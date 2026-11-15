import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Button, Group, ScrollArea, Stack, Tooltip } from '@mantine/core';
import { IconArrowsHorizontal, IconMinus, IconPlus } from '@tabler/icons-react';
import { t as tx, useLocale } from '../i18n';
import { SchemaSvg } from './SchemaSvg';
import classes from './SchemaViewer.module.css';

/** Zoom steps relative to the drawing's own size (its viewBox, in points). */
const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const PT_TO_PX = 4 / 3;

/** Width of the drawing at 100%, in CSS pixels, from the SVG's viewBox. */
function naturalWidth(markup: string): number | null {
  const m = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) [\d.]+"/.exec(markup);
  return m ? Number(m[1]) * PT_TO_PX : null;
}

/**
 * A server-drawn bracket (sanitized `theme=css` SVG) with a zoom bar. "Fit" fills the width; a zoom
 * step draws it at that share of its own size inside a horizontal ScrollArea, so a large bracket stays
 * readable and is swiped sideways on a phone while the page scrolls down as usual. Ctrl + wheel (a
 * trackpad pinch) steps the zoom too. `actions` adds buttons to the right of the bar (expand, save).
 */
export function SchemaViewer({
  markup,
  label,
  actions,
  onOpen,
  testId,
}: {
  markup: string;
  label: string;
  actions?: ReactNode;
  /** Clicking the picture while it fits the width (e.g. open a full-screen view). */
  onOpen?: () => void;
  testId?: string;
}) {
  useLocale();
  const [zoom, setZoom] = useState<number | null>(null); // null = fit to width
  const natural = naturalWidth(markup);
  const viewport = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // A big bracket on a narrow screen would shrink below half size to fit, too small to read: it opens
  // at a readable step instead and scrolls sideways. Decided once, so a live update keeps the zoom.
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current) return;
    const width = viewport.current?.clientWidth;
    if (!natural || !width) return;
    decided.current = true;
    if (width / natural < 0.5) setZoom(0.75);
  }, [natural]);

  // The current scale as a share of the natural size, also when fitting the width.
  const current = () => {
    if (zoom !== null) return zoom;
    const width = viewport.current?.clientWidth;
    return natural && width ? width / natural : 1;
  };
  const step = (dir: 1 | -1) => {
    const now = current();
    const next =
      dir > 0
        ? STEPS.find((s) => s > now + 0.01)
        : [...STEPS].reverse().find((s) => s < now - 0.01);
    setZoom(next ?? (dir > 0 ? STEPS[STEPS.length - 1] : STEPS[0]));
  };
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  // ctrl + wheel is how desktop browsers report a trackpad pinch; it needs a non-passive listener.
  // A pinch sends many small events, so the movement adds up to one zoom step at a time.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let travel = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      travel += e.deltaY;
      if (Math.abs(travel) < 60) return;
      stepRef.current(travel < 0 ? 1 : -1);
      travel = 0;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const width = zoom !== null && natural ? `${Math.round(natural * zoom)}px` : '100%';
  const picture = (
    <SchemaSvg
      markup={markup}
      label={label}
      style={{ width, maxWidth: zoom === null ? '100%' : 'none' }}
      className={classes.picture}
    />
  );
  return (
    <Stack gap={6} data-testid={testId} ref={box}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <ActionIcon.Group aria-label={tx('Zoom')}>
          <ActionIcon
            variant="default"
            size="md"
            aria-label={tx('Zoom out')}
            onClick={() => step(-1)}
          >
            <IconMinus size={14} aria-hidden />
          </ActionIcon>
          <Tooltip label={tx('Fit to width')} disabled={zoom === null}>
            <Button
              variant="default"
              size="compact-sm"
              h={28}
              miw={64}
              aria-label={tx('Fit to width')}
              aria-pressed={zoom === null}
              onClick={() => setZoom(null)}
              leftSection={
                zoom === null ? <IconArrowsHorizontal size={14} aria-hidden /> : undefined
              }
              className={classes.level}
            >
              {zoom === null ? tx('Fit') : `${Math.round(zoom * 100)}%`}
            </Button>
          </Tooltip>
          <ActionIcon
            variant="default"
            size="md"
            aria-label={tx('Zoom in')}
            onClick={() => step(1)}
          >
            <IconPlus size={14} aria-hidden />
          </ActionIcon>
        </ActionIcon.Group>
        {actions && (
          <Group gap="xs" wrap="nowrap">
            {actions}
          </Group>
        )}
      </Group>
      <ScrollArea type="auto" scrollbars="x" offsetScrollbars viewportRef={viewport}>
        {zoom === null && onOpen ? (
          <button
            type="button"
            className={classes.open}
            onClick={onOpen}
            aria-label={`${label}: ${tx('Enlarge')}`}
          >
            {picture}
          </button>
        ) : (
          picture
        )}
      </ScrollArea>
    </Stack>
  );
}
