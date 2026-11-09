// The one source of the sport coding: padel is blue, tennis is green, in both color schemes. Put the
// `data-sport` attribute on a page, card or row (`sportProps`) and everything inside reads
// `var(--sport-accent)` (theme/sport.css); a Mantine component that needs a color name takes
// `sportColor(sport).mantine`. Unknown sports fall back to padel. Pages built later (TV,
// registration, club) use the same two helpers.
export type SportKey = 'padel' | 'tennis';

export const sportOf = (sport?: string | null): SportKey =>
  sport === 'tennis' ? 'tennis' : 'padel';

export function sportColor(sport?: string | null) {
  const key = sportOf(sport);
  return {
    key,
    /** Mantine color name for `color=` props (`court` is the blue ramp, `tennis` the green one). */
    mantine: key === 'tennis' ? ('tennis' as const) : ('court' as const),
    /** CSS value that follows the nearest `data-sport` scope. */
    css: 'var(--sport-accent)',
  };
}

/** Spread on an element to scope the sport accent to it. Without a known sport nothing is set. */
export const sportProps = (sport?: string | null) =>
  sport ? ({ 'data-sport': sportOf(sport) } as const) : ({} as const);
