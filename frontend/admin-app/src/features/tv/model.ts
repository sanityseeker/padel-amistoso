import type { Match, Standing, TournamentStatus, TvSettings } from '../../types';
import type { PlayerMatch } from '../../player/types';
import type { Ctx } from '../../admin/tournament/scoring';
import { publicApi } from '../../events/api';
import { ApiError } from '../../api';

// What the spectator page reads. Every call is anonymous (publicApi: no credentials, no admin or
// player token), so a private tournament is reachable only by its id or alias, never listed here.
export interface TvMeta {
  id: string;
  name: string;
  type: 'mexicano' | 'group_playoff' | 'playoff';
  alias: string | null;
  sport: string;
  phase: string;
  elo_scope?: string;
  community_id?: string | null;
  community_name?: string | null;
  club_name?: string | null;
  club_logo_url?: string | null;
}

export interface TvStatus extends TournamentStatus {
  champion?: string[] | null;
  winners?: string[][];
  winners_champion?: string[] | null;
  losers_champion?: string[] | null;
  espejo_split?: boolean;
  espejo_super_final?: boolean;
  elo_scope?: string;
}
export interface Playoffs {
  matches: Match[];
  pending: Match[];
}
export interface Breakdown {
  raw: number;
  relative_strength?: number;
  strength_mult: number;
  loss_disc: number;
  win_bonus: number;
  final: number;
}
export interface TvLive {
  kind: TvMeta['type'];
  settings: TvSettings;
  status: TvStatus;
  /** Group stage: matches and standings by group. */
  groups?: { matches: Record<string, Match[]>; standings: Record<string, Standing[]> };
  /** Mexicano rounds. */
  rounds?: {
    current_matches: Match[];
    all_matches: Match[];
    breakdowns?: Record<string, Record<string, Breakdown>>;
  };
  playoffs: Playoffs;
}

const EMPTY: Playoffs = { matches: [], pending: [] };
const get = <T>(path: string) => publicApi<T>(path);
const optional = (path: string) => get<Playoffs>(path).catch(() => EMPTY);

export async function loadLive(tid: string, kind: TvMeta['type']): Promise<TvLive> {
  const base = `/tournaments/${tid}`;
  const settings = get<TvSettings>(`${base}/tv-settings`);
  if (kind === 'group_playoff') {
    const [s, status, groups, playoffs] = await Promise.all([
      settings,
      get<TvStatus>(`${base}/gp/status`),
      get<NonNullable<TvLive['groups']>>(`${base}/gp/groups`),
      optional(`${base}/gp/playoffs`),
    ]);
    return { kind, settings: s, status, groups, playoffs };
  }
  if (kind === 'playoff') {
    const [s, status, playoffs] = await Promise.all([
      settings,
      get<TvStatus>(`${base}/po/status`),
      optional(`${base}/po/playoffs`),
    ]);
    return { kind, settings: s, status, playoffs };
  }
  const [s, status, rounds, playoffs] = await Promise.all([
    settings,
    get<TvStatus>(`${base}/mex/status`),
    get<NonNullable<TvLive['rounds']>>(`${base}/mex/matches`),
    optional(`${base}/mex/playoffs`),
  ]);
  return { kind, settings: s, status, rounds, playoffs };
}

/** `/tv/<alias or id>` to the tournament id. An id that no alias claims resolves to itself. */
export async function resolveSlug(slug: string): Promise<string> {
  try {
    return (await get<{ id: string }>(`/tournaments/resolve-alias/${encodeURIComponent(slug)}`)).id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return slug;
    throw error;
  }
}

export const prefixFor = (kind: TvMeta['type']) =>
  kind === 'mexicano' ? 'mex' : kind === 'group_playoff' ? 'gp' : 'po';

export const sortTbdLast = (matches: Match[]) =>
  [...matches].sort((a, b) => Number(isTbd(a)) - Number(isTbd(b)));
export const isTbd = (m: Pick<Match, 'team1' | 'team2'>) =>
  !m.team1?.join('').trim() || !m.team2?.join('').trim();

/** The scoring context of a match shown in one section, exactly as the legacy page chose it. */
export function ctxOf(kind: TvMeta['type'], playoffs: boolean): Ctx {
  if (kind === 'group_playoff') return playoffs ? 'gp-playoff' : 'gp-group';
  if (kind === 'playoff') return 'po-playoff';
  return playoffs ? 'mex-playoff' : 'mex';
}

export const asPlayerMatch = (m: Match) => m as PlayerMatch;

/** Display name of a bracket side (Espejo / double elimination). */
export type Sided = Pick<Match, 'round_label' | 'bracket_side'>;
