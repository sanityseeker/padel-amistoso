import type { CSSProperties, Ref } from 'react';
import classes from './SchemaSvg.module.css';

const DROP = 'script, style, foreignObject, iframe, object, embed, a, image, audio, video';

/**
 * Clean a bracket SVG from the server before it goes into the page.
 *
 * The server draws it with matplotlib (`theme=css`) and escapes team names, so this is a second
 * layer: drop anything that can run code, load another resource or style the rest of the page
 * (matplotlib adds a global `*{...}` style rule), keep `#id` links only. Width and height go, so
 * the picture scales to its box through the viewBox. Returns null for anything that is not an SVG.
 */
export function sanitizeSchemaSvg(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  svg.querySelectorAll(DROP).forEach((node) => node.remove());
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (name.endsWith('href') && !attr.value.startsWith('#')))
        el.removeAttribute(attr.name);
    }
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  // The wrapper carries role="img" and the label; the drawing itself is one image, not two.
  svg.setAttribute('aria-hidden', 'true');
  return new XMLSerializer().serializeToString(svg);
}

/**
 * A server-drawn bracket SVG (already passed through `sanitizeSchemaSvg`) placed in the page, so its
 * `--br-*` colours and font come from the app theme and follow a theme switch at once.
 */
export function SchemaSvg({
  markup,
  label,
  className,
  style,
  ref,
  testId,
}: {
  markup: string;
  label: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  testId?: string;
}) {
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={[classes.schema, className].filter(Boolean).join(' ')}
      style={style}
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
