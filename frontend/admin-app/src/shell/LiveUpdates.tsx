import { useEffect, type ReactNode } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TOURNAMENT_UPDATE_EVENT, useFollowedTournament } from './followTournament';

// The one server-sent-events connection for the whole app. On a tournament route (admin or a
// player's event page) it follows that tournament's stream; everywhere else it follows the global stream.
// Updates invalidate by key prefix, so pages never open streams or timers of their own.
// Polling is a fallback only: it starts when the browser has given up on the stream
// (readyState CLOSED) and stops as soon as a stream opens again.
const POLL_MS = 30_000;

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { pathname } = useLocation();
  const tid = matchPath('/admin/t/:id', pathname)?.params.id;
  // A player's event page follows its tournament's stream and refreshes only that event's matches
  // (the Hub keeps its own poll: the global stream fires for every tournament).
  const playerTid = matchPath('/player/matches/tournament/:id', pathname)?.params.id;
  // The TV page follows its own tournament and decides itself (refresh mode) what a message means.
  const onTv = pathname.startsWith('/tv/');
  const tvTid = useFollowedTournament();
  const followed = tid ?? playerTid ?? (onTv ? tvTid : null) ?? undefined;
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: number | undefined;
    let stopped = false;
    const refresh = (data?: unknown) => {
      if (!tid && !playerTid && followed) {
        let version: unknown = null;
        try {
          version = JSON.parse(String(data)).version;
        } catch {
          /* A bare message still means "something changed". */
        }
        window.dispatchEvent(new CustomEvent(TOURNAMENT_UPDATE_EVENT, { detail: version }));
        return;
      }
      if (playerTid) {
        void client.invalidateQueries({ queryKey: ['player', 'matches', playerTid] });
        return;
      }
      for (const key of [
        ['admin', 'tournaments'],
        ['admin', 'lobbies'],
        ['public', 'events'],
      ])
        void client.invalidateQueries({ queryKey: key });
      if (tid) void client.invalidateQueries({ queryKey: ['admin', 'tournament', tid] });
    };
    const stopPolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const connect = () => {
      if (stopped || typeof EventSource === 'undefined') return;
      const stream = new EventSource(
        followed ? `/api/tournaments/${followed}/events` : '/api/events',
      );
      source = stream;
      stream.onmessage = (event) => refresh(event.data);
      stream.onopen = stopPolling;
      stream.onerror = () => {
        if (stream.readyState !== EventSource.CLOSED || timer !== undefined || stopped) return;
        timer = window.setInterval(() => {
          refresh();
          stream.close();
          connect();
        }, POLL_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      stopPolling();
      source?.close();
    };
  }, [client, tid, playerTid, followed]);
  return <>{children}</>;
}
