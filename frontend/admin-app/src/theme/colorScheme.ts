import {
  localStorageColorSchemeManager,
  type MantineColorScheme,
  type MantineColorSchemeManager,
} from '@mantine/core';

// Reuse the legacy preference and migrate its older key. The toggle writes only
// light/dark, which the original pages understand; an unset key follows the OS.
try {
  const old = localStorage.getItem('padel-theme');
  if (!localStorage.getItem('amistoso-theme') && (old === 'light' || old === 'dark')) {
    localStorage.setItem('amistoso-theme', old);
    localStorage.removeItem('padel-theme');
  }
} catch {
  /* Browsers without storage still support the current session theme. */
}
const THEME_KEY = 'amistoso-theme';
const storedScheme = localStorageColorSchemeManager({ key: THEME_KEY });
// "Auto" is stored as an absent key, which is what the legacy pages expect
// (an unset key follows the OS), so it is never written as a literal value.
let onRemoved: ((event: StorageEvent) => void) | null = null;
export const colorSchemeManager: MantineColorSchemeManager = {
  ...storedScheme,
  set(value: MantineColorScheme) {
    if (value !== 'auto') return storedScheme.set(value);
    try {
      localStorage.removeItem(THEME_KEY);
    } catch {
      /* The choice still applies to this session. */
    }
  },
  subscribe(onUpdate) {
    storedScheme.subscribe(onUpdate);
    // Another tab choosing "Auto" removes the key; Mantine ignores null values.
    onRemoved = (event) => {
      if (event.storageArea === window.localStorage && event.key === THEME_KEY && !event.newValue)
        onUpdate('auto');
    };
    window.addEventListener('storage', onRemoved);
  },
  unsubscribe() {
    storedScheme.unsubscribe();
    if (onRemoved) window.removeEventListener('storage', onRemoved);
  },
};
