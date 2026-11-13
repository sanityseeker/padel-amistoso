import { useSyncExternalStore } from 'react';

// The Player Hub's chosen scope: '' (all my communities), `club:<id>` or `community:<id>`.
// A store, not component state, so the phone tab bar (outside the Hub's outlet) can follow it.
const SCOPE_KEY = 'padel-player-community';

const read = (): string => {
  try {
    const saved = localStorage.getItem(SCOPE_KEY) || '';
    return saved && !saved.includes(':') ? `community:${saved}` : saved;
  } catch {
    return '';
  }
};

let current = read();
const listeners = new Set<() => void>();

export const getPlayerScope = () => current;

/** Only the picker persists; the club-subdomain override passes `persist = false`. */
export function setPlayerScope(value: string, persist = true) {
  if (persist) {
    try {
      localStorage.setItem(SCOPE_KEY, value);
    } catch {
      /* storage unavailable: the scope still applies for this visit */
    }
  }
  if (value === current) return;
  current = value;
  listeners.forEach((listener) => listener());
}

export function usePlayerScope(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => '',
  );
}

// The Player Hub's sport filter, kept across its pages and visits like the scope above: 'padel',
// 'tennis' or 'all' (the default). An empty or unknown stored value reads as 'all'. The Ratings page
// needs one concrete sport and falls back to the player's first one without writing anything.
const SPORT_KEY = 'padel-player-sport';

export type SportFilter = 'padel' | 'tennis' | 'all';

const normalize = (value: string | null): SportFilter =>
  value === 'padel' || value === 'tennis' ? value : 'all';

const readSport = (): SportFilter => {
  try {
    return normalize(localStorage.getItem(SPORT_KEY));
  } catch {
    return 'all';
  }
};

let sport: SportFilter = readSport();
const sportListeners = new Set<() => void>();

export function setPlayerSport(next: SportFilter) {
  const value = normalize(next);
  try {
    localStorage.setItem(SPORT_KEY, value);
  } catch {
    /* storage unavailable: the sport still applies for this visit */
  }
  if (value === sport) return;
  sport = value;
  sportListeners.forEach((listener) => listener());
}

export function usePlayerSport(): SportFilter {
  return useSyncExternalStore(
    (listener) => {
      sportListeners.add(listener);
      return () => {
        sportListeners.delete(listener);
      };
    },
    () => sport,
    () => 'all',
  );
}
