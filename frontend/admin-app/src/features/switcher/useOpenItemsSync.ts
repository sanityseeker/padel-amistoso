import { useEffect, useRef } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useLobbyList, useTournamentList } from '../../components';
import {
  forgetClosed,
  openItem,
  syncItems,
  useOpenItems,
  wasClosed,
  type OpenItem,
} from './openItems';

function routeItem(pathname: string): Pick<OpenItem, 'id' | 'kind'> | null {
  const tournament = matchPath('/admin/t/:id', pathname);
  if (tournament?.params.id) return { id: tournament.params.id, kind: 'tournament' };
  const lobby = matchPath('/admin/lobby/:id', pathname);
  if (lobby?.params.id) return { id: lobby.params.id, kind: 'lobby' };
  return null;
}

// Keeps the open-items store in step with the route and the server lists. Mounted once inside the
// admin gate, whatever navigation is on screen (dock, rail, sheet or strip).
export function useOpenItemsSync() {
  const { pathname } = useLocation();
  const items = useOpenItems();
  const tournaments = useTournamentList();
  const lobbies = useLobbyList();
  const active = routeItem(pathname);
  const pruned = useRef({ tournament: false, lobby: false });

  // Visiting a tournament or lobby page opens it (or marks it as just visited).
  useEffect(() => {
    if (!active) return;
    const known =
      active.kind === 'tournament'
        ? tournaments.data?.find((t) => t.id === active.id)?.name
        : lobbies.data?.find((l) => l.id === active.id)?.name;
    if (!wasClosed(active.id)) openItem({ ...active, name: known ?? active.id });
    // Leaving the page re-arms it, so visiting it again opens it again.
    return () => forgetClosed(active.id);
  }, [active?.id, active?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Names follow the lists; entries from earlier sessions that the server no longer has are dropped
  // once (the open page handles its own 404).
  useEffect(() => {
    if (!tournaments.data) return;
    const known = new Map(tournaments.data.map((t) => [t.id, t.name]));
    const prune = !pruned.current.tournament && !tournaments.isFetching;
    if (prune) pruned.current.tournament = true;
    syncItems('tournament', known, { prune, keep: active?.kind === 'tournament' ? active.id : '' });
  }, [tournaments.data, tournaments.isFetching, active?.id, active?.kind, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!lobbies.data) return;
    const known = new Map(lobbies.data.map((l) => [l.id, l.name]));
    const prune = !pruned.current.lobby && !lobbies.isFetching;
    if (prune) pruned.current.lobby = true;
    syncItems('lobby', known, { prune, keep: active?.kind === 'lobby' ? active.id : '' });
  }, [lobbies.data, lobbies.isFetching, active?.id, active?.kind, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
