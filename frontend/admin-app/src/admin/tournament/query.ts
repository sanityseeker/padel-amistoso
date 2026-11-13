import { queryOptions } from '@tanstack/react-query';
import { ApiError, api } from '../../api';
import type {
  MatchData,
  Tournament,
  TournamentStatus,
  TvSettings,
  WorkspaceTournament,
} from '../../types';
import { DEFAULT_SETTINGS, type Ctx, type TournamentPageData } from './scoring';

export type TournamentPrefix = 'mex' | 'gp' | 'po';

export const prefixOf = (type: Tournament['type'] | undefined): TournamentPrefix =>
  type === 'mexicano' ? 'mex' : type === 'group_playoff' ? 'gp' : 'po';

/** Keeps a visited workspace warm so switching back never shows a spinner (15 minutes). */
export const WORKSPACE_GC_MS = 15 * 60_000;

/** `GET /tournaments/{id}/workspace`: the same pieces the per-phase endpoints return, in one call. */
interface WorkspaceResponse {
  type: Tournament['type'];
  prefix: TournamentPrefix;
  status: TournamentStatus;
  path: 'groups' | 'matches' | 'playoffs';
  group_stage: boolean;
  data: MatchData;
  groups: MatchData | null;
  rounds: MatchData | null;
  tv_settings: TvSettings | null;
  access: { can_edit: boolean; is_owner_or_admin: boolean };
  tournament: WorkspaceTournament | null;
}

const ctxOf = (prefix: TournamentPrefix, path: string, groupStage: boolean): Ctx =>
  prefix === 'mex'
    ? path === 'matches'
      ? 'mex'
      : 'mex-playoff'
    : prefix === 'gp'
      ? groupStage
        ? 'gp-group'
        : 'gp-playoff'
      : 'po-playoff';

// One definition of "everything the workspace shows", shared by the page, the dock's hover prefetch
// and the cache readers (aside, switcher) so all of them use the same cache entry.
export function workspaceQuery(id: string, enabled = true) {
  return queryOptions({
    queryKey: ['admin', 'tournament', id],
    enabled,
    gcTime: WORKSPACE_GC_MS,
    // A deleted or unknown tournament is final: show "not found" at once instead of retrying.
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status === 404) && failures < 1,
    queryFn: async (): Promise<TournamentPageData> => {
      const r = await api<WorkspaceResponse>(`/tournaments/${id}/workspace`);
      return {
        type: r.type,
        prefix: r.prefix,
        access: { canEdit: r.access.can_edit, isOwnerOrAdmin: r.access.is_owner_or_admin },
        tournament: r.tournament,
        status: r.status,
        data: r.data,
        settings: r.tv_settings ?? DEFAULT_SETTINGS,
        groupStage: r.group_stage,
        path: r.path,
        ctx: ctxOf(r.prefix, r.path, r.group_stage),
        groups: r.groups ?? undefined,
        rounds: r.rounds ?? undefined,
      };
    },
  });
}
