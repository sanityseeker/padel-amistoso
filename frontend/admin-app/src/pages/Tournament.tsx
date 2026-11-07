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
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { Link, useParams } from 'react-router-dom';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconDeviceTv,
  IconEdit,
  IconTrophy,
} from '@tabler/icons-react';
import { api, formatType, write } from '../api';
import {
  Empty,
  ErrorState,
  LegacyLink,
  Loading,
  PageHeading,
  PhaseBadge,
  useLiveUpdates,
  useOverview,
} from '../components';
import { useAuth } from '../auth';
import type { Match, MatchData, Standing, TournamentStatus } from '../types';
function Standings({ rows }: { rows: Standing[] }) {
  useLocale();
  return (
    <Table.ScrollContainer minWidth={400}>
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>{tx('Player')}</Table.Th>
            <Table.Th>{tx('Played')}</Table.Th>
            <Table.Th>{tx('Wins')}</Table.Th>
            <Table.Th>{tx('Points')}</Table.Th>
            <Table.Th>{tx('ELO')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((p, i) => (
            <Table.Tr key={p.player_id}>
              <Table.Td>
                <Text fw={700} c={i < 3 ? 'court' : 'dimmed'}>
                  {i + 1}
                </Text>
              </Table.Td>
              <Table.Td>{p.player}</Table.Td>
              <Table.Td>{p.matches_played ?? p.played ?? 0}</Table.Td>
              <Table.Td>{p.wins}</Table.Td>
              <Table.Td>
                <Text fw={650}>{p.total_points ?? p.points_for ?? 0}</Text>
              </Table.Td>
              <Table.Td>{p.elo ? Math.round(p.elo) : '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
function ScoreForm({
  match,
  endpoint,
  close,
  tid,
}: {
  match: Match;
  endpoint: string;
  close: () => void;
  tid: string;
}) {
  useLocale();
  const client = useQueryClient();
  const [score1, setScore1] = useState<string | number>(match.score?.[0] ?? '');
  const [score2, setScore2] = useState<string | number>(match.score?.[1] ?? '');
  const save = useMutation({
    mutationFn: () => {
      if (score1 === '' || score2 === '') throw new Error('Enter a score for both sides.');
      return write(endpoint, {
        match_id: match.id,
        score1: Number(score1),
        score2: Number(score2),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['tournament', tid],
      });
      void client.invalidateQueries({
        queryKey: ['tournaments'],
      });
      notifications.show({
        message: tx('Score saved'),
        color: 'green',
      });
      close();
    },
  });
  return (
    <Modal opened onClose={close} title={tx('Record match score')} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack>
          {save.error && <Alert color="red">{tx(save.error.message)}</Alert>}
          <Text size="sm" c="dimmed">
            {match.round_label} · {match.court || tx('Unassigned court')}
          </Text>
          {match.effective_points_target && (
            <Text size="sm">
              {tx('Scores must add up to') + ' '}
              {match.effective_points_target}
              {' ' + tx('points.')}
            </Text>
          )}
          <NumberInput
            label={match.team1.join(' & ')}
            min={0}
            allowDecimal={false}
            required
            value={score1}
            onChange={setScore1}
          />
          <NumberInput
            label={match.team2.join(' & ')}
            min={0}
            allowDecimal={false}
            required
            value={score2}
            onChange={setScore2}
          />
          <Text size="xs" c="dimmed">
            {tx('For set scores and third-set deciders, use Advanced admin.')}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {tx('Cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tx('Save score')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
export function TournamentPage() {
  useLocale();
  const { id = '' } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const { tournaments } = useOverview();
  const tournament = tournaments.data?.find((t) => t.id === id);
  const prefix =
    tournament?.type === 'mexicano' ? 'mex' : tournament?.type === 'group_playoff' ? 'gp' : 'po';
  const [editing, setEditing] = useState<Match | null>(null);
  const [filter, setFilter] = useState('pending');
  const [confirm, setConfirm] = useState<{
    title: string;
    action: string;
    body?: unknown;
  } | null>(null);
  useLiveUpdates(id);
  const query = useQuery({
    queryKey: ['tournament', id],
    enabled: !!tournament,
    queryFn: async () => {
      const status = await api<TournamentStatus>(`/tournaments/${id}/${prefix}/status`);
      const groupStage = prefix === 'gp' && status.phase === 'groups';
      const path = groupStage
        ? 'groups'
        : prefix === 'mex' && status.phase === 'mexicano'
          ? 'matches'
          : 'playoffs';
      const data = await api<MatchData>(`/tournaments/${id}/${prefix}/${path}`);
      return {
        status,
        data,
        groupStage,
        path,
      };
    },
  });
  const advance = useMutation({
    mutationFn: () => write(`/tournaments/${id}/${prefix}/${confirm!.action}`, confirm!.body),
    onSuccess: () => {
      setConfirm(null);
      void client.invalidateQueries({
        queryKey: ['tournament', id],
      });
      void client.invalidateQueries({
        queryKey: ['tournaments'],
      });
      notifications.show({
        message: tx('Tournament updated'),
        color: 'green',
      });
    },
  });
  if (tournaments.isPending || (tournament && query.isPending)) return <Loading />;
  if (tournaments.error || query.error)
    return (
      <ErrorState
        error={tournaments.error || query.error}
        retry={() => {
          void tournaments.refetch();
          void query.refetch();
        }}
      />
    );
  if (!tournament || !query.data)
    return (
      <Empty title={tx('Tournament not found')}>
        {tx('It may have been removed or you may not have access.')}
      </Empty>
    );
  const { status, data, groupStage, path } = query.data;
  const raw = data.all_matches || data.matches || [];
  const matches = Array.isArray(raw) ? raw : Object.values(raw).flat();
  const pending = matches.filter(
    (m) => m.status !== 'completed' && m.team1.length && m.team2.length,
  );
  const visible =
    filter === 'all'
      ? matches
      : matches.filter((m) =>
          filter === 'completed' ? m.status === 'completed' : m.status !== 'completed',
        );
  const canEdit =
    user?.role === 'admin' || tournament.owner === user?.username || tournament.shared;
  const endpoint = `/tournaments/${id}/${prefix}/${groupStage ? 'record-group' : prefix === 'po' || path === 'matches' ? 'record' : 'record-playoff'}`;
  const showAdvance = canEdit && !pending.length && status.phase !== 'finished';
  return (
    <>
      <Button
        component={Link}
        to="/tournaments"
        variant="subtle"
        color="gray"
        leftSection={<IconArrowLeft size={16} />}
        mb="lg"
        px={0}
      >
        {tx('All tournaments')}
      </Button>
      <PageHeading
        title={tournament.name}
        description={`${formatType(tournament.type)} · ${tournament.sport === 'padel' ? tx('Padel') : tx('Tennis')} · ${tournament.club_name || tournament.community_name}`}
      >
        <Group>
          <LegacyLink />
          <Button
            component="a"
            href={`/tv?tid=${id}`}
            variant="default"
            leftSection={<IconDeviceTv size={17} />}
          >
            {tx('TV view')}
          </Button>
        </Group>
      </PageHeading>
      <Paper p="lg" mb="lg">
        <Group justify="space-between">
          <Group>
            <PhaseBadge phase={status.phase} />
            {!!status.current_round && (
              <Text size="sm">
                {status.num_rounds
                  ? tx('Round {round} of {total}', {
                      round: status.current_round,
                      total: status.num_rounds,
                    })
                  : tx('Round {round}', { round: status.current_round })}
              </Text>
            )}
            <Text size="sm" c="dimmed">
              {tx('{done} / {total} matches completed', {
                done: matches.filter((m) => m.status === 'completed').length,
                total: matches.length,
              })}
            </Text>
          </Group>
          {showAdvance && (
            <Group>
              {prefix === 'mex' && status.phase === 'mexicano' && !status.mexicano_ended && (
                <>
                  {(!status.num_rounds || (status.current_round ?? 0) < status.num_rounds) && (
                    <Button
                      variant="light"
                      rightSection={<IconArrowRight size={16} />}
                      onClick={() => {
                        advance.reset();
                        setConfirm({
                          title: tx(
                            status.current_round
                              ? 'Generate the next round?'
                              : 'Start the first round?',
                          ),
                          action: 'next-round',
                          body: {},
                        });
                      }}
                    >
                      {status.current_round ? tx('Next round') : tx('Start first round')}
                    </Button>
                  )}
                  {!!status.current_round && (
                    <Button
                      variant="default"
                      onClick={() => {
                        advance.reset();
                        setConfirm({
                          title: tx('End the Mexicano rounds?'),
                          action: 'end',
                        });
                      }}
                    >
                      {tx('End rounds')}
                    </Button>
                  )}
                </>
              )}
              {prefix === 'mex' && status.mexicano_ended && (
                <Button
                  onClick={() => {
                    advance.reset();
                    setConfirm({
                      title: tx('Finish this tournament?'),
                      action: 'finish',
                    });
                  }}
                >
                  {tx('Finish tournament')}
                </Button>
              )}
              {groupStage && (
                <Button
                  rightSection={<IconArrowRight size={16} />}
                  onClick={() => {
                    advance.reset();
                    setConfirm(
                      data.has_more_rounds
                        ? {
                            title: tx('Generate the next group round?'),
                            action: 'next-group-round',
                          }
                        : {
                            title: tx('Start the play-offs?'),
                            action: 'start-playoffs',
                            body: {},
                          },
                    );
                  }}
                >
                  {data.has_more_rounds ? tx('Next group round') : tx('Start play-offs')}
                </Button>
              )}
            </Group>
          )}
        </Group>
      </Paper>
      {status.champion && (
        <Alert color="court" icon={<IconTrophy />} title={tx('Tournament champions')} mb="lg">
          {status.champion.join(' & ')}
        </Alert>
      )}
      <Tabs defaultValue="matches">
        <Tabs.List mb="lg">
          <Tabs.Tab value="matches">{tx('Matches')}</Tabs.Tab>
          <Tabs.Tab value="standings">{tx('Standings')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="matches">
          <Group justify="space-between" mb="lg">
            <Title order={3}>{tx('Match centre')}</Title>
            <SegmentedControl
              value={filter}
              onChange={setFilter}
              data={[
                {
                  value: 'pending',
                  label: tx('To play'),
                },
                {
                  value: 'completed',
                  label: tx('Completed'),
                },
                {
                  value: 'all',
                  label: tx('All matches'),
                },
              ]}
            />
          </Group>
          {!visible.length ? (
            <Empty
              title={filter === 'pending' ? tx('Every point is in.') : tx('No matches to show')}
            >
              {tx('Switch the filter to see other matches, or generate the next round.')}
            </Empty>
          ) : (
            <SimpleGrid
              cols={{
                base: 1,
                lg: 2,
              }}
            >
              {visible.map((m) => (
                <Card key={m.id} withBorder p="lg">
                  <Group justify="space-between" mb="md">
                    <Text size="xs" fw={600} c="dimmed">
                      {m.round_label} · {m.court || tx('No court assigned')}
                    </Text>
                    <Badge
                      size="xs"
                      color={m.status === 'completed' ? 'gray' : 'court'}
                      variant="light"
                    >
                      {m.status === 'completed' ? tx('Final') : tx('To play')}
                    </Badge>
                  </Group>
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text fw={600}>{m.team1.join(' & ') || tx('To be decided')}</Text>
                      <Text fw={800} size="xl">
                        {m.score?.[0] ?? '—'}
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text fw={600}>{m.team2.join(' & ') || tx('To be decided')}</Text>
                      <Text fw={800} size="xl">
                        {m.score?.[1] ?? '—'}
                      </Text>
                    </Group>
                  </Stack>
                  {m.sets && (
                    <Text size="sm" c="dimmed" mt="sm">
                      {tx('Sets:')}
                      {m.sets.map((s) => s.join('–')).join(', ')}
                    </Text>
                  )}
                  {(m.disputed || m.format_review) && (
                    <Alert mt="sm" color="orange">
                      {tx('This score needs review in Advanced admin.')}
                    </Alert>
                  )}
                  {canEdit &&
                    m.team1.length > 0 &&
                    m.team2.length > 0 &&
                    !m.sets &&
                    !m.disputed &&
                    !m.format_review && (
                      <Button
                        variant="light"
                        mt="lg"
                        leftSection={m.score ? <IconEdit size={15} /> : <IconCheck size={15} />}
                        onClick={() => setEditing(m)}
                      >
                        {m.score ? tx('Edit score') : tx('Record score')}
                      </Button>
                    )}
                </Card>
              ))}
            </SimpleGrid>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="standings">
          {status.leaderboard ? (
            <Paper p="lg">
              <Standings rows={status.leaderboard} />
            </Paper>
          ) : data.standings ? (
            <Stack>
              {Object.entries(data.standings).map(([name, rows]) => (
                <Paper p="lg" key={name}>
                  <Title order={4} mb="md">
                    {tx('Group')}
                    {name}
                  </Title>
                  <Standings rows={rows} />
                </Paper>
              ))}
            </Stack>
          ) : (
            <Empty title={tx('Follow the bracket')}>
              {tx('Play-off progress is shown in the match centre and TV view.')}
            </Empty>
          )}
        </Tabs.Panel>
      </Tabs>
      {editing && (
        <ScoreForm
          key={editing.id}
          match={editing}
          endpoint={endpoint}
          tid={id}
          close={() => setEditing(null)}
        />
      )}
      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title} centered>
        <Stack>
          {advance.error && <Alert color="red">{tx(advance.error.message)}</Alert>}
          <Text size="sm">{tx('This updates the tournament and its public view.')}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              {tx('Cancel')}
            </Button>
            <Button loading={advance.isPending} onClick={() => advance.mutate()}>
              {tx('Continue')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
