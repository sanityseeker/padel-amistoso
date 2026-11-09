import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconArrowRight,
  IconDots,
  IconExternalLink,
  IconMail,
  IconPencil,
  IconPlus,
  IconQrcode,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PaymentsPanel } from '../../admin/settings/PaymentsPanel';
import { api, ApiError, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail, ParticipationClaim, Registrant } from '../../types';
import {
  ConfirmAction,
  CopyField,
  EmptyState,
  MutationError,
  QrSheet,
  SportMark,
  StatusBadge,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { sportProps } from '../../theme';
import { closeItem } from '../switcher';
import { AnswersPanel } from './AnswersPanel';
import { CodesPanel, ClaimsPanel } from './LobbyPanels';
import { LobbySettings } from './LobbySettings';
import { ParticipantFilter } from './ParticipantFilter';
import { RegistrantSheet } from './RegistrantSheet';

function RowMenu({
  lobbyId,
  p,
  onEdit,
  onRemove,
}: {
  lobbyId: string;
  p: Registrant;
  onEdit: () => void;
  onRemove: () => void;
}) {
  useLocale();
  const mail = (path: string, success: string) =>
    write(`/registrations/${lobbyId}/${path}/${p.player_id}`, undefined, 'POST').then(
      () => success,
    );
  const send = useAdminMutation({
    request: (kind: 'send-email' | 'send-cancellation-email' | 'send-waitlist-email') =>
      mail(kind, kind),
    success: 'Email sent',
  });
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon aria-label={`${tx('Player options')}: ${p.player_name}`}>
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={15} />} onClick={onEdit}>
          {tx('Edit')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconMail size={15} />}
          disabled={!p.email}
          onClick={() => send.mutate('send-email')}
        >
          {tx('Email login details')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconMail size={15} />}
          disabled={!p.email}
          onClick={() => send.mutate('send-waitlist-email')}
        >
          {tx('Email: a spot opened up')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconMail size={15} />}
          disabled={!p.email}
          onClick={() => send.mutate('send-cancellation-email')}
        >
          {tx('Email: registration cancelled')}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={onRemove}>
          {tx('Remove')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

// A lobby: share the sign-up link, manage the people who registered, collect fees, and turn the
// list into a tournament.
export function LobbyPage() {
  useLocale();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [editing, setEditing] = useState<Registrant | 'new' | null>(null);
  const [removing, setRemoving] = useState<Registrant | null>(null);
  const [settings, setSettings] = useState(false);
  const [qr, setQr] = useState(false);
  const [tab, setTab] = useState<string | null>('players');
  const detail = useQuery({
    queryKey: ['admin', 'lobby', id, 'detail'],
    queryFn: () => api<LobbyDetail>(`/registrations/${id}`),
    refetchInterval: 30_000,
  });
  const claims = useQuery({
    queryKey: ['admin', 'lobby', id, 'claims'],
    queryFn: () => api<ParticipationClaim[]>(`/registrations/${id}/claims`),
    enabled: !!detail.data,
  });
  const toggle = useAdminMutation({
    request: () => write(`/registrations/${id}`, { open: !detail.data?.open }, 'PATCH'),
    invalidate: [
      ['admin', 'lobby', id],
      ['admin', 'lobbies'],
    ],
  });
  // A closed lobby can be archived (kept, out of the way); an archived one can only be restored.
  const archive = useAdminMutation({
    request: () => write(`/registrations/${id}`, { archived: !detail.data?.archived }, 'PATCH'),
    invalidate: [
      ['admin', 'lobby', id],
      ['admin', 'lobbies'],
    ],
    success: 'Lobby updated',
  });
  const remove = useAdminMutation({
    request: (p: Registrant) =>
      write(`/registrations/${id}/registrant/${p.player_id}`, undefined, 'DELETE'),
    invalidate: [
      ['admin', 'lobby', id],
      ['admin', 'lobbies'],
    ],
    success: 'Player removed',
    onSuccess: () => setRemoving(null),
  });
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => {
    if (missing) closeItem(id);
  }, [missing, id]);
  if (detail.isPending) return <Loading />;
  if (detail.error) return <ErrorState error={detail.error} retry={() => void detail.refetch()} />;
  const lobby = detail.data;
  const assigned = new Set(lobby.assigned_player_ids ?? []);
  const unassigned = lobby.registrants.filter((r) => !assigned.has(r.player_id)).length;
  const link = `${window.location.origin}/register/${lobby.alias || lobby.id}`;
  const canEdit = true;
  const linked = lobby.linked_tournaments ?? [];
  const nameCounts = new Map<string, number>();
  for (const r of lobby.registrants) {
    const key = r.player_name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set([...nameCounts].filter(([, n]) => n > 1).map(([k]) => k));
  const filtered = (lobby.participant_filter?.length ?? 0) > 0;
  const eligibleIds = new Set(lobby.eligible_player_ids ?? []);
  const entries = lobby.registrants.map((p) => {
    const tids = lobby.player_tournament_map?.[p.player_id] ?? [];
    return { p, tids };
  });
  const playerCell = (p: Registrant, tids: string[]) => (
    <Group gap={6}>
      <Text fw={600} size="sm">
        {p.player_name}
      </Text>
      {tids.length > 0 && (
        <Badge size="xs" variant="light" color="gray">
          {tx('In a tournament')}
        </Badge>
      )}
      {duplicates.has(p.player_name.trim().toLowerCase()) && (
        <Badge size="xs" variant="light" color="yellow">
          {tx('Same name')}
        </Badge>
      )}
      {filtered && !eligibleIds.has(p.player_id) && (
        <Badge size="xs" variant="light" color="red">
          {tx('Not eligible')}
        </Badge>
      )}
    </Group>
  );
  const menu = (p: Registrant) => (
    <RowMenu
      lobbyId={id}
      p={p}
      onEdit={() => setEditing(p)}
      onRemove={() => {
        remove.reset();
        setRemoving(p);
      }}
    />
  );

  return (
    <Stack gap="lg" {...sportProps(lobby.sport)}>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} miw={0}>
            <Text variant="eyebrow">
              {[tx('Lobby'), lobby.club_name || lobby.community_name].filter(Boolean).join(' · ')}
            </Text>
            <VisuallyHidden>
              <Title order={1}>{lobby.name}</Title>
            </VisuallyHidden>
            {lobby.description && <Text c="dimmed">{lobby.description}</Text>}
          </Stack>
          <ActionIcon size="touch" aria-label={tx('Settings')} onClick={() => setSettings(true)}>
            <IconSettings size={20} />
          </ActionIcon>
        </Group>
        <Group gap="sm">
          <StatusBadge tone={lobby.open ? 'success' : 'neutral'}>
            {lobby.archived ? tx('Archived') : lobby.open ? tx('Registration open') : tx('Closed')}
          </StatusBadge>
          <SportMark sport={lobby.sport} />
          <Text size="sm">
            {lobby.registrants.length}
            {' ' + tx('players')}
          </Text>
          {claims.data && claims.data.length > 0 && (
            <Badge
              color="red"
              variant="light"
              component="button"
              type="button"
              onClick={() => setTab('claims')}
            >
              {tx('{n} claims to review', { n: claims.data.length })}
            </Badge>
          )}
        </Group>
      </Stack>
      <Paper p="md">
        <Stack gap="sm">
          <Text variant="eyebrow">{tx('Share the sign-up')}</Text>
          <CopyField value={link} label={tx('Public sign-up')} />
          <Group justify="space-between" gap="sm">
            <Group gap="xs">
              {lobby.archived ? (
                <Button
                  variant="default"
                  loading={archive.isPending}
                  onClick={() => archive.mutate()}
                >
                  {tx('Unarchive')}
                </Button>
              ) : (
                <Button
                  variant="default"
                  loading={toggle.isPending}
                  onClick={() => toggle.mutate()}
                >
                  {lobby.open ? tx('Close registration') : tx('Reopen registration')}
                </Button>
              )}
              {!lobby.archived && !lobby.open && (
                <Button
                  variant="default"
                  loading={archive.isPending}
                  onClick={() => archive.mutate()}
                >
                  {tx('Archive')}
                </Button>
              )}
              <Button
                variant="default"
                leftSection={<IconQrcode size={16} />}
                onClick={() => setQr(true)}
              >
                {tx('QR code')}
              </Button>
              <Button
                component="a"
                href={`/register/${lobby.alias || id}`}
                variant="default"
                rightSection={<IconExternalLink size={15} />}
              >
                {tx('Public sign-up')}
              </Button>
              {canEdit && (
                <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                  {tx('Add player')}
                </Button>
              )}
            </Group>
            {!lobby.archived && (
              <Button
                rightSection={<IconArrowRight size={16} />}
                disabled={lobby.registrants.length < 2 || unassigned < 2}
                onClick={() => navigate(`/admin/new?from=${id}&type=group_playoff`)}
              >
                {tx('Convert to tournament')}
              </Button>
            )}
          </Group>
          <MutationError error={toggle.error ?? archive.error} />
          {linked.length > 0 && (
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                {tx('Created from this lobby:')}
              </Text>
              {linked.map((t) => (
                <Anchor key={t.id} component={Link} to={`/admin/t/${t.id}`} size="sm">
                  {t.name}
                </Anchor>
              ))}
            </Group>
          )}
        </Stack>
      </Paper>
      <Tabs value={tab === 'claims' && !claims.data?.length ? 'players' : tab} onChange={setTab}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="players">{tx('Players')}</Tabs.Tab>
          {!!claims.data?.length && (
            <Tabs.Tab
              value="claims"
              rightSection={
                <Badge size="sm" circle color="red">
                  {claims.data.length}
                </Badge>
              }
            >
              {tx('Claims')}
            </Tabs.Tab>
          )}
          {lobby.questions.length > 0 && <Tabs.Tab value="answers">{tx('Answers')}</Tabs.Tab>}
          <Tabs.Tab
            value="filter"
            rightSection={
              lobby.participant_filter?.length ? (
                <Badge size="sm" variant="light">
                  {lobby.eligible_player_ids?.length ?? 0}/{lobby.registrants.length}
                </Badge>
              ) : undefined
            }
          >
            {tx('Eligibility')}
          </Tabs.Tab>
          <Tabs.Tab value="payments">{tx('Payments')}</Tabs.Tab>
          <Tabs.Tab value="codes">{tx('Player codes')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="players">
          {!lobby.registrants.length ? (
            <EmptyState title={tx('Your next game starts here')}>
              {tx('Add a player or share the public registration link.')}
            </EmptyState>
          ) : phone ? (
            // One row per player: the menu sits on the row and any answers are listed under it, so
            // Edit is two taps (menu, Edit) and nothing has to be expanded first.
            <Paper p={0} variant="row" role="list" style={{ overflow: 'hidden' }}>
              {entries.map(({ p, tids }) => (
                <Group
                  key={p.player_id}
                  role="listitem"
                  wrap="nowrap"
                  align="flex-start"
                  justify="space-between"
                  gap="xs"
                  p="sm"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
                  <Stack gap={2} miw={0}>
                    {playerCell(p, tids)}
                    <Text size="xs" c="dimmed">
                      {p.email || '—'}
                    </Text>
                    {lobby.questions.map((q) => (
                      <Text key={q.key} size="xs" c="dimmed">
                        {q.label}:{' '}
                        <Text span size="xs">
                          {p.answers[q.key] || '—'}
                        </Text>
                      </Text>
                    ))}
                  </Stack>
                  {menu(p)}
                </Group>
              ))}
            </Paper>
          ) : (
            <Paper>
              <Table.ScrollContainer minWidth={600}>
                <Table verticalSpacing="md" horizontalSpacing="lg" stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{tx('Player')}</Table.Th>
                      <Table.Th>{tx('Email')}</Table.Th>
                      {lobby.questions.map((q) => (
                        <Table.Th key={q.key}>{q.label}</Table.Th>
                      ))}
                      <Table.Th w={1} aria-label={tx('Actions')} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {entries.map(({ p, tids }) => (
                      <Table.Tr key={p.player_id}>
                        <Table.Td>{playerCell(p, tids)}</Table.Td>
                        <Table.Td>{p.email || '—'}</Table.Td>
                        {lobby.questions.map((q) => (
                          <Table.Td key={q.key}>{p.answers[q.key] || '—'}</Table.Td>
                        ))}
                        <Table.Td>{menu(p)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )}
        </Tabs.Panel>
        {!!claims.data?.length && (
          <Tabs.Panel value="claims">
            <ClaimsPanel lobbyId={id} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="answers">
          <AnswersPanel lobby={lobby} />
        </Tabs.Panel>
        <Tabs.Panel value="filter">
          <ParticipantFilter key={JSON.stringify(lobby.participant_filter ?? [])} lobby={lobby} />
        </Tabs.Panel>
        <Tabs.Panel value="payments">
          <PaymentsPanel base={`/registrations/${id}`} scope="lobby" />
        </Tabs.Panel>
        <Tabs.Panel value="codes">
          <CodesPanel lobbyId={id} />
        </Tabs.Panel>
      </Tabs>
      {editing && (
        <RegistrantSheet
          lobbyId={id}
          questions={lobby.questions}
          registrant={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <QrSheet
        opened={qr}
        onClose={() => setQr(false)}
        title={tx('Sign-up QR code')}
        caption={tx('Players scan this to open the sign-up page of {name}.', { name: lobby.name })}
        value={link}
        filename={`${lobby.alias || lobby.id}-signup-qr.svg`}
      />
      {settings && <LobbySettings lobby={lobby} onClose={() => setSettings(false)} />}
      <ConfirmAction
        opened={!!removing}
        title={tx('Remove {name}?', { name: removing?.player_name })}
        description={tx('They leave the sign-up list and their payment record is removed.')}
        confirmLabel={tx('Remove')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </Stack>
  );
}
