import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Anchor,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../../i18n';
import { formatRoundLabel } from '../../../roundLabel';
import { playerApi } from '../../../player/api';
import { sportProps } from '../../../theme';
import type { Entry, PathRound, TournamentPath as Path } from '../../../player/types';
import classes from './TournamentPath.module.css';
import { Notice } from '../../../ui/Notice';

/** A played round's result from the player's side (the same rule as the Played list). */
export type RoundResult = 'won' | 'lost' | 'drawn';
const RESULT_WORD: Record<RoundResult, () => string> = {
  won: () => tx('Won'),
  lost: () => tx('Lost'),
  drawn: () => tx('Draw'),
};

const signed = (n: number | null) => (n == null ? '0' : n > 0 ? `+${n}` : String(n));
const roundName = (row: PathRound) =>
  row.round_label
    ? formatRoundLabel(row.round_label)
    : `${tx('Round', row.stage === 'playoff' ? { context: 'knockout' } : undefined)} ${row.round_number}`;
// Rounds with a standing (group or Mexicano rounds); play-off rounds have none.
export const isRanked = (row: PathRound) => row.stage !== 'playoff' && row.rank != null;

/** The path of one entry, shared by the summary card and the Played list (one request, cached). */
export function useTournamentPath(entry: Entry | undefined) {
  return useQuery({
    queryKey: ['player', 'path', entry?.entity_id, entry?.player_id],
    enabled: !!entry,
    queryFn: () =>
      playerApi<Path>(
        `/player-profile/tournament-path/${encodeURIComponent(entry!.entity_id)}/${encodeURIComponent(entry!.player_id)}`,
      ),
  });
}

/** While the event runs and the player is not sitting out, a last unplayed round is the one being
    played now (the API lists it unplayed), not a sit-out: it stays off the path until it is scored. */
export const playedPath = (rounds: PathRound[], inProgress: boolean) =>
  inProgress && rounds.length && !rounds.at(-1)!.played ? rounds.slice(0, -1) : rounds;

const H = 140;
const PAD = { top: 14, right: 34, bottom: 30, left: 34 };

// Rank after each round: #1 at the top, last place at the bottom, so climbing the table reads as a
// line going up. One series in the sport colour; only the current rank is labelled on the plot, the
// rest is in the tooltip (the crosshair snaps to the nearest round) and in the Played rows. Tapping a
// round asks the page to show that round's row.
function RankChart({
  rows,
  results,
  onSelect,
}: {
  rows: PathRound[];
  results?: Record<string, RoundResult>;
  onSelect?: (row: PathRound) => void;
}) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const total = Math.max(2, ...rows.map((r) => r.total_players));
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const x = (i: number) =>
    PAD.left + (rows.length === 1 ? innerW / 2 : (i * innerW) / (rows.length - 1));
  const y = (rank: number) => PAD.top + ((rank - 1) / (total - 1)) * (H - PAD.top - PAD.bottom);
  const last = rows.length - 1;
  const pick = (clientX: number, box: DOMRect) => {
    const px = clientX - box.left;
    let best = 0;
    rows.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  };
  const tip = hover == null ? null : rows[hover]!;
  return (
    <div ref={ref} className={classes.chart}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={tx('Rank by round')}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover != null && onSelect?.(rows[hover]!)}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          {/* Recessive frame: first and last place, labelled on the left. */}
          {[1, total].map((rank) => (
            <g key={rank}>
              <line
                className={classes.grid}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(rank)}
                y2={y(rank)}
              />
              <text
                className={classes.axis}
                x={PAD.left - 8}
                y={y(rank)}
                textAnchor="end"
                dy="0.35em"
              >
                #{rank}
              </text>
            </g>
          ))}
          {rows.map((row, i) => (
            <text key={i} className={classes.axis} x={x(i)} y={H - 4} textAnchor="middle">
              {tx('R{n}', { n: row.round_number })}
            </text>
          ))}
          {hover != null && (
            <line
              className={classes.crosshair}
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top - 6}
              y2={H - PAD.bottom}
            />
          )}
          <polyline
            className={classes.line}
            points={rows.map((r, i) => `${x(i)},${y(r.rank!)}`).join(' ')}
          />
          {rows.map((row, i) => (
            <circle
              key={i}
              className={classes.dot}
              data-sat-out={row.played ? undefined : ''}
              data-active={hover === i ? '' : undefined}
              cx={x(i)}
              cy={y(row.rank!)}
              r={hover === i ? 6 : 5}
            />
          ))}
          <text className={classes.end} x={x(last) + 10} y={y(rows[last]!.rank!)} dy="0.35em">
            #{rows[last]!.rank}
          </text>
        </svg>
      )}
      {tip && hover != null && (
        <div
          className={classes.tip}
          style={{ left: Math.min(Math.max(x(hover), 70), width - 70), top: y(tip.rank!) - 10 }}
        >
          <Text size="xs" c="dimmed">
            {roundName(tip)}
            {!tip.played && ` · ${tx('Sat out')}`}
          </Text>
          <Text size="sm" fw={700}>
            {tx('#{rank} of {total}', { rank: tip.rank, total: tip.total_players })}
          </Text>
          {tip.played && results?.[tip.round_label] && (
            <Text size="xs">
              {RESULT_WORD[results[tip.round_label]!]()}
              {tip.score ? ` ${tip.score.replace(/-/g, '–')}` : ''}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}

/** Rank change since the previous ranked round: a green up arrow when climbing, red down when dropping. */
export function Movement({ change }: { change: number | null }) {
  // The first ranked round has nothing to compare with.
  if (change == null) return null;
  if (change === 0)
    return (
      <span className={classes.move} data-dir="same">
        –<VisuallyHidden>{tx('Same place')}</VisuallyHidden>
      </span>
    );
  const up = change < 0;
  const n = Math.abs(change);
  return (
    <span className={classes.move} data-dir={up ? 'up' : 'down'}>
      {up ? <IconArrowUp size={13} aria-hidden /> : <IconArrowDown size={13} aria-hidden />}
      <span aria-hidden="true">{n}</span>
      <VisuallyHidden>{tx(up ? 'Up {n} places' : 'Down {n} places', { n })}</VisuallyHidden>
    </span>
  );
}

// Where the player stands: the current rank, start and best, the points so far, and the rank after
// each round as a line. The rounds themselves (who, score, rank change) are the Played list's rows.
// GET /player-profile/tournament-path/{entity}/{player} with the profile token.
export function TournamentPath({
  entry,
  inProgress = false,
  results,
  onSelect,
  onShowStandings,
}: {
  entry: Entry;
  inProgress?: boolean;
  /** The headline is a way into the full table: it scrolls there and marks your row. */
  onShowStandings?: () => void;
  /** Result per round label, for the chart's tooltip. */
  results?: Record<string, RoundResult>;
  /** Tapping a round on the chart. */
  onSelect?: (row: PathRound) => void;
}) {
  useLocale();
  const path = useTournamentPath(entry);
  if (path.isPending) return <Loader size="sm" />;
  if (path.error) return <Notice tone="danger">{tx(path.error.message)}</Notice>;
  const rows = playedPath(path.data.rounds, inProgress);
  if (!path.data.available || !rows.length)
    return (
      <Paper variant="dashed" p="md">
        <Text size="sm" c="dimmed">
          {path.data.available
            ? tx('Your path appears after the first round.')
            : tx('A round-by-round path is not available for this event.')}
        </Text>
      </Paper>
    );
  const ranked = rows.filter(isRanked);
  const now = ranked.at(-1);
  const tennis = rows.some((r) => r.score_mode === 'tennis');
  const lastRow = rows.at(-1)!;
  const best = ranked.length ? Math.min(...ranked.map((r) => r.rank!)) : null;
  return (
    <Paper p="md" data-testid="tournament-path" {...sportProps(entry.sport)}>
      <Stack gap="md">
        {now && (
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="xs">
            <div>
              <UnstyledButton
                className={classes.headline}
                onClick={onShowStandings}
                disabled={!onShowStandings}
                aria-label={onShowStandings ? tx('Show the standings') : undefined}
                data-testid="path-headline"
              >
                <Group gap={6} align="baseline">
                  <span className={classes.now}>#{now.rank}</span>
                  <Text c="dimmed">{tx('of {total}', { total: now.total_players })}</Text>
                </Group>
              </UnstyledButton>
              <Text size="sm" c="dimmed">
                {ranked.length >= 2 &&
                  tx('Started #{start} · best #{best}', { start: ranked[0]!.rank, best })}
                {ranked.length >= 2 && onShowStandings && ' · '}
                {onShowStandings && (
                  <Anchor component="button" size="sm" onClick={onShowStandings}>
                    {tx('Standings')}
                  </Anchor>
                )}
              </Text>
            </div>
            <Text className={classes.total}>
              {tennis
                ? `${tx('Sets')} ${signed(lastRow.cumulative_sets_diff)} · ${tx('Games')} ${signed(lastRow.cumulative_games_diff)}`
                : `${lastRow.cumulative_points} ${tx('pts')}`}
            </Text>
          </Group>
        )}
        {ranked.length >= 2 && <RankChart rows={ranked} results={results} onSelect={onSelect} />}
      </Stack>
    </Paper>
  );
}
