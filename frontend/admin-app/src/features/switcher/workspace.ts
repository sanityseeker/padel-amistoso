import { useEffect, useSyncExternalStore } from 'react';

// The open tournament workspace announces what it can do, so the command palette, the keyboard
// shortcuts and the wide-screen aside can act on it without owning its state. Every action that
// changes data still goes through the workspace's own confirmation modal.
export interface WorkspaceInfo {
  tid: string;
  name: string;
  canEdit: boolean;
  /** Label of the "advance" action the current phase allows, or null. */
  nextRoundLabel: string | null;
  reviewCount: number;
  hasPending: boolean;
}
export interface WorkspaceHandlers {
  nextRound: () => void;
  scoreNext: () => void;
  scoreSelected: () => void;
  moveSelection: (delta: 1 | -1) => void;
  focusMatch: (matchId: string) => void;
  focusFilter: () => void;
  showView: (view: string) => void;
}

let info: WorkspaceInfo | null = null;
let handlers: WorkspaceHandlers | null = null;
const listeners = new Set<() => void>();

export function useRegisterWorkspace(next: WorkspaceInfo, nextHandlers: WorkspaceHandlers) {
  // Handlers always point at the latest render; only the data fields notify.
  handlers = nextHandlers;
  const signature = JSON.stringify(next);
  useEffect(() => {
    info = JSON.parse(signature) as WorkspaceInfo;
    listeners.forEach((listener) => listener());
  }, [signature]);
  useEffect(
    () => () => {
      info = null;
      handlers = null;
      listeners.forEach((listener) => listener());
    },
    [],
  );
}

export function useWorkspaceInfo(): WorkspaceInfo | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => info,
    () => null,
  );
}
export const workspace = (): WorkspaceHandlers | null => handlers;
