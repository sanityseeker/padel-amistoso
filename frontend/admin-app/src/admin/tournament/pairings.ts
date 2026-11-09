import type { RepeatDetail } from '../../types';

export interface PlayerStat {
  player_id?: string;
  partners: { player: string; count: number }[];
  opponents: { player: string; count: number }[];
  total_partner_repeats: number;
  total_opponent_repeats: number;
}

export interface RoundStats {
  scoreGap: number;
  repeats: number;
  exactRematches: number;
  skillGapViolations: number;
  skillGapWorstExcess: number;
  perPerson: Record<string, RepeatDetail>;
}

export interface RoundContext {
  names: Record<string, string>;
  /** Leaderboard values by player id (average and total points). */
  ratings: Record<string, { avg: number; total: number }>;
  stats: Record<string, PlayerStat> | null | undefined;
  skillGap: number | null | undefined;
  /** Matches of the latest round, to spot an exact rematch. */
  previousRound: { team1_ids: string[]; team2_ids: string[] }[];
}

const fingerprint = (a: string[], b: string[]) =>
  [[...a].sort().join(','), [...b].sort().join(',')].sort().join('|');

/** The same numbers the server reports for a proposal, worked out for a round the organizer built by hand. */
export function roundStats(slots: string[][], ctx: RoundContext): RoundStats | null {
  const matches = slots
    .filter((s) => s.every(Boolean))
    .map((s) => ({ t1: [s[0]!, s[1]!], t2: [s[2]!, s[3]!] }));
  if (!matches.length) return null;
  const idOf = new Map<string, string>();
  for (const id of Object.keys(ctx.names)) idOf.set(ctx.names[id]!, id);
  const partners: Record<string, Record<string, number>> = {};
  const opponents: Record<string, Record<string, number>> = {};
  for (const data of Object.values(ctx.stats ?? {})) {
    const pid = data.player_id;
    if (!pid) continue;
    partners[pid] = {};
    opponents[pid] = {};
    for (const x of data.partners) {
      const other = idOf.get(x.player);
      if (other) partners[pid]![other] = x.count;
    }
    for (const x of data.opponents) {
      const other = idOf.get(x.player);
      if (other) opponents[pid]![other] = x.count;
    }
  }
  const count = (table: Record<string, Record<string, number>>, a: string, b: string) =>
    table[a]?.[b] ?? 0;
  const previous = new Set(ctx.previousRound.map((m) => fingerprint(m.team1_ids, m.team2_ids)));
  const out: RoundStats = {
    scoreGap: 0,
    repeats: 0,
    exactRematches: 0,
    skillGapViolations: 0,
    skillGapWorstExcess: 0,
    perPerson: {},
  };
  const sum = (ids: string[], key: 'avg' | 'total') =>
    ids.reduce((n, id) => n + (ctx.ratings[id]?.[key] ?? 0), 0);
  for (const m of matches) {
    out.scoreGap += Math.abs(sum(m.t1, 'avg') - sum(m.t2, 'avg'));
    const [a, b] = m.t1 as [string, string];
    const [c, d] = m.t2 as [string, string];
    out.repeats += count(partners, a, b) + count(partners, c, d);
    for (const x of [a, b]) for (const y of [c, d]) out.repeats += count(opponents, x, y);
    for (const pid of [...m.t1, ...m.t2]) {
      const name = ctx.names[pid] ?? pid;
      const detail = (out.perPerson[name] ??= { partner_repeats: [], opponent_repeats: [] });
      const mine = m.t1.includes(pid) ? m.t1 : m.t2;
      const theirs = m.t1.includes(pid) ? m.t2 : m.t1;
      for (const other of mine) {
        const n = other === pid ? 0 : count(partners, pid, other);
        if (n > 0) detail.partner_repeats!.push({ player: ctx.names[other] ?? other, count: n });
      }
      for (const other of theirs) {
        const n = count(opponents, pid, other);
        if (n > 0) detail.opponent_repeats!.push({ player: ctx.names[other] ?? other, count: n });
      }
    }
    if (previous.has(fingerprint(m.t1, m.t2))) out.exactRematches++;
    if (ctx.skillGap != null && ctx.skillGap > 0) {
      const gap = Math.abs(sum(m.t1, 'total') - sum(m.t2, 'total'));
      if (gap > ctx.skillGap) {
        out.skillGapViolations++;
        out.skillGapWorstExcess = Math.max(out.skillGapWorstExcess, gap - ctx.skillGap);
      }
    }
  }
  return out;
}

/** The latest round of a list of matches (to compare a new round with it). */
export function latestRound<
  M extends { round_number?: number; team1_ids?: string[]; team2_ids?: string[] },
>(matches: M[]): { team1_ids: string[]; team2_ids: string[] }[] {
  const max = Math.max(0, ...matches.map((m) => m.round_number ?? 0));
  if (!max) return [];
  return matches
    .filter((m) => m.round_number === max && m.team1_ids && m.team2_ids)
    .map((m) => ({ team1_ids: m.team1_ids!, team2_ids: m.team2_ids! }));
}
