import { useEffect } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { legacyColors } from '../theme';

// Mirrors the resolved scheme onto <html data-theme> and every <meta theme-color> so the
// legacy pages' CSS and the browser chrome follow the React preference. index.html declares one
// meta per OS scheme for the first paint; an explicit choice overrides both.
export function ThemeSync() {
  const scheme = useComputedColorScheme('light');
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', legacyColors[scheme].bg));
  }, [scheme]);
  return null;
}
