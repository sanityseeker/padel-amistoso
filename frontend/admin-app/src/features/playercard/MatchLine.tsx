import { Group, Paper, Stack, Text } from '@mantine/core';
import { t as tx } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { formatSets } from '../../admin/tournament/scoring';
import type { Score } from '../../types';
import { StatusBadge } from '../../ui';
import type { CardMatch } from './types';

const flip = (s: Score): Score => [s[1], s[0]];
export const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
export const deltaColor = (n: number) => (n > 0 ? 'green' : n < 0 ? 'red' : 'dimmed');

// One match from the card player's side: their score first, the result, partner and opponents.
// `player` and `members` drop the card's own names from the partners (the event card); a wider card
// sends the partners and opponents itself.
export function MatchLine({
  m,
  player,
  members = [],
}: {
  m: CardMatch;
  player: string;
  members?: string[];
}) {
  const mine = m.side === 2;
  const sets = m.sets?.length ? (mine ? m.sets.map(flip) : m.sets) : null;
  const score = m.score && m.score.length >= 2 ? (mine ? flip(m.score) : m.score) : null;
  // Sets decide by sets won (a super tie-break counts as one); a plain score by points.
  const [us, them] = sets
    ? sets.reduce(([a, b], [x, y]) => [a + (x > y ? 1 : 0), b + (y > x ? 1 : 0)], [0, 0])
    : (score ?? [0, 0]);
  const result = !m.side || (!sets && !score) ? null : us > them ? 'W' : us < them ? 'L' : 'D';
  const own = m.side === 2 ? m.team2 : m.team1;
  const other = m.side === 2 ? m.team1 : m.team2;
  const partners = m.partners ?? own.filter((n) => n !== player && !members.includes(n));
  const opponents = m.opponents ?? other;
  const round =
    (m.round_label && formatRoundLabel(m.round_label)) ||
    (m.round_number ? `R${m.round_number}` : '');
  const text = sets
    ? formatSets(sets, m.decider ?? 'full_set')
    : score
      ? `${score[0]}–${score[1]}`
      : tx('Vs');
  return (
    <Paper variant="row" p="sm" data-testid="tv-card-match">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Stack gap={4} miw={0}>
          {m.tournament_name && (
            <Text size="xs" c="dimmed" truncate data-testid="card-match-event">
              {m.tournament_name}
            </Text>
          )}
          <Group gap="xs" wrap="nowrap">
            {result && (
              <StatusBadge
                size="sm"
                miw="2.25rem"
                tone={result === 'W' ? 'success' : result === 'L' ? 'danger' : 'neutral'}
              >
                {tx(result)}
              </StatusBadge>
            )}
            <Text fw={700} ff="var(--font-display)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {text}
            </Text>
            {m.walkover && <StatusBadge size="xs">{tx('Walkover')}</StatusBadge>}
            {round && (
              <Text size="xs" c="dimmed" truncate>
                {round}
              </Text>
            )}
          </Group>
          {m.side ? (
            <>
              {partners.length > 0 && (
                <Text size="sm">{tx('with {names}', { names: partners.join(', ') })}</Text>
              )}
              <Text size="sm" c="dimmed">
                {tx('vs {names}', { names: opponents.join(', ') })}
              </Text>
            </>
          ) : (
            <Text size="sm">
              {m.team1.join(' / ')} – {m.team2.join(' / ')}
            </Text>
          )}
        </Stack>
        {m.elo_delta != null && (
          <Text fw={700} size="sm" c={deltaColor(m.elo_delta)}>
            {signed(Number(m.elo_delta))}
          </Text>
        )}
      </Group>
    </Paper>
  );
}
