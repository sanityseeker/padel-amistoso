import type { Counterpart, EloMatch, Entry, Space } from '../../player/types';

export type Sport = 'padel' | 'tennis';

export const sportsOf = (space: Space): Sport[] => {
  const out: Sport[] = [];
  const { profile } = space;
  if (profile.elo_padel_matches > 0 || space.elo_history.some((m) => m.sport === 'padel'))
    out.push('padel');
  if (profile.elo_tennis_matches > 0 || space.elo_history.some((m) => m.sport === 'tennis'))
    out.push('tennis');
  return out;
};

export const eloOf = (space: Space, sport: Sport): number | null =>
  sport === 'padel' ? space.profile.elo_padel : space.profile.elo_tennis;

/** History for one sport, oldest first (the API sends newest first). */
export const historyOf = (space: Space, sport: Sport): EloMatch[] =>
  space.elo_history
    .filter((m) => m.sport === sport)
    .slice()
    .reverse();

export type FormResult = 'W' | 'L' | 'D';

/** The result of a rated match for the player: from the score (sets won when it has sets), so a draw is
    a draw whatever it did to the rating. Entries without a score or a side fall back to the rating change. */
function resultOf(m: Space['elo_history'][number]): FormResult {
  const side = m.team1?.some((p) => p.player_id === m.player_id)
    ? 0
    : m.team2?.some((p) => p.player_id === m.player_id)
      ? 1
      : null;
  if (side == null) return m.elo_delta >= 0 ? 'W' : 'L';
  const [mine, theirs] = m.sets?.length
    ? [
        m.sets.filter((s) => s[side]! > s[1 - side]!).length,
        m.sets.filter((s) => s[side]! < s[1 - side]!).length,
      ]
    : [m.score?.[side], m.score?.[1 - side]];
  if (mine == null || theirs == null) return m.elo_delta >= 0 ? 'W' : 'L';
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

/** Result of the last `n` rated matches, newest first (manual adjustments are skipped). */
export const formOf = (space: Space, sport: Sport, n = 5): FormResult[] =>
  space.elo_history
    .filter((m) => m.sport === sport && !m.is_manual)
    .slice(0, n)
    .map(resultOf);

/** Rating change over the last `n` rated matches. */
export const recentDelta = (space: Space, sport: Sport, n = 5): number =>
  space.elo_history
    .filter((m) => m.sport === sport)
    .slice(0, n)
    .reduce((sum, m) => sum + m.elo_delta, 0);

export function careerOf(space: Space) {
  const finished = space.entries.filter((e) => e.status === 'finished');
  const wins = finished.reduce((n, e) => n + e.wins, 0);
  const losses = finished.reduce((n, e) => n + e.losses, 0);
  const draws = finished.reduce((n, e) => n + e.draws, 0);
  const games = wins + losses + draws;
  return {
    events: finished.length,
    wins,
    losses,
    winRate: games ? Math.round((wins / games) * 100) : null,
  };
}

// ---- Career statistics (the Hub's career card, best results and players you have met) ----------

/** Stable key of a partner or rival across events: the profile if known, else the normalised name. */
const counterpartKey = (c: Counterpart) => {
  if (c.profile_id) return `p:${c.profile_id}`;
  const name = (c.name || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? `n:${name}` : `i:${c.id ?? ''}`;
};
/** The name the person has now, not the one they played under in the oldest event. */
const counterpartName = (c: Counterpart) => c.current_name || c.name || '';

export interface Ranked {
  name: string;
  games: number;
  wins: number;
  winPct: number;
}
export interface ParticipantRow {
  name: string;
  togetherGames: number;
  togetherWins: number;
  againstGames: number;
  againstWins: number;
}
export interface CareerStats {
  tournaments: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  topPartners: Ranked[];
  topRivals: Ranked[];
  participants: ParticipantRow[];
}

/** Totals, best three teammates and toughest three rivals, and everyone met, over these entries. */
export function careerStats(entries: Entry[]): CareerStats {
  let tournaments = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const partners = new Map<string, { name: string; games: number; wins: number }>();
  const rivals = new Map<string, { name: string; games: number; wins: number }>();
  const add = (
    map: Map<string, { name: string; games: number; wins: number }>,
    list: Counterpart[],
  ) => {
    for (const c of list) {
      const key = counterpartKey(c);
      const row = map.get(key) ?? { name: counterpartName(c), games: 0, wins: 0 };
      row.name = counterpartName(c) || row.name;
      row.games += c.games || 0;
      row.wins += c.wins || 0;
      map.set(key, row);
    }
  };
  for (const e of entries) {
    if ((e.wins || 0) + (e.losses || 0) + (e.draws || 0) > 0 || e.entity_type === 'tournament') {
      tournaments++;
      wins += e.wins || 0;
      losses += e.losses || 0;
      draws += e.draws || 0;
    }
    add(partners, e.all_partners?.length ? e.all_partners : (e.top_partners ?? []));
    add(rivals, e.all_rivals?.length ? e.all_rivals : (e.top_rivals ?? []));
  }
  const games = wins + losses + draws;
  const ranked = (map: typeof partners): Ranked[] =>
    [...map.values()]
      .filter((r) => r.games > 0)
      .map((r) => ({ ...r, winPct: Math.round((r.wins / r.games) * 100) }));
  const people = new Map<string, ParticipantRow>();
  for (const [key, r] of partners)
    people.set(key, {
      name: r.name,
      togetherGames: r.games,
      togetherWins: r.wins,
      againstGames: 0,
      againstWins: 0,
    });
  for (const [key, r] of rivals) {
    const row = people.get(key) ?? {
      name: r.name,
      togetherGames: 0,
      togetherWins: 0,
      againstGames: 0,
      againstWins: 0,
    };
    row.againstGames = r.games;
    row.againstWins = r.wins;
    people.set(key, row);
  }
  return {
    tournaments,
    wins,
    losses,
    draws,
    winRate: games ? Math.round((wins / games) * 100) : null,
    topPartners: ranked(partners)
      .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins)
      .slice(0, 3),
    topRivals: ranked(rivals)
      .sort((a, b) => a.winPct - b.winPct || b.games - a.games)
      .slice(0, 3),
    participants: [...people.values()]
      .filter((r) => r.togetherGames + r.againstGames > 0)
      .sort(
        (a, b) =>
          b.togetherGames + b.againstGames - (a.togetherGames + a.againstGames) ||
          a.name.localeCompare(b.name),
      ),
  };
}

export type ParticipantSort = 'interactions' | 'together' | 'against' | 'win_rate' | 'name';

export function sortParticipants(rows: ParticipantRow[], mode: ParticipantSort): ParticipantRow[] {
  const total = (r: ParticipantRow) => r.togetherGames + r.againstGames;
  const rate = (r: ParticipantRow) =>
    total(r) ? Math.round(((r.togetherWins + r.againstWins) / total(r)) * 100) : 0;
  return [...rows].sort((a, b) => {
    if (mode === 'name') return a.name.localeCompare(b.name);
    const diff =
      mode === 'together'
        ? b.togetherGames - a.togetherGames
        : mode === 'against'
          ? b.againstGames - a.againstGames
          : mode === 'win_rate'
            ? rate(b) - rate(a) || total(b) - total(a)
            : total(b) - total(a);
    return diff || a.name.localeCompare(b.name);
  });
}

export interface BestResults {
  groupRank: number | null;
  groupRankEvent: string | null;
  stage: string | null;
  stageEvent: string | null;
}
/** Best finish without play-offs, and best play-off result, over finished events. */
export function bestResults(entries: Entry[]): BestResults {
  const best: BestResults = {
    groupRank: null,
    groupRankEvent: null,
    stage: null,
    stageEvent: null,
  };
  let stageRank: number | null = null;
  for (const e of entries) {
    // A rank only counts when the event had no play-offs; otherwise the play-off result does.
    if (
      e.rank &&
      e.rank > 0 &&
      !e.playoff_stage &&
      (best.groupRank === null || e.rank < best.groupRank)
    ) {
      best.groupRank = e.rank;
      best.groupRankEvent = e.entity_name || null;
    }
    if (e.playoff_stage && e.playoff_stage_rank != null) {
      if (stageRank === null || e.playoff_stage_rank < stageRank) {
        stageRank = e.playoff_stage_rank;
        best.stage = e.playoff_stage;
        best.stageEvent = e.entity_name || null;
      }
    }
  }
  return best;
}

/** One line for an event card: place (of N) or play-off result, W-L, rating change. */
export function entrySummary(e: Entry): {
  place: string | null;
  record: string | null;
  elo: number | null;
} {
  const place = e.rank && e.rank > 0 ? `#${e.rank}` : null;
  const games = (e.wins || 0) + (e.losses || 0) + (e.draws || 0);
  return {
    place,
    record: games > 0 ? `${e.wins || 0}W${e.losses ? ` ${e.losses}L` : ''}` : null,
    elo:
      e.elo_before != null && e.elo_after != null
        ? Math.round(e.elo_after) - Math.round(e.elo_before)
        : null,
  };
}

/** The server's per-event top lists (with `win_pct`) in the shape the career card uses. */
export const rankedOf = (list: Counterpart[] | undefined): Ranked[] =>
  (list ?? []).map((c) => ({
    name: c.current_name || c.name,
    games: c.games,
    wins: c.wins,
    winPct: c.win_pct ?? (c.games ? Math.round((c.wins / c.games) * 100) : 0),
  }));

/** The names on the other side of a match from the player the history belongs to. */
export const opponentsOf = (m: EloMatch): string[] => {
  const onTeam1 = (m.team1 ?? []).some((p) => p.player_id === m.player_id);
  const side = onTeam1 ? m.team2 : (m.team1 ?? []).length ? m.team1 : undefined;
  const other = (m.team2 ?? []).some((p) => p.player_id === m.player_id) ? m.team1 : side;
  return (other ?? []).map((p) => p.player_name);
};
