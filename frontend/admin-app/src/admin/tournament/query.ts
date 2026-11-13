import { queryOptions } from '@tanstack/react-query';
import { api } from '../../api';
import type { MatchData, Tournament, TournamentStatus, TvSettings } from '../../types';
import { DEFAULT_SETTINGS, allMatches, type Ctx, type TournamentPageData } from './scoring';

export type TournamentPrefix = 'mex' | 'gp' | 'po';

export const prefixOf = (type: Tournament['type'] | undefined): TournamentPrefix =>
  type === 'mexicano' ? 'mex' : type === 'group_playoff' ? 'gp' : 'po';

// The type of each tournament this browser has opened, so a cold load of /admin/t/<id> can ask for
// the workspace at once instead of waiting for the tournament list to learn which endpoints to call.
const TYPES_KEY = 'amistoso-tournament-types';
const TYPES_CAP = 200;
type KnownTypes = Record<string, Tournament['type']>;

function readTypes(): KnownTypes {
  try {
    const raw = localStorage.getItem(TYPES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as KnownTypes) : {};
  } catch {
    return {};
  }
}

export function knownType(id: string): Tournament['type'] | undefined {
  const type = readTypes()[id];
  return type === 'mexicano' || type === 'group_playoff' || type === 'playoff' ? type : undefined;
}

export function rememberType(id: string, type: Tournament['type']) {
  const types = readTypes();
  if (types[id] === type) return;
  delete types[id];
  types[id] = type;
  // Insertion order is age: keep the newest entries.
  const ids = Object.keys(types);
  for (const old of ids.slice(0, Math.max(0, ids.length - TYPES_CAP))) delete types[old];
  try {
    localStorage.setItem(TYPES_KEY, JSON.stringify(types));
  } catch {
    // Storage full or blocked: the workspace then waits for the list, as before.
  }
}

/** Keeps a visited workspace warm so switching back never shows a spinner (15 minutes). */
export const WORKSPACE_GC_MS = 15 * 60_000;

// One definition of "everything the workspace shows", shared by the page and by the dock's
// hover prefetch so both fill the same cache entry.
export function workspaceQuery(id: string, prefix: TournamentPrefix, enabled = true) {
  return queryOptions({
    queryKey: ['admin', 'tournament', id],
    enabled,
    gcTime: WORKSPACE_GC_MS,
    queryFn: async (): Promise<TournamentPageData> => {
      const status = await api<TournamentStatus>(`/tournaments/${id}/${prefix}/status`);
      const groupStage = prefix === 'gp' && status.phase === 'groups';
      const path = groupStage
        ? 'groups'
        : prefix === 'mex' && status.phase === 'mexicano'
          ? 'matches'
          : 'playoffs';
      const [data, settings, groups] = await Promise.all([
        api<MatchData>(`/tournaments/${id}/${prefix}/${path}`),
        api<TvSettings>(`/tournaments/${id}/tv-settings`).catch(() => DEFAULT_SETTINGS),
        // Group results stay readable once the play-offs start (read-only; never scored from here).
        prefix === 'gp' && !groupStage
          ? api<MatchData>(`/tournaments/${id}/gp/groups`).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      // A Mexicano that ended without play-offs has no bracket matches: keep its round history so
      // the match list and the played count still describe the event.
      const noBracket = prefix === 'mex' && path === 'playoffs' && !allMatches(data).length;
      const rounds = noBracket
        ? await api<MatchData>(`/tournaments/${id}/mex/matches`).catch(() => undefined)
        : undefined;
      const ctx: Ctx =
        prefix === 'mex'
          ? path === 'matches'
            ? 'mex'
            : 'mex-playoff'
          : prefix === 'gp'
            ? groupStage
              ? 'gp-group'
              : 'gp-playoff'
            : 'po-playoff';
      return { status, data, settings, groupStage, path, ctx, groups, rounds };
    },
  });
}
