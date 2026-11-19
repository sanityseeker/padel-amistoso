import { useEffect } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { baseColors } from '../theme';

// Mirrors the resolved scheme onto every <meta theme-color> so the browser chrome follows the
// preference. index.html declares one meta per OS scheme for the first paint; an explicit choice
// overrides both.
export function ThemeSync() {
  const scheme = useComputedColorScheme('light');
  useEffect(() => {
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', baseColors[scheme].bg));
  }, [scheme]);
  return null;
}
