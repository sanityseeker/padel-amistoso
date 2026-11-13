import { useOutletContext } from 'react-router-dom';
import type { Entry, Space } from '../../player/types';
import type { SportFilter } from '../../player/scope';
import type { Sport } from './stats';

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
  /** On a club subdomain: that club's entries. Everything on the Hub, payments included, keeps to them. */
  clubEntries: Entry[] | null;
  /** One concrete sport for the per-sport widgets (rating card, chart, leaderboard); always one of `sports` when the player has any. */
  sport: Sport;
  sports: Sport[];
  /** What the sport switcher filters the lists by. Always 'all' while the switcher is hidden (one sport). Never index with it. */
  sportFilter: Sport | 'all';
  setSport: (sport: SportFilter) => void;
  openLink: () => void;
  notice: string;
  clearNotice: () => void;
}

export const usePlayerSpace = () => useOutletContext<PlayerSpaceContext>();

export const entryPath = (entry: { entity_type: string; entity_id: string }) =>
  `/player/matches/${entry.entity_type}/${encodeURIComponent(entry.entity_id)}`;
