import { useSyncExternalStore } from 'react';

// The TV page knows the tournament id only after it resolves the alias in the address. It tells the one
// live-update connection (LiveUpdatesProvider) which tournament stream to follow, instead of opening a
// second EventSource of its own.
let followed: string | null = null;
const listeners = new Set<() => void>();

export function followTournament(tid: string | null) {
  if (followed === tid) return;
  followed = tid;
  listeners.forEach((listener) => listener());
}

export function useFollowedTournament(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => followed,
  );
}

/** Fired on `window` for every server message of the followed TV tournament; `detail` is its version. */
export const TOURNAMENT_UPDATE_EVENT = 'amistoso:tournament-update';
