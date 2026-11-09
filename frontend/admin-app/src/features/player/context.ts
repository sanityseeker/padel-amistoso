import { useOutletContext } from 'react-router-dom';
import type { Entry, Space } from '../../player/types';

export interface PlayerSpaceContext {
  space: Space;
  /** "", "club:<id>" or "community:<id>". */
  scope: string;
  scopeQuery: string;
  scopeOptions: { value: string; label: string }[];
  /** Every entry regardless of the picked scope (except on a club subdomain): tournaments in progress and deep links. */
  liveEntries: Entry[];
  /** The unscoped list is still loading (a picked scope is showing a partial list meanwhile). */
  liveLoading: boolean;
  setScope: (scope: string) => void;
  openLink: () => void;
  notice: string;
  clearNotice: () => void;
}

export const usePlayerSpace = () => useOutletContext<PlayerSpaceContext>();

export const entryPath = (entry: { entity_type: string; entity_id: string }) =>
  `/player/matches/${entry.entity_type}/${encodeURIComponent(entry.entity_id)}`;
