import { useEffect } from 'react';
import { Group, Loader, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { publicApi } from '../../events/api';
import { formatSets } from '../../admin/tournament/scoring';
import type { Score, SetDecider } from '../../types';
import { Notice, ResponsiveSheet, StatTile, StatusBadge } from '../../ui';

interface Card {
  player_name: string;
  elo: number | null;
  elo_delta_total: number | null;
  elo_scope?: string;
  matches: number;
  wins: number;
  draws?: number;
  losses: number;
  recent_matches?: CardMatch[];
}
interface CardMatch {
  round_label?: string;
  round_number?: number;
  team1: string[];
  team2: string[];
  /** The card's player played on this side (1 or 2). */
  side?: 1 | 2 | null;
  score?: Score | null;
  sets?: Score[] | null;
  decider?: SetDecider | null;
  elo_delta: number | null;
}

const flip = (s: Score): Score => [s[1], s[0]];
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const deltaColor = (n: number) => (n > 0 ? 'green' : n < 0 ? 'red' : 'dimmed');

// One match from the card player's side: their score first, the result, partner and opponents.
function MatchLine({ m, player }: { m: CardMatch; player: string }) {
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
  const partners = own.filter((n) => n !== player);
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
                {tx('vs {names}', { names: other.join(', ') })}
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

const AUTO_CLOSE_MS = 30_000;

// A player's card within one tournament (GET /tournaments/{tid}/players/{pid}/public-card). It is the same
// public data as the legacy card; on a TV nobody is there to close it, so it closes itself after a while.
export function PlayerCardModal({
  tid,
  playerId,
  onClose,
}: {
  tid: string;
  playerId: string | null;
  onClose: () => void;
}) {
  useLocale();
  const card = useQuery({
    queryKey: ['public', 'tv', tid, 'card', playerId],
    enabled: !!playerId,
    queryFn: () =>
      publicApi<Card>(
        `/tournaments/${encodeURIComponent(tid)}/players/${encodeURIComponent(playerId!)}/public-card`,
      ),
  });
  useEffect(() => {
    if (!playerId) return;
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [playerId, onClose]);
  const data = card.data;
  const delta = data?.elo_delta_total;
  const draws = data?.draws ?? 0;
  return (
    <ResponsiveSheet
      opened={!!playerId}
      onClose={onClose}
      size="lg"
      title={data?.player_name ?? tx('Loading')}
    >
      {card.isPending && <Loader aria-label={tx('Loading')} />}
      {card.error && <Notice tone="danger">{tx('Could not load player.')}</Notice>}
      {data && (
        <Stack gap="md" data-testid="tv-player-card">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="md">
            <StatTile
              label={data.elo_scope === 'club' ? tx('Club ELO') : tx('ELO')}
              value={data.elo == null ? '—' : Math.round(data.elo)}
            />
            <StatTile
              label={tx('ELO change')}
              value={
                delta == null ? (
                  '—'
                ) : (
                  <Text span inherit c={deltaColor(Number(delta))}>
                    {signed(Number(delta))}
                  </Text>
                )
              }
            />
            <StatTile label={tx('Matches')} value={data.matches || 0} />
            <StatTile
              label={draws ? tx('W–L–D') : tx('W–L')}
              value={[data.wins || 0, data.losses || 0, ...(draws ? [draws] : [])].join('–')}
            />
          </SimpleGrid>
          <Text variant="eyebrow">{tx('Match history')}</Text>
          {!data.recent_matches?.length && (
            <Text c="dimmed" size="sm">
              {tx('No matches yet.')}
            </Text>
          )}
          <Stack gap="xs">
            {data.recent_matches?.map((m, i) => (
              <MatchLine key={i} m={m} player={data.player_name} />
            ))}
          </Stack>
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
