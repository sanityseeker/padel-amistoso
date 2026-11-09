import { t as tx } from '../../i18n';
import type { Match, Score, SetDecider, Standing, TvSettings } from '../../types';
import type { PlayerMatch } from '../../player/types';
import type { StatusTone } from '../../ui';
import { isTiebreakSet, matchDecider, type Ctx } from '../../admin/tournament/scoring';
import type { StandingRow } from './StandingsTable';

// View models: the components below render these and never see an API type. Adapters keep the API
// types untouched (admin Match, player PlayerMatch, Standing).
export interface MatchFlag {
  key: string;
  label: string;
  tone: StatusTone;
  variant?: 'outline' | 'light';
}
export interface SideView {
  names: string[];
  score: number | null;
  games: number[] | null;
  win: boolean;
  isYou?: boolean;
}
export interface MatchView {
  id: string;
  court: string | null;
  roundLabel: string | null;
  sides: [SideView, SideView];
  /** Raw API status, kept for the `data-status` test hook. */
  rawStatus: string;
  status: 'pending' | 'live' | 'completed';
  /** Left rule color: the most urgent flag. */
  tone: 'dispute' | 'await' | 'review' | undefined;
  flags: MatchFlag[];
  decider: SetDecider;
  score: Score | null;
  sets: Score[] | null;
  /** Both sides are known (a bracket slot can still be empty). */
  ready: boolean;
  walkover: boolean;
}

function sides(
  m: Match,
  perspective?: (names: 'team1' | 'team2') => boolean,
): [SideView, SideView] {
  const done = m.status === 'completed';
  const lead = m.score ? Math.sign(m.score[0] - m.score[1]) : 0;
  const one = (key: 'team1' | 'team2', index: 0 | 1): SideView => ({
    names: m[key],
    score: m.score?.[index] ?? null,
    games: m.sets?.map((s) => s[index]) ?? null,
    win: done && (index === 0 ? lead > 0 : lead < 0),
    isYou: perspective?.(key),
  });
  return [one('team1', 0), one('team2', 1)];
}

export function matchFlags(m: Match, settings: TvSettings, ctx: Ctx): MatchFlag[] {
  const flags: MatchFlag[] = [];
  if (m.walkover)
    flags.push({ key: 'wo', label: tx('Walkover'), tone: 'neutral', variant: 'outline' });
  if (m.disputed)
    flags.push({
      key: 'dispute',
      label: m.dispute_escalated ? tx('Dispute: escalated') : tx('Dispute'),
      tone: 'danger',
    });
  else if (m.format_review)
    flags.push({ key: 'review', label: tx('Needs review'), tone: 'warning' });
  else if (
    settings.score_confirmation !== 'immediate' &&
    m.status !== 'completed' &&
    m.scored_by &&
    !m.score_confirmed
  )
    flags.push({ key: 'await', label: tx('Awaiting confirmation'), tone: 'warning' });
  const fo = m.format_override;
  if (fo) {
    const bits = [
      fo.mode && fo.mode !== settings.score_mode[ctx]
        ? fo.mode === 'sets'
          ? tx('Sets')
          : tx('Points')
        : '',
      fo.decider === 'match_tiebreak' ? tx('TB') : '',
      fo.points_target ? String(fo.points_target) : '',
    ].filter(Boolean);
    if (bits.length)
      flags.push({ key: 'fmt', label: bits.join(' '), tone: 'info', variant: 'outline' });
  }
  return flags;
}

const toneOf = (flags: MatchFlag[]): MatchView['tone'] =>
  flags.some((f) => f.key === 'dispute')
    ? 'dispute'
    : flags.some((f) => f.key === 'await')
      ? 'await'
      : flags.some((f) => f.key === 'review')
        ? 'review'
        : undefined;

export function toMatchView(m: Match, settings: TvSettings, ctx: Ctx): MatchView {
  const flags = matchFlags(m, settings, ctx);
  return {
    id: m.id,
    court: m.court,
    roundLabel: m.round_label || null,
    sides: sides(m),
    rawStatus: m.status,
    status: m.status === 'completed' ? 'completed' : 'pending',
    tone: toneOf(flags),
    flags,
    decider: matchDecider(m, settings),
    score: m.score,
    sets: m.sets,
    ready: m.team1.length > 0 && m.team2.length > 0,
    walkover: !!m.walkover,
  };
}

// Player Hub: the player's own side is marked, and the status is a single flag.
export function toPlayerMatchView(
  m: PlayerMatch,
  options: { decider: SetDecider; expand: (ids: string[]) => string[]; playerId: string },
): MatchView {
  const mine = (ids: string[]) => options.expand(ids).includes(options.playerId);
  const youOn = (key: 'team1' | 'team2') => mine(key === 'team1' ? m.team1_ids : m.team2_ids);
  const flags: MatchFlag[] = [];
  const ready = (m.team1_ids?.length ?? 0) > 0 && (m.team2_ids?.length ?? 0) > 0;
  if (m.disputed || m.format_review)
    flags.push({ key: 'review', label: tx('Needs review'), tone: 'warning' });
  flags.push(
    !ready && !m.score
      ? { key: 'tbd', label: tx('Waiting for your opponent'), tone: 'neutral' }
      : m.score
        ? m.score_confirmed
          ? { key: 'final', label: tx('Final'), tone: 'neutral' }
          : { key: 'await', label: tx('Awaiting confirmation'), tone: 'warning' }
        : { key: 'play', label: tx('To play'), tone: 'info' },
  );
  return {
    id: m.id,
    court: m.court,
    roundLabel: m.round_label || null,
    sides: sides(m, youOn),
    rawStatus: m.status,
    status: m.status === 'completed' ? 'completed' : 'pending',
    tone: m.disputed ? 'dispute' : m.score && !m.score_confirmed ? 'await' : undefined,
    flags,
    decider: options.decider,
    score: m.score,
    sets: m.sets,
    ready,
    walkover: !!m.walkover,
  };
}

export const tiebreakOf = (view: Pick<MatchView, 'sets' | 'decider'>) => (i: number) =>
  isTiebreakSet(i, view.sets?.length ?? 0, view.decider);

export function toStandingRows(rows: Standing[]): StandingRow[] {
  return rows.map((p) => ({
    id: p.player_id,
    name: p.player,
    played: p.matches_played ?? p.played ?? 0,
    wins: p.wins,
    points: p.total_points ?? p.points_for ?? 0,
    elo: p.elo ? Math.round(p.elo) : null,
    losses: p.losses,
    avg: p.avg_points,
    buchholz: p.buchholz,
    rank: p.rank,
    rankedByAvg: p.ranked_by_avg,
    removed: p.removed,
    withdrawn: p.withdrawn,
    setsWon: p.sets_won,
    setsLost: p.sets_lost,
    setsDiff: p.sets_diff,
    pointsFor: p.points_for,
    pointsAgainst: p.points_against,
    pointDiff: p.point_diff,
  }));
}
