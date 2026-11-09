import { formatType } from '../../api';
import { t as tx } from '../../i18n';
import type { Lobby, Tournament } from '../../types';

// One shape for the hub, the lobby list and the search: a tournament or a registration lobby.
export interface HubEvent {
  id: string;
  kind: 'tournament' | 'lobby';
  name: string;
  path: string;
  owner: string;
  shared: boolean;
  /** Listed publicly. */
  listed: boolean;
  sport: string;
  scope: string;
  format: string;
  live: boolean;
  finished: boolean;
  phaseLabel: string;
  registrants?: number;
  tournament?: Tournament;
  lobby?: Lobby;
}

export function fromTournament(t: Tournament): HubEvent {
  const finished = t.phase === 'finished';
  return {
    id: t.id,
    kind: 'tournament',
    name: t.name,
    path: `/admin/t/${t.id}`,
    owner: t.owner,
    shared: t.shared,
    listed: t.public,
    sport: t.sport,
    scope: t.club_name || t.community_name,
    format: formatType(t.type),
    live: !finished && t.phase !== 'setup',
    finished,
    phaseLabel: t.phase,
    tournament: t,
  };
}

export function fromLobby(l: Lobby): HubEvent {
  return {
    id: l.id,
    kind: 'lobby',
    name: l.name,
    path: `/admin/lobby/${l.id}`,
    owner: l.owner,
    shared: l.shared,
    listed: l.listed,
    sport: l.sport,
    scope: l.club_name || l.community_name || '',
    format: tx('Registration lobby'),
    live: l.open && !l.archived,
    finished: l.archived,
    phaseLabel: l.archived ? 'archived' : l.open ? 'open' : 'closed',
    registrants: l.registrant_count,
    lobby: l,
  };
}

export const sportLabel = (sport: string) => tx(sport === 'tennis' ? 'Tennis' : 'Padel');
