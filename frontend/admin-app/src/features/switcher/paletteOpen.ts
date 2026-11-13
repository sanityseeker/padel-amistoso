import { useSyncExternalStore } from 'react';

// Opening the command palette before its chunk (and @mantine/spotlight) has loaded. The first request
// mounts the palette; once mounted it registers its opener, which also serves that first request.

let wanted = false;
let pending = false;
let opener: (() => void) | null = null;
const listeners = new Set<() => void>();

const load = () => import('./PaletteSpotlight');

/** Starts loading the palette's code (hover or focus on the search box). */
export function preloadPalette() {
  void load().catch(() => undefined);
}
export const loadPalette = load;

/** Opens the palette, loading it first if needed. */
export function openPalette() {
  if (opener) {
    opener();
    return;
  }
  pending = true;
  if (!wanted) {
    wanted = true;
    for (const listener of listeners) listener();
  }
}

/** Called by the mounted palette; returns the cleanup for its effect. */
export function registerPaletteOpener(open: () => void): () => void {
  opener = open;
  if (pending) {
    pending = false;
    open();
  }
  return () => {
    if (opener === open) opener = null;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once the palette was asked for: it then stays mounted. */
export function usePaletteWanted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => wanted,
    () => wanted,
  );
}
