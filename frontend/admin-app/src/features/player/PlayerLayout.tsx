import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Container, Group, Indicator, NavLink, Stack, Tabs } from '@mantine/core';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconChartLine, IconHome, IconListCheck, IconPlus, IconUser } from '@tabler/icons-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { t as tx, useLocale } from '../../i18n';
import { ErrorState, Loading } from '../../components';
import { resolveHostClub } from '../../club-context';
import { playerApi, saveSession } from '../../player/api';
import { PlayerLogin } from '../../player/PlayerLogin';
import { usePlayerSession } from '../../player/session';
import type { Entry, Space } from '../../player/types';
import { useLayoutMode } from '../../shell/layout';
import { linkToken, participantPassphrase, verifyToken } from './linkParams';
import { LinkEvent } from './components/LinkEvent';
import { dueOf, usePayments } from './components/TodoCards';
import { lifecycleIn, type EventData } from './eventData';
import type { PlayerSpaceContext } from './context';
import classes from './Player.module.css';

const SCOPE_KEY = 'padel-player-community';
const initialScope = () => {
  const saved = localStorage.getItem(SCOPE_KEY) || '';
  return saved && !saved.includes(':') ? `community:${saved}` : saved;
};

const SECTIONS = [
  { to: '/player', label: 'Hub', icon: IconHome, end: true },
  { to: '/player/matches', label: 'My events', icon: IconListCheck, end: false },
  { to: '/player/ratings', label: 'Ratings', icon: IconChartLine, end: false },
  { to: '/player/me', label: 'Profile', icon: IconUser, end: false },
] as const;

function useDots(space: Space | undefined, entries: Entry[], signedIn: boolean) {
  const payments = usePayments(signedIn);
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
  const meWaits = !!space && (!space.profile.email_verified || dueOf(payments.data).length > 0);
  return { matches: scoreWaits, me: meWaits };
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
  const [scope, setScopeState] = useState(initialScope);
  const initialized = useRef(false);
  const hostClub = useQuery({
    queryKey: ['public', 'host-club'],
    queryFn: resolveHostClub,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (hostClub.data) setScopeState(`club:${hostClub.data.club_id}`);
  }, [hostClub.data]);
  const setScope = (value: string) => {
    setScopeState(value);
    localStorage.setItem(SCOPE_KEY, value);
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
    enabled: !!token && !linkBusy,
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
  const liveEntries = unscoped
    ? (live.data?.entries ?? query.data?.entries ?? [])
    : (query.data?.entries ?? []);
  const liveLoading = unscoped && live.isPending;
  useEffect(() => {
    if (query.data) saveSession(query.data);
  }, [query.data]);
  const dots = useDots(query.data, liveEntries, !!token && !linkBusy);

  if (linkBusy || (token && query.isPending)) return <Loading />;
  if (!token)
    return (
      <>
        {linkError && <Alert color="red">{linkError}</Alert>}
        {notice && <Alert color="court">{tx(notice)}</Alert>}
        <PlayerLogin initialPassphrase={participantPassphrase} onSession={start} />
      </>
    );
  if (query.error || !query.data)
    return (
      <Container py="xl">
        <ErrorState error={query.error} retry={() => void query.refetch()} />
        <Button mt="lg" onClick={logout}>
          {tx('Return to player login')}
        </Button>
      </Container>
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
  const context: PlayerSpaceContext = {
    space,
    scope,
    scopeQuery,
    scopeOptions,
    liveEntries,
    liveLoading,
    setScope,
    openLink: () => setLinking(true),
    notice,
    clearNotice: () => setNotice(''),
  };
  const current =
    SECTIONS.find((s) => (s.end ? pathname === s.to : pathname.startsWith(s.to)))?.to ?? '/player';
  const dotFor = (to: string) =>
    to === '/player/matches' ? dots.matches : to === '/player/me' ? dots.me : false;
  const outlet = (
    <Stack gap="md">
      {linkError && <Alert color="red">{linkError}</Alert>}
      {notice && (
        <Alert color="court" withCloseButton onClose={() => setNotice('')}>
          {tx(notice)}
        </Alert>
      )}
      <Outlet context={context} />
    </Stack>
  );
  return (
    <Container size={mode === 'desktop' ? 'lg' : 'md'} py="lg">
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
                    <Indicator size={8} color="red" disabled={false}>
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
    </Container>
  );
}
