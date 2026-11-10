import { useSyncExternalStore } from 'react';

// Installability state for the "Install app" affordances. This module is imported
// by main.tsx before React renders: `beforeinstallprompt` can fire before any
// component mounts, and it fires only once per page load.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export type InstallState = 'prompt' | 'ios' | 'hidden';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

// No iOS browser has an install event, but since iOS 16.4 Safari, Chrome, Edge and Firefox all add a
// page to the home screen from their Share menu, so they get the how-to instead. In-app browsers
// (Instagram, WhatsApp, Facebook...) cannot; they are the ones without "Safari/" in the user agent.
export function isIosBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPod|iPad/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/FBAN|FBAV|Instagram|Line\//.test(ua);
}

function compute(): InstallState {
  if (installed || isStandalone()) return 'hidden';
  if (deferred) return 'prompt';
  return isIosBrowser() ? 'ios' : 'hidden';
}

let snapshot: InstallState = compute();
function emit() {
  snapshot = compute();
  listeners.forEach((listener) => listener());
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  emit();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  installed = true;
  emit();
});
try {
  window.matchMedia('(display-mode: standalone)').addEventListener('change', emit);
} catch {
  /* Older browsers: the state is simply computed once. */
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => 'hidden' as const,
  );
}

/** Shows the browser's install dialog. Resolves to the user's choice, or null if unavailable. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const event = deferred;
  if (!event) return null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  deferred = null;
  emit();
  return outcome;
}
