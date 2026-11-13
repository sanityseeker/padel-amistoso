import { lazy, Suspense } from 'react';
import { useHotkeys } from '@mantine/hooks';
import { loadPalette, openPalette, usePaletteWanted } from './paletteOpen';

const PaletteSpotlight = lazy(loadPalette);

// The command palette's shell: the Mod+K shortcut (also inside text fields, as before) and, from the
// first request on, the palette itself. Its code and @mantine/spotlight stay out of the first load.
export function Palette() {
  const wanted = usePaletteWanted();
  useHotkeys([['mod+K', openPalette]], []);
  return wanted ? (
    <Suspense fallback={null}>
      <PaletteSpotlight />
    </Suspense>
  ) : null;
}
