import { useEffect, useState } from 'react';
import { Button, Group, Loader, Modal, NumberInput, Paper, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { api, write } from '../../api';
import type { WithdrawalMatchItem, WithdrawalPreview } from '../../types';
import { Notice } from '../../ui/Notice';
import { StatusBadge } from '../../ui/StatusBadge';

const refreshKeys = (tid: string) => [
  ['admin', 'tournament', tid],
  ['admin', 'tournaments'],
  ['admin', 'tournament-status', tid],
];

const RULES: Record<string, string> = {
  annul: 'Every result of this entry is annulled and it leaves the standings.',
  walkover: 'Results already played stand. The remaining matches become walkovers.',
  exclude: 'The entry is left out of the next rounds. Results stay.',
  forfeit: 'The entry forfeits its play-off match and the opponent advances.',
};
const CONFIRM: Record<string, string> = {
  annul: 'Annul results and withdraw',
  walkover: 'Withdraw with walkovers',
  exclude: 'Withdraw from next rounds',
  forfeit: 'Forfeit and withdraw',
};
const BLOCKERS: Record<string, string> = {
  pending: 'a score waits for confirmation',
  disputed: 'a score is disputed',
  format_review: 'a score waits for format review',
};

function MatchLine({ m, showResult }: { m: WithdrawalMatchItem; showResult: boolean }) {
  return (
    <Text size="sm">
      {[formatRoundLabel(m.round_label), m.court].filter(Boolean).join(' · ')}:{' '}
      {m.team1.join(' & ')} vs {m.team2.join(' & ')}
      {showResult && m.resulting_score ? ` → ${m.resulting_score}` : ''}
      {!showResult && m.current_score ? ` (${m.current_score})` : ''}
    </Text>
  );
}

// Dry-run first (GET .../withdrawals/preview), then POST .../withdrawals with the outcome the
// organizer saw (`expected_kind`) and, when walkovers are created, the walkover score.
export function WithdrawDialog({
  tid,
  playerId,
  onClose,
}: {
  tid: string;
  playerId: string;
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ['admin', 'withdraw-preview', tid, playerId],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      api<WithdrawalPreview>(
        `/tournaments/${tid}/withdrawals/preview?player_id=${encodeURIComponent(playerId)}`,
      ),
  });
  const p = preview.data;
  const [points, setPoints] = useState<[number | string, number | string]>([6, 0]);
  const [sets, setSets] = useState<[number | string, number | string][]>([
    [6, 0],
    [6, 0],
    ['', ''],
  ]);
  useEffect(() => {
    const d = p?.walkover_defaults;
    if (d?.points?.length === 2) setPoints([d.points[0]!, d.points[1]!]);
    if (d?.sets?.length)
      setSets(
        [...d.sets, ['', ''], ['', ''], ['', '']]
          .slice(0, 3)
          .map((s) => [s![0]!, s![1]!] as [number | string, number | string]),
      );
  }, [p]);
  const needsPoints = !!p?.modes_needed.includes('points');
  const needsSets = !!p?.modes_needed.includes('sets');
  const filled = sets
    .filter(([a, b]) => a !== '' || b !== '')
    .map(([a, b]) => [Number(a), Number(b)] as [number, number]);
  const pointsBad =
    needsPoints && !(Number(points[0]) > Number(points[1]) && Number(points[1]) >= 0);
  const wonBy = filled.filter(([a, b]) => a > b).length;
  const setsBad =
    needsSets &&
    (!filled.length || filled.some(([a, b]) => a === b) || wonBy <= filled.length - wonBy);
  const send = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { player_id: playerId, expected_kind: p!.kind };
      if (needsPoints || needsSets)
        body.walkover = {
          ...(needsPoints ? { points: [Number(points[0]), Number(points[1])] } : {}),
          ...(needsSets ? { sets: filled } : {}),
        };
      return write(`/tournaments/${tid}/withdrawals`, body);
    },
    onSuccess: () => {
      refreshKeys(tid).forEach((queryKey) => void client.invalidateQueries({ queryKey }));
      notifications.show({
        message: tx('{name} has withdrawn.', { name: p!.entry_name }),
        color: 'green',
      });
      onClose();
    },
    onError: () => void preview.refetch(),
  });
  const listed = p ? (p.kind === 'annul' ? p.annul_matches : p.walkover_matches) : [];
  return (
    <Modal
      opened
      onClose={onClose}
      title={p ? tx('Withdraw {name}', { name: p.entry_name }) : tx('Withdraw')}
      size="lg"
    >
      <Stack>
        {preview.isPending ? (
          <Loader size="sm" />
        ) : preview.error ? (
          <Notice tone="danger">{tx(preview.error.message)}</Notice>
        ) : (
          p && (
            <>
              {send.error && <Notice tone="danger">{tx(send.error.message)}</Notice>}
              {p.member_names.length > 1 && (
                <Text size="sm" c="dimmed">
                  {tx('Team: {names}', { names: p.member_names.join(', ') })}
                </Text>
              )}
              <Text size="sm">{tx(RULES[p.kind]!)}</Text>
              {p.kind === 'walkover' && (
                <Text size="sm" c="dimmed">
                  {tx('{played} of {total} matches already played.', {
                    played: p.played,
                    total: p.total,
                  })}
                </Text>
              )}
              {listed.length > 0 && (
                <Paper variant="row" p="sm">
                  <Stack gap={4} data-testid="withdraw-matches">
                    {listed.map((m) => (
                      <MatchLine key={m.match_id} m={m} showResult={p.kind === 'walkover'} />
                    ))}
                  </Stack>
                </Paper>
              )}
              {p.kind === 'forfeit' && (
                <Text size="sm">
                  {p.pending_forfeit_match
                    ? tx('{opponent} advances without playing.', {
                        opponent: p.pending_forfeit_match.opponent,
                      })
                    : tx('The opponent is not known yet.')}
                </Text>
              )}
              {p.sit_out_names.length > 0 && (
                <Text size="xs" c="dimmed">
                  {tx('Sitting out: {names}', { names: p.sit_out_names.join(', ') })}
                </Text>
              )}
              {needsPoints && (
                <Group align="flex-end" gap="xs">
                  <NumberInput
                    label={tx('Walkover score: winner')}
                    min={0}
                    max={200}
                    w={150}
                    value={points[0]}
                    onChange={(v) => setPoints([v, points[1]])}
                  />
                  <NumberInput
                    label={tx('Withdrawn side')}
                    min={0}
                    max={200}
                    w={150}
                    value={points[1]}
                    onChange={(v) => setPoints([points[0], v])}
                  />
                </Group>
              )}
              {needsSets && (
                <Stack gap={4}>
                  <Text size="sm" fw={600}>
                    {tx('Walkover sets (winner first)')}
                  </Text>
                  {sets.map((s, i) => (
                    <Group key={i} gap="xs">
                      <NumberInput
                        aria-label={`${tx('Set')} ${i + 1}: ${tx('winner')}`}
                        min={0}
                        w={90}
                        value={s[0]}
                        onChange={(v) =>
                          setSets((rows) => rows.map((r, j) => (j === i ? [v, r[1]] : r)))
                        }
                      />
                      <Text c="dimmed">-</Text>
                      <NumberInput
                        aria-label={`${tx('Set')} ${i + 1}: ${tx('withdrawn side')}`}
                        min={0}
                        w={90}
                        value={s[1]}
                        onChange={(v) =>
                          setSets((rows) => rows.map((r, j) => (j === i ? [r[0], v] : r)))
                        }
                      />
                    </Group>
                  ))}
                </Stack>
              )}
              {(pointsBad || setsBad) && (
                <Text size="sm" c="red">
                  {tx('Enter a valid walkover score.')}
                </Text>
              )}
              {p.blockers.length > 0 && (
                <Notice tone="warning" title={tx('Settle these scores first')}>
                  {p.blockers.map((b) => (
                    <Text size="sm" key={b.match_id}>
                      {[formatRoundLabel(b.round_label), tx(BLOCKERS[b.reason] ?? b.reason)]
                        .filter(Boolean)
                        .join(': ')}
                    </Text>
                  ))}
                </Notice>
              )}
              {p.elo_recalc && (
                <Text size="xs" c="dimmed">
                  {tx('Ratings of the annulled matches are recalculated.')}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {p.undo_possible
                  ? tx('You can undo this until the situation changes.')
                  : tx('This cannot be undone.')}
              </Text>
              <Group justify="flex-end">
                <Button variant="default" size="touch" onClick={onClose}>
                  {tx('Cancel')}
                </Button>
                <Button
                  size="touch"
                  color="red"
                  loading={send.isPending}
                  disabled={p.blockers.length > 0 || pointsBad || setsBad}
                  onClick={() => send.mutate()}
                >
                  {tx(CONFIRM[p.kind]!)}
                </Button>
              </Group>
            </>
          )
        )}
      </Stack>
    </Modal>
  );
}

export function UndoWithdrawal({
  tid,
  entryKey,
  name,
}: {
  tid: string;
  entryKey: string;
  name: string;
}) {
  useLocale();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const undo = useMutation({
    mutationFn: () =>
      write(`/tournaments/${tid}/withdrawals/${encodeURIComponent(entryKey)}`, undefined, 'DELETE'),
    onSuccess: () => {
      refreshKeys(tid).forEach((queryKey) => void client.invalidateQueries({ queryKey }));
      notifications.show({ message: tx('Withdrawal undone'), color: 'green' });
      setOpen(false);
    },
  });
  return (
    <>
      <Button size="compact-md" variant="light" onClick={() => setOpen(true)}>
        {tx('Undo withdrawal')}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={tx('Undo withdrawal')}>
        <Stack>
          {undo.error && <Notice tone="danger">{tx(undo.error.message)}</Notice>}
          <Text size="sm">{tx('Bring {name} back into the tournament?', { name })}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              {tx('Cancel')}
            </Button>
            <Button loading={undo.isPending} onClick={() => undo.mutate()}>
              {tx('Undo withdrawal')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export const WithdrawnBadge = () => <StatusBadge variant="outline">{tx('Withdrawn')}</StatusBadge>;
