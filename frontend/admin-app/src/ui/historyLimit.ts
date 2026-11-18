import { useCallback, useState } from 'react';

/** How many matches a history lists: the two short lengths, or all of them. */
export type HistoryLimitValue = '10' | '25' | 'all';

/** The most the API lists in one answer (`HISTORY_HARD_CAP` in `player_card.py`): what "all" asks for. */
export const HISTORY_ALL = 500;
/** Longer than this, a history offers the choice; shorter ones are shown whole. */
export const HISTORY_SHORT = 10;

const KEY = 'amistoso-history-limit';

function stored(): HistoryLimitValue {
  try {
    const value = localStorage.getItem(KEY);
    if (value === '25' || value === 'all') return value;
  } catch {
    // Storage can be blocked; the default still works.
  }
  return '10';
}

/** The `limit` query value of a choice. */
export const historyLimitParam = (value: HistoryLimitValue): number =>
  value === 'all' ? HISTORY_ALL : Number(value);

/** The viewer's choice of history length, kept in the browser (one setting for every history). */
export function useHistoryLimit(): [HistoryLimitValue, (value: HistoryLimitValue) => void] {
  const [value, setValue] = useState<HistoryLimitValue>(stored);
  const update = useCallback((next: HistoryLimitValue) => {
    setValue(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not kept; this visit still uses it.
    }
  }, []);
  return [value, update];
}
