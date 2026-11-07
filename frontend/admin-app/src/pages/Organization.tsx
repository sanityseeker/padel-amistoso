import { t as tx, useLocale } from '../i18n';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconBuildingCommunity, IconPlus, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, write } from '../api';
import { Empty, ErrorState, LegacyLink, Loading, PageHeading, useOverview } from '../components';
import { useAuth } from '../auth';
import type { Club, Season, User } from '../types';
function ClubDetail({ club, close }: { club: Club; close: () => void }) {
  useLocale();
  const client = useQueryClient();
  const [seasonName, setSeasonName] = useState('');
  const seasons = useQuery({
    queryKey: ['seasons', club.id],
    queryFn: () => api<Season[]>(`/clubs/${club.id}/seasons`),
  });
  const tiers = useQuery({
    queryKey: ['tiers', club.id],
    queryFn: () =>
      api<
        {
          id: string;
          name: string;
          sport: string;
          base_elo: number;
        }[]
      >(`/clubs/${club.id}/tiers`),
  });
  const createSeason = useMutation({
    mutationFn: () =>
      write(`/clubs/${club.id}/seasons`, {
        name: seasonName,
      }),
    onSuccess: () => {
      setSeasonName('');
      void client.invalidateQueries({
        queryKey: ['seasons', club.id],
      });
    },
  });
  return (
    <Modal opened onClose={close} title={club.name} size="lg" centered>
      <Stack>
        <Text c="dimmed" size="sm">
          {club.description || tx('Your club’s seasons and player tiers.')}
        </Text>
        <Tabs defaultValue="seasons">
          <Tabs.List>
            <Tabs.Tab value="seasons">{tx('Seasons')}</Tabs.Tab>
            <Tabs.Tab value="tiers">{tx('Skill tiers')}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="seasons" pt="md">
            {seasons.isPending ? (
              <Loading />
            ) : seasons.error ? (
              <ErrorState error={seasons.error} />
            ) : (
              <Stack>
                {seasons.data.map((s) => (
                  <Paper p="md" key={s.id}>
                    <Group justify="space-between">
                      <Text fw={600}>{s.name}</Text>
                      <Badge color={s.active ? 'court' : 'gray'}>
                        {s.active ? tx('Active') : tx('Archived')}
                      </Badge>
                    </Group>
                  </Paper>
                ))}
                {!seasons.data.length && <Text c="dimmed">{tx('No seasons yet.')}</Text>}
              </Stack>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createSeason.mutate();
              }}
            >
              <Group mt="lg" align="flex-end">
                <TextInput
                  label={tx('New season')}
                  required
                  maxLength={100}
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.currentTarget.value)}
                  style={{
                    flex: 1,
                  }}
                />
                <Button type="submit" loading={createSeason.isPending}>
                  {tx('Add season')}
                </Button>
              </Group>
            </form>
            {createSeason.error && (
              <Alert color="red" mt="md">
                {tx(createSeason.error.message)}
              </Alert>
            )}
          </Tabs.Panel>
          <Tabs.Panel value="tiers" pt="md">
            {tiers.isPending ? (
              <Loading />
            ) : tiers.error ? (
              <ErrorState error={tiers.error} />
            ) : (
              <Stack>
                {tiers.data.map((t) => (
                  <Paper p="md" key={t.id}>
                    <Group justify="space-between">
                      <div>
                        <Text fw={600}>{t.name}</Text>
                        <Text size="xs" c="dimmed" tt="capitalize">
                          {t.sport}
                        </Text>
                      </div>
                      <Badge variant="light">
                        {t.base_elo}
                        {' ' + tx('ELO')}
                      </Badge>
                    </Group>
                  </Paper>
                ))}
                {!tiers.data.length && (
                  <Text c="dimmed">{tx('Configure skill tiers in Advanced admin.')}</Text>
                )}
              </Stack>
            )}
          </Tabs.Panel>
        </Tabs>
        <LegacyLink />
      </Stack>
    </Modal>
  );
}
export function ClubsPage() {
  useLocale();
  const { user } = useAuth();
  const client = useQueryClient();
  const { communities, clubs, tournaments } = useOverview();
  const [kind, setKind] = useState<'club' | 'community' | null>(null);
  const [name, setName] = useState('');
  const [community, setCommunity] = useState<string | null>(null);
  const [selected, setSelected] = useState<Club | null>(null);
  const create = useMutation({
    mutationFn: () =>
      write(
        kind === 'club' ? '/clubs' : '/communities',
        kind === 'club'
          ? {
              name,
              community_id: community,
            }
          : {
              name,
            },
      ),
    onSuccess: () => {
      setKind(null);
      setName('');
      void client.invalidateQueries({
        queryKey: ['clubs'],
      });
      void client.invalidateQueries({
        queryKey: ['communities'],
      });
    },
  });
  return (
    <>
      <PageHeading
        title={tx('Clubs & communities')}
        description={tx('The people and places that make your game.')}
      >
        <Group>
          {user?.role === 'admin' && (
            <Button
              variant="default"
              onClick={() => {
                create.reset();
                setKind('community');
              }}
            >
              {tx('New community')}
            </Button>
          )}
          <Button
            leftSection={<IconPlus size={17} />}
            onClick={() => {
              create.reset();
              setKind('club');
            }}
          >
            {tx('Create club')}
          </Button>
        </Group>
      </PageHeading>
      {clubs.isPending || communities.isPending ? (
        <Loading />
      ) : clubs.error || communities.error ? (
        <ErrorState error={clubs.error || communities.error} />
      ) : (
        <>
          <SimpleGrid
            cols={{
              base: 1,
              md: 2,
              xl: 3,
            }}
          >
            {clubs.data.map((c) => (
              <Card withBorder p="xl" key={c.id}>
                <IconBuildingCommunity size={32} stroke={1.4} color="var(--app-primary)" />
                <Title order={3} mt="lg">
                  {c.name}
                </Title>
                <Text size="sm" c="dimmed" mt="xs">
                  {communities.data.find((cm) => cm.id === c.community_id)?.name}
                </Text>
                <Group justify="space-between" mt="xl">
                  <Badge variant="light">
                    {(tournaments.data || []).filter((t) => t.club_id === c.id).length}
                    {tx('tournaments')}
                  </Badge>
                  <Button variant="light" onClick={() => setSelected(c)}>
                    {tx('Manage club')}
                  </Button>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
          {!clubs.data.length && <Empty title={tx('Your club belongs here')} />}
          <Title order={3} mt="xl" mb="md">
            {tx('Communities')}
          </Title>
          <Paper>
            <Table verticalSpacing="md" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Community')}</Table.Th>
                  <Table.Th>{tx('Clubs')}</Table.Th>
                  <Table.Th>{tx('Tournaments')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {communities.data.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td>
                      <Text fw={600} size="sm">
                        {c.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {clubs.data.filter((cl) => cl.community_id === c.id).length}
                    </Table.Td>
                    <Table.Td>
                      {(tournaments.data || []).filter((t) => t.community_id === c.id).length}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </>
      )}
      {selected && <ClubDetail key={selected.id} club={selected} close={() => setSelected(null)} />}
      <Modal
        opened={!!kind}
        onClose={() => setKind(null)}
        title={kind === 'club' ? tx('Create club') : tx('Create community')}
        centered
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Stack>
            {create.error && <Alert color="red">{tx(create.error.message)}</Alert>}
            <TextInput
              label={tx('Name')}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            {kind === 'club' && (
              <Select
                label={tx('Community')}
                required
                data={(communities.data || [])
                  .filter((c) => c.id !== 'open')
                  .map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                value={community}
                onChange={setCommunity}
              />
            )}
            <Button type="submit" loading={create.isPending}>
              {tx(kind === 'club' ? 'Create club' : 'Create community')}
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
export function UsersPage() {
  useLocale();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<User[]>('/auth/users'),
  });
  const create = useMutation({
    mutationFn: () =>
      write('/auth/users', {
        username,
        password,
        role,
      }),
    onSuccess: () => {
      setOpened(false);
      setUsername('');
      setPassword('');
      void client.invalidateQueries({
        queryKey: ['users'],
      });
    },
  });
  return (
    <>
      <PageHeading
        title={tx('Users')}
        description={tx('Give your organizing team a place in the club.')}
      >
        <Button
          leftSection={<IconPlus size={17} />}
          onClick={() => {
            create.reset();
            setOpened(true);
          }}
        >
          {tx('Add user')}
        </Button>
      </PageHeading>
      <TextInput
        maw={380}
        mb="xl"
        placeholder={tx('Search users')}
        aria-label={tx('Search users')}
        leftSection={<IconSearch size={17} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {users.isPending ? (
        <Loading />
      ) : users.error ? (
        <ErrorState error={users.error} retry={() => void users.refetch()} />
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={500}>
            <Table verticalSpacing="md" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Username')}</Table.Th>
                  <Table.Th>{tx('Role')}</Table.Th>
                  <Table.Th>{tx('Email')}</Table.Th>
                  <Table.Th>{tx('Status')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {users.data
                  .filter((u) => u.username.toLowerCase().includes(search.toLowerCase()))
                  .map((u) => (
                    <Table.Tr key={u.username}>
                      <Table.Td>
                        <Text fw={600} size="sm">
                          {u.username}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={u.role === 'admin' ? 'court' : 'gray'} variant="light">
                          {u.role}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{u.email || '—'}</Table.Td>
                      <Table.Td>{u.disabled ? tx('Disabled') : tx('Active')}</Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      <Modal opened={opened} onClose={() => setOpened(false)} title={tx('Add user')} centered>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Stack>
            {create.error && <Alert color="red">{tx(create.error.message)}</Alert>}
            <TextInput
              label={tx('Username')}
              autoComplete="off"
              required
              minLength={3}
              maxLength={64}
              pattern="[a-zA-Z0-9_-]+"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
            <TextInput
              label={tx('Temporary password')}
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Select
              label={tx('Role')}
              allowDeselect={false}
              value={role}
              onChange={(v) => setRole(v!)}
              data={[
                {
                  value: 'user',
                  label: tx('Organizer'),
                },
                {
                  value: 'admin',
                  label: tx('Administrator'),
                },
              ]}
            />
            <Button type="submit" loading={create.isPending}>
              {tx('Create user')}
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
