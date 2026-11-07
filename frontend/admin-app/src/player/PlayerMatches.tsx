import { t as tx, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconExternalLink } from '@tabler/icons-react';
import { Empty, ErrorState, Loading } from '../components';
import { eventUrl, playerApi } from './api';
import type { Entry, PlayerMatch } from './types';
interface MatchStatus {
  phase: string;
  team_roster?: Record<string, string[]>;
}
interface MatchPayload {
  all_matches?: PlayerMatch[];
  matches?: PlayerMatch[] | Record<string, PlayerMatch[]>;
}
interface TvSettings {
  allow_player_scoring: boolean;
  score_mode: Record<string, string>;
  set_decider: 'full_set' | 'match_tiebreak';
}
function EnterScore({
  match,
  entry,
  endpoint,
  token,
  setsAvailable,
  defaultMode,
  decider,
  close,
}: {
  match: PlayerMatch;
  entry: Entry;
  endpoint: string;
  token: string;
  setsAvailable: boolean;
  defaultMode: string;
  decider: 'full_set' | 'match_tiebreak';
  close: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const [mode, setMode] = useState(defaultMode);
  const [score1, setScore1] = useState<number | string>('');
  const [score2, setScore2] = useState<number | string>('');
  const [sets, setSets] = useState<[number | string, number | string][]>([
    ['', ''],
    ['', ''],
    ['', ''],
  ]);
  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'points' && (score1 === '' || score2 === ''))
        throw new Error('Enter both scores.');
      const enteredSets = sets.filter((s) => s[0] !== '' || s[1] !== '');
      if (
        mode === 'sets' &&
        (!enteredSets.length || enteredSets.some((s) => s[0] === '' || s[1] === ''))
      )
        throw new Error('Complete both sides of every set you enter.');
      const suffix = mode === 'sets' ? `${endpoint}-tennis` : endpoint;
      return playerApi<{
        review?: boolean;
      }>(
        `/tournaments/${entry.entity_id}/${suffix}`,
        mode === 'sets'
          ? {
              match_id: match.id,
              sets: enteredSets.map((s) => s.map(Number)),
              decider,
            }
          : {
              match_id: match.id,
              score1: Number(score1),
              score2: Number(score2),
            },
        'POST',
        token,
      );
    },
    onSuccess: (result) => {
      void client.invalidateQueries({
        queryKey: ['player'],
      });
      notifications.show({
        message: tx(
          result.review
            ? 'Score sent to the organizer for review.'
            : 'Score submitted. Your event’s confirmation rules apply.',
        ),
        color: 'green',
      });
      close();
    },
  });
  return (
    <Modal opened onClose={close} title={tx('Submit your score')} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <Stack>
          {submit.error && <Alert color="red">{tx(submit.error.message)}</Alert>}
          <Text fw={600}>
            {match.team1.join(' & ')}
            <br />
            <Text span c="dimmed" fw={400}>
              {tx('vs')}
            </Text>
            <br />
            {match.team2.join(' & ')}
          </Text>
          {setsAvailable && (
            <SegmentedControl
              aria-label={tx('Score format')}
              value={mode}
              onChange={setMode}
              data={[
                {
                  value: 'points',
                  label: tx('Points'),
                },
                {
                  value: 'sets',
                  label: tx('Sets'),
                },
              ]}
            />
          )}
          {mode !== defaultMode && (
            <Alert color="orange">
              {tx('A different scoring format may require organizer review.')}
            </Alert>
          )}
          {mode === 'points' ? (
            <>
              <Text size="sm" c="dimmed">
                {match.effective_points_target
                  ? tx('Scores must total {value1} points.', {
                      value1: match.effective_points_target,
                    })
                  : tx('Enter the score for each side.')}
              </Text>
              <SimpleGrid cols={2}>
                <NumberInput
                  label={tx('First side')}
                  min={0}
                  allowDecimal={false}
                  required
                  value={score1}
                  onChange={setScore1}
                />
                <NumberInput
                  label={tx('Second side')}
                  min={0}
                  allowDecimal={false}
                  required
                  value={score2}
                  onChange={setScore2}
                />
              </SimpleGrid>
            </>
          ) : (
            <Stack>
              {sets.map((s, i) => (
                <SimpleGrid cols={2} key={i}>
                  <NumberInput
                    label={tx('{value1} · first side', {
                      value1:
                        i === 2 && decider === 'match_tiebreak'
                          ? 'Match tie-break'
                          : `Set ${i + 1}`,
                    })}
                    min={0}
                    allowDecimal={false}
                    value={s[0]}
                    onChange={(v) =>
                      setSets((prev) => prev.map((old, j) => (i === j ? [v, old[1]] : old)))
                    }
                  />
                  <NumberInput
                    label={tx('{value1} · second side', {
                      value1:
                        i === 2 && decider === 'match_tiebreak'
                          ? 'Match tie-break'
                          : `Set ${i + 1}`,
                    })}
                    min={0}
                    allowDecimal={false}
                    value={s[1]}
                    onChange={(v) =>
                      setSets((prev) => prev.map((old, j) => (i === j ? [old[0], v] : old)))
                    }
                  />
                </SimpleGrid>
              ))}
            </Stack>
          )}
          <Button type="submit" loading={submit.isPending}>
            {tx('Submit score')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
export function PlayerMatches({ entry, close }: { entry: Entry; close: () => void }) {
  useLocale();
  const client = useQueryClient();
  const [editing, setEditing] = useState<PlayerMatch | null>(null);
  const prefix =
    entry.tournament_type === 'mexicano'
      ? 'mex'
      : entry.tournament_type === 'group_playoff'
        ? 'gp'
        : 'po';
  const session = useQuery({
    queryKey: ['player', 'match-session', entry.entity_id],
    queryFn: () =>
      playerApi<{
        access_token: string;
      }>(
        `/tournaments/${entry.entity_id}/player-auth`,
        {
          token: entry.auto_login_token,
        },
        'POST',
        null,
      ),
    enabled: !!entry.auto_login_token,
    staleTime: 15 * 60_000,
  });
  const token = session.data?.access_token || null;
  const query = useQuery({
    queryKey: ['player', 'matches', entry.entity_id],
    enabled: !entry.auto_login_token || !!token,
    queryFn: async () => {
      const [status, tv] = await Promise.all([
        playerApi<MatchStatus>(
          `/tournaments/${entry.entity_id}/${prefix}/status`,
          undefined,
          'GET',
          token,
        ),
        playerApi<TvSettings>(
          `/tournaments/${entry.entity_id}/tv-settings`,
          undefined,
          'GET',
          token,
        ),
      ]);
      const group = prefix === 'gp' && status.phase === 'groups';
      const mex = prefix === 'mex' && status.phase === 'mexicano';
      const path = group ? 'groups' : mex ? 'matches' : 'playoffs';
      const payload = await playerApi<MatchPayload>(
        `/tournaments/${entry.entity_id}/${prefix}/${path}`,
        undefined,
        'GET',
        token,
      );
      const raw = payload.all_matches || payload.matches || [];
      const matches = Array.isArray(raw) ? raw : Object.values(raw).flat();
      const roster = status.team_roster || {};
      const expand = (ids: string[]) => ids.flatMap((id) => [id, ...(roster[id] || [])]);
      const mine = matches.filter((m) =>
        expand([...m.team1_ids, ...m.team2_ids]).includes(entry.player_id),
      );
      return {
        matches: mine,
        expand,
        endpoint: `${prefix}/${group ? 'record-group' : prefix === 'po' || mex ? 'record' : 'record-playoff'}`,
        context: group ? 'gp-group' : mex ? 'mex' : `${prefix}-playoff`,
        setsAvailable: !mex,
        tv,
      };
    },
    refetchInterval: 15_000,
  });
  useEffect(() => {
    const events = new EventSource(`/api/tournaments/${entry.entity_id}/events`);
    events.onmessage = () => {
      void client.invalidateQueries({
        queryKey: ['player', 'matches', entry.entity_id],
      });
    };
    return () => events.close();
  }, [client, entry.entity_id]);
  const accept = useMutation({
    mutationFn: (mid: string) =>
      playerApi(`/tournaments/${entry.entity_id}/matches/${mid}/accept`, {}, 'POST', token),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['player'],
      });
      notifications.show({
        message: tx('Score confirmed'),
        color: 'green',
      });
    },
  });
  return (
    <>
      <Modal opened onClose={close} title={entry.entity_name} size="xl" centered>
        <Stack>
          <Group justify="space-between">
            <Title order={3}>{tx('Your matches')}</Title>
            <Button
              component="a"
              href={eventUrl(entry)}
              variant="subtle"
              size="xs"
              rightSection={<IconExternalLink size={14} />}
            >
              {tx('Full event view')}
            </Button>
          </Group>
          {session.error || query.error ? (
            <ErrorState error={session.error || query.error} />
          ) : query.isPending ? (
            <Loading />
          ) : !query.data.matches.length ? (
            <Empty title={tx('Your court is waiting')}>
              {tx('Your organizer will publish pairings here when the next round is ready.')}
            </Empty>
          ) : (
            query.data.matches.map((m) => {
              const first = query.data.expand(m.team1_ids);
              const second = query.data.expand(m.team2_ids);
              const opposing =
                m.scored_by &&
                ((first.includes(entry.player_id) && second.includes(m.scored_by)) ||
                  (second.includes(entry.player_id) && first.includes(m.scored_by)));
              return (
                <Card key={m.id} withBorder p="lg">
                  <Group justify="space-between" mb="md">
                    <Text size="xs" c="dimmed">
                      {m.round_label} · {m.court || tx('Court to be assigned')}
                    </Text>
                    <Badge variant="light" color={m.score_confirmed ? 'gray' : 'court'}>
                      {m.score
                        ? m.score_confirmed
                          ? tx('Final')
                          : tx('Awaiting confirmation')
                        : tx('To play')}
                    </Badge>
                  </Group>
                  <Group justify="space-between">
                    <Text fw={600}>{m.team1.join(' & ')}</Text>
                    <Text fw={800} size="xl">
                      {m.score?.[0] ?? '—'}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text fw={600}>{m.team2.join(' & ')}</Text>
                    <Text fw={800} size="xl">
                      {m.score?.[1] ?? '—'}
                    </Text>
                  </Group>
                  {m.sets && (
                    <Text size="sm" c="dimmed">
                      {tx('Sets:')}
                      {m.sets.map((s) => s.join('–')).join(', ')}
                    </Text>
                  )}
                  {m.disputed || m.format_review ? (
                    <Alert mt="md" color="orange">
                      {tx(
                        'Your organizer is reviewing this score. Use the full event view for dispute details.',
                      )}
                    </Alert>
                  ) : (
                    token &&
                    query.data.tv.allow_player_scoring && (
                      <Group mt="md">
                        {!m.score && m.status !== 'completed' && (
                          <Button variant="light" onClick={() => setEditing(m)}>
                            {tx('Enter score')}
                          </Button>
                        )}
                        {opposing && m.score && !m.score_confirmed && (
                          <Button
                            variant="light"
                            leftSection={<IconCheck size={15} />}
                            loading={accept.isPending}
                            onClick={() => accept.mutate(m.id)}
                          >
                            {tx('Confirm score')}
                          </Button>
                        )}
                      </Group>
                    )
                  )}
                </Card>
              );
            })
          )}
          {accept.error && <Alert color="red">{tx(accept.error.message)}</Alert>}
          <Text size="xs" c="dimmed">
            {tx(
              'Corrections, disputes, and detailed brackets are available in the full event view.',
            )}
          </Text>
        </Stack>
      </Modal>
      {editing && token && query.data && (
        <EnterScore
          key={editing.id}
          match={editing}
          entry={entry}
          endpoint={query.data.endpoint}
          token={token}
          setsAvailable={query.data.setsAvailable}
          defaultMode={
            (editing.format_override?.mode || query.data.tv.score_mode[query.data.context]) ===
              'sets' && query.data.setsAvailable
              ? 'sets'
              : 'points'
          }
          decider={editing.effective_decider || query.data.tv.set_decider || 'full_set'}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
