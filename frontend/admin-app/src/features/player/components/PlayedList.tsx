import { Badge, Group, Text, Title, VisuallyHidden } from '@mantine/core';
import { IconMessage } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../../i18n';
import { formatRoundLabel } from '../../../roundLabel';
import type { PathRound } from '../../../player/types';
import { MatchListFrame, type MatchView } from '../../tournaments';
import { isRanked, Movement, type RoundResult } from './TournamentPath';
import classes from './PlayedList.module.css';

type Result = RoundResult;
export interface PlayedItem {
  view: MatchView;
  comment?: string | null;
}

const LETTER: Record<Result, () => string> = {
  won: () => tx('W', { context: 'result' }),
  lost: () => tx('L', { context: 'result' }),
  drawn: () => tx('D'),
};
const WORD: Record<Result, () => string> = {
  won: () => tx('Won'),
  lost: () => tx('Lost'),
  drawn: () => tx('Draw'),
};

/** The result of a played match from the player's side: the rule the chips and the chart share. */
export function resultOf(view: MatchView): Result {
  const you = Math.max(
    0,
    view.sides.findIndex((s) => s.isYou),
  );
  return view.sides[you]!.win ? 'won' : view.sides[1 - you]!.win ? 'lost' : 'drawn';
}

interface Standing {
  rank: number | null;
  change: number | null;
  eliminated: boolean;
}

// The rank after each round and its change since the previous ranked round, by round label.
function standingsOf(path: PathRound[]): Map<string, Standing> {
  const out = new Map<string, Standing>();
  let previous: number | null = null;
  for (const row of path) {
    const ranked = isRanked(row);
    out.set(row.round_label, {
      rank: ranked ? row.rank : null,
      change: ranked && previous != null ? row.rank! - previous : null,
      eliminated: row.eliminated,
    });
    if (ranked) previous = row.rank;
  }
  return out;
}

function StandingCell({ standing }: { standing?: Standing }) {
  if (!standing) return null;
  if (standing.rank != null)
    return (
      <span className={classes.standing} data-testid="played-rank">
        <span className={classes.rank}>#{standing.rank}</span>
        <Movement change={standing.change} />
      </span>
    );
  return standing.eliminated ? (
    <Badge size="xs" variant="light" color="red">
      {tx('Eliminated')}
    </Badge>
  ) : null;
}

type Line =
  | { kind: 'match'; key: string; label: string; view: MatchView; comment?: string | null }
  | { kind: 'sat-out'; key: string; label: string; row: PathRound };

// Played rounds, each telling its whole story: the result (a W / L / D chip: colour and letter), the
// rank after the round and how it moved, then a scoreboard with your pair on top (the You badge) and
// theirs below; bold is the winner, as on every scoreboard. Given the path, rows follow its rounds and
// a round sat out gets a slim row, so no change of rank goes unexplained. "Final" is the normal
// state here, so only an unconfirmed or disputed score is flagged.
export function PlayedList({
  items,
  path,
  testId,
}: {
  items: PlayedItem[];
  /** The player's path (rounds already played), for ranks and sat-out rounds. */
  path?: PathRound[];
  testId?: string;
}) {
  useLocale();
  const standings = path ? standingsOf(path) : new Map<string, Standing>();
  const matchLine = ({ view, comment }: PlayedItem): Line => ({
    kind: 'match',
    key: view.id,
    label: view.roundLabel ?? '',
    view,
    comment,
  });
  // Follow the path when every match finds its round there; otherwise keep the schedule's order.
  const joined = !!path && items.every((i) => standings.has(i.view.roundLabel ?? ''));
  const lines: Line[] = joined
    ? path!.flatMap((row): Line[] => {
        const here = items.filter((i) => i.view.roundLabel === row.round_label);
        if (here.length) return here.map(matchLine);
        return !row.played && row.stage !== 'playoff'
          ? [{ kind: 'sat-out', key: `sat-${row.round_label}`, label: row.round_label, row }]
          : [];
      })
    : items.map(matchLine);
  const results = items.map((i) => resultOf(i.view));
  const count = (r: Result) => results.filter((x) => x === r).length;
  const summary = [
    tx('{n} won', { n: count('won') }),
    tx('{n} lost', { n: count('lost') }),
    count('drawn') > 0 && tx('{n} drawn', { n: count('drawn') }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Group justify="space-between" align="baseline" gap="xs">
        <Title order={2}>{tx('Played')}</Title>
        <Text size="sm" c="dimmed" data-testid="played-summary">
          {summary}
        </Text>
      </Group>
      <MatchListFrame testId={testId}>
        {lines.map((line) => {
          const standing = standings.get(line.label);
          if (line.kind === 'sat-out')
            return (
              <div
                key={line.key}
                role="listitem"
                className={classes.row}
                data-kind="sat-out"
                data-round={line.label}
                data-testid="played-sat-out"
              >
                <span className={classes.chip} data-result="none" aria-hidden="true" />
                <div className={classes.metaLine}>
                  <Group gap={6} wrap="wrap">
                    <Text size="xs" c="dimmed">
                      {formatRoundLabel(line.label)}
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                      {tx('Sat out')}
                    </Badge>
                  </Group>
                  <StandingCell standing={standing} />
                </div>
              </div>
            );
          const { view, comment } = line;
          const result = resultOf(view);
          const you = Math.max(
            0,
            view.sides.findIndex((s) => s.isYou),
          );
          const sides = [view.sides[you]!, view.sides[1 - you]!] as const;
          const flags = view.flags.filter((f) => f.key !== 'final');
          const meta = [view.roundLabel && formatRoundLabel(view.roundLabel), view.court]
            .filter(Boolean)
            .join(' · ');
          return (
            <div
              key={line.key}
              role="listitem"
              className={classes.row}
              data-testid="player-match"
              data-match-id={view.id}
              data-status={view.rawStatus}
              data-result={result}
              data-round={line.label}
            >
              <span className={classes.chip} data-result={result} aria-hidden="true">
                {LETTER[result]()}
              </span>
              <VisuallyHidden>{WORD[result]()}</VisuallyHidden>
              <div className={classes.main}>
                <div className={classes.metaLine}>
                  <Group gap={6} wrap="wrap">
                    {meta && (
                      <Text size="xs" c="dimmed">
                        {meta}
                      </Text>
                    )}
                    {view.walkover && (
                      <Badge size="xs" variant="light" color="gray">
                        {tx('Walkover')}
                      </Badge>
                    )}
                    {flags.map((f) => (
                      <Badge key={f.key} size="xs" variant="light" color="orange">
                        {f.label}
                      </Badge>
                    ))}
                  </Group>
                  <StandingCell standing={standing} />
                </div>
                {sides.map((side, i) => (
                  <div
                    key={i}
                    className={classes.side}
                    data-outcome={side.win ? 'win' : result === 'drawn' ? 'draw' : 'loss'}
                    data-testid={i === 0 ? 'played-own' : 'played-other'}
                  >
                    <span className={classes.names}>
                      {side.names.join(' & ')}
                      {/* The same marker as every other match card: bold is taken by the winner. */}
                      {i === 0 && (
                        <Badge ml={6} size="xs" variant="outline" component="span">
                          {tx('You')}
                        </Badge>
                      )}
                    </span>
                    {!view.walkover && (
                      <span className={classes.digits}>
                        {side.games && side.games.length > 0
                          ? side.games.map((g, s) => <span key={s}>{g}</span>)
                          : (side.score ?? '–')}
                      </span>
                    )}
                  </div>
                ))}
                {comment && (
                  <Text size="xs" c="dimmed" data-testid="match-comment">
                    <IconMessage size={12} style={{ verticalAlign: '-2px' }} /> {comment}
                  </Text>
                )}
              </div>
            </div>
          );
        })}
      </MatchListFrame>
    </>
  );
}
