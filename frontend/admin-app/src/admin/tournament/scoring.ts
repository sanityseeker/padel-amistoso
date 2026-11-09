import type {
  InputFormat,
  Match,
  MatchData,
  Score,
  SetDecider,
  TournamentStatus,
  TvSettings,
} from '../../types';

// Scoring contexts, the same ones the legacy admin uses (admin-gp.js _SCORE_ENDPOINTS).
export type Ctx = 'gp-group' | 'gp-playoff' | 'mex' | 'mex-playoff' | 'po-playoff';

export interface TournamentPageData {
  status: TournamentStatus;
  data: MatchData;
  settings: TvSettings;
  groupStage: boolean;
  path: string;
  ctx: Ctx;
  /** Group+Play-off after the group stage: the group standings and matches, read-only. */
  groups?: MatchData;
  /** Mexicano that ended without play-offs: the round history (`/mex/matches`), read-only. */
  rounds?: MatchData;
}

// `decider` on a sets payload is the third-set format the entry form ended in (a player may choose it).
export type ScorePayload =
  { kind: 'points'; score: Score } | { kind: 'sets'; sets: Score[]; decider?: SetDecider };

/** The entry formats a player can choose between: points, sets, or sets with a match tie-break. */
export type FormatKey = 'points' | 'sets' | 'sets_tb';
export const formatKeyOf = (mode: InputFormat, decider: SetDecider): FormatKey =>
  mode !== 'sets' ? 'points' : decider === 'match_tiebreak' ? 'sets_tb' : 'sets';
export type SetRow = [string, string];

export const DEFAULT_SETTINGS: TvSettings = {
  score_mode: {},
  set_decider: 'full_set',
  score_confirmation: 'immediate',
};

const ENDPOINTS: Record<Ctx, { points: string; sets: string | null }> = {
  'gp-group': { points: 'gp/record-group', sets: 'gp/record-group-tennis' },
  'gp-playoff': { points: 'gp/record-playoff', sets: 'gp/record-playoff-tennis' },
  mex: { points: 'mex/record', sets: null },
  'mex-playoff': { points: 'mex/record-playoff', sets: 'mex/record-playoff-tennis' },
  'po-playoff': { points: 'po/record', sets: 'po/record-tennis' },
};

export const canScoreSets = (ctx: Ctx) => ctx !== 'mex';

export function recordRequest(tid: string, ctx: Ctx, matchId: string, payload: ScorePayload) {
  const entry = ENDPOINTS[ctx];
  if (payload.kind === 'sets')
    return {
      path: `/tournaments/${tid}/${entry.sets}`,
      body: { match_id: matchId, sets: payload.sets },
    };
  return {
    path: `/tournaments/${tid}/${entry.points}`,
    body: { match_id: matchId, score1: payload.score[0], score2: payload.score[1] },
  };
}

// Input mode a form opens in: the match's own override, else the format of the stored score,
// else the stage default (tv_settings.score_mode).
export function inputFormat(match: Match, ctx: Ctx, settings: TvSettings): InputFormat {
  if (!canScoreSets(ctx)) return 'points';
  return (
    match.format_override?.mode ??
    (match.sets?.length ? 'sets' : null) ??
    settings.score_mode[ctx] ??
    'points'
  );
}

export const matchDecider = (match: Match, settings: TvSettings): SetDecider =>
  match.effective_decider ?? settings.set_decider ?? 'full_set';

// Mexicano round scores must add up to this; 0 means there is no sum rule.
export const pointsTarget = (match: Match, ctx: Ctx, total = 0) =>
  ctx === 'mex'
    ? (match.effective_points_target ?? match.format_override?.points_target ?? total)
    : 0;

export const isTiebreakSet = (index: number, count: number, decider: SetDecider) =>
  decider === 'match_tiebreak' && count === 3 && index === 2;

// "6-4 3-6 [10-8]": a match tie-break is bracketed, as in the backend's format_sets.
export function formatSets(sets: Score[], decider: SetDecider, sep = ' '): string {
  return sets
    .map((s, i) =>
      isTiebreakSet(i, sets.length, decider) ? `[${s[0]}-${s[1]}]` : `${s[0]}-${s[1]}`,
    )
    .join(sep);
}

export function formatScore(score: Score | null, sets: Score[] | null, decider: SetDecider) {
  if (sets?.length) return formatSets(sets, decider);
  return score ? `${score[0]}-${score[1]}` : '-';
}

// Rows with both boxes empty/zero are skipped, as in the legacy form.
export function parseSets(rows: SetRow[]): Score[] {
  return rows
    .map((r): Score => [Number(r[0]) || 0, Number(r[1]) || 0])
    .filter((s) => s[0] !== 0 || s[1] !== 0);
}

export type ScoreError =
  | { code: 'no-sets' }
  | { code: 'tied'; n: number }
  | { code: 'third' }
  | { code: 'winner' }
  | { code: 'tiebreak' }
  | { code: 'sum'; target: number }
  | { code: 'empty' };

// Mirrors validate_set_scores and validate_decider_sets in the backend; the page words the errors.
export function validateSets(sets: Score[], decider: SetDecider): ScoreError | null {
  if (!sets.length) return { code: 'no-sets' };
  for (const [i, s] of sets.entries()) if (s[0] === s[1]) return { code: 'tied', n: i + 1 };
  const won1 = sets.filter((s) => s[0] > s[1]).length;
  const won2 = sets.filter((s) => s[1] > s[0]).length;
  if (sets.length >= 3 && sets[0][0] > sets[0][1] === sets[1][0] > sets[1][1])
    return { code: 'third' };
  if (won1 === won2) return { code: 'winner' };
  if (decider === 'match_tiebreak' && sets.length === 3) {
    const hi = Math.max(...sets[2]);
    const lo = Math.min(...sets[2]);
    if (hi < 10 || hi - lo < 2) return { code: 'tiebreak' };
  }
  return null;
}

export function validatePoints(boxes: SetRow, target: number): ScoreError | null {
  if (boxes[0] === '' || boxes[1] === '') return { code: 'empty' };
  if (target > 0 && Number(boxes[0]) + Number(boxes[1]) !== target) return { code: 'sum', target };
  return null;
}

// Every match list inside the page query, so one function can patch a match everywhere it appears.
export function mapMatches(data: MatchData, fn: (m: Match) => Match): MatchData {
  const out: MatchData = { ...data };
  for (const key of ['current_matches', 'all_matches', 'pending'] as const)
    if (data[key]) out[key] = data[key].map(fn);
  if (Array.isArray(data.matches)) out.matches = data.matches.map(fn);
  else if (data.matches)
    out.matches = Object.fromEntries(
      Object.entries(data.matches).map(([k, list]) => [k, list.map(fn)]),
    );
  return out;
}

export function allMatches(data: MatchData): Match[] {
  const raw = data.all_matches || data.matches || [];
  return Array.isArray(raw) ? raw : Object.values(raw).flat();
}

export type ReviewKind = 'dispute' | 'pending' | 'format';
export interface ReviewItem {
  match: Match;
  kind: ReviewKind;
}

// Same rules as the legacy review queue (admin-gp.js _gpGetReviewItemKind), plus parked off-format scores.
export function reviewItems(matches: Match[], settings: TvSettings): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const match of matches) {
    if (match.disputed) items.push({ match, kind: 'dispute' });
    else if (match.format_review) items.push({ match, kind: 'format' });
    else if (
      settings.score_confirmation !== 'immediate' &&
      match.status !== 'completed' &&
      match.score &&
      match.scored_by &&
      !match.score_confirmed
    )
      items.push({ match, kind: 'pending' });
  }
  return items;
}

export const scorePayloadOf = (
  score: Score | null | undefined,
  sets: Score[] | null | undefined,
): ScorePayload | null =>
  sets?.length ? { kind: 'sets', sets } : score ? { kind: 'points', score } : null;

// What the list shows while a save is in flight; the server's totals replace it on refetch.
export function optimisticMatch(match: Match, payload: ScorePayload): Match {
  const score: Score =
    payload.kind === 'points'
      ? payload.score
      : [payload.sets.reduce((n, s) => n + s[0], 0), payload.sets.reduce((n, s) => n + s[1], 0)];
  return {
    ...match,
    status: 'completed',
    score,
    sets: payload.kind === 'sets' ? payload.sets : null,
    scored_by: null,
    score_confirmed: true,
    disputed: false,
    dispute_score: null,
    dispute_sets: null,
    format_review: false,
  };
}

/** True when the page shows a finished Mexicano's round history instead of a bracket. */
export const historyOnly = (page: TournamentPageData) =>
  !!page.rounds && !allMatches(page.data).length;

/** The matches the workspace lists and counts: the bracket's, or the round history of a Mexicano
    that never had one. Group matches of a Group+Play-off are deliberately not part of it. */
export const pageMatches = (page: TournamentPageData): Match[] =>
  historyOnly(page) && page.rounds ? allMatches(page.rounds) : allMatches(page.data);
