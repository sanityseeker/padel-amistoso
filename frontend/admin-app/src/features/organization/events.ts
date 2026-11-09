import type { Lobby, Tournament } from '../../types';

// The rows of a club's Events tab: its tournaments and sign-up lobbies in one list, each with a
// lifecycle state, an owner flag and the key the club's pin list stores (`tn:<id>` / `reg:<id>`).
export type EventState =
  | 'live'
  | 'upcoming'
  | 'finished'
  | 'open_registration'
  | 'ready_to_convert'
  | 'closed'
  | 'archived';
export type EventTab = 'active' | 'finished' | 'archived';

export interface ClubEvent {
  key: string;
  kind: 'tournament' | 'lobby';
  id: string;
  name: string;
  sport: string;
  alias: string | null;
  state: EventState;
  tab: EventTab;
  /** Eligible for the club's public page (and so for pinning). */
  isPublic: boolean;
  canEdit: boolean;
  seasonId: string | null;
  fromLobby: { id: string; name: string } | null;
  registrants: number | null;
  createdAt: string;
}

const TAB: Record<EventState, EventTab> = {
  live: 'active',
  upcoming: 'active',
  open_registration: 'active',
  ready_to_convert: 'active',
  finished: 'finished',
  closed: 'finished',
  archived: 'archived',
};

/** An item of `GET /clubs/{id}/public-tournaments`. */
export interface PublicItem {
  id: string;
  pin_key?: string;
  name: string;
  alias?: string | null;
  status: 'in_progress' | 'upcoming' | 'finished' | 'open_registration';
  kind: 'tournament' | 'registration';
  sport?: string;
  registrant_count?: number | null;
}

export function deriveEvents(
  tournaments: Tournament[],
  lobbies: Lobby[],
  clubId: string,
  publicItems: PublicItem[],
  me: { username: string; admin: boolean },
): ClubEvent[] {
  const T = tournaments.filter((t) => t.club_id === clubId);
  const R = lobbies.filter((r) => r.club_id === clubId);
  const tids = new Set(T.map((t) => t.id));
  const lobbyOf = new Map<string, Lobby>();
  for (const r of R)
    for (const tid of r.converted_to_tids ?? []) lobbyOf.set(tid, lobbyOf.get(tid) ?? r);
  const rows: ClubEvent[] = [];
  for (const t of T) {
    const state: EventState =
      t.phase === 'finished'
        ? 'finished'
        : t.phase === 'setup' && t.type === 'group_playoff'
          ? 'upcoming'
          : 'live';
    const from = lobbyOf.get(t.id);
    rows.push({
      key: `tn:${t.id}`,
      kind: 'tournament',
      id: t.id,
      name: t.name,
      sport: t.sport,
      alias: t.alias ?? null,
      state,
      tab: TAB[state],
      isPublic: t.public !== false,
      canEdit: me.admin || t.owner === me.username || t.shared === true,
      seasonId: t.season_id ?? null,
      fromLobby: from ? { id: from.id, name: from.name } : null,
      registrants: null,
      createdAt: t.created_at ?? '',
    });
  }
  for (const r of R) {
    const visible = (r.converted_to_tids ?? []).filter((id) => tids.has(id));
    let state: EventState;
    if (r.archived) state = 'archived';
    else if (r.open) state = 'open_registration';
    else if (visible.length)
      continue; // Its tournaments carry the row.
    else state = r.registrant_count >= 2 ? 'ready_to_convert' : 'closed';
    rows.push({
      key: `reg:${r.id}`,
      kind: 'lobby',
      id: r.id,
      name: r.name,
      sport: r.sport,
      alias: r.alias ?? null,
      state,
      tab: TAB[state],
      // A lobby is on the club page only while it is open and listed.
      isPublic: r.open && r.listed && !r.archived,
      canEdit: true,
      seasonId: r.season_id ?? null,
      fromLobby: null,
      registrants: r.registrant_count,
      createdAt: r.created_at ?? '',
    });
  }
  const seen = new Set(rows.map((r) => r.key));
  const PUBLIC_STATE = {
    in_progress: 'live',
    upcoming: 'upcoming',
    finished: 'finished',
    open_registration: 'open_registration',
  } as const;
  for (const item of publicItems) {
    const lobby = item.kind === 'registration';
    const key = item.pin_key ?? `${lobby ? 'reg' : 'tn'}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state: EventState = PUBLIC_STATE[item.status] ?? 'live';
    rows.push({
      key,
      kind: lobby ? 'lobby' : 'tournament',
      id: item.id,
      name: item.name,
      sport: item.sport ?? 'padel',
      alias: item.alias ?? null,
      state,
      tab: TAB[state],
      isPublic: true,
      canEdit: false,
      seasonId: null,
      fromLobby: null,
      registrants: lobby ? (item.registrant_count ?? 0) : null,
      createdAt: '',
    });
  }
  return rows;
}

/** Events that can join the club: yours, in the club's community, in no club yet. */
export function attachCandidates(
  tournaments: Tournament[],
  lobbies: Lobby[],
  communityId: string,
  me: { username: string; admin: boolean },
) {
  const out: {
    key: string;
    kind: 'tournament' | 'lobby';
    id: string;
    name: string;
    sport: string;
    createdAt: string;
  }[] = [];
  for (const t of tournaments)
    if (
      !t.club_id &&
      (t.community_id || 'open') === communityId &&
      (me.admin || t.owner === me.username || t.shared)
    )
      out.push({
        key: `tn:${t.id}`,
        kind: 'tournament',
        id: t.id,
        name: t.name,
        sport: t.sport,
        createdAt: t.created_at ?? '',
      });
  for (const r of lobbies)
    if (!r.club_id && !r.archived && (r.community_id || 'open') === communityId)
      out.push({
        key: `reg:${r.id}`,
        kind: 'lobby',
        id: r.id,
        name: r.name,
        sport: r.sport,
        createdAt: r.created_at ?? '',
      });
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}
