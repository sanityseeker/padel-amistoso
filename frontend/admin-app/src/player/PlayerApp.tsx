import { t as tx, useLocale } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { ErrorState, Loading } from '../components';
import { formatType } from '../api';
import { PublicHeader, SupportLinks } from '../PublicHeader';
import { eventUrl, PLAYER_DATA, PLAYER_TOKEN, playerApi, saveSession } from './api';
import type { Entry, Leaderboard, Resolution, Session, Space } from './types';
import { PlayerLogin } from './PlayerLogin';
import { PlayerAccount, PlayerPayments } from './PlayerAccount';
import { PlayerMatches } from './PlayerMatches';

// Read link credentials once, before removing them from the address bar.
const linkParams = new URLSearchParams(window.location.hash.slice(1));
const linkToken = linkParams.get('token');
const verifyToken = linkParams.get('verify_token');
const participantPassphrase = linkParams.get('participant_passphrase') || '';
function LinkEvent({ close }: { close: () => void }) {
  useLocale();
  const client = useQueryClient();
  const [passphrase, setPassphrase] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: async () => {
      const result = await playerApi<Resolution>(
        '/player-profile/resolve',
        {
          passphrase: passphrase.trim(),
        },
        'POST',
        null,
      );
      if (!result.matches.length)
        throw new Error(
          'No event entries found. Enter the passphrase issued for that tournament or registration.',
        );
      setResolution(result);
      setSelected('0');
    },
  });
  const link = useMutation({
    mutationFn: () => {
      const match = resolution!.matches[Number(selected)];
      return playerApi(
        '/player-profile/link',
        {
          entity_type: match.entity_type,
          entity_id: match.entity_id,
          passphrase: passphrase.trim(),
        },
        'POST',
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['player'],
      });
      notifications.show({
        message: tx('Event linked to your profile'),
        color: 'green',
      });
      close();
    },
  });
  return (
    <Modal opened onClose={close} title={tx('Link an event')} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (resolution) link.mutate();
          else resolve.mutate();
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {tx(
              'Use your event passphrase to connect an existing registration or tournament to your profile.',
            )}
          </Text>
          {(resolve.error || link.error) && (
            <Alert color="red">{(resolve.error || link.error)?.message}</Alert>
          )}
          <TextInput
            label={tx('Event passphrase')}
            autoComplete="off"
            required
            disabled={!!resolution}
            value={passphrase}
            onChange={(e) => setPassphrase(e.currentTarget.value)}
          />
          {resolution && (
            <Select
              label={tx('Event entry')}
              required
              allowDeselect={false}
              value={selected}
              onChange={setSelected}
              data={resolution.matches.map((m, i) => ({
                value: String(i),
                label: `${m.entity_name} · ${m.player_name}`,
              }))}
            />
          )}
          <Group justify="flex-end">
            {resolution && (
              <Button
                variant="subtle"
                onClick={() => {
                  setResolution(null);
                  resolve.reset();
                  link.reset();
                }}
              >
                {tx('Use another passphrase')}
              </Button>
            )}
            <Button type="submit" loading={resolve.isPending || link.isPending}>
              {resolution ? tx('Link event') : tx('Find event')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
function EventCards({
  entries,
  onMatches,
}: {
  entries: Entry[];
  onMatches: (entry: Entry) => void;
}) {
  useLocale();
  if (!entries.length)
    return (
      <Text c="dimmed" size="sm">
        {tx('No events found')}
      </Text>
    );
  return (
    <Stack gap="xs">
      {entries.map((entry) => (
        <Paper
          key={entry.entity_type + ':' + entry.entity_id}
          p="sm"
          className="compact-player-event"
        >
          <Group justify="space-between">
            <div>
              {entry.entity_deleted ? (
                <Text fw={600}>{entry.entity_name}</Text>
              ) : (
                <Text component="a" href={eventUrl(entry)} fw={600} className="text-link">
                  {entry.entity_name}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {entry.player_name}
              </Text>
            </div>
            {entry.entity_type === 'tournament' && !entry.entity_deleted && (
              <Button variant="subtle" size="compact-xs" onClick={() => onMatches(entry)}>
                {tx('My matches')}
              </Button>
            )}
          </Group>
          <Group gap={6} mt={6}>
            <Badge size="xs" variant="light">
              {tx(entry.sport === 'tennis' ? 'Tennis' : 'Padel')}
            </Badge>
            <Text size="xs" c="dimmed">
              {entry.tournament_type ? formatType(entry.tournament_type) : tx('Registration lobby')}
            </Text>
            {entry.rank && (
              <Badge size="xs" color="gray">
                #{entry.rank}
              </Badge>
            )}
          </Group>
          {entry.status === 'finished' && (
            <Text size="xs" mt={6}>
              {entry.wins} {tx('wins ·')} {entry.losses} {tx('losses')}
              {entry.elo_after !== null ? ' · ' + Math.round(entry.elo_after) + ' ELO' : ''}
            </Text>
          )}
        </Paper>
      ))}
    </Stack>
  );
}
function Ratings({ space, scopeQuery }: { space: Space; scopeQuery: string }) {
  const locale = useLocale();
  const [sport, setSport] = useState<'padel' | 'tennis'>('padel');
  const board = useQuery({
    queryKey: ['player', 'leaderboard', scopeQuery],
    queryFn: () => playerApi<Leaderboard>(`/player-profile/leaderboard${scopeQuery}`),
  });
  const history = space.elo_history.filter((m) => m.sport === sport);
  const points = history
    .slice()
    .reverse()
    .map((m) => m.elo_after);
  const min = Math.min(...points),
    max = Math.max(...points);
  const path = points
    .map(
      (p, i) =>
        `${20 + (i / Math.max(1, points.length - 1)) * 560},${130 - ((p - min) / Math.max(1, max - min)) * 100}`,
    )
    .join(' ');
  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <div>
          <Title order={3}>{tx('Match history')}</Title>
        </div>
        <Select
          aria-label={tx('Rating sport')}
          value={sport}
          allowDeselect={false}
          onChange={(v) => setSport(v as 'padel' | 'tennis')}
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
      </Group>
      {points.length > 1 && (
        <Paper p="lg">
          <Text size="sm" fw={600}>
            {tx('Recent rating trend')}
          </Text>
          <svg
            viewBox="0 0 600 160"
            role="img"
            aria-label={tx('{value1} ELO trend across {value2} recent matches', {
              value1: sport,
              value2: points.length,
            })}
            className="rating-chart"
          >
            <line x1="20" y1="140" x2="580" y2="140" stroke="var(--app-border)" />
            <polyline
              points={path}
              fill="none"
              stroke="var(--app-primary)"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={20 + (i / Math.max(1, points.length - 1)) * 560}
                cy={130 - ((p - min) / Math.max(1, max - min)) * 100}
                r={4}
                fill="var(--app-tennis)"
              >
                <title>
                  {Math.round(p)}
                  {' ' + tx('ELO')}
                </title>
              </circle>
            ))}
          </svg>
          <Text size="xs" c="dimmed">
            {tx('Oldest to newest · Up to 50 recent rating changes across sports')}
          </Text>
        </Paper>
      )}
      <Paper p="lg">
        <Title order={3} mb="md">
          {tx('Recent results')}
        </Title>
        {!history.length ? (
          <Text c="dimmed">{tx('Your rated match results will appear here.')}</Text>
        ) : (
          <Table.ScrollContainer minWidth={500}>
            <Table verticalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Event')}</Table.Th>
                  <Table.Th>{tx('Score')}</Table.Th>
                  <Table.Th>{tx('ELO')}</Table.Th>
                  <Table.Th>{tx('Change')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((m, i) => (
                  <Table.Tr key={`${m.match_id}:${i}`}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {m.tournament_name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {m.is_manual
                          ? m.adjustment_reason || tx('Rating adjustment')
                          : new Date(m.updated_at).toLocaleDateString(locale)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {m.sets.length
                        ? m.sets.map((s) => s.join('–')).join(', ')
                        : m.score.join('–') || '—'}
                    </Table.Td>
                    <Table.Td>{Math.round(m.elo_after)}</Table.Td>
                    <Table.Td>
                      <Text fw={650} c={m.elo_delta >= 0 ? 'success' : 'danger'}>
                        {m.elo_delta > 0 ? '+' : ''}
                        {m.elo_delta.toFixed(1)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
      <Paper p="lg">
        <Title order={3} mb="md">
          {tx('Community leaderboard')}
        </Title>
        {board.isPending ? (
          <Loading />
        ) : board.error ? (
          <ErrorState error={board.error} />
        ) : !board.data[sport].length ? (
          <Text c="dimmed">{tx('No rated players in this scope yet.')}</Text>
        ) : (
          <Table.ScrollContainer minWidth={400}>
            <Table verticalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>{tx('Player')}</Table.Th>
                  <Table.Th>{tx('Rating')}</Table.Th>
                  <Table.Th>{tx('Matches')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {board.data[sport].map((p, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{p.rank}</Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {p.name}
                      </Text>
                      {p.tier_name && (
                        <Text size="xs" c="dimmed">
                          {p.tier_name}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{Math.round(p.elo)}</Table.Td>
                    <Table.Td>{p.matches}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
    </Stack>
  );
}
export function PlayerApp() {
  useLocale();
  const client = useQueryClient();
  const [token, setToken] = useState(() => localStorage.getItem(PLAYER_TOKEN));
  const [linkBusy, setLinkBusy] = useState(!!(linkToken || verifyToken));
  const [linkError, setLinkError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(
    localStorage.getItem('padel-player-history-panel-open') === 'true',
  );
  const [scope, setScope] = useState(() => {
    const saved = localStorage.getItem('padel-player-community') || '';
    return saved && !saved.includes(':') ? `community:${saved}` : saved;
  });
  const [linking, setLinking] = useState(false);
  const [matchEntry, setMatchEntry] = useState<Entry | null>(null);
  const initialized = useRef(false);
  const hostClub = useQuery({
    queryKey: ['player-host-club'],
    queryFn: async () => {
      const config = await playerApi<{
        amistoso_domain: string | null;
      }>('/config', undefined, 'GET', null);
      const host = window.location.hostname;
      if (host === 'localhost' || /^[\d.]+$/.test(host)) return null;
      const suffix = config.amistoso_domain ? `.${config.amistoso_domain}` : null;
      const slug = suffix
        ? host.endsWith(suffix)
          ? host.slice(0, -suffix.length)
          : ''
        : host.split('.').length === 3
          ? host.split('.')[0]
          : '';
      if (!slug || slug.includes('.') || ['admin', 'www', 'demo', 'app'].includes(slug))
        return null;
      return playerApi<{
        club_id: string;
        name: string;
      }>(`/clubs/by-slug/${encodeURIComponent(slug)}`, undefined, 'GET', null);
    },
    staleTime: Infinity,
  });
  useEffect(() => {
    if (hostClub.data) setScope(`club:${hostClub.data.club_id}`);
  }, [hostClub.data]);
  const scopeId = scope.split(':').slice(1).join(':');
  const params = new URLSearchParams({
    elo_history_limit: '50',
  });
  if (scopeId) params.set(scope.startsWith('club:') ? 'club_id' : 'community_id', scopeId);
  const scopeQuery = scopeId
    ? `?${scope.startsWith('club:') ? 'club_id' : 'community_id'}=${encodeURIComponent(scopeId)}`
    : '';
  const logout = useCallback(() => {
    localStorage.removeItem(PLAYER_TOKEN);
    localStorage.removeItem(PLAYER_DATA);
    setToken(null);
    setMatchEntry(null);
    setLinking(false);
    client.removeQueries({
      queryKey: ['player'],
    });
  }, [client]);
  const onSession = useCallback(
    (session: Session) => {
      client.removeQueries({
        queryKey: ['player'],
      });
      saveSession(session);
      setToken(session.access_token);
    },
    [client],
  );
  useEffect(() => {
    document.title = tx('Player Hub') + ' · Torneos Amistosos';
    const expire = () => logout();
    const storage = (e: StorageEvent) => {
      if (e.key === PLAYER_TOKEN && !e.newValue) logout();
    };
    window.addEventListener('player-auth-expired', expire);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('player-auth-expired', expire);
      window.removeEventListener('storage', storage);
    };
  }, [logout]);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (linkToken || verifyToken || participantPassphrase)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    void (async () => {
      try {
        if (verifyToken) {
          await playerApi(
            '/player-profile/verify-email',
            {
              token: verifyToken,
            },
            'POST',
            null,
          );
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
          onSession(session);
        }
        if (verifyToken)
          void client.invalidateQueries({
            queryKey: ['player'],
          });
      } catch (e) {
        setLinkError((e as Error).message);
      } finally {
        setLinkBusy(false);
      }
    })();
  }, [client, onSession]);
  const query = useQuery({
    queryKey: ['player', 'space', scope],
    enabled: !!token && !linkBusy,
    queryFn: () => playerApi<Space>(`/player-profile/space?${params}`),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (query.data) saveSession(query.data);
  }, [query.data]);
  if (linkBusy || (token && query.isPending)) return <Loading />;
  if (!token)
    return (
      <>
        {linkError && <Alert color="red">{linkError}</Alert>}
        {notice && <Alert color="court">{notice}</Alert>}
        <PlayerLogin initialPassphrase={participantPassphrase} onSession={onSession} />
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
  const profile = space.profile;
  const active = space.entries.filter((e) => e.status === 'active');
  const history = space.entries.filter((e) => e.status === 'finished');
  const scopeOptions = [
    {
      value: '',
      label: tx('All my communities'),
    },
    ...space.player_clubs.map((c) => ({
      value: `club:${c.id}`,
      label: c.name,
    })),
    ...space.player_communities.map((c) => ({
      value: `community:${c.id}`,
      label: c.name,
    })),
  ];
  const resolvedClub = hostClub.data;
  if (resolvedClub && !scopeOptions.some((s) => s.value === `club:${resolvedClub.club_id}`)) {
    scopeOptions.push({
      value: `club:${resolvedClub.club_id}`,
      label: resolvedClub.name,
    });
  }
  return (
    <div className="player-workspace">
      <PublicHeader current="player" actions={<span />} />
      <Container size="md" py="lg">
        <Stack gap="md">
          {linkError && <Alert color="red">{linkError}</Alert>}
          {notice && (
            <Alert color="court" withCloseButton onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          <Paper p="md">
            <Group justify="space-between">
              <div>
                <Title order={1} size="h3">
                  {profile.name}
                </Title>
                <Group gap="xs">
                  <Text size="sm" c="dimmed">
                    {profile.email}
                  </Text>
                  <Badge size="xs" color={profile.email_verified ? 'court' : 'orange'}>
                    {tx(profile.email_verified ? 'Verified' : 'Pending')}
                  </Badge>
                </Group>
              </div>
              <Group gap="xs">
                <Button size="xs" variant="default" onClick={() => setEditing(!editing)}>
                  {tx(editing ? 'Cancel' : 'Edit')}
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  aria-label={tx('Log out of Player Hub')}
                  onClick={logout}
                >
                  {tx('Log out')}
                </Button>
              </Group>
            </Group>
          </Paper>
          {editing && (
            <PlayerAccount
              key={profile.id + profile.name + profile.email + profile.contact}
              profile={profile}
              editing
            />
          )}
          {(space.player_clubs.length > 0 || space.player_communities.length > 0) && (
            <Paper p="md">
              <Select
                label={tx('Player stats scope')}
                data={scopeOptions}
                value={scope}
                allowDeselect={false}
                onChange={(v) => {
                  setScope(v || '');
                  localStorage.setItem('padel-player-community', v || '');
                }}
              />
              <Group gap={6} mt="sm">
                {space.player_communities.map((c) => (
                  <Badge key={c.id} variant="light" color="gray">
                    {c.name}
                  </Badge>
                ))}
                {space.player_clubs.map((c) => (
                  <Badge key={c.id} variant="light">
                    {c.name}
                  </Badge>
                ))}
              </Group>
            </Paper>
          )}
          <PlayerAccount profile={profile} />
          <PlayerPayments />
          <Paper p="md">
            <Group justify="space-between" mb="md">
              <Title order={2} size="h3">
                {tx('Tournaments')}
              </Title>
              <Button variant="subtle" size="xs" onClick={() => setLinking(true)}>
                {tx('Link event')}
              </Button>
            </Group>
            <Title order={3} size="sm" mb="sm">
              {tx('Active')}
            </Title>
            <EventCards entries={active} onMatches={setMatchEntry} />
            {history.length > 0 && (
              <details
                className="compact-details"
                open={historyOpen}
                onToggle={(e) => {
                  const open = e.currentTarget.open;
                  setHistoryOpen(open);
                  localStorage.setItem('padel-player-history-panel-open', String(open));
                }}
              >
                <summary>
                  {tx('Finished')} ({history.length})
                </summary>
                <EventCards entries={history} onMatches={setMatchEntry} />
              </details>
            )}
          </Paper>
          {history.length > 0 && (
            <Paper p="md">
              <Title order={2} size="h3" mb="sm">
                {tx('Career stats')}
              </Title>
              <Group gap="lg">
                <Text size="sm">
                  {tx('Completed events')}: {history.length}
                </Text>
                <Text size="sm">
                  {history.reduce((n, e) => n + e.wins, 0)} {tx('wins ·')}{' '}
                  {history.reduce((n, e) => n + e.losses, 0)} {tx('losses')}
                </Text>
              </Group>
            </Paper>
          )}
          {(profile.elo_padel_matches > 0 ||
            profile.elo_tennis_matches > 0 ||
            space.elo_history.length > 0) && (
            <Paper p="md">
              <Title order={2} size="h3" mb="sm">
                {tx('ELO ratings')}
              </Title>
              <Group gap="lg">
                {profile.elo_padel !== null && profile.elo_padel_matches > 0 && (
                  <Text size="sm">
                    {tx('Padel')}: {Math.round(profile.elo_padel)} ELO
                  </Text>
                )}
                {profile.elo_tennis !== null && profile.elo_tennis_matches > 0 && (
                  <Text size="sm">
                    {tx('Tennis')}: {Math.round(profile.elo_tennis)} ELO
                  </Text>
                )}
              </Group>
              <details className="compact-details">
                <summary>{tx('Match history and leaderboard')}</summary>
                <Ratings space={space} scopeQuery={scopeQuery} />
              </details>
            </Paper>
          )}
        </Stack>
        <SupportLinks />{' '}
      </Container>
      {linking && <LinkEvent close={() => setLinking(false)} />}
      {matchEntry && (
        <PlayerMatches
          key={matchEntry.entity_id}
          entry={matchEntry}
          close={() => setMatchEntry(null)}
        />
      )}
    </div>
  );
}
