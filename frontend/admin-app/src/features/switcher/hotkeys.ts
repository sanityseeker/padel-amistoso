import { useEffect } from 'react';
import { useHotkeys } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useShellUi } from '../../shell/ShellUi';
import { adminDestinations, EXTRA_CHORDS } from './destinations';
import { byRecency, openPath, useOpenItems, orderItems } from './openItems';
import { workspace } from './workspace';

export const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
/** Modifier for dock slots. Alt+digit on Windows and Linux; Ctrl+digit on macOS, where Option+digit types a symbol. */
export const modifierLabel = () => (isMac() ? 'Ctrl' : 'Alt');

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
};

// Keyboard shortcuts for the organizer console.
//  - Modified combos (dock slots, neighbours, back, collapse) go through Mantine's useHotkeys and work
//    everywhere, including inside inputs.
//  - Bare keys (g-chords, j/k/s/Enter, /, ?) are ignored while focus is in an input, textarea, select or
//    editable area and while any dialog is open, so a stray key can never move the organizer away from
//    a match mid-score. Bare digits are not bound at all.
export function useShellHotkeys({
  enabled,
  toggleDock,
}: {
  enabled: boolean;
  toggleDock: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const items = useOpenItems();
  const { setShortcutsOpen } = useShellUi();
  const ordered = orderItems(items);
  // Handlers read the live location: a key can arrive in the few milliseconds between a navigation
  // and the re-render that follows it.
  const here = () => window.location.pathname;
  const jump = (at: number) => {
    const target = ordered[at];
    if (target) navigate(openPath(target));
  };
  const step = (delta: 1 | -1) => {
    if (!ordered.length) return;
    const activeAt = ordered.findIndex((i) => openPath(i) === here());
    const from = activeAt < 0 ? (delta === 1 ? -1 : 0) : activeAt;
    jump((from + delta + ordered.length) % ordered.length);
  };
  const back = () => {
    const previous = byRecency(items).find((i) => openPath(i) !== here());
    if (previous) navigate(openPath(previous));
  };
  const mod = isMac() ? 'ctrl' : 'alt';
  useHotkeys(
    enabled
      ? [
          ...Array.from(
            { length: 8 },
            (_, i): [string, () => void, { preventDefault: boolean }] => [
              `${mod}+${i + 1}`,
              () => jump(i),
              { preventDefault: true },
            ],
          ),
          ['alt+ArrowUp', () => step(-1), { preventDefault: true }],
          ['alt+ArrowDown', () => step(1), { preventDefault: true }],
          ['alt+Backspace', back, { preventDefault: true }],
          ['mod+B', toggleDock, { preventDefault: true }],
        ]
      : [],
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    let armed = 0;
    const chords = new Map([
      ...adminDestinations(user?.role === 'admin').flatMap((d) =>
        d.chord ? [[d.chord, d.to] as const] : [],
      ),
      ...EXTRA_CHORDS.map((c) => [c.chord, c.to] as const),
    ]);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typing(event.target) || document.querySelector('[role="dialog"]')) return;
      if (armed) {
        window.clearTimeout(armed);
        armed = 0;
        const to = chords.get(event.key.toLowerCase());
        if (to) {
          event.preventDefault();
          navigate(to);
        }
        return;
      }
      const ws = workspace();
      const key = event.key === '/' && event.shiftKey ? '?' : event.key;
      switch (key) {
        case 'g':
          armed = window.setTimeout(() => (armed = 0), 1200);
          break;
        case '?':
          event.preventDefault();
          setShortcutsOpen(true);
          break;
        case 'j':
        case 'k':
          if (ws) {
            event.preventDefault();
            ws.moveSelection(key === 'j' ? 1 : -1);
          }
          break;
        case 's':
          if (ws) {
            event.preventDefault();
            ws.scoreSelected();
          }
          break;
        case 'Enter':
          // Enter on a focused button or link keeps its normal meaning.
          if (ws && event.target === document.body) {
            event.preventDefault();
            ws.scoreSelected();
          }
          break;
        case '/':
          if (ws) {
            event.preventDefault();
            ws.focusFilter();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(armed);
    };
  }, [enabled, navigate, setShortcutsOpen, user?.role]);
}
