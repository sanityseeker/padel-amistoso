import { useSyncExternalStore } from 'react';

// The interface size is the root font size, as a percentage so it stays relative to the browser's own
// setting. Type and spacing are in rem and follow it; tap targets stay in px so they remain easy to touch.
// The default is stored as an absent key. The inline script in index.html applies the value before first paint.
export const UI_SCALES = ['85', '95', '110'] as const;
export type UiScale = (typeof UI_SCALES)[number];

const SCALE_KEY = 'amistoso-ui-scale';
const DEFAULT_SCALE: UiScale = '95';

function readStored(value: string | null): UiScale {
  if (value === '90') return '85';
  if (value === '100') return '95';
  return UI_SCALES.includes(value as UiScale) ? (value as UiScale) : DEFAULT_SCALE;
}

function readScale(): UiScale {
  try {
    const stored = localStorage.getItem(SCALE_KEY);
    const scale = readStored(stored);
    if (stored === '90' || stored === '100') localStorage.setItem(SCALE_KEY, scale);
    else if (stored !== null && !UI_SCALES.includes(stored as UiScale))
      localStorage.removeItem(SCALE_KEY);
    return scale;
  } catch {
    return DEFAULT_SCALE;
  }
}

let current = readScale();
const listeners = new Set<() => void>();

function apply(scale: UiScale) {
  current = scale;
  document.documentElement.style.fontSize = `${scale}%`;
  listeners.forEach((listener) => listener());
}

export function setUiScale(scale: UiScale) {
  try {
    if (scale === DEFAULT_SCALE) localStorage.removeItem(SCALE_KEY);
    else localStorage.setItem(SCALE_KEY, scale);
  } catch {
    /* The choice still applies to this session. */
  }
  apply(scale);
}

// Keeps other open tabs in step with the choice.
window.addEventListener('storage', (event) => {
  if (event.storageArea === window.localStorage && event.key === SCALE_KEY) {
    const scale = readStored(event.newValue);
    try {
      if (event.newValue === '90' || event.newValue === '100')
        localStorage.setItem(SCALE_KEY, scale);
      else if (event.newValue !== null && !UI_SCALES.includes(event.newValue as UiScale))
        localStorage.removeItem(SCALE_KEY);
    } catch {
      /* The choice still applies to this session. */
    }
    apply(scale);
  }
});

export function useUiScale(): UiScale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
