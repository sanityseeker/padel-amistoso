import type { ReactNode } from 'react';
import { Badge, Group, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { ScoreDigits, StatusBadge } from '../../ui';
import { tiebreakOf, type MatchView, type SideView } from './adapters';
import classes from './MatchCard.module.css';

export type MatchDensity = 'row' | 'card' | 'slot' | 'tv';

function Side({
  side,
  view,
  tv,
  hideScore,
}: {
  side: SideView;
  view: MatchView;
  tv: boolean;
  hideScore?: boolean;
}) {
  return (
    <div
      className={classes.side}
      data-side={view.sides[0] === side ? 0 : 1}
      data-win={side.win ? '' : undefined}
      data-you={side.isYou ? '' : undefined}
    >
      <Text
        className={classes.name}
        size={tv ? undefined : 'md'}
        fz={tv ? 'var(--fs-tv-lg)' : undefined}
        miw={0}
      >
        {side.names.join(' & ') || tx('To be decided')}
        {side.isYou && (
          <Badge ml={6} size="xs" variant="outline" component="span">
            {tx('You')}
          </Badge>
        )}
      </Text>
      {!hideScore && (
        <ScoreDigits
          score={side.score}
          games={side.games}
          isTiebreak={tiebreakOf(view)}
          win={side.win}
          size={tv ? 'tv' : 'md'}
        />
      )}
    </div>
  );
}

export interface MatchCardProps {
  match: MatchView;
  density?: MatchDensity;
  /** Right-hand actions (Score / Edit). Hidden while an editor is open. */
  actions?: ReactNode;
  /** Inline editor (ScoreEntry) shown under the sides in place of the actions. */
  editor?: ReactNode;
  /** Extra content under the sides (review lines). */
  children?: ReactNode;
  /** Full-width row under everything (review actions). */
  footer?: ReactNode;
  /** `data-testid`; pass null for cards that are not match-centre rows. */
  testId?: string | null;
  kind?: string;
  /** Marks the row as the keyboard selection. */
  selected?: boolean;
  /** Spectator lists: a match still to play shows no scoreboard digits. */
  hideScores?: boolean;
  /** `false` drops the court from the meta line (the spectator court cards title it themselves). */
  showCourt?: boolean;
  /** `false` when the tournament does not assign courts: no "Waiting for a court" placeholder. */
  courts?: boolean;
  /** Spectator lists: a scheduled match of the signed-in player, tinted and labelled "Your match". */
  yours?: boolean;
}

// One match: meta line, two sides with scoreboard numerals, one action. Used in the admin match
// centre and review queue, the Player Hub, and (density="tv") on the spectator screen.
export function MatchCard({
  match,
  density = 'row',
  actions,
  editor,
  children,
  footer,
  testId = 'match-row',
  kind,
  selected,
  hideScores,
  showCourt = true,
  courts = true,
  yours,
}: MatchCardProps) {
  useLocale();
  const tv = density === 'tv';
  const meta = [
    match.roundLabel && formatRoundLabel(match.roundLabel),
    // A court means "playing there now"; a match still to play without one waits in the queue.
    showCourt
      ? match.court ||
        (courts && match.rawStatus === 'scheduled' ? tx('Waiting for a court') : null)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Paper
      variant={density === 'row' ? 'row' : undefined}
      withBorder={density !== 'row'}
      p={tv ? 'lg' : 'sm'}
      className={classes.card}
      role="listitem"
      data-testid={testId ?? undefined}
      data-status={match.rawStatus}
      data-match-id={match.id}
      data-tone={match.tone}
      data-kind={kind}
      data-density={density}
      data-selected={selected ? '' : undefined}
      data-yours={yours ? '' : undefined}
    >
      <div className={classes.body} data-extra={children ? '' : undefined}>
        {(meta || yours || match.flags.length > 0) && (
          <Group gap={6} wrap="wrap" className={classes.meta} data-part="meta">
            {meta && (
              <Text variant="eyebrow" span fz={tv ? 'var(--fs-tv-sm)' : undefined}>
                {meta}
              </Text>
            )}
            {yours && (
              <StatusBadge tone="info" size="xs">
                {tx('Your match')}
              </StatusBadge>
            )}
            {match.flags.map((f) => (
              <StatusBadge key={f.key} tone={f.tone} variant={f.variant ?? 'light'} size="xs">
                {f.label}
              </StatusBadge>
            ))}
          </Group>
        )}
        <Stack gap={2} miw={0} className={classes.sides}>
          <Side side={match.sides[0]} view={match} tv={tv} hideScore={hideScores} />
          <Side side={match.sides[1]} view={match} tv={tv} hideScore={hideScores} />
        </Stack>
        {children && <div className={classes.extra}>{children}</div>}
        {!editor && actions && <div className={classes.actions}>{actions}</div>}
      </div>
      {editor}
      {footer}
    </Paper>
  );
}

MatchCard.Skeleton = function MatchCardSkeleton() {
  return (
    <Paper variant="row" p="sm" aria-busy="true" aria-label={tx('Loading')}>
      <Stack gap={8}>
        <Skeleton height={12} width="35%" />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </Stack>
    </Paper>
  );
};
