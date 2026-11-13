import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconPointFilled, IconPlus, IconSearch } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import { write } from '../../api';
import { useAuth } from '../../auth';
import { ErrorState, Loading, PhaseBadge, useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import { ConfirmAction, EmptyState, EventRow, PageHeader, SportMark, StatusBadge } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { sportProps } from '../../theme';
import { useSubdomainClub } from '../../shell/subdomainClub';
import { EventMenu } from './EventMenu';
import classes from './Hub.module.css';
import { useStoredFilter } from './HubFilters';
import { GhostPurgeField, purgeQuery, useGhostPurge } from '../tournaments/GhostPurge';
import { fromLobby, fromTournament, type HubEvent } from './model';
import { TournamentCard } from './TournamentCard';

const LIVE_CARDS = 6;

function lobbyBadge(e: HubEvent) {
  return (
    <StatusBadge tone={e.live ? 'success' : 'neutral'}>
      {e.phaseLabel === 'archived'
        ? tx('Archived')
        : e.phaseLabel === 'open'
          ? tx('Open', { context: 'status' })
          : tx('Closed')}
    </StatusBadge>
  );
}

function newAnswersBadge(e: HubEvent) {
  if (e.kind !== 'lobby' || !e.unseenAnswers) return null;
  return (
    <Badge
      size="xs"
      color="red"
      variant="light"
      leftSection={<IconPointFilled size={10} />}
      aria-label={tx('New answers')}
    >
      {tx('New answers')}
    </Badge>
  );
}

// The admin home: your live events first (cards), sign-ups that are open, then every event in a
// searchable table (rows on phones). Filters and the search term persist between visits.
export function TournamentsHub() {
  useLocale();
  const { user } = useAuth();
  const { tournaments, lobbies } = useOverview();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [search, setSearch] = useStoredFilter('tournament-search', '');
  const [text, setText] = useState(search);
  const [debounced] = useDebouncedValue(text, 200);
  const [ownership, setOwnership] = useStoredFilter('filter-ownership', 'mine');
  const [status, setStatus] = useStoredFilter('filter-status', 'active');
  const [type, setType] = useStoredFilter('filter-type', 'all');
  // /admin?type=lobby (the old Lobbies page) opens the hub filtered to lobbies.
  const [params, setParams] = useSearchParams();
  const wanted = params.get('type');
  useEffect(() => {
    if (wanted === 'lobby' || wanted === 'tournaments' || wanted === 'all') {
      setType(wanted);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const [deleting, setDeleting] = useState<HubEvent | null>(null);
  const isAdmin = user?.role === 'admin';
  // On `{club}.{domain}/admin` only that club's events show, until the subdomain banner is dismissed.
  // Both ids must match, so an event whose club belongs to another community stays out.
  const host = useSubdomainClub()?.club;
  const query = debounced.trim().toLowerCase();

  const toggle = useAdminMutation({
    request: (e: HubEvent) =>
      e.kind === 'tournament'
        ? write(`/tournaments/${e.id}/public`, { public: !e.listed }, 'PATCH')
        : write(`/registrations/${e.id}`, { listed: !e.listed }, 'PATCH'),
    invalidate: [
      ['admin', 'tournaments'],
      ['admin', 'lobbies'],
    ],
    success: 'Visibility updated',
  });
  const ghostPurge = useGhostPurge(deleting?.kind === 'tournament' ? deleting.id : undefined);
  const remove = useAdminMutation({
    request: (e: HubEvent) =>
      write(
        e.kind === 'tournament'
          ? `/tournaments/${e.id}${purgeQuery(ghostPurge.purge)}`
          : `/registrations/${e.id}`,
        undefined,
        'DELETE',
      ),
    invalidate: [
      ['admin', 'tournaments'],
      ['admin', 'lobbies'],
    ],
    success: 'Deleted',
    onSuccess: () => setDeleting(null),
  });

  const all = useMemo(() => {
    const inHost = (item: { club_id: string | null; community_id: string }) =>
      !host || (item.club_id === host.club_id && item.community_id === host.community_id);
    return [
      ...(tournaments.data ?? []).filter(inHost).map(fromTournament),
      ...(lobbies.data ?? []).filter(inHost).map(fromLobby),
    ];
  }, [tournaments.data, lobbies.data, host]);
  const mine = (e: HubEvent) => !isAdmin || e.owner === user?.username || e.shared;
  const matches = (e: HubEvent) =>
    (ownership !== 'mine' || mine(e)) &&
    [e.name, e.scope, e.owner].join(' ').toLowerCase().includes(query);
  const past = (e: HubEvent) => e.finished || (e.kind === 'lobby' && !e.live);
  const listed = all.filter(
    (e) =>
      matches(e) &&
      (type === 'all' || (type === 'lobby') === (e.kind === 'lobby')) &&
      (status === 'all' || (status === 'past') === past(e)),
  );
  // Live tournaments you run lead as cards. They are taken out of the table below, so no event is
  // listed twice on the screen, whatever the filters are.
  const featured = listed
    .filter((e) => e.kind === 'tournament' && e.live && mine(e))
    .slice(0, LIVE_CARDS);
  const featuredKeys = new Set(featured.map((e) => e.kind + e.id));
  const rest = listed.filter((e) => !featuredKeys.has(e.kind + e.id));
  const othersLive = isAdmin
    ? all.filter((e) => e.kind === 'tournament' && e.live && !mine(e)).length
    : 0;
  const canDelete = (e: HubEvent) => isAdmin || e.owner === user?.username;
  const menu = (e: HubEvent) => (
    <EventMenu
      event={e}
      canDelete={canDelete(e)}
      busy={toggle.isPending}
      onToggleVisible={(ev) => toggle.mutate(ev)}
      onDelete={(ev) => {
        remove.reset();
        setDeleting(ev);
      }}
    />
  );
  const rowOf = (e: HubEvent) => (
    <EventRow
      key={e.kind + e.id}
      to={e.path}
      title={e.name}
      meta={e.scope}
      testId="event-row"
      sport={e.sport}
      badges={
        <>
          <SportMark sport={e.sport} size="xs" />
          <Text size="xs">{e.format}</Text>
          {e.kind === 'tournament' ? <PhaseBadge phase={e.phaseLabel} /> : lobbyBadge(e)}
          {e.kind === 'lobby' && (
            <Text size="xs">{tx('{count} registered', { count: e.registrants ?? 0 })}</Text>
          )}
          {newAnswersBadge(e)}
          {e.shared && <Badge size="xs">{tx('Shared')}</Badge>}
          <StatusBadge size="xs" variant="outline">
            {e.listed ? tx('Public') : tx('Private')}
          </StatusBadge>
        </>
      }
      actions={menu(e)}
    />
  );

  return (
    <Stack gap="xl">
      <PageHeader
        title={tx('Tournaments')}
        description={tx('Your tournaments and sign-up lobbies, from first serve to final.')}
      />
      {tournaments.isPending || lobbies.isPending ? (
        <Loading />
      ) : tournaments.error || lobbies.error ? (
        <ErrorState
          error={tournaments.error || lobbies.error}
          retry={() => {
            void tournaments.refetch();
            void lobbies.refetch();
          }}
        />
      ) : (
        <>
          {featured.length > 0 && (
            <Stack gap="sm" component="section" aria-label={tx('Your live events')}>
              <Text variant="eyebrow">{tx('Your live events')}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
                {featured.map((e) => (
                  <TournamentCard key={e.id} event={e} menu={menu(e)} />
                ))}
              </SimpleGrid>
            </Stack>
          )}
          <Stack gap="sm" component="section" aria-label={tx('All events')}>
            {featured.length > 0 && <Text variant="eyebrow">{tx('More events')}</Text>}
            <TextInput
              aria-label={tx('Search tournaments')}
              placeholder={tx('Search tournaments')}
              leftSection={<IconSearch size={16} />}
              value={text}
              onChange={(e) => {
                setText(e.currentTarget.value);
                setSearch(e.currentTarget.value.trim());
              }}
            />
            <Group gap="sm">
              {isAdmin && (
                <SegmentedControl
                  aria-label={tx('Ownership')}
                  value={ownership}
                  onChange={setOwnership}
                  data={[
                    { value: 'mine', label: tx('Mine') },
                    { value: 'all', label: tx('All') },
                  ]}
                />
              )}
              <SegmentedControl
                aria-label={tx('Status')}
                value={status}
                onChange={setStatus}
                data={[
                  { value: 'active', label: tx('Active') },
                  { value: 'past', label: tx('Past') },
                  { value: 'all', label: tx('All') },
                ]}
              />
              <SegmentedControl
                aria-label={tx('Type')}
                value={type}
                onChange={setType}
                data={[
                  { value: 'all', label: tx('All') },
                  { value: 'tournaments', label: tx('Tournaments') },
                  { value: 'lobby', label: tx('Lobbies') },
                ]}
              />
            </Group>
            {isAdmin && ownership === 'mine' && othersLive > 0 && !featured.length && (
              <Text size="sm" c="dimmed">
                {tx('{n} live events from other organizers. Choose All to see them.', {
                  n: othersLive,
                })}
              </Text>
            )}
            {!rest.length && featured.length ? null : !rest.length ? (
              <EmptyState
                title={tx('No tournaments found')}
                action={
                  <Button component={Link} to="/admin/new" leftSection={<IconPlus size={16} />}>
                    {tx('New tournament')}
                  </Button>
                }
              >
                {tx('Try another search, or change the filters.')}
              </EmptyState>
            ) : phone ? (
              <Stack gap="xs">{rest.map(rowOf)}</Stack>
            ) : (
              <Paper>
                <Table.ScrollContainer minWidth={760}>
                  <Table stickyHeader verticalSpacing="sm" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{tx('Name')}</Table.Th>
                        <Table.Th>{tx('Club or community')}</Table.Th>
                        <Table.Th>{tx('Format')}</Table.Th>
                        <Table.Th>{tx('Phase')}</Table.Th>
                        <Table.Th>{tx('Visibility')}</Table.Th>
                        <Table.Th w={1} aria-label={tx('Actions')} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {rest.map((e) => (
                        <Table.Tr
                          key={e.kind + e.id}
                          data-testid="event-row"
                          className={classes.sportRow}
                          {...sportProps(e.sport)}
                        >
                          <Table.Td>
                            <Stack gap={2}>
                              <Text component={Link} to={e.path} fw={650} c="inherit">
                                {e.name}
                              </Text>
                              <SportMark sport={e.sport} size="xs" />
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              {e.scope}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{e.format}</Text>
                          </Table.Td>
                          <Table.Td>
                            {e.kind === 'tournament' ? (
                              <PhaseBadge phase={e.phaseLabel} />
                            ) : (
                              <Group gap={6}>
                                {lobbyBadge(e)}
                                <Text size="xs">
                                  {tx('{count} registered', { count: e.registrants ?? 0 })}
                                </Text>
                                {newAnswersBadge(e)}
                              </Group>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6}>
                              <StatusBadge variant="outline">
                                {e.listed ? tx('Public') : tx('Private')}
                              </StatusBadge>
                              {e.shared && <Badge>{tx('Shared')}</Badge>}
                            </Group>
                          </Table.Td>
                          <Table.Td>{menu(e)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
            )}
          </Stack>
        </>
      )}
      <ConfirmAction
        opened={!!deleting}
        title={tx('Delete')}
        description={
          <>
            {tx('Delete «{name}»? This cannot be undone.', { name: deleting?.name })}
            <GhostPurgeField
              ghosts={ghostPurge.ghosts}
              purge={ghostPurge.purge}
              onChange={ghostPurge.setPurge}
            />
          </>
        }
        confirmLabel={tx('Delete')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}
