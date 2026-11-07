import { t as tx, useLocale } from '../i18n';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendarEvent,
  IconExternalLink,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, write } from '../api';
import { Empty, ErrorState, LegacyLink, Loading, PageHeading, useOverview } from '../components';
import { ScopeFields } from './forms';
import { useAuth } from '../auth';
import type { LobbyDetail, Payments, PaymentStatus, Question } from '../types';
export function CreateLobby({
  opened,
  close,
  embedded = false,
}: {
  opened: boolean;
  close: () => void;
  embedded?: boolean;
}) {
  useLocale();
  const { user } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sport, setSport] = useState('padel');
  const [community, setCommunity] = useState(user?.default_community_id || 'open');
  const [club, setClub] = useState<string | null>(null);
  const [listed, setListed] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      write<{
        id: string;
      }>('/registrations', {
        name,
        description,
        sport,
        community_id: community,
        club_id: club,
        listed,
        auto_send_email: false,
      }),
    onSuccess: (lobby) => {
      void client.invalidateQueries({
        queryKey: ['lobbies'],
      });
      close();
      setName('');
      navigate(`/registrations/${lobby.id}`);
    },
  });
  const content = (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Stack>
          {create.error && <Alert color="red">{tx(create.error.message)}</Alert>}
          <TextInput
            label={tx('Event name')}
            required
            maxLength={255}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Textarea
            label={tx('Description')}
            minRows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Select
            label={tx('Sport')}
            value={sport}
            allowDeselect={false}
            onChange={(v) => setSport(v!)}
            data={[
              {
                value: 'padel',
                label: tx('Padel'),
              },
              {
                value: 'tennis',
                label: tx('Tennis'),
              },
            ]}
          />
          <ScopeFields
            community={community}
            setCommunity={setCommunity}
            club={club}
            setClub={setClub}
          />
          <Switch
            label={tx('List in public events')}
            checked={listed}
            onChange={(e) => setListed(e.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {tx('Cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {tx('Create lobby')}
            </Button>
          </Group>
        </Stack>
      </form>
    </>
  );
  return embedded ? (
    content
  ) : (
    <Modal opened={opened} onClose={close} title={tx('Create registration lobby')} centered>
      {content}
    </Modal>
  );
}
export function LobbiesPage() {
  useLocale();
  const { lobbies } = useOverview();
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(false);
  const list = (lobbies.data || []).filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title={tx('Registrations')}
        description={tx('Get your people together for the next great game.')}
      >
        <Button leftSection={<IconPlus size={17} />} onClick={() => setOpened(true)}>
          {tx('Create lobby')}
        </Button>
      </PageHeading>
      <TextInput
        mb="xl"
        maw={380}
        aria-label={tx('Search registrations')}
        placeholder={tx('Search registrations')}
        leftSection={<IconSearch size={17} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {lobbies.isPending ? (
        <Loading />
      ) : lobbies.error ? (
        <ErrorState error={lobbies.error} retry={() => void lobbies.refetch()} />
      ) : !list.length ? (
        <Empty title={tx('No registration lobbies found')} />
      ) : (
        <SimpleGrid
          cols={{
            base: 1,
            md: 2,
            xl: 3,
          }}
        >
          {list.map((l) => (
            <Card key={l.id} withBorder p="xl">
              <Group justify="space-between" mb="lg">
                <IconCalendarEvent size={28} stroke={1.4} color="var(--app-primary)" />
                <Badge color={l.open ? 'court' : 'gray'} variant="light">
                  {l.open ? tx('Registration open') : tx('Closed')}
                </Badge>
              </Group>
              <Title order={3}>{l.name}</Title>
              <Text size="sm" c="dimmed" mt="xs">
                {l.club_name || tx('Independent event')} · {l.sport}
              </Text>
              <Text size="sm" mt="md" lineClamp={2} mih={42}>
                {l.description || tx('Bring your community together.')}
              </Text>
              <Group justify="space-between" mt="xl">
                <Text size="sm" fw={600}>
                  {tx('{count} registered', { count: l.registrant_count })}
                </Text>
                <Button
                  component={Link}
                  to={`/registrations/${l.id}`}
                  variant="light"
                  rightSection={<IconArrowRight size={15} />}
                >
                  {tx('Manage')}
                </Button>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}
      <CreateLobby opened={opened} close={() => setOpened(false)} />
    </>
  );
}
function AddRegistrant({
  id,
  questions,
  close,
}: {
  id: string;
  questions: Question[];
  close: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: () =>
      write(`/registrations/${id}/registrant`, {
        player_name: name,
        email,
        answers,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['lobby', id],
      });
      void client.invalidateQueries({
        queryKey: ['lobbies'],
      });
      close();
      notifications.show({
        message: tx('Player added'),
        color: 'green',
      });
    },
  });
  return (
    <Modal opened onClose={close} title={tx('Add a player')} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Stack>
          {add.error && <Alert color="red">{tx(add.error.message)}</Alert>}
          <TextInput
            label={tx('Player name')}
            required
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label={tx('Email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          {questions.map((q) =>
            q.type === 'choice' ? (
              <Select
                key={q.key}
                label={q.label}
                required={q.required}
                data={q.choices}
                value={answers[q.key] || null}
                onChange={(v) =>
                  setAnswers({
                    ...answers,
                    [q.key]: v || '',
                  })
                }
              />
            ) : (
              <TextInput
                key={q.key}
                label={q.label}
                description={
                  q.type === 'multichoice' ? tx('Separate choices with commas') : undefined
                }
                required={q.required}
                type={q.type === 'number' ? 'number' : 'text'}
                value={answers[q.key] || ''}
                onChange={(e) =>
                  setAnswers({
                    ...answers,
                    [q.key]: e.currentTarget.value,
                  })
                }
              />
            ),
          )}
          <Button type="submit" loading={add.isPending}>
            {tx('Add player')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
function FeeSettings({ id, data, close }: { id: string; data: Payments; close: () => void }) {
  useLocale();
  const client = useQueryClient();
  const [fee, setFee] = useState<number | string>(data.settings.fee_cents / 100);
  const [instructions, setInstructions] = useState(data.settings.instructions || '');
  const update = useMutation({
    mutationFn: () =>
      write(
        `/registrations/${id}/payment-settings`,
        {
          fee_cents: Math.round(Number(fee) * 100),
          currency: data.settings.currency,
          instructions,
        },
        'PATCH',
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['lobby', id],
      });
      close();
    },
  });
  return (
    <Modal opened onClose={close} title={tx('Payment settings')} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <Stack>
          {update.error && <Alert color="red">{tx(update.error.message)}</Alert>}
          <NumberInput
            label={tx('Fee per player ({value1})', {
              value1: data.settings.currency,
            })}
            min={0}
            decimalScale={2}
            required
            value={fee}
            onChange={setFee}
          />
          <Textarea
            label={tx('Instructions')}
            maxLength={2000}
            value={instructions}
            onChange={(e) => setInstructions(e.currentTarget.value)}
          />
          <Button type="submit" loading={update.isPending}>
            {tx('Save settings')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
export function LobbyPage() {
  useLocale();
  const { id = '' } = useParams();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const detail = useQuery({
    queryKey: ['lobby', id, 'detail'],
    queryFn: () => api<LobbyDetail>(`/registrations/${id}`),
    refetchInterval: 30_000,
  });
  const payments = useQuery({
    queryKey: ['lobby', id, 'payments'],
    queryFn: () => api<Payments>(`/registrations/${id}/payments`),
    refetchInterval: 30_000,
  });
  const changeStatus = useMutation({
    mutationFn: ({ player, status }: { player: string; status: PaymentStatus }) =>
      write(
        `/registrations/${id}/payments/${player}`,
        {
          status,
        },
        'PATCH',
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['lobby', id, 'payments'],
      });
      notifications.show({
        message: tx('Payment status updated'),
        color: 'green',
      });
    },
  });
  const toggle = useMutation({
    mutationFn: () =>
      write(
        `/registrations/${id}`,
        {
          open: !detail.data?.open,
        },
        'PATCH',
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['lobby', id],
      });
      void client.invalidateQueries({
        queryKey: ['lobbies'],
      });
    },
  });
  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorState error={detail.error} retry={() => void detail.refetch()} />;
  const lobby = detail.data;
  return (
    <>
      <Button
        component={Link}
        to="/registrations"
        variant="subtle"
        color="gray"
        leftSection={<IconArrowLeft size={16} />}
        mb="lg"
        px={0}
      >
        {tx('All registrations')}
      </Button>
      <PageHeading
        title={lobby.name}
        description={lobby.description || tx('Manage your players and registration payments.')}
      >
        <Group>
          <LegacyLink />
          <Button
            component="a"
            href={`/register/${id}`}
            variant="default"
            rightSection={<IconExternalLink size={15} />}
          >
            {tx('Public sign-up')}
          </Button>
        </Group>
      </PageHeading>
      <Paper p="lg" mb="lg">
        <Group justify="space-between">
          <Group>
            <Badge color={lobby.open ? 'court' : 'gray'}>
              {lobby.open ? tx('Registration open') : tx('Closed')}
            </Badge>
            <Text size="sm">
              {lobby.registrants.length}
              {' ' + tx('players')}
            </Text>
          </Group>
          <Group>
            <Button variant="default" loading={toggle.isPending} onClick={() => toggle.mutate()}>
              {lobby.open ? tx('Close registration') : tx('Reopen registration')}
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
              {tx('Add player')}
            </Button>
          </Group>
        </Group>
        {toggle.error && (
          <Alert color="red" mt="md">
            {tx(toggle.error.message)}
          </Alert>
        )}
      </Paper>
      <Tabs defaultValue="players">
        <Tabs.List mb="lg">
          <Tabs.Tab value="players">{tx('Players')}</Tabs.Tab>
          <Tabs.Tab value="payments">{tx('Payments')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="players">
          {!lobby.registrants.length ? (
            <Empty title={tx('Your next game starts here')}>
              {tx('Add a player or share the public registration link.')}
            </Empty>
          ) : (
            <Paper>
              <Table.ScrollContainer minWidth={600}>
                <Table verticalSpacing="md" horizontalSpacing="lg">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{tx('Player')}</Table.Th>
                      <Table.Th>{tx('Email')}</Table.Th>
                      {lobby.questions.map((q) => (
                        <Table.Th key={q.key}>{q.label}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lobby.registrants.map((p) => (
                      <Table.Tr key={p.player_id}>
                        <Table.Td>
                          <Text fw={600} size="sm">
                            {p.player_name}
                          </Text>
                        </Table.Td>
                        <Table.Td>{p.email || '—'}</Table.Td>
                        {lobby.questions.map((q) => (
                          <Table.Td key={q.key}>{p.answers[q.key] || '—'}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="payments">
          {payments.isPending ? (
            <Loading />
          ) : payments.error ? (
            <ErrorState error={payments.error} retry={() => void payments.refetch()} />
          ) : (
            <>
              <Group justify="space-between" mb="lg">
                <div>
                  <Title order={3}>
                    {money(payments.data.summary.collected_cents, payments.data.settings.currency)}{' '}
                    {tx('collected')}
                  </Title>
                  <Text size="sm" c="dimmed" mt={5}>
                    {payments.data.summary.paid}
                    {' ' + tx('paid ·') + ' '}
                    {payments.data.summary.unpaid}
                    {' ' + tx('unpaid ·')} {payments.data.summary.reported}
                    {tx('reported')}
                  </Text>
                </div>
                <Button variant="default" onClick={() => setSettings(true)}>
                  {tx('Payment settings')}
                </Button>
              </Group>
              {changeStatus.error && (
                <Alert color="red" mb="md">
                  {tx(changeStatus.error.message)}
                </Alert>
              )}
              <Paper>
                <Table.ScrollContainer minWidth={650}>
                  <Table verticalSpacing="md" horizontalSpacing="lg">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{tx('Player')}</Table.Th>
                        <Table.Th>{tx('Amount')}</Table.Th>
                        <Table.Th>{tx('Reference')}</Table.Th>
                        <Table.Th>{tx('Status')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {payments.data.rows.map((p) => (
                        <Table.Tr key={p.player_id}>
                          <Table.Td>
                            <Text fw={600} size="sm">
                              {p.player_name}
                            </Text>
                          </Table.Td>
                          <Table.Td>{money(p.amount_cents, p.currency)}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {p.concept}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Select
                              aria-label={tx('Payment status for {value1}', {
                                value1: p.player_name,
                              })}
                              w={150}
                              size="xs"
                              allowDeselect={false}
                              value={p.status}
                              disabled={changeStatus.isPending}
                              data={[
                                'unpaid',
                                'reported',
                                'paid',
                                'waived',
                                'refund_due',
                                'refunded',
                              ].map((v) => ({
                                value: v,
                                label: tx(v.replace('_', ' ')),
                              }))}
                              onChange={(v) =>
                                v &&
                                changeStatus.mutate({
                                  player: p.player_id,
                                  status: v as PaymentStatus,
                                })
                              }
                            />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
              {settings && (
                <FeeSettings id={id} data={payments.data} close={() => setSettings(false)} />
              )}
            </>
          )}
        </Tabs.Panel>
      </Tabs>
      {adding && (
        <AddRegistrant id={id} questions={lobby.questions} close={() => setAdding(false)} />
      )}
    </>
  );
}
