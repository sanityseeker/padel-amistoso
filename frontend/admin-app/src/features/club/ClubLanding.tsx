import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Group,
  Image,
  Loader,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconPin } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { formatType } from '../../api';
import { ErrorState, Loading } from '../../components';
import { publicApi, publicEventUrl, type PublicEvent } from '../../events/api';
import { t as tx, useLocale } from '../../i18n';
import { PLAYER_TOKEN, playerApi } from '../../player/api';
import { sportProps } from '../../theme';
import { EmptyState, EventCodeFinder, EventRow, SportMark, StatusBadge } from '../../ui';
import { hostClubSlug } from '../public/meta';
import { StandingsTable, type StandingRow } from '../tournaments';
import { Notice } from '../../ui/Notice';
import { PageContainer } from '../../ui/PageContainer';
import { ProfileCardModal, profileCardSource, type ProfileCardTarget } from '../playercard';

interface Club {
  club_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
}
interface ClubEvent extends PublicEvent {
  pinned?: boolean;
}
interface Season {
  id: string;
  name: string;
  active: boolean;
}
interface BoardRow {
  rank: number;
  name: string;
  elo: number | null;
  matches: number;
  profile_id?: string | null;
}
interface SeasonRow {
  player_name: string;
  profile_id?: string | null;
  elo_end: number | null;
  elo_change: number | null;
  matches_played: number | null;
}
type Sport = 'padel' | 'tennis';
interface CardTarget {
  profileId: string;
  sport: Sport;
  seasonId: string | null;
}

const KEYS = {
  tab: 'amistoso-club-landing-items-tab',
  sport: 'amistoso-club-landing-sport',
  scope: 'amistoso-club-landing-scope',
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* The choice still applies to this visit. */
  }
};
const profileJwt = () => recall(PLAYER_TOKEN);
const STATUS: Record<PublicEvent['status'], string> = {
  in_progress: 'In progress',
  open_registration: 'Sign-ups open',
  upcoming: 'Not started',
  finished: 'Finished',
};

function Rows({ items, hideSport }: { items: ClubEvent[]; hideSport: boolean }) {
  useLocale();
  return (
    <Stack gap="xs">
      {items.map((event) => (
        <EventRow
          key={event.kind + ':' + event.id}
          href={publicEventUrl(event)}
          title={event.name}
          testId="club-event"
          sport={event.sport}
          leading={event.pinned ? <IconPin size={16} aria-label={tx('Pinned')} /> : undefined}
          badges={
            <>
              {!hideSport && <SportMark sport={event.sport} size="xs" />}
              <StatusBadge
                tone={
                  event.status === 'in_progress'
                    ? 'live'
                    : event.status === 'finished'
                      ? 'neutral'
                      : 'info'
                }
                size="sm"
              >
                {tx(STATUS[event.status])}
              </StatusBadge>
              <Text size="xs" c="dimmed">
                {event.kind === 'registration'
                  ? tx('{n} registered', {
                      n: event.registrant_count || 0,
                    })
                  : formatType(event.type)}
              </Text>
              {event.join_code_required && (
                <StatusBadge size="xs" variant="outline">
                  {tx('Join code', { context: 'badge' })}
                </StatusBadge>
              )}
            </>
          }
        />
      ))}
    </Stack>
  );
}

// ---- Leaderboard (members only: it needs a Player Hub or organizer session) ---------------------------------

function useMember<T>(path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['player', 'club', path, 'member'],
    enabled,
    retry: false,
    queryFn: () => playerApi<T>(path, undefined, 'GET', profileJwt()),
  });
}

// The card shows the one sport of the board it was opened from, and for a season board only that
// season's matches, so its numbers agree with the row that was clicked. It is the shared player card,
// locked to this club (no scope switch), read with the profile session this page holds.
const clubCardSource = profileCardSource(profileJwt);
const cardTarget = (clubId: string, target: CardTarget | null): ProfileCardTarget | null =>
  target && {
    profileId: target.profileId,
    query: `?club_id=${encodeURIComponent(clubId)}&sport=${target.sport}${
      target.seasonId ? `&season_id=${encodeURIComponent(target.seasonId)}` : ''
    }`,
  };

function Board({
  rows,
  sport,
  onCard,
}: {
  rows: BoardRow[];
  sport: Sport;
  onCard: (target: CardTarget) => void;
}) {
  useLocale();
  if (!rows.length) return <Text c="dimmed">{tx('No players have played a match yet.')}</Text>;
  const standing: StandingRow[] = rows.map((r) => ({
    id: r.profile_id || r.name,
    name: r.name,
    rank: r.rank,
    elo: r.elo,
    played: r.matches,
  }));
  return (
    <StandingsTable
      rows={standing}
      preset="leaderboard"
      eloLabel={tx('Club ELO')}
      onSelect={(row) => {
        const found = rows.find((r) => (r.profile_id || r.name) === row.id);
        if (found?.profile_id) onCard({ profileId: found.profile_id, sport, seasonId: null });
      }}
    />
  );
}

// Archived seasons show a frozen snapshot, so their rows do not open a card (it would show live data).
function SeasonBoard({
  rows,
  sport,
  seasonId,
  onCard,
}: {
  rows: SeasonRow[];
  sport: Sport;
  seasonId: string;
  onCard: ((target: CardTarget) => void) | null;
}) {
  useLocale();
  if (!rows.length) return <Text c="dimmed">{tx('No players have played a match yet.')}</Text>;
  const sorted = [...rows].sort((a, b) => (b.elo_end ?? 0) - (a.elo_end ?? 0));
  return (
    <Table.ScrollContainer minWidth={0}>
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>{tx('Player')}</Table.Th>
            <Table.Th>{tx('Club ELO')}</Table.Th>
            <Table.Th>{tx('Change')}</Table.Th>
            <Table.Th>{tx('Matches')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((s, i) => {
            const change = s.elo_change;
            return (
              <Table.Tr key={s.player_name + i}>
                <Table.Td>{i + 1}</Table.Td>
                <Table.Td>
                  {onCard && s.profile_id ? (
                    <UnstyledButton
                      fz="inherit"
                      onClick={() => onCard({ profileId: s.profile_id!, sport, seasonId })}
                    >
                      {s.player_name}
                    </UnstyledButton>
                  ) : (
                    s.player_name
                  )}
                </Table.Td>
                <Table.Td>{s.elo_end == null ? '—' : Math.round(s.elo_end)}</Table.Td>
                <Table.Td
                  c={
                    change == null ? 'dimmed' : change > 0 ? 'green' : change < 0 ? 'red' : 'dimmed'
                  }
                >
                  {change == null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}`}
                </Table.Td>
                <Table.Td>{s.matches_played ?? '—'}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Leaderboard({
  club,
  sport,
  seasons,
}: {
  club: Club;
  sport: Sport | null;
  seasons: Season[];
}) {
  useLocale();
  const saved = recall(KEYS.scope);
  const [scope, setScope] = useState(
    saved && seasons.some((s) => s.id === saved) ? saved : 'global',
  );
  const [card, setCard] = useState<CardTarget | null>(null);
  const seasonActive = seasons.find((x) => x.id === scope)?.active ?? false;
  const cid = encodeURIComponent(club.club_id);
  const global = scope === 'global';
  const board = useMember<BoardRow[] | { padel: BoardRow[]; tennis: BoardRow[] }>(
    `/clubs/${cid}/public-leaderboard?sport=${sport ?? 'all'}`,
    global,
  );
  const season = useMember<{ padel?: SeasonRow[]; tennis?: SeasonRow[] }>(
    `/seasons/${encodeURIComponent(scope)}/standings`,
    !global,
  );
  const active = global ? board : season;
  // A rejected session, or a visitor who is not a member of this club, behaves like a signed-out
  // visitor: the section disappears (the board is for members and the club's organizers).
  const denied = (active.error as { status?: number } | null)?.status;
  if (denied === 401 || denied === 403) return null;
  const sports: Sport[] = sport ? [sport] : ['padel', 'tennis'];
  const rowsOf = (s: Sport): BoardRow[] => {
    const data = board.data;
    if (!data) return [];
    return Array.isArray(data) ? data : (data[s] ?? []);
  };
  return (
    <Stack
      gap="md"
      component="section"
      aria-labelledby="club-board-title"
      data-testid="club-leaderboard"
    >
      <Group justify="space-between" align="flex-end">
        <Title order={2} id="club-board-title">
          {tx('Leaderboard', { context: 'overall' })}
        </Title>
        {seasons.length > 0 && (
          <Select
            label={tx('View:')}
            allowDeselect={false}
            value={scope}
            onChange={(v) => {
              const next = v ?? 'global';
              setScope(next);
              remember(KEYS.scope, next);
            }}
            data={[
              { value: 'global', label: tx('All-time') },
              ...seasons.map((s) => ({
                value: s.id,
                label: s.active ? s.name : `${s.name} (${tx('archived')})`,
              })),
            ]}
          />
        )}
      </Group>
      {active.isPending ? (
        <Loader aria-label={tx('Loading')} />
      ) : active.error ? (
        <Text c="dimmed">{tx('No players have played a match yet.')}</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, md: sports.length }}>
          {sports.map((s) => (
            <Stack key={s} gap="xs" {...sportProps(s)}>
              {!sport && <SportMark sport={s} />}
              {global ? (
                <Board rows={rowsOf(s)} sport={s} onCard={setCard} />
              ) : (
                <SeasonBoard
                  rows={season.data?.[s] ?? []}
                  sport={s}
                  seasonId={scope}
                  onCard={seasonActive ? setCard : null}
                />
              )}
            </Stack>
          ))}
        </SimpleGrid>
      )}
      <ProfileCardModal
        target={cardTarget(club.club_id, card)}
        source={clubCardSource}
        onClose={() => setCard(null)}
      />
    </Stack>
  );
}

// ---- Search by id or alias ------------------------------------------------------------------------------------

function Finder({ items }: { items: ClubEvent[] }) {
  useLocale();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const go = async () => {
    const raw = value.trim();
    if (!raw) return;
    setMessage('');
    const known = items.find((it) => it.id === raw || (it.alias && it.alias === raw));
    if (known) return navigate(publicEventUrl(known));
    setBusy(true);
    setMessage(tx('Looking up…'));
    try {
      for (const [path, route] of [
        [`/registrations/public/${encodeURIComponent(raw)}`, 'register'],
        [`/tournaments/${encodeURIComponent(raw)}/meta`, 'tv'],
      ] as const) {
        try {
          await publicApi(path);
          return navigate(`/${route}/${encodeURIComponent(raw)}`);
        } catch {
          /* Try the next kind. */
        }
      }
      setMessage(tx('No results found.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <EventCodeFinder
      value={value}
      onChange={setValue}
      onSubmit={() => void go()}
      busy={busy}
      status={message}
    />
  );
}

// ---- The page -------------------------------------------------------------------------------------------------

const LIVE = new Set(['in_progress', 'open_registration', 'upcoming']);

function ClubLanding({ slug }: { slug: string }) {
  useLocale();
  const [sport, setSport] = useState<Sport | null>(() => {
    const saved = recall(KEYS.sport);
    return saved === 'padel' || saved === 'tennis' ? saved : null;
  });
  const [tab, setTab] = useState<string>(recall(KEYS.tab) === 'finished' ? 'finished' : 'live');
  const club = useQuery({
    queryKey: ['public', 'club', 'by-slug', slug],
    queryFn: () => publicApi<Club>(`/clubs/by-slug/${encodeURIComponent(slug)}`),
    retry: false,
  });
  const cid = club.data?.club_id;
  const events = useQuery({
    // Under ['public', 'events'] so the global live stream refreshes it with the directory.
    queryKey: ['public', 'events', 'club', cid],
    enabled: !!cid,
    queryFn: () => publicApi<ClubEvent[]>(`/clubs/${encodeURIComponent(cid!)}/public-tournaments`),
  });
  const seasons = useQuery({
    queryKey: ['public', 'club', cid, 'seasons'],
    enabled: !!cid,
    queryFn: () =>
      publicApi<Season[]>(`/clubs/${encodeURIComponent(cid!)}/seasons`).catch(() => []),
  });
  const member = !!profileJwt();
  const visible = useMemo(
    () => (events.data ?? []).filter((e) => !sport || !e.sport || e.sport === sport),
    [events.data, sport],
  );
  const live = visible.filter((e) => LIVE.has(e.status));
  const finished = visible.filter((e) => !LIVE.has(e.status));
  // Never land on an empty tab when the other one has items.
  useEffect(() => {
    if (!events.data) return;
    if (tab === 'live' && !live.length && finished.length) setTab('finished');
    else if (tab === 'finished' && !finished.length && live.length) setTab('live');
  }, [events.data, tab, live.length, finished.length]);

  if (club.error) {
    if ((club.error as { status?: number }).status === 404) {
      const to = new URLSearchParams({ m: tx('Club not found.'), to: '/events' });
      return <Navigate to={`/404?${to}`} replace />;
    }
    return (
      <PageContainer size="md">
        <Notice tone="danger" title={tx('Could not load this club right now.')}>
          <Button variant="subtle" color="red" onClick={() => void club.refetch()}>
            {tx('Try again')}
          </Button>
        </Notice>
      </PageContainer>
    );
  }
  const data = club.data;
  if (!data) return <Loading />;
  const tournaments = live.filter((e) => e.kind === 'tournament');
  const signups = live.filter((e) => e.kind === 'registration');
  return (
    <PageContainer size="md" data-testid="club-page">
      <Stack gap="lg">
        <Group gap="lg" wrap="nowrap" align="center">
          {data.logo_url && (
            <Image src={data.logo_url} alt={data.name} h={88} w="auto" fit="contain" />
          )}
          <Stack gap={4} miw={0}>
            <Title order={1}>{data.name}</Title>
            {data.description && <Text c="dimmed">{data.description}</Text>}
          </Stack>
        </Group>
        <SegmentedControl
          w="fit-content"
          aria-label={tx('Sport')}
          value={sport ?? 'all'}
          onChange={(v) => {
            const next = v === 'all' ? null : (v as Sport);
            setSport(next);
            remember(KEYS.sport, next);
          }}
          data={[
            { value: 'all', label: tx('All') },
            { value: 'padel', label: tx('Padel') },
            { value: 'tennis', label: tx('Tennis') },
          ]}
        />
        <Stack gap="sm" component="section" aria-labelledby="club-events-title">
          <Title order={2} id="club-events-title">
            {tx('Events')}
          </Title>
          <Tabs
            value={tab}
            onChange={(v) => {
              setTab(v ?? 'live');
              remember(KEYS.tab, v);
            }}
          >
            <Tabs.List mb="md">
              <Tabs.Tab value="live">
                {tx('Live')} ({live.length})
              </Tabs.Tab>
              <Tabs.Tab value="finished">
                {tx('Finished')} ({finished.length})
              </Tabs.Tab>
            </Tabs.List>
            {events.isPending ? (
              <Loading />
            ) : events.error ? (
              <ErrorState error={events.error} retry={() => void events.refetch()} />
            ) : (
              <>
                <Tabs.Panel value="live">
                  <Stack gap="lg">
                    {tournaments.length > 0 && (
                      <Stack gap="xs">
                        <Title order={3}>{tx('Tournaments')}</Title>
                        <Rows items={tournaments} hideSport={!!sport} />
                      </Stack>
                    )}
                    {signups.length > 0 && (
                      <Stack gap="xs">
                        <Title order={3}>{tx('Sign-ups open')}</Title>
                        <Rows items={signups} hideSport={!!sport} />
                      </Stack>
                    )}
                    {!live.length && <EmptyState title={tx('No live activity right now.')} />}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="finished">
                  {finished.length ? (
                    <Rows items={finished} hideSport={!!sport} />
                  ) : (
                    <EmptyState title={tx('No finished events yet.')} />
                  )}
                </Tabs.Panel>
              </>
            )}
          </Tabs>
        </Stack>
        <Finder items={events.data ?? []} />
        {member && cid && (
          <Leaderboard key={cid} club={data} sport={sport} seasons={seasons.data ?? []} />
        )}
      </Stack>
    </PageContainer>
  );
}

/** `{club}.{domain}/`: the server decided this host is a club and wrote its slug into the page. */
export function ClubHostLanding() {
  const slug = hostClubSlug();
  return slug ? <ClubLanding slug={slug} /> : <Navigate to="/events" replace />;
}

/** `/club/<slug>`: the same page for hosts without subdomains. */
export function ClubPathLanding() {
  const { slug = '' } = useParams();
  return <ClubLanding key={slug} slug={slug} />;
}
