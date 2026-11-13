import { useEffect, useState } from 'react';
import {
  Accordion,
  Button,
  Group,
  Loader,
  MultiSelect,
  Paper,
  Radio,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { ResponsiveSheet } from '../../ui';
import classes from './Dialogs.module.css';
import { t as tx, useLocale } from '../../i18n';
import { api, write } from '../../api';
import type { PairingProposal, RepeatDetail } from '../../types';
import { roundStats, type PlayerStat, type RoundContext } from './pairings';
import { Notice } from '../../ui/Notice';
import { StatusBadge } from '../../ui/StatusBadge';

interface ProposalResponse {
  proposals: PairingProposal[];
  player_stats: Record<string, PlayerStat> | null;
}
const listOf = (rows: { player: string; count: number }[]) =>
  rows.map((r) => `${r.player} (x${r.count})`).join(', ') || tx('None yet');

const fixed = (n: number | undefined) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '0.00';

/** Who would partner or face whom again, per player ("Ana: partner Luis x2, vs Eva x1"). */
function RepeatDetails({ detail }: { detail: Record<string, RepeatDetail> }) {
  const rows = Object.entries(detail)
    .map(([name, d]) => ({
      name,
      parts: [
        ...(d.partner_repeats ?? []).map((r) =>
          tx('partner {player} x{count}', { player: r.player, count: r.count }),
        ),
        ...(d.opponent_repeats ?? []).map((r) =>
          tx('vs {player} x{count}', { player: r.player, count: r.count }),
        ),
      ],
    }))
    .filter((r) => r.parts.length);
  if (!rows.length) return null;
  return (
    <Stack gap={0} data-testid="repeat-details">
      {rows.map((r) => (
        <Text key={r.name} size="xs" c="dimmed">
          <b>{r.name}</b>: {r.parts.join(', ')}
        </Text>
      ))}
    </Stack>
  );
}

/** The numbers under a proposal or a hand-made round: score gap, repeats, rematch, skill-gap breaks. */
function Metrics({
  gap,
  repeats,
  rematches,
  violations,
  excess,
  sitOut,
  hideRepeats,
}: {
  gap: number;
  repeats: number;
  rematches: number;
  violations: number;
  excess: number;
  sitOut?: string[];
  /** The proposal card already shows a repeats badge. */
  hideRepeats?: boolean;
}) {
  return (
    <Stack gap={2} data-testid="metrics">
      <Text size="xs" c="dimmed">
        {tx('Score gap')}: <b>{tx('{n} pts', { n: fixed(gap) })}</b>
      </Text>
      {!hideRepeats && (
        <Text size="xs" c={repeats ? 'orange' : 'dimmed'}>
          {repeats ? tx('{n} repeats', { n: fixed(repeats) }) : tx('No repeated match-ups')}
        </Text>
      )}
      {rematches > 0 && (
        <Text size="xs" c="orange">
          {tx('Exact rematch from previous round in {n} match(es). Avoid if possible.', {
            n: rematches,
          })}
        </Text>
      )}
      {violations > 0 && (
        <Text size="xs" c="red">
          {tx('Skill-gap violation in {n} match(es) (worst +{excess})', {
            n: violations,
            excess: fixed(excess),
          })}
        </Text>
      )}
      {!!sitOut?.length && (
        <Text size="xs" c="dimmed">
          {tx('Sitting out: {names}', { names: sitOut.join(', ') })}
        </Text>
      )}
    </Stack>
  );
}

function ProposalCard({ proposal, details }: { proposal: PairingProposal; details: boolean }) {
  return (
    <Radio.Card value={proposal.option_id} p="sm" radius="md" data-testid="proposal">
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Radio.Indicator mt={3} />
        <Stack gap={4} flex={1} miw={0}>
          <Group gap={6}>
            <Text fw={700}>{proposal.label}</Text>
            {proposal.recommended && (
              <StatusBadge tone="info" variant="light">
                {tx('Recommended')}
              </StatusBadge>
            )}
            {proposal.strategy === 'seeded' && (
              <StatusBadge variant="outline">{tx('Seeded')}</StatusBadge>
            )}
            {proposal.repeat_count > 0 ? (
              <StatusBadge tone="warning" variant="light">
                {tx('{n} repeats', { n: fixed(proposal.repeat_count) })}
              </StatusBadge>
            ) : (
              <StatusBadge tone="success" variant="light">
                {tx('No repeats')}
              </StatusBadge>
            )}
          </Group>
          <Metrics
            gap={proposal.score_imbalance}
            repeats={proposal.repeat_count}
            rematches={proposal.exact_prev_round_repeats ?? 0}
            violations={proposal.skill_gap_violations ?? 0}
            excess={proposal.skill_gap_worst_excess ?? 0}
            sitOut={proposal.sit_out_names}
            hideRepeats
          />
          {proposal.matches.map((m, i) => (
            <Text key={i} size="sm">
              {m.team1_names.join(' & ')}{' '}
              <Text span c="dimmed">
                {tx('vs')}
              </Text>{' '}
              {m.team2_names.join(' & ')}
              {m.court_name && (
                <Text span c="dimmed">
                  {' '}
                  [{m.court_name}]
                </Text>
              )}
            </Text>
          ))}
          {details && proposal.per_person_repeats && proposal.repeat_count > 0 && (
            <RepeatDetails detail={proposal.per_person_repeats} />
          )}
        </Stack>
      </Group>
    </Radio.Card>
  );
}

const labelNumber = (p: PairingProposal) => {
  const m = /(\d+)\s*$/.exec(p.label);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const byLabel = (a: PairingProposal, b: PairingProposal) =>
  labelNumber(a) - labelNumber(b) || a.label.localeCompare(b.label);

// "Generate the next round": GET /mex/propose-pairings (options, forced sit-outs, partner balance)
// then POST /mex/next-round with the chosen option_id, or POST /mex/custom-round for a hand-made round.
export function PairingsDialog({
  tid,
  title,
  players,
  sitOutCount,
  missedGames,
  partnerBalance,
  teamMode = false,
  ratings = {},
  skillGap = null,
  previousRound = [],
  onClose,
}: {
  tid: string;
  title: string;
  players: { id: string; name: string }[];
  sitOutCount: number;
  /** Per player: games missed and played, shown beside each name in the sit-out picker. */
  missedGames?: Record<string, { name: string; sat_out: number; matches_played: number }>;
  partnerBalance: number;
  /** Fixed teams: the partner balance slider does not apply. */
  teamMode?: boolean;
  /** Leaderboard values by player id, for the hand-made round's score gap and skill gap. */
  ratings?: RoundContext['ratings'];
  skillGap?: number | null;
  previousRound?: RoundContext['previousRound'];
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const [count, setCount] = useState(3);
  const [sitOuts, setSitOuts] = useState<string[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [statPlayer, setStatPlayer] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [tab, setTab] = useState<string | null>('suggested');
  const forcedOk = sitOuts.length === 0 || sitOuts.length === sitOutCount;
  const proposals = useQuery({
    queryKey: ['admin', 'pairings', tid, count, sitOuts.join(','), balance],
    enabled: forcedOk,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: () => {
      const q = new URLSearchParams({ n: String(count) });
      if (sitOuts.length) q.set('sit_out_ids', sitOuts.join(','));
      if (balance != null) q.set('partner_balance_weight', String(balance));
      return api<ProposalResponse>(`/tournaments/${tid}/mex/propose-pairings?${q}`);
    },
  });
  const list = proposals.data?.proposals ?? [];
  const best = list.find((p) => p.recommended) ?? list[0] ?? null;
  const rest = list.filter((p) => p !== best);
  const balanced = rest.filter((p) => p.strategy === 'balanced').sort(byLabel);
  const seeded = rest.filter((p) => p.strategy === 'seeded').sort(byLabel);
  const others = rest.filter((p) => p.strategy !== 'balanced' && p.strategy !== 'seeded');
  useEffect(() => {
    if (!list.length) return;
    setPicked((current) =>
      current && list.some((p) => p.option_id === current)
        ? current
        : (list.find((p) => p.recommended) ?? list[0]!).option_id,
    );
  }, [list]);

  const done = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'tournament', tid] });
    void client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
    notifications.show({ message: tx('Tournament updated'), color: 'green' });
    onClose();
  };
  const commit = useMutation({
    // Without proposals the server picks the recommended pairing itself (the old behaviour).
    mutationFn: () =>
      write(`/tournaments/${tid}/mex/next-round`, picked ? { option_id: picked } : {}),
    onSuccess: done,
  });

  // Manual round: four selects per match.
  const matchCount = Math.max(1, Math.floor(players.length / 4));
  const [slots, setSlots] = useState<string[][]>(() =>
    Array.from({ length: matchCount }, () => ['', '', '', '']),
  );
  const used = slots.flat().filter(Boolean);
  const duplicate = used.length !== new Set(used).size;
  const complete = slots.every((s) => s.every(Boolean));
  const custom = useMutation({
    mutationFn: () =>
      write(`/tournaments/${tid}/mex/custom-round`, {
        matches: slots.map((s) => ({ team1_ids: [s[0], s[1]], team2_ids: [s[2], s[3]] })),
      }),
    onSuccess: done,
  });
  const labels = ['Team 1, player 1', 'Team 1, player 2', 'Team 2, player 1', 'Team 2, player 2'];
  const stats = proposals.data?.player_stats;
  const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
  const round = roundStats(slots, { names, ratings, stats, skillGap, previousRound });
  // Players left out of every match sit out; the line also warns when too many or too few do.
  const sittingOut = players.filter((p) => !used.includes(p.id)).map((p) => p.name);
  const goToManual = (value: string | null) => {
    setTab(value);
    // Opening the manual editor with a proposal chosen starts from that proposal.
    const chosen = list.find((p) => p.option_id === picked);
    if (value === 'manual' && chosen && slots.every((s) => s.every((x) => !x)))
      setSlots(
        Array.from({ length: Math.max(matchCount, chosen.matches.length) }, (_, i) => {
          const m = chosen.matches[i];
          return m ? [...m.team1_ids, ...m.team2_ids] : ['', '', '', ''];
        }),
      );
  };
  const stat = statPlayer && stats ? stats[statPlayer] : null;

  return (
    <ResponsiveSheet opened onClose={onClose} title={title} size="lg">
      <Tabs value={tab} onChange={goToManual} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="suggested">{tx('Suggested pairings')}</Tabs.Tab>
          <Tabs.Tab value="manual">{tx('Manual round')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="suggested">
          <Stack>
            {(commit.error || proposals.error) && (
              <Notice tone="danger">{tx((commit.error || proposals.error)!.message)}</Notice>
            )}
            {proposals.isFetching && !list.length ? (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  {tx('Generating proposals…')}
                </Text>
              </Group>
            ) : (
              <Radio.Group value={picked} onChange={setPicked} aria-label={tx('Pairing options')}>
                <Stack gap="xs">
                  <Switch
                    size="sm"
                    checked={details}
                    onChange={(e) => setDetails(e.currentTarget.checked)}
                    label={tx('Show per-player repeat details')}
                  />
                  {best && (
                    <>
                      <Text fw={700}>{tx('Best')}</Text>
                      <Text size="xs" c="dimmed">
                        {tx(
                          'Top recommended option based on skill-gap compliance, score gap, and repeats.',
                        )}
                      </Text>
                      <ProposalCard proposal={best} details={details} />
                    </>
                  )}
                  {balanced.length > 0 && (
                    <>
                      <Text fw={700}>{tx('Balanced')}</Text>
                      <Text size="xs" c="dimmed">
                        {tx(
                          'Focuses on minimizing score gap and repeats while respecting constraints.',
                        )}
                      </Text>
                      {balanced.map((p) => (
                        <ProposalCard key={p.option_id} proposal={p} details={details} />
                      ))}
                    </>
                  )}
                  {seeded.length > 0 && (
                    <>
                      <Text fw={700}>{tx('Seeded')}</Text>
                      <Text size="xs" c="dimmed">
                        {tx('Focuses on a strict separation by the current ranking.')}
                      </Text>
                      {seeded.map((p) => (
                        <ProposalCard key={p.option_id} proposal={p} details={details} />
                      ))}
                    </>
                  )}
                  {others.map((p) => (
                    <ProposalCard key={p.option_id} proposal={p} details={details} />
                  ))}
                </Stack>
              </Radio.Group>
            )}
            <Group>
              {count >= 10 ? (
                <Button
                  variant="default"
                  size="compact-md"
                  loading={proposals.isFetching && !!list.length}
                  onClick={() => void proposals.refetch()}
                >
                  {tx('Refresh proposals')}
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="compact-md"
                  loading={proposals.isFetching && !!list.length}
                  onClick={() => setCount(10)}
                >
                  {tx('Show more options')}
                </Button>
              )}
            </Group>
            <Accordion variant="contained">
              <Accordion.Item value="tune">
                <Accordion.Control>{tx('Tune the pairings')}</Accordion.Control>
                <Accordion.Panel>
                  <Stack>
                    {sitOutCount > 0 && (
                      <MultiSelect
                        label={tx('Force sit-outs')}
                        description={tx(
                          'Pick exactly {n} players, or none to let the app choose.',
                          {
                            n: sitOutCount,
                          },
                        )}
                        data={players
                          .map((p) => ({ value: p.id, label: p.name }))
                          .sort(
                            (a, b) =>
                              (missedGames?.[b.value]?.sat_out ?? 0) -
                                (missedGames?.[a.value]?.sat_out ?? 0) ||
                              (missedGames?.[a.value]?.matches_played ?? 0) -
                                (missedGames?.[b.value]?.matches_played ?? 0),
                          )}
                        renderOption={({ option }) => {
                          const g = missedGames?.[option.value];
                          return (
                            <Group justify="space-between" wrap="nowrap" w="100%" gap="sm">
                              <Text size="sm">{option.label}</Text>
                              {g && (
                                <Text size="xs" c="dimmed">
                                  {tx('{n} missed', { n: g.sat_out })} ·{' '}
                                  {tx('{n} played', { n: g.matches_played })}
                                </Text>
                              )}
                            </Group>
                          );
                        }}
                        value={sitOuts}
                        onChange={setSitOuts}
                        error={
                          forcedOk ? undefined : tx('Pick exactly {n} players.', { n: sitOutCount })
                        }
                        searchable
                        clearable
                      />
                    )}
                    {!teamMode && (
                      <div>
                        <Text size="sm" fw={600}>
                          {tx('Partner balance')}: {(balance ?? partnerBalance).toFixed(1)}
                        </Text>
                        <Text size="xs" c="dimmed" mb="xs">
                          {tx('For this round only. Not saved to the tournament.')}
                        </Text>
                        <Slider
                          min={0}
                          max={Math.max(2, partnerBalance)}
                          step={0.1}
                          defaultValue={partnerBalance}
                          label={null}
                          aria-label={tx('Partner balance')}
                          onChangeEnd={setBalance}
                        />
                      </div>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
              {stats && (
                <Accordion.Item value="history">
                  <Accordion.Control>{tx('Partner and opponent history')}</Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <Select
                        aria-label={tx('Player')}
                        placeholder={tx('Select player')}
                        data={Object.keys(stats).sort()}
                        value={statPlayer}
                        onChange={setStatPlayer}
                        searchable
                      />
                      {stat && (
                        <Stack gap={2}>
                          <Text size="sm">
                            <b>{tx('Partners')}:</b> {listOf(stat.partners)}
                          </Text>
                          <Text size="sm">
                            <b>{tx('Opponents')}:</b> {listOf(stat.opponents)}
                          </Text>
                          <Text size="sm">
                            <b>{tx('Partner repeats')}:</b> {stat.total_partner_repeats}
                          </Text>
                          <Text size="sm">
                            <b>{tx('Opponent repeats')}:</b> {stat.total_opponent_repeats}
                          </Text>
                        </Stack>
                      )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              )}
            </Accordion>
            <Text size="sm" c="dimmed">
              {tx('This updates the tournament and its public view.')}
            </Text>
            <Group justify="flex-end" className={classes.footer}>
              <Button variant="default" size="touch" onClick={onClose}>
                {tx('Cancel')}
              </Button>
              <Button
                size="touch"
                loading={commit.isPending}
                disabled={proposals.isFetching && !list.length}
                onClick={() => commit.mutate()}
              >
                {tx('Continue')}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="manual">
          <Stack>
            {custom.error && <Notice tone="danger">{tx(custom.error.message)}</Notice>}
            <Text size="sm" c="dimmed">
              {tx('Choose who plays whom. Players you leave out sit out this round.')}
            </Text>
            {sittingOut.length > 0 && (
              <Text size="sm" data-testid="manual-sitout">
                {tx('Sitting out: {names}', { names: sittingOut.join(', ') })}
              </Text>
            )}
            {slots.map((slot, mi) => (
              <Paper key={mi} p="sm" variant="row">
                <Text variant="eyebrow" mb={6}>
                  {tx('Match {n}', { n: mi + 1 })}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  {slot.map((value, si) => (
                    <Select
                      key={si}
                      aria-label={`${tx('Match {n}', { n: mi + 1 })}: ${tx(labels[si]!)}`}
                      placeholder={tx(labels[si]!)}
                      searchable
                      value={value || null}
                      data={players.map((p) => ({
                        value: p.id,
                        label: p.name,
                        disabled: used.includes(p.id) && p.id !== value,
                      }))}
                      onChange={(v) =>
                        setSlots((rows) =>
                          rows.map((r, i) =>
                            i === mi ? r.map((x, j) => (j === si ? (v ?? '') : x)) : r,
                          ),
                        )
                      }
                    />
                  ))}
                </SimpleGrid>
              </Paper>
            ))}
            <Group gap="xs">
              <Button
                variant="default"
                size="compact-md"
                onClick={() => setSlots((rows) => [...rows, ['', '', '', '']])}
              >
                {tx('Add a match')}
              </Button>
              <Button
                variant="default"
                size="compact-md"
                disabled={slots.length <= 1}
                onClick={() => setSlots((rows) => rows.slice(0, -1))}
              >
                {tx('Remove a match')}
              </Button>
              <Button
                variant="subtle"
                size="compact-md"
                disabled={!used.length}
                onClick={() => setSlots((rows) => rows.map(() => ['', '', '', '']))}
              >
                {tx('Clear all')}
              </Button>
            </Group>
            {round && (
              <Paper p="sm" variant="row" data-testid="round-summary">
                <Text variant="eyebrow" mb={4}>
                  {tx('Round summary')}
                </Text>
                <Metrics
                  gap={round.scoreGap}
                  repeats={round.repeats}
                  rematches={round.exactRematches}
                  violations={round.skillGapViolations}
                  excess={round.skillGapWorstExcess}
                />
                {round.repeats > 0 && <RepeatDetails detail={round.perPerson} />}
              </Paper>
            )}
            {duplicate && (
              <Notice tone="warning">{tx('A player is assigned to more than one match.')}</Notice>
            )}
            <Group justify="flex-end" className={classes.footer}>
              <Button variant="default" size="touch" onClick={onClose}>
                {tx('Cancel')}
              </Button>
              <Button
                size="touch"
                disabled={!complete || duplicate}
                loading={custom.isPending}
                onClick={() => custom.mutate()}
              >
                {tx('Start this round')}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </ResponsiveSheet>
  );
}
