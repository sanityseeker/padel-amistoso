import { useCallback, useSyncExternalStore } from 'react';

// Which announcements a player has seen, per tournament, in this browser only. The value is the
// `created_at` of the newest announcement the player has seen (server time, so the device clock does
// not matter). The event page writes it; the Hub card reads it for its "New" state and may also write
// it (mark seen). Never a padel-auth-* key: this is a convenience, not part of any session.
const PREFIX = 'amistoso-seen-announcement-';
const CHANGED = 'amistoso:announcement-seen';

export const seenKey = (tid: string) => `${PREFIX}${tid}`;

function read(tid: string): string | null {
  try {
    return localStorage.getItem(seenKey(tid));
  } catch {
    return null;
  }
}

/** Remember that the player saw everything up to `newest` (an ISO time). Never moves backwards. */
export function markAnnouncementsSeen(tid: string, newest: string | null | undefined) {
  if (!newest) return;
  const current = read(tid);
  if (current && Date.parse(current) >= Date.parse(newest)) return;
  try {
    localStorage.setItem(seenKey(tid), newest);
  } catch {
    /* Storage blocked: the "New" state simply stays. */
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: tid }));
}

function subscribe(notify: () => void) {
  window.addEventListener(CHANGED, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(CHANGED, notify);
    window.removeEventListener('storage', notify);
  };
}

/** Whether the tournament has an announcement newer than the player's last view, plus "mark seen". */
export function useAnnouncementSeen(tid: string, newest: string | null | undefined) {
  const seen = useSyncExternalStore(subscribe, () => read(tid));
  // A missing or unreadable value counts as "not seen yet".
  const isNew = !!newest && !(Date.parse(newest) <= Date.parse(seen ?? ''));
  const markSeen = useCallback(() => markAnnouncementsSeen(tid, newest), [tid, newest]);
  return { isNew, markSeen };
}
