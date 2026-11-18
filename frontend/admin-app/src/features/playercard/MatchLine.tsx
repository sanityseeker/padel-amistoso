import { Fragment } from 'react';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { t as tx } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { formatSets } from '../../admin/tournament/scoring';
import type { Score } from '../../types';
import { PlayerName, StatusBadge } from '../../ui';
import type { CardMatch } from './types';

const flip = (s: Score): Score => [s[1], s[0]];
export const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
export const deltaColor = (n: number) => (n > 0 ? 'green' : n < 0 ? 'red' : 'dimmed');

interface Named {
  name: string;
  id: string | null;
}
const named = (names: string[], ids?: (string | null)[]): Named[] =>
  names.map((name, i) => ({ name, id: ids?.[i] ?? null }));

// Names joined by `separator`; each with an id opens its card when `onOpen` is given.
function Names({
  people,
  onOpen,
  separator = ', ',
}: {
  people: Named[];
  onOpen?: (id: string) => void;
  separator?: string;
}) {
  return (
    <>
      {people.map((p, i) => (
        <Fragment key={`${i}:${p.name}`}>
          {i > 0 && separator}
          <PlayerName
            name={p.name}
            id={p.id ?? undefined}
            onOpen={onOpen && p.id ? () => onOpen(p.id!) : undefined}
          />
        </Fragment>
      ))}
    </>
  );
}

// A translated template ("vs {names}") split around its `{names}` slot, so the names can be links.
function around(template: 'with {names}' | 'vs {names}'): [string, string] {
  const mark = '\u0000';
  const [before = '', after = ''] = tx(template, { names: mark }).split(mark);
  return [before, after];
}

// One match from the card player's side: their score first, the result, partner and opponents.
// `player` and `members` drop the card's own names from the partners (the event card); a wider card
// sends the partners and opponents itself. `onPlayer` opens the card of a name: an event player id on
// the event card, a profile id on a wider card.
export function MatchLine({
  m,
  player,
  members = [],
  onPlayer,
}: {
  m: CardMatch;
  player: string;
  members?: string[];
  onPlayer?: (id: string) => void;
}) {
  const mine = m.side === 2;
  const sets = m.sets?.length ? (mine ? m.sets.map(flip) : m.sets) : null;
  const score = m.score && m.score.length >= 2 ? (mine ? flip(m.score) : m.score) : null;
  // Sets decide by sets won (a super tie-break counts as one); a plain score by points.
  const [us, them] = sets
    ? sets.reduce(([a, b], [x, y]) => [a + (x > y ? 1 : 0), b + (y > x ? 1 : 0)], [0, 0])
    : (score ?? [0, 0]);
  const result = !m.side || (!sets && !score) ? null : us > them ? 'W' : us < them ? 'L' : 'D';
  const team1 = named(m.team1, m.team1_ids);
  const team2 = named(m.team2, m.team2_ids);
  const own = m.side === 2 ? team2 : team1;
  const other = m.side === 2 ? team1 : team2;
  const partners = m.partners
    ? named(m.partners, m.partner_profiles)
    : own.filter((p) => p.name !== player && !members.includes(p.name));
  const opponents = m.opponents ? named(m.opponents, m.opponent_profiles) : other;
  const withText = around('with {names}');
  const vsText = around('vs {names}');
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
                <Text size="sm" component="div">
                  {withText[0]}
                  <Names people={partners} onOpen={onPlayer} />
                  {withText[1]}
                </Text>
              )}
              <Text size="sm" c="dimmed" component="div">
                {vsText[0]}
                <Names people={opponents} onOpen={onPlayer} />
                {vsText[1]}
              </Text>
            </>
          ) : (
            <Text size="sm" component="div">
              <Names people={team1} onOpen={onPlayer} separator=" / " /> –{' '}
              <Names people={team2} onOpen={onPlayer} separator=" / " />
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
