import { useSyncExternalStore } from 'react';

// Tournaments and lobbies the organizer keeps open for quick switching. Persisted in localStorage
// (shared across tabs). Pinned items (up to PINNED_CAP) are never evicted and can be reordered.
// Recents are evicted least-recently-used once there are more than RECENT_CAP; their display order
// stays stable so dock slots (Alt+1..8) do not move while the organizer switches.
export interface OpenItem {
  id: string;
  kind: 'tournament' | 'lobby';
  name: string;
  pinned?: boolean;
  /** Monotonic visit counter (not a wall clock); larger is more recent. */
  visitedAt?: number;
}
export const OPEN_KEY = 'amistoso-admin-open';
export const RECENT_CAP = 8;
export const PINNED_CAP = 8;

const sameItem = (a: Pick<OpenItem, 'id' | 'kind'>, b: Pick<OpenItem, 'id' | 'kind'>) =>
  a.id === b.id && a.kind === b.kind;

function read(): OpenItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    // Entries stored before pinning have no visitedAt: array order (old FIFO) stands in for it.
    return parsed
      .filter(
        (item): item is OpenItem =>
          !!item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          (item.kind === 'tournament' || item.kind === 'lobby'),
      )
      .map((item, index) => ({
        ...item,
        pinned: item.pinned === true ? true : undefined,
        visitedAt: typeof item.visitedAt === 'number' ? item.visitedAt : index + 1,
      }));
  } catch {
    return [];
  }
}

// Keep everything pinned (up to the cap) and the newest RECENT_CAP of the rest.
function enforceCaps(items: OpenItem[]): OpenItem[] {
  const pinned = items.filter((i) => i.pinned);
  const droppedPins = new Set(pinned.slice(PINNED_CAP).map((i) => i.kind + i.id));
  const recents = items.filter((i) => !i.pinned);
  const keep = new Set(
    [...recents]
      .sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0))
      .slice(0, RECENT_CAP)
      .map((i) => i.kind + i.id),
  );
  return items.filter((i) =>
    i.pinned ? !droppedPins.has(i.kind + i.id) : keep.has(i.kind + i.id),
  );
}

let current = enforceCaps(read());
let counter = current.reduce((max, i) => Math.max(max, i.visitedAt ?? 0), 0);
const nextVisit = () => (counter = Math.max(counter + 1, Date.now()));
const listeners = new Set<() => void>();

function commit(next: OpenItem[]) {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(next));
  } catch {
    /* The list still works for this page load. */
  }
  listeners.forEach((listener) => listener());
}

window.addEventListener('storage', (event) => {
  if (event.key !== OPEN_KEY) return;
  current = enforceCaps(read());
  listeners.forEach((listener) => listener());
});

export const openPath = (item: Pick<OpenItem, 'id' | 'kind'>) =>
  item.kind === 'lobby' ? `/admin/lobby/${item.id}` : `/admin/t/${item.id}`;

/** Display order: pinned first (in their saved order), then recents (in the order they were opened). */
export function orderItems(items: OpenItem[]): OpenItem[] {
  return [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned)];
}

/** Items from most to least recently visited (used to pick the neighbour after closing). */
export const byRecency = (items: OpenItem[]) =>
  [...items].sort((a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0));

/** Add an item or mark an existing one as just visited. Least-recently-used recents are evicted. */
export function openItem(item: Pick<OpenItem, 'id' | 'kind' | 'name'>) {
  const visitedAt = nextVisit();
  const existing = current.find((i) => sameItem(i, item));
  if (existing) {
    commit(current.map((i) => (i === existing ? { ...i, visitedAt } : i)));
    return;
  }
  commit(enforceCaps([...current, { ...item, visitedAt }]));
}
// Items closed while their page is still on screen. The route sync must not reopen them in the
// moment before the navigation away completes; leaving the page re-arms them.
const closedHere = new Set<string>();
export const wasClosed = (id: string) => closedHere.has(id);
export const forgetClosed = (id: string) => void closedHere.delete(id);

export function closeItem(id: string) {
  closedHere.add(id);
  commit(current.filter((i) => i.id !== id));
}
export function closeItems(predicate: (item: OpenItem) => boolean) {
  current.filter(predicate).forEach((i) => closedHere.add(i.id));
  commit(current.filter((i) => !predicate(i)));
}
/** Returns false when the pinned slots are full. */
export function togglePin(target: Pick<OpenItem, 'id' | 'kind'>): boolean {
  const item = current.find((i) => sameItem(i, target));
  if (!item) return false;
  if (!item.pinned && current.filter((i) => i.pinned).length >= PINNED_CAP) return false;
  // A newly pinned item joins the end of the pinned group; an unpinned one the end of the recents.
  const rest = current.filter((i) => i !== item);
  commit(
    item.pinned
      ? enforceCaps([...rest, { ...item, pinned: undefined }])
      : [
          ...rest.filter((i) => i.pinned),
          { ...item, pinned: true },
          ...rest.filter((i) => !i.pinned),
        ],
  );
  return true;
}
/** Move a pinned item up (-1) or down (+1) inside the pinned group. */
export function movePinned(target: Pick<OpenItem, 'id' | 'kind'>, delta: -1 | 1) {
  const pinned = current.filter((i) => i.pinned);
  const from = pinned.findIndex((i) => sameItem(i, target));
  const to = from + delta;
  if (from < 0 || to < 0 || to >= pinned.length) return;
  [pinned[from], pinned[to]] = [pinned[to], pinned[from]];
  commit([...pinned, ...current.filter((i) => !i.pinned)]);
}
/** Apply fresh names, and optionally drop items the server no longer lists. */
export function syncItems(
  kind: OpenItem['kind'],
  known: Map<string, string>,
  options: { prune?: boolean; keep?: string } = {},
) {
  commit(
    current
      .filter((i) => i.kind !== kind || known.has(i.id) || !options.prune || i.id === options.keep)
      .map((i) => (i.kind === kind && known.has(i.id) ? { ...i, name: known.get(i.id)! } : i)),
  );
}

export function useOpenItems(): OpenItem[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => [],
  );
}
