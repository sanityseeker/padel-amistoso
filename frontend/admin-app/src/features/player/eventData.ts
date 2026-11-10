import { useQuery, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { playerApi } from '../../player/api';
import type { Entry, PlayerMatch, TvPlayerSettings } from '../../player/types';
import type { Standing } from '../../types';

/** The two facts the score actions read from a player's entry. */
export type ScoringEntry = Pick<Entry, 'entity_id' | 'player_id'>;

export const prefixOfType = (type: string | null) =>
  type === 'mexicano' ? 'mex' : type === 'group_playoff' ? 'gp' : 'po';

interface StatusPayload {
  phase: string;
  current_round?: number;
  num_rounds?: number;
  team_roster?: Record<string, string[]>;
  leaderboard?: Standing[];
  /** Mexicano: ids sitting out the round in play. */
  current_sit_out_ids?: string[];
  /** `member_ids` are person ids (team members included); `entry_key` is a "+"-joined key. */
  withdrawals?: { member_ids: string[] }[];
  /** `false` when the organizer does not assign courts. */
  assign_courts?: boolean;
}
interface MatchesPayload {
  all_matches?: PlayerMatch[];
  matches?: PlayerMatch[] | Record<string, PlayerMatch[]>;
  standings?: Record<string, Standing[]>;
}
const flat = (payload: MatchesPayload): PlayerMatch[] => {
  const raw = payload.all_matches || payload.matches || [];
  return Array.isArray(raw) ? raw : Object.values(raw).flat();
};

/** The tournament-scoped player token (POST /{tid}/player-auth). Never the profile or admin token. */
export function usePlayerToken(entry: Entry | undefined) {
  const session = useQuery({
    queryKey: ['player', 'match-session', entry?.entity_id],
    queryFn: () =>
      playerApi<{ access_token: string }>(
        `/tournaments/${entry!.entity_id}/player-auth`,
        { token: entry!.auto_login_token },
        'POST',
        null,
      ),
    enabled: !!entry?.auto_login_token,
    staleTime: 15 * 60_000,
  });
  return { token: session.data?.access_token ?? null, error: session.error, session };
}

/** After a failed player action: reload the matches; a 403 also means the tournament token expired. */
export function refreshAfterError(client: QueryClient, tid: string, error: unknown) {
  void client.invalidateQueries({ queryKey: ['player', 'matches', tid] });
  if (error instanceof ApiError && error.status === 403)
    void client.invalidateQueries({ queryKey: ['player', 'match-session', tid] });
  // The TV page keeps its own tournament token; it signs the player out when the server rejects it.
  if (error instanceof ApiError && error.status === 401)
    window.dispatchEvent(new CustomEvent(TV_TOKEN_REJECTED_EVENT, { detail: tid }));
}
export const TV_TOKEN_REJECTED_EVENT = 'amistoso:tv-token-rejected';

export interface EventData {
  status: StatusPayload;
  tv: TvPlayerSettings;
  matches: PlayerMatch[];
  standings: Record<string, Standing[]> | null;
  expand: (ids: string[]) => string[];
  endpoint: string;
  context: string;
  setsAvailable: boolean;
  /** Match the Hub card shows (`schedule.now`): one that needs the player, else one waiting on someone else. */
  pending: PlayerMatch | null;
  schedule: Schedule;
  /** Earlier-phase matches (group stage, Mexicano rounds) shown as read-only history. */
  historyIds: ReadonlySet<string>;
  /** Mexicano: the player sits out the round in play and has no match. */
  sittingOut: boolean;
  /** The organizer withdrew the player (or their team). */
  withdrawn: boolean;
  finished: boolean;
}

/** The player's matches, split by what they can do with them. */
export interface Schedule {
  /** The match that needs the player; else one waiting on someone else. */
  now: PlayerMatch | null;
  /** Everything else still to play, including matches whose opponent is not known yet. */
  next: PlayerMatch[];
  /** Score entered or disputed, waiting on the other side or the organizer. */
  waiting: PlayerMatch[];
  /** Finished matches and read-only history. */
  played: PlayerMatch[];
}

const order = (a: PlayerMatch, b: PlayerMatch) =>
  (a.round_number ?? Infinity) - (b.round_number ?? Infinity) ||
  (a.slot_number ?? Infinity) - (b.slot_number ?? Infinity);

/** My side of a match: ids of the side that holds `playerId`, or null. */
export function sideOf(m: PlayerMatch, expand: (ids: string[]) => string[], playerId: string) {
  if (expand(m.team1_ids).includes(playerId)) return 1;
  if (expand(m.team2_ids).includes(playerId)) return 2;
  return null;
}

/** Player-side score lifecycle state of one of my matches. */
export type Lifecycle =
  | 'open' // no score yet: enter one
  | 'confirm' // an opponent entered it: accept or correct
  | 'waiting' // I entered it: waiting for the other side
  | 'correction' // the other side proposed a correction: accept or escalate
  | 'correction-sent' // I proposed a correction: waiting
  | 'escalated' // the organizer decides
  | 'review' // off-format score parked for the organizer
  | 'tbd' // a side is not decided yet (bracket slot): nothing to enter
  | 'final';

export function lifecycleOf(
  m: PlayerMatch,
  expand: (ids: string[]) => string[],
  playerId: string,
  readOnly = false,
): Lifecycle {
  if (readOnly) return 'final';
  const mine = sideOf(m, expand, playerId);
  const submitterSide = m.scored_by
    ? expand(m.team1_ids).includes(m.scored_by)
      ? 1
      : expand(m.team2_ids).includes(m.scored_by)
        ? 2
        : null
    : null;
  const isSubmitter = !!mine && mine === submitterSide;
  if (m.disputed) {
    if (m.dispute_escalated) return 'escalated';
    return isSubmitter ? 'correction' : 'correction-sent';
  }
  if (m.format_review) return 'review';
  if (m.score && m.scored_by && !m.score_confirmed) return isSubmitter ? 'waiting' : 'confirm';
  if (!m.score && m.status !== 'completed') return isTbd(m) ? 'tbd' : 'open';
  return 'final';
}

/** A side of the match is not decided yet (empty bracket slot). */
export const isTbd = (m: PlayerMatch) => !m.team1_ids.length || !m.team2_ids.length;

/** What the score actions need to know about the event; the TV page builds it without an `EventData`. */
export type ScoringData = Pick<
  EventData,
  'tv' | 'expand' | 'endpoint' | 'context' | 'setsAvailable' | 'historyIds'
>;

/** `lifecycleOf` for a match of `data`: earlier-phase history is always final. */
export const lifecycleIn = (m: PlayerMatch, data: ScoringData, playerId: string) =>
  lifecycleOf(m, data.expand, playerId, data.historyIds.has(m.id));

/** One tournament as the player sees it. Shared by the Hub cards and the event page. */
export function useEventData(entry: Entry | undefined, options: { poll?: number | false } = {}) {
  const { token, error: tokenError } = usePlayerToken(entry);
  const prefix = prefixOfType(entry?.tournament_type ?? null);
  const query = useQuery({
    queryKey: ['player', 'matches', entry?.entity_id],
    // Reads are public: a failed token exchange only hides the scoring actions.
    enabled: !!entry,
    refetchInterval: options.poll ?? 15_000,
    queryFn: async (): Promise<EventData> => {
      const id = entry!.entity_id;
      const read = <T>(path: string) =>
        playerApi<T>(`/tournaments/${id}/${prefix}/${path}`, undefined, 'GET', null);
      const [status, tv] = await Promise.all([
        read<StatusPayload>('status'),
        playerApi<TvPlayerSettings>(`/tournaments/${id}/tv-settings`, undefined, 'GET', null),
      ]);
      const group = prefix === 'gp' && status.phase === 'groups';
      const mex = prefix === 'mex' && status.phase === 'mexicano';
      const gpLater = prefix === 'gp' && !group;
      const mexLater = prefix === 'mex' && !mex;
      // Live matches come from the current phase; the phase before it is read-only history.
      const live = await read<MatchesPayload>(group ? 'groups' : mex ? 'matches' : 'playoffs');
      const past = gpLater
        ? await read<MatchesPayload>('groups')
        : mexLater
          ? await read<MatchesPayload>('matches')
          : null;
      const liveMatches = flat(live);
      const pastMatches = past ? flat(past) : [];
      const roster = status.team_roster || {};
      const expand = (ids: string[]) => ids.flatMap((x) => [x, ...(roster[x] || [])]);
      const involved = (m: PlayerMatch) =>
        expand([...m.team1_ids, ...m.team2_ids]).includes(entry!.player_id);
      const liveIds = new Set(liveMatches.map((m) => m.id));
      const historyIds = new Set(pastMatches.filter((m) => !liveIds.has(m.id)).map((m) => m.id));
      const mine = [...pastMatches.filter((m) => !liveIds.has(m.id)), ...liveMatches]
        .filter(involved)
        .sort(order);
      const stateOf = (m: PlayerMatch) =>
        lifecycleOf(m, expand, entry!.player_id, historyIds.has(m.id));
      const needs = mine.filter((m) => ['open', 'confirm', 'correction'].includes(stateOf(m)));
      const waiting = mine.filter((m) =>
        ['waiting', 'correction-sent', 'escalated', 'review'].includes(stateOf(m)),
      );
      const now = needs[0] ?? waiting[0] ?? null;
      const schedule: Schedule = {
        now,
        next: [...needs, ...mine.filter((m) => stateOf(m) === 'tbd')]
          .filter((m) => m !== now)
          .sort(order),
        waiting: waiting.filter((m) => m !== now),
        played: mine.filter((m) => stateOf(m) === 'final'),
      };
      const finished = status.phase === 'finished' || entry!.status === 'finished';
      const sittingOut =
        !finished &&
        !now &&
        (status.current_sit_out_ids ?? []).some((x) => expand([x]).includes(entry!.player_id));
      return {
        status,
        tv,
        matches: mine,
        standings: live.standings ?? past?.standings ?? null,
        expand,
        endpoint: `${prefix}/${group ? 'record-group' : prefix === 'po' || mex ? 'record' : 'record-playoff'}`,
        context: group ? 'gp-group' : mex ? 'mex' : `${prefix}-playoff`,
        setsAvailable: !mex,
        pending: now,
        schedule,
        historyIds,
        sittingOut,
        withdrawn: (status.withdrawals ?? []).some((w) =>
          expand(w.member_ids).includes(entry!.player_id),
        ),
        finished,
      };
    },
  });
  return { ...query, token, tokenError };
}
