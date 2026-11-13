import { useEffect, useRef, useState } from 'react';
import { Button, Group, Indicator, NavLink, Stack, Tabs } from '@mantine/core';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconChartLine, IconHome, IconListCheck, IconPlus, IconUser } from '@tabler/icons-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { t as tx, useLocale } from '../../i18n';
import { ErrorState, Loading } from '../../components';
import { resolveHostClub } from '../../club-context';
import { playerApi, saveSession } from '../../player/api';
import { PlayerLogin } from '../../player/PlayerLogin';
import { setPlayerScope, setPlayerSport, usePlayerScope, usePlayerSport } from '../../player/scope';
import { usePlayerSession } from '../../player/session';
import type { Entry, Space } from '../../player/types';
import { useLayoutMode } from '../../shell/layout';
import { linkToken, participantPassphrase, verifyToken } from './linkParams';
import { HubFilters } from './components/HubFilters';
import { LinkEvent } from './components/LinkEvent';
import { paymentKey, usePayments } from './payments';
import { lifecycleIn, type EventData } from './eventData';
import type { PlayerSpaceContext } from './context';
import { hubSportsOf, type Sport } from './stats';
import classes from './Player.module.css';
import { Notice } from '../../ui/Notice';
import { PageContainer } from '../../ui/PageContainer';

const SECTIONS = [
  { to: '/player', label: 'Hub', icon: IconHome, end: true },
  { to: '/player/matches', label: 'My events', icon: IconListCheck, end: false },
  { to: '/player/ratings', label: 'Ratings', icon: IconChartLine, end: false },
  { to: '/player/me', label: 'Profile', icon: IconUser, end: false },
] as const;

function useDots(
  space: Space | undefined,
  entries: Entry[],
  signedIn: boolean,
  clubEntries: Entry[] | null,
) {
  const payments = usePayments(signedIn, clubEntries);
  const active = entries.filter(
    (e) => e.status === 'active' && e.entity_type === 'tournament' && !e.entity_deleted,
  );
  // Reads what the Hub cards already fetched; adds no request of its own.
  const events = useQueries({
    queries: active.map((e) => ({
      queryKey: ['player', 'matches', e.entity_id],
      enabled: false,
    })),
  });
  const scoreWaits = active.some((entry, i) => {
    const data = events[i]?.data as EventData | undefined;
    if (!data) return false;
    return data.matches.some((m) => {
      const state = lifecycleIn(m, data, entry.player_id);
      return state === 'confirm' || state === 'correction';
    });
  });
  const meWaits = !!space && !space.profile.email_verified;
  // A dot lights only where the page itself shows a badge the player can act on. Tournament badges
  // (unpaid, refund due) are on the Hub; lobby badges (unpaid) are on My events. A reported payment
  // waits for the organizer, so it lights nothing.
  const shown = (kind: Entry['entity_type'], statuses: string[]) => {
    const keys = new Set(
      [...entries, ...(space?.entries ?? [])]
        .filter((e) => e.entity_type === kind && !e.entity_deleted)
        .filter((e) => kind === 'registration' || e.status === 'active' || e.status === 'finished')
        .map(paymentKey),
    );
    return (payments.data ?? []).some(
      (p) =>
        p.entity_type === kind &&
        statuses.includes(p.status) &&
        (p.entry_keys ?? [p.key]).some((k) => keys.has(k)),
    );
  };
  const hubWaits = shown('tournament', ['unpaid', 'refund_due']);
  const lobbyWaits = shown('registration', ['unpaid']);
  return { matches: scoreWaits || lobbyWaits, me: meWaits, hub: hubWaits };
}

// The session gate and shell of every /player/* route. Without a session the login and onboarding
// render in place of the requested sub-route (and the sub-route is kept, so login returns to it).
export function PlayerLayout() {
  useLocale();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token, profile, logout, start } = usePlayerSession();
  const { mode } = useLayoutMode();
  const [linkBusy, setLinkBusy] = useState(!!(linkToken || verifyToken));
  const [linkError, setLinkError] = useState('');
  const [notice, setNotice] = useState('');
  const [linking, setLinking] = useState(false);
  const scope = usePlayerScope();
  const savedSport = usePlayerSport();
  const initialized = useRef(false);
  const hostClub = useQuery({
    queryKey: ['public', 'host-club'],
    queryFn: resolveHostClub,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (hostClub.data) setPlayerScope(`club:${hostClub.data.club_id}`, false);
  }, [hostClub.data]);
  // On a club subdomain the club is the scope: nothing on the Hub may move it elsewhere.
  const setScope = (value: string) => {
    if (!hostClub.data) setPlayerScope(value);
  };
  const scopeId = scope.split(':').slice(1).join(':');
  const scopeKey = scope.startsWith('club:') ? 'club_id' : 'community_id';
  const scopeQuery = scopeId ? `?${scopeKey}=${encodeURIComponent(scopeId)}` : '';

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        if (verifyToken) {
          await playerApi('/player-profile/verify-email', { token: verifyToken }, 'POST', null);
          setNotice('Your email has been verified.');
        }
        if (linkToken) {
          const session = await playerApi<Space>(
            '/player-profile/space',
            undefined,
            'GET',
            linkToken,
          );
          await playerApi('/player-profile/confirm-email-link', {}, 'POST', linkToken);
          start(session);
        }
        if (verifyToken) void client.invalidateQueries({ queryKey: ['player'] });
      } catch (e) {
        setLinkError((e as Error).message);
      } finally {
        setLinkBusy(false);
      }
    })();
  }, [client, start]);

  const params = new URLSearchParams({ elo_history_limit: '50' });
  if (scopeId) params.set(scopeKey, scopeId);
  const query = useQuery({
    queryKey: ['player', 'space', scope],
    // Wait for the club lookup, so a club subdomain never loads (and flashes) another saved scope.
    enabled:
      !!token &&
      !linkBusy &&
      !hostClub.isPending &&
      (!hostClub.data || scope === `club:${hostClub.data.club_id}`),
    queryFn: () => playerApi<Space>(`/player-profile/space?${params}`),
    refetchInterval: 30_000,
    // A new community or club is a new query: keep showing the current page until it is back.
    // Without this the whole Hub turns into a spinner, the page shrinks and the scroll resets to the
    // top, so a player who picked a community halfway down has to scroll back to it. Only this
    // player's own page is kept: after signing in as someone else nothing of the last one shows.
    placeholderData: (previous) =>
      previous && previous.profile.id === profile?.id ? previous : undefined,
  });
  // A picked community or club narrows ratings and history, never the tournaments in progress:
  // those come from the unscoped space. Club subdomains keep their deliberate restriction.
  const hostKnown = !hostClub.isPending;
  const unscoped = !!scope && hostKnown && !hostClub.data;
  const live = useQuery({
    queryKey: ['player', 'space', '__live'],
    enabled: !!token && !linkBusy && unscoped,
    queryFn: () => playerApi<Space>('/player-profile/space?elo_history_limit=5'),
    refetchInterval: 30_000,
  });
  // The tournaments in progress last seen in full: shown while a picked scope's own request is still
  // out, so the active cards do not shrink to the scoped list for a moment and push the page.
  const lastLive = useRef<Entry[] | null>(null);
  if (!unscoped && query.data && !query.isPlaceholderData) lastLive.current = query.data.entries;
  if (unscoped && live.data) lastLive.current = live.data.entries;
  const liveEntries = unscoped
    ? (live.data?.entries ?? lastLive.current ?? query.data?.entries ?? [])
    : (query.data?.entries ?? []);
  const liveLoading = unscoped && live.isPending;
  useEffect(() => {
    if (query.data) saveSession(query.data);
  }, [query.data]);
  const clubEntries = hostClub.data ? (query.data?.entries ?? null) : null;
  const dots = useDots(query.data, liveEntries, !!token && !linkBusy, clubEntries);

  if (linkBusy || (token && (query.isPending || hostClub.isPending))) return <Loading />;
  if (!token)
    return (
      <>
        {linkError && <Notice tone="danger">{linkError}</Notice>}
        {notice && <Notice>{tx(notice)}</Notice>}
        <PlayerLogin initialPassphrase={participantPassphrase} onSession={start} />
      </>
    );
  if (query.error || !query.data)
    return (
      <PageContainer>
        <ErrorState error={query.error} retry={() => void query.refetch()} />
        <Button mt="lg" onClick={logout}>
          {tx('Return to player login')}
        </Button>
      </PageContainer>
    );
  const space = query.data;
  const scopeOptions = [
    { value: '', label: tx('All my communities') },
    ...space.player_clubs.map((c) => ({ value: `club:${c.id}`, label: c.name })),
    ...space.player_communities.map((c) => ({ value: `community:${c.id}`, label: c.name })),
  ];
  const host = hostClub.data;
  if (host && !scopeOptions.some((s) => s.value === `club:${host.club_id}`))
    scopeOptions.push({ value: `club:${host.club_id}`, label: host.name });
  const sports = hubSportsOf(space);
  const sport: Sport = sports.includes(savedSport as Sport)
    ? (savedSport as Sport)
    : (sports[0] ?? 'padel');
  // The filter only counts while the switcher is visible: with one sport an active tournament in a
  // sport the player has no rating in must still show.
  const sportFilter: Sport | 'all' =
    sports.length > 1 && sports.includes(savedSport as Sport) ? (savedSport as Sport) : 'all';
  const context: PlayerSpaceContext = {
    space,
    scope,
    scopeQuery,
    scopeOptions,
    liveEntries,
    liveLoading,
    setScope,
    clubEntries,
    sport,
    sports,
    sportFilter,
    setSport: setPlayerSport,
    openLink: () => setLinking(true),
    notice,
    clearNotice: () => setNotice(''),
  };
  const current =
    SECTIONS.find((s) => (s.end ? pathname === s.to : pathname.startsWith(s.to)))?.to ?? '/player';
  // The filters sit on the four Hub pages, not on one event's page (which shows that event whole).
  const section = SECTIONS.find((s) => pathname.replace(/\/$/, '') === s.to);
  const dotFor = (to: string) =>
    to === '/player'
      ? dots.hub
      : to === '/player/matches'
        ? dots.matches
        : to === '/player/me'
          ? dots.me
          : false;
  const outlet = (
    <Stack gap="md">
      {linkError && <Notice tone="danger">{linkError}</Notice>}
      {notice && (
        <Notice withCloseButton onClose={() => setNotice('')}>
          {tx(notice)}
        </Notice>
      )}
      {section && (
        <HubFilters
          scope={scope}
          // A club subdomain shows that club only, so there is nothing to pick.
          scopeOptions={host ? [] : scopeOptions}
          onScope={setScope}
          sport={sportFilter}
          fallbackSport={sport}
          sports={sports}
          onSport={setPlayerSport}
          // The Hub and My events filter by sport (with All); Ratings shows one sport at a time.
          showSport={section.to !== '/player/me'}
          withAll={section.to !== '/player/ratings'}
        />
      )}
      <Outlet context={context} />
    </Stack>
  );
  return (
    <PageContainer size={mode === 'desktop' ? 'lg' : 'md'}>
      {mode === 'tablet' && (
        <Tabs
          value={current}
          onChange={(value) => value && navigate(value)}
          variant="pills"
          mb="lg"
          aria-label={tx('Player Hub')}
        >
          <Tabs.List>
            {SECTIONS.map(({ to, label, icon: Icon }) => (
              <Tabs.Tab
                key={to}
                value={to}
                leftSection={<Icon size={16} aria-hidden />}
                renderRoot={(props) => <Link to={to} {...props} />}
              >
                <Indicator disabled={!dotFor(to)} size={8} color="red" offset={-4}>
                  {tx(label)}
                </Indicator>
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      )}
      {mode === 'desktop' ? (
        <Group align="flex-start" wrap="nowrap" gap="xl">
          <Stack
            gap="xs"
            w={220}
            className={classes.sideNav}
            component="nav"
            aria-label={tx('Player Hub')}
          >
            {SECTIONS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                component={Link}
                to={to}
                active={current === to}
                aria-current={current === to ? 'page' : undefined}
                label={tx(label)}
                leftSection={<Icon size={18} aria-hidden />}
                rightSection={
                  dotFor(to) ? (
                    <Indicator size={8} color="red" disabled={false} data-testid="nav-dot">
                      <span />
                    </Indicator>
                  ) : undefined
                }
              />
            ))}
            <Button
              variant="default"
              leftSection={<IconPlus size={16} />}
              onClick={() => setLinking(true)}
              mt="sm"
            >
              {tx('Link an event')}
            </Button>
          </Stack>
          <div style={{ flex: 1, minWidth: 0 }}>{outlet}</div>
        </Group>
      ) : (
        outlet
      )}
      {linking && <LinkEvent close={() => setLinking(false)} />}
    </PageContainer>
  );
}
