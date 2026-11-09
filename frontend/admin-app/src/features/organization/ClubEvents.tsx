import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Group,
  Menu,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconExternalLink,
  IconLink,
  IconLinkPlus,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconUnlink,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, write } from '../../api';
import { useAuth } from '../../auth';
import { ErrorState, Loading, useLobbyList, useTournamentList } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { Club, Season } from '../../types';
import {
  ConfirmAction,
  EmptyState,
  EventRow,
  MutationError,
  SportMark,
  StatusBadge,
} from '../../ui';
import type { StatusTone } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import {
  attachCandidates,
  deriveEvents,
  type ClubEvent,
  type EventState,
  type EventTab,
  type PublicItem,
} from './events';

const STATE: Record<EventState, { label: string; tone: StatusTone }> = {
  live: { label: 'Live', tone: 'success' },
  upcoming: { label: 'Not started', tone: 'info' },
  finished: { label: 'Finished', tone: 'neutral' },
  open_registration: { label: 'Sign-ups open', tone: 'success' },
  ready_to_convert: { label: 'Ready to convert', tone: 'warning' },
  closed: { label: 'Closed', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};
const stateLabel = (s: EventState) => tx(STATE[s].label);

// A club's events in one list: tournaments and sign-up lobbies with their state, the season each
// belongs to, and pins. Pinned events lead the club's public page, in the order set here
// (PATCH /clubs/{id}/landing `pinned_tournament_ids`). Events you own can be attached to the club
// or removed from it.
export function ClubEvents({ club }: { club: Club }) {
  useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const tournaments = useTournamentList();
  const lobbies = useLobbyList();
  const seasons = useQuery({
    queryKey: ['admin', 'seasons', club.id],
    queryFn: () => api<Season[]>(`/clubs/${club.id}/seasons`),
  });
  const publicItems = useQuery({
    queryKey: ['admin', 'club-public', club.id],
    queryFn: () => api<PublicItem[]>(`/clubs/${club.id}/public-tournaments`),
  });
  const [tab, setTab] = useState<EventTab>('active');
  const [attachOpen, setAttachOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<ClubEvent | null>(null);
  const me = { username: user?.username ?? '', admin: user?.role === 'admin' };
  const pins = club.pinned_tournament_ids ?? [];
  const refresh = [
    ['admin', 'clubs'],
    ['admin', 'tournaments'],
    ['admin', 'lobbies'],
    ['admin', 'club-public', club.id],
  ];
  const savePins = useAdminMutation({
    request: (next: string[]) =>
      write(`/clubs/${club.id}/landing`, { pinned_tournament_ids: next }, 'PATCH'),
    invalidate: refresh,
    success: 'Saved',
  });
  const setSeason = useAdminMutation({
    request: ({ row, season }: { row: ClubEvent; season: string | null }) =>
      write(
        `/${row.kind === 'lobby' ? 'registrations' : 'tournaments'}/${row.id}/season`,
        { season_id: season },
        'PATCH',
      ),
    invalidate: refresh,
    success: 'Saved',
  });
  const detach = useAdminMutation({
    request: async (row: ClubEvent) => {
      await write(
        `/${row.kind === 'lobby' ? 'registrations' : 'tournaments'}/${row.id}/club`,
        { club_id: null },
        'PATCH',
      );
      if (pins.includes(row.key) || pins.includes(row.id))
        await write(
          `/clubs/${club.id}/landing`,
          { pinned_tournament_ids: pins.filter((p) => p !== row.key && p !== row.id) },
          'PATCH',
        );
    },
    invalidate: refresh,
    success: 'Removed from the club',
    onSuccess: () => setRemoving(null),
  });
  const attach = useAdminMutation({
    request: async (item: { kind: 'tournament' | 'lobby'; id: string; community?: string }) => {
      const base = `/${item.kind === 'lobby' ? 'registrations' : 'tournaments'}/${item.id}`;
      if ((item.community ?? 'open') !== club.community_id)
        await write(`${base}/community`, { community_id: club.community_id }, 'PATCH');
      await write(`${base}/club`, { club_id: club.id }, 'PATCH');
    },
    invalidate: refresh,
    success: 'Attached to the club',
  });

  if (tournaments.isPending || lobbies.isPending) return <Loading />;
  if (tournaments.error || lobbies.error)
    return (
      <ErrorState
        error={tournaments.error || lobbies.error}
        retry={() => {
          void tournaments.refetch();
          void lobbies.refetch();
        }}
      />
    );
  const rows = deriveEvents(tournaments.data, lobbies.data, club.id, publicItems.data ?? [], me);
  const inTab = (t: EventTab) => rows.filter((r) => r.tab === t);
  const pinIndex = (r: ClubEvent) => {
    const i = pins.indexOf(r.key);
    return i >= 0 ? i : pins.indexOf(r.id);
  };
  const pinnable = (r: ClubEvent) =>
    r.canEdit && r.isPublic && r.state !== 'closed' && r.state !== 'archived';
  const active = inTab('active');
  const pinned = active.filter((r) => pinIndex(r) >= 0).sort((a, b) => pinIndex(a) - pinIndex(b));
  const shown = tab === 'active' ? active.filter((r) => pinIndex(r) < 0) : inTab(tab);
  const togglePin = (r: ClubEvent) =>
    savePins.mutate(
      pinIndex(r) >= 0 ? pins.filter((p) => p !== r.key && p !== r.id) : [...pins, r.key],
    );
  const move = (r: ClubEvent, delta: number) => {
    const order = pinned.map((p) => p.key);
    const i = order.indexOf(r.key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    savePins.mutate([...order, ...pins.filter((p) => !order.includes(p))]);
  };
  const candidates = attachCandidates(tournaments.data, lobbies.data, club.community_id, me).filter(
    (c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const lookup = new Map<string, string>([
    ...tournaments.data.map((t) => [`tn:${t.id}`, t.community_id] as const),
    ...lobbies.data.map((l) => [`reg:${l.id}`, l.community_id] as const),
  ]);
  const publicHref = (r: ClubEvent) =>
    r.kind === 'lobby' ? `/register/${r.alias || r.id}` : `/tv/${r.alias || r.id}`;
  const openPath = (r: ClubEvent) =>
    r.kind === 'lobby' ? `/admin/lobby/${r.id}` : `/admin/t/${r.id}`;
  const seasonOptions = (seasons.data ?? []).map((s) => ({ value: s.id, label: s.name }));

  const row = (r: ClubEvent, isPinned: boolean, position: number) => (
    <EventRow
      key={r.key}
      to={r.canEdit ? openPath(r) : undefined}
      title={r.name}
      meta={r.fromLobby ? `${tx('from lobby')}: ${r.fromLobby.name}` : undefined}
      testId="club-event-row"
      sport={r.sport}
      badges={
        <>
          <SportMark sport={r.sport} size="xs" />
          <StatusBadge tone={STATE[r.state].tone} size="sm">
            {stateLabel(r.state)}
          </StatusBadge>
          {r.registrants != null && (
            <Text size="xs">{tx('{count} registered', { count: r.registrants })}</Text>
          )}
          {!r.canEdit && (
            <Badge size="xs" variant="outline" color="gray">
              {tx('View only')}
            </Badge>
          )}
        </>
      }
      actions={
        <Group gap={4} wrap="nowrap">
          {r.canEdit && seasonOptions.length > 0 && (
            <Select
              size="xs"
              w={150}
              clearable
              aria-label={`${tx('Season')}: ${r.name}`}
              placeholder={tx('No season')}
              data={seasonOptions}
              value={r.seasonId}
              onChange={(season) => setSeason.mutate({ row: r, season })}
              visibleFrom="sm"
            />
          )}
          {isPinned && (
            <>
              <ActionIcon
                aria-label={`${tx('Move up')}: ${r.name}`}
                disabled={position === 0}
                onClick={() => move(r, -1)}
              >
                <IconArrowUp size={16} />
              </ActionIcon>
              <ActionIcon
                aria-label={`${tx('Move down')}: ${r.name}`}
                disabled={position === pinned.length - 1}
                onClick={() => move(r, 1)}
              >
                <IconArrowDown size={16} />
              </ActionIcon>
            </>
          )}
          <Tooltip
            label={
              isPinned
                ? tx('Unpin from club page')
                : pinnable(r)
                  ? tx('Pin on club page')
                  : tx('Only public, open events you manage can be pinned')
            }
          >
            <ActionIcon
              aria-label={`${isPinned ? tx('Unpin from club page') : tx('Pin on club page')}: ${r.name}`}
              aria-pressed={isPinned}
              disabled={!isPinned && !pinnable(r)}
              color={isPinned ? 'court' : 'gray'}
              loading={savePins.isPending && savePins.variables?.includes(r.key)}
              onClick={() => togglePin(r)}
            >
              {isPinned ? <IconPinFilled size={16} /> : <IconPin size={16} />}
            </ActionIcon>
          </Tooltip>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon aria-label={`${tx('More actions')}: ${r.name}`}>
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                component="a"
                href={publicHref(r)}
                leftSection={<IconExternalLink size={15} />}
              >
                {tx('Public view')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconLink size={15} />}
                onClick={() =>
                  void navigator.clipboard.writeText(`${window.location.origin}${publicHref(r)}`)
                }
              >
                {tx('Copy link')}
              </Menu.Item>
              {r.canEdit && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconUnlink size={15} />}
                    onClick={() => {
                      detach.reset();
                      setRemoving(r);
                    }}
                  >
                    {tx('Remove from club')}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      }
    />
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="sm">
        <SegmentedControl
          aria-label={tx('Events')}
          value={tab}
          onChange={(v) => setTab(v as EventTab)}
          data={[
            { value: 'active', label: `${tx('Active')} (${active.length})` },
            { value: 'finished', label: `${tx('Finished')} (${inTab('finished').length})` },
            { value: 'archived', label: `${tx('Archived')} (${inTab('archived').length})` },
          ]}
        />
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconLinkPlus size={16} />}
            aria-expanded={attachOpen}
            onClick={() => setAttachOpen((o) => !o)}
          >
            {tx('Attach existing')}
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => navigate('/admin/new')}>
            {tx('New event')}
          </Button>
        </Group>
      </Group>
      <Collapse expanded={attachOpen}>
        <Stack gap="xs" data-testid="attach-panel">
          <Text size="sm" c="dimmed">
            {tx(
              'Tournaments and sign-up lobbies you organize in this club’s community that are not in any club yet. To move an event from another club, remove it from that club first.',
            )}
          </Text>
          <TextInput
            aria-label={tx('Search by name')}
            placeholder={tx('Search by name')}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {candidates.length === 0 ? (
            <Text size="sm" c="dimmed">
              {tx('Nothing to attach.')}
            </Text>
          ) : (
            candidates.slice(0, 30).map((c) => (
              <EventRow
                key={c.key}
                title={c.name}
                testId="attach-row"
                sport={c.sport}
                badges={<SportMark sport={c.sport} size="xs" />}
                actions={
                  <Button
                    size="compact-md"
                    variant="light"
                    loading={attach.isPending && attach.variables?.id === c.id}
                    onClick={() =>
                      attach.mutate({ kind: c.kind, id: c.id, community: lookup.get(c.key) })
                    }
                  >
                    {tx('Attach')}
                  </Button>
                }
              />
            ))
          )}
        </Stack>
      </Collapse>
      <MutationError error={savePins.error ?? setSeason.error ?? attach.error} />
      {tab === 'active' && pinned.length > 0 && (
        <Stack gap="xs" component="section" aria-label={tx('Pinned on club page')}>
          <Text variant="eyebrow">{tx('Pinned on club page')}</Text>
          {pinned.map((r, i) => row(r, true, i))}
        </Stack>
      )}
      <Stack gap="xs" component="section" aria-label={tx('Events')}>
        {shown.length ? (
          shown.map((r) => row(r, false, 0))
        ) : pinned.length && tab === 'active' ? null : (
          <EmptyState
            title={
              tab === 'active'
                ? tx('No live events or open sign-ups in this club.')
                : tab === 'finished'
                  ? tx('No finished events yet. Running events are under Active.')
                  : tx('No archived lobbies. Only lobbies can be archived.')
            }
          />
        )}
      </Stack>
      <ConfirmAction
        opened={!!removing}
        title={tx('Remove from club')}
        description={tx(
          'Remove “{name}” from this club? It stays in your list and keeps its results.',
          { name: removing?.name },
        )}
        confirmLabel={tx('Remove from club')}
        color="red"
        loading={detach.isPending}
        error={detach.error}
        onConfirm={() => removing && detach.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </Stack>
  );
}
