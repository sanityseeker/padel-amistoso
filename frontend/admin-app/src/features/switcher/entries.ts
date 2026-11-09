import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { matchPath, useLocation } from 'react-router-dom';
import { api, formatType } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { useLobbyList, useTournamentList } from '../../components';
import { prefixOf, workspaceQuery } from '../../admin/tournament/query';
import { pageMatches, reviewItems } from '../../admin/tournament/scoring';
import type { Club, Community, Tournament, TournamentStatus } from '../../types';
import { openPath, orderItems, useOpenItems, type OpenItem } from './openItems';

/** What the dock, rail, sheet, strip and hover card show about one open tournament or lobby. */
export interface EntryInfo {
  item: OpenItem;
  path: string;
  name: string;
  sport: string | null;
  /** Upper-case eyebrow such as "MEXICANO · R3/6" or "LOBBY · 9 registered". */
  eyebrow: string;
  live: boolean;
  finished: boolean;
  review: number;
  /** 0..1, or null when the app has no honest number for it. */
  progress: number | null;
  phase: string | null;
  played: number | null;
  total: number | null;
  courts: number | null;
  type: Tournament['type'] | null;
  open: boolean | null;
}

/** "Gracia Sunday Mexicano #5" -> "GS5". First two words plus a trailing number. */
export function monogram(name: string): string {
  const number = name.match(/#?(\d+)\s*$/)?.[1] ?? '';
  const words = name
    .replace(/#?\d+\s*$/, '')
    .split(/[\s\-_/]+/)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (letters + number).slice(0, 4) || name.slice(0, 2).toUpperCase();
}

function useAdminData() {
  const { user } = useAuth();
  const enabled = !!user;
  const tournaments = useTournamentList(enabled);
  const lobbies = useLobbyList(enabled);
  return { user, enabled, tournaments, lobbies };
}

/** Open items in display order (pinned, then recents). */
export function useOrderedItems(): OpenItem[] {
  const items = useOpenItems();
  return useMemo(() => orderItems(items), [items]);
}

// Status for one open item. The active workspace's full query (when cached) is the source of truth;
// every other tournament uses a light status call, refetched every 60 s while the page is visible.
export function useEntryInfo(item: OpenItem): EntryInfo {
  useLocale();
  const { user, enabled, tournaments, lobbies } = useAdminData();
  const tournament =
    item.kind === 'tournament' ? tournaments.data?.find((t) => t.id === item.id) : undefined;
  const lobby = item.kind === 'lobby' ? lobbies.data?.find((l) => l.id === item.id) : undefined;
  const prefix = prefixOf(tournament?.type);
  const { pathname } = useLocation();
  const isActive = matchPath('/admin/t/:id', pathname)?.params.id === item.id;
  const fullQuery = useQuery({ ...workspaceQuery(item.id, prefix, false) });
  // Cached workspace data counts while it is the open page or was refreshed in the last two minutes.
  const fullData =
    fullQuery.data && (isActive || Date.now() - fullQuery.dataUpdatedAt < 120_000)
      ? fullQuery.data
      : undefined;
  const full = { data: fullData };
  const light = useQuery({
    queryKey: ['admin', 'tournament-status', item.id],
    queryFn: () => api<TournamentStatus>(`/tournaments/${item.id}/${prefix}/status`),
    enabled: enabled && !!tournament && !full.data,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return useMemo((): EntryInfo => {
    const base = {
      item,
      path: openPath(item),
      name: tournament?.name ?? lobby?.name ?? item.name,
      sport: tournament?.sport ?? lobby?.sport ?? null,
      courts: null as number | null,
      open: lobby ? lobby.open : null,
    };
    if (item.kind === 'lobby') {
      const count = lobby?.registrant_count;
      return {
        ...base,
        eyebrow: [tx('Lobby'), count != null ? tx('{n} registered', { n: count }) : '']
          .filter(Boolean)
          .join(' · '),
        live: !!lobby?.open,
        finished: !!lobby?.archived,
        review: 0,
        progress: null,
        phase: null,
        played: null,
        total: null,
        type: null,
      };
    }
    const status = full.data?.status ?? light.data;
    const phase = status?.phase ?? tournament?.phase ?? null;
    const finished = phase === 'finished' || !!status?.is_finished;
    const matches = full.data ? pageMatches(full.data) : null;
    // Matches of the stage now running (groups, rounds or play-offs), counted by the status call so
    // that every tournament has them. `total` stays null when the stage has no known size, such as a
    // Mexicano without a round limit.
    const played = status?.stage_played ?? null;
    const total = status?.stage_total || null;
    const round =
      status?.current_round && tournament?.type === 'mexicano'
        ? status.num_rounds
          ? `R${status.current_round}/${status.num_rounds}`
          : `R${status.current_round}`
        : '';
    const canEdit =
      user?.role === 'admin' || tournament?.owner === user?.username || !!tournament?.shared;
    const review = full.data && canEdit ? reviewItems(matches ?? [], full.data.settings).length : 0;
    const typeLabel = tournament
      ? tournament.type === 'mexicano'
        ? tx('Mexicano')
        : tournament.type === 'group_playoff'
          ? phase === 'playoffs'
            ? tx('Play-offs')
            : phase === 'finished'
              ? ''
              : tx('Groups')
          : tx('Play-offs')
      : '';
    let progress: number | null = null;
    if (finished) progress = 1;
    else if (played != null && total) progress = Math.min(1, played / total);
    const courts = (status as { courts?: unknown[] } | undefined)?.courts?.length ?? null;
    return {
      ...base,
      courts,
      eyebrow: [
        // A finished Group+Play-off has no stage left to name; "Finished" says it.
        typeLabel.toUpperCase(),
        finished ? tx('Finished').toUpperCase() : round,
        played != null && total && !finished ? `${played}/${total}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      live: !!tournament && !finished && phase !== 'setup',
      finished,
      review,
      progress,
      phase,
      played,
      total,
      type: tournament?.type ?? null,
    };
  }, [item, tournament, lobby, full.data, light.data, user]);
}

export const entryDescription = (info: EntryInfo) =>
  [
    info.eyebrow,
    info.live ? tx('Live') : '',
    info.review ? tx('{n} to review', { n: info.review }) : '',
  ]
    .filter(Boolean)
    .join(', ');

/** One-at-a-time workspace prefetch for hover and focus on a dock item. */
export function usePrefetch() {
  const client = useQueryClient();
  const tournaments = useTournamentList(false);
  return (item: OpenItem) => {
    if (item.kind !== 'tournament') return;
    const type = tournaments.data?.find((t) => t.id === item.id)?.type;
    if (!type) return;
    void client.prefetchQuery({ ...workspaceQuery(item.id, prefixOf(type)), staleTime: 15_000 });
  };
}

export type IndexKind = 'tournament' | 'lobby' | 'club' | 'community' | 'player';
export interface IndexEntry {
  id: string;
  kind: IndexKind;
  label: string;
  description: string;
  path: string;
  keywords: string[];
  /** Player entries carry the match to focus. */
  matchId?: string;
  tid?: string;
  /** Tournaments and lobbies: the palette tints the icon blue (padel) or green (tennis). */
  sport?: string;
}

/** One search index over data already in the cache. It makes no requests of its own beyond the
    four list queries every admin page already shares. */
export function useSwitcherIndex(activeTournamentId?: string): IndexEntry[] {
  useLocale();
  const { enabled, tournaments, lobbies } = useAdminData();
  const clubs = useQuery({
    queryKey: ['admin', 'clubs'],
    queryFn: () => api<Club[]>('/clubs'),
    enabled,
  });
  const communities = useQuery({
    queryKey: ['admin', 'communities'],
    queryFn: () => api<Community[]>('/communities'),
    enabled,
  });
  // Same query key as the workspace page, so the prefix must be the tournament's own: a fetch made
  // through this observer would otherwise ask a wrong endpoint (a 404 after every write).
  const activeType = tournaments.data?.find((t) => t.id === activeTournamentId)?.type;
  const active = useQuery({
    ...workspaceQuery(activeTournamentId ?? '', prefixOf(activeType), false),
  });
  return useMemo(() => {
    const out: IndexEntry[] = [];
    for (const t of tournaments.data ?? [])
      out.push({
        id: t.id,
        kind: 'tournament',
        label: t.name,
        description: [formatType(t.type), t.club_name || t.community_name]
          .filter(Boolean)
          .join(' · '),
        path: `/admin/t/${t.id}`,
        sport: t.sport,
        keywords: [t.id, t.club_name ?? '', t.community_name, t.type],
      });
    for (const l of lobbies.data ?? [])
      out.push({
        id: l.id,
        kind: 'lobby',
        label: l.name,
        description: [tx('Lobby'), tx('{n} registered', { n: l.registrant_count })].join(' · '),
        path: `/admin/lobby/${l.id}`,
        sport: l.sport,
        keywords: [l.id, l.club_name ?? '', l.community_name ?? '', 'lobby inscripcion'],
      });
    for (const c of clubs.data ?? [])
      out.push({
        id: c.id,
        kind: 'club',
        label: c.name,
        description: tx('Club'),
        path: '/admin/clubs',
        keywords: [c.id, 'club'],
      });
    for (const c of communities.data ?? [])
      out.push({
        id: c.id,
        kind: 'community',
        label: c.name,
        description: tx('Community'),
        path: '/admin/clubs',
        keywords: [c.id, 'community comunidad'],
      });
    if (activeTournamentId && active.data) {
      const matches = pageMatches(active.data);
      const names = new Set<string>();
      for (const m of matches) for (const n of [...m.team1, ...m.team2]) names.add(n);
      for (const name of names) {
        const next = matches.find(
          (m) => m.status !== 'completed' && [...m.team1, ...m.team2].includes(name),
        );
        out.push({
          id: `${activeTournamentId}:${name}`,
          kind: 'player',
          label: name,
          description: next
            ? [next.court, next.round_label && formatRoundLabel(next.round_label)]
                .filter(Boolean)
                .join(' · ')
            : tx('No pending match'),
          path: `/admin/t/${activeTournamentId}`,
          keywords: [],
          matchId: next?.id,
          tid: activeTournamentId,
        });
      }
    }
    return out;
  }, [
    tournaments.data,
    lobbies.data,
    clubs.data,
    communities.data,
    active.data,
    activeTournamentId,
  ]);
}
