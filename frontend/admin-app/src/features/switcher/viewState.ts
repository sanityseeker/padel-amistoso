import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

// Per-tournament view memory: which tab, filter, group and round the organizer was on, which match
// was selected, and how far the page was scrolled. The URL carries view, filter, group and round
// (back/forward and deep links work); sessionStorage carries all six, so switching away and back
// lands in the same place.
export interface ViewState {
  view: string;
  filter: string;
  group?: string;
  round?: string;
  selectedMatchId?: string;
  scrollY?: number;
}
export const VIEW_KEY = 'amistoso-admin-view';
export const DEFAULT_VIEW: ViewState = { view: 'matches', filter: 'pending' };
const URL_KEYS = ['view', 'filter', 'group', 'round'] as const;

type Store = Record<string, Partial<ViewState>>;
function readAll(): Store {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(VIEW_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}
export function readView(tid: string): Partial<ViewState> {
  return readAll()[tid] ?? {};
}
export function writeView(tid: string, patch: Partial<ViewState>) {
  try {
    const all = readAll();
    all[tid] = { ...all[tid], ...patch };
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(all));
  } catch {
    /* Memory only helps; the page works without it. */
  }
}

/** Drop a remembered value the tournament no longer has (the round advanced, a group vanished). */
export function pruneView(tid: string, keep: Partial<Record<keyof ViewState, string[]>>) {
  const stored = readView(tid);
  const patch: Partial<ViewState> = {};
  for (const key of Object.keys(keep) as (keyof ViewState)[]) {
    const value = stored[key];
    if (typeof value === 'string' && !keep[key]!.includes(value))
      (patch as Record<string, unknown>)[key] = undefined;
  }
  if (Object.keys(patch).length) writeView(tid, patch);
}

/**
 * Workspace view state. The URL wins; with no view parameters the stored state is restored once
 * (call after the data has rendered, never before). `allowedViews` guards against a stored tab the
 * user cannot open (Review and Players need edit rights).
 */
export function useViewState(
  tid: string,
  ready: boolean,
  allowedViews: string[],
  /** Finished events open on "all"; a remembered "to play" does not override that. */
  defaultFilter: string = DEFAULT_VIEW.filter,
) {
  const [params, setParams] = useSearchParams();
  const restored = useRef(false);
  const stored = readView(tid);
  const fromUrl = (key: (typeof URL_KEYS)[number]) => params.get(key) ?? undefined;
  const view = fromUrl('view') ?? DEFAULT_VIEW.view;
  // A tab that no longer exists (Review once the queue is empty, Standings on knockouts) falls back
  // to the default tab, or the first one that does.
  const fallbackView = allowedViews.includes(DEFAULT_VIEW.view)
    ? DEFAULT_VIEW.view
    : (allowedViews[0] ?? DEFAULT_VIEW.view);
  const state: ViewState = {
    view: allowedViews.includes(view) ? view : fallbackView,
    filter: fromUrl('filter') ?? defaultFilter,
    group: fromUrl('group'),
    round: fromUrl('round'),
    selectedMatchId: stored.selectedMatchId,
    scrollY: stored.scrollY,
  };

  const defaultFilterRef = useRef(defaultFilter);
  defaultFilterRef.current = defaultFilter;
  const fallbackRef = useRef(fallbackView);
  fallbackRef.current = fallbackView;
  const patch = useCallback(
    (next: Partial<ViewState>, options: { replace?: boolean } = {}) => {
      writeView(tid, next);
      setParams(
        (current) => {
          const out = new URLSearchParams(current);
          for (const key of URL_KEYS) {
            if (!(key in next)) continue;
            const value = next[key];
            const fallback =
              key === 'filter' ? defaultFilterRef.current : DEFAULT_VIEW[key as 'view'];
            if (
              value == null ||
              value === fallback ||
              (key === 'view' && value === fallbackRef.current)
            )
              out.delete(key);
            else out.set(key, String(value));
          }
          return out;
        },
        { replace: options.replace ?? false },
      );
    },
    [tid, setParams],
  );

  // Restore once the first data render has happened and the URL says nothing.
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    if (URL_KEYS.some((k) => params.has(k))) {
      // A deep link: remember it so the next visit lands here too.
      writeView(tid, {
        view: state.view,
        filter: state.filter,
        group: state.group,
        round: state.round,
      });
      return;
    }
    const memory = readView(tid);
    const next: Partial<ViewState> = {};
    if (memory.view && allowedViews.includes(memory.view)) next.view = memory.view;
    // A remembered "to play" is not restored on an event that opens on "all".
    if (
      memory.filter &&
      (defaultFilter === DEFAULT_VIEW.filter || memory.filter !== DEFAULT_VIEW.filter)
    )
      next.filter = memory.filter;
    if (memory.group) next.group = memory.group;
    if (memory.round) next.round = memory.round;
    if (Object.keys(next).length) patch(next, { replace: true });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the scroll position while the workspace is open, and put it back after a restore.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const save = () => writeView(tid, { scrollY: Math.round(window.scrollY) });
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(save);
    };
    const saved = readView(tid).scrollY;
    if (saved) {
      // After the router's own scroll reset and the first layout of the restored view.
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => window.scrollTo(0, saved)),
      );
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [ready, tid]);

  return { state, patch };
}
