import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import classes from './ZoomableImage.module.css';

export interface ZoomableImageHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

interface View {
  s: number;
  x: number;
  y: number;
}

const MIN = 1;
const MAX = 5;
const STEP = 1.25;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 10;

const clampScale = (s: number) => Math.min(MAX, Math.max(MIN, s));

// A picture that zooms and pans in place: two-finger pinch and double-tap on touch screens,
// ctrl + wheel (trackpad pinch) and double-click with a mouse, drag to pan once zoomed. At 1x a
// one-finger swipe still scrolls the page (touch-action: pan-x pan-y); zoomed in, it pans the image.
export function ZoomableImage({
  src,
  alt,
  maxHeight,
  className,
  imageClassName,
  onScaleChange,
  ref,
  testId,
}: {
  src: string;
  alt: string;
  /** CSS max-height of the picture at 1x, e.g. 560 or 'calc(100dvh - 8rem)'. */
  maxHeight?: number | string;
  className?: string;
  imageClassName?: string;
  onScaleChange?: (scale: number) => void;
  ref?: Ref<ZoomableImageHandle>;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setViewState] = useState<View>({ s: 1, x: 0, y: 0 });
  const current = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    s: number;
    x: number;
    y: number;
    px: number;
    py: number;
    dist: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // Some mobile browsers also send dblclick after a double tap; the tap handler already toggled.
  const lastPointer = useRef('mouse');

  // Keep the picture over the box: a zoomed image may not leave a gap at an edge, and an image
  // smaller than the box stays inside it.
  const clamp = useCallback((v: View): View => {
    const b = box.current;
    const i = img.current;
    if (!b || !i) return v;
    const fit = (t: number, offset: number, size: number, room: number) => {
      const a = -offset;
      const c = room - offset - size * v.s;
      return Math.min(Math.max(a, c), Math.max(Math.min(a, c), t));
    };
    return {
      s: v.s,
      x: fit(v.x, i.offsetLeft, i.offsetWidth, b.clientWidth),
      y: fit(v.y, i.offsetTop, i.offsetHeight, b.clientHeight),
    };
  }, []);

  const setView = useCallback(
    (v: View) => {
      const next = v.s <= MIN ? { s: 1, x: 0, y: 0 } : clamp(v);
      current.current = next;
      setViewState(next);
    },
    [clamp],
  );

  // Scale to `s` keeping the box point (px, py) still.
  const zoomAt = useCallback(
    (s: number, px: number, py: number, from: View = current.current) => {
      const next = clampScale(s);
      const k = next / from.s;
      setView({ s: next, x: px - (px - from.x) * k, y: py - (py - from.y) * k });
    },
    [setView],
  );

  const centre = () => {
    const b = box.current;
    return b ? [b.clientWidth / 2, b.clientHeight / 2] : [0, 0];
  };

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAt(current.current.s * STEP, ...(centre() as [number, number])),
      zoomOut: () => zoomAt(current.current.s / STEP, ...(centre() as [number, number])),
      reset: () => setView({ s: 1, x: 0, y: 0 }),
    }),
    [zoomAt, setView],
  );

  useEffect(() => {
    setView({ s: 1, x: 0, y: 0 });
  }, [src, setView]);

  useEffect(() => {
    onScaleChange?.(view.s);
  }, [view.s, onScaleChange]);

  // ctrl + wheel is how desktop browsers report a trackpad pinch. It needs a non-passive listener to
  // stop the page zoom; a plain wheel keeps scrolling the page. Safari's own gesture events are
  // cancelled too, so a pinch over the picture never zooms the whole page.
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = b.getBoundingClientRect();
      zoomAt(current.current.s * Math.exp(-e.deltaY / 200), e.clientX - r.left, e.clientY - r.top);
    };
    const stop = (e: Event) => e.preventDefault();
    b.addEventListener('wheel', wheel, { passive: false });
    b.addEventListener('gesturestart', stop);
    b.addEventListener('gesturechange', stop);
    return () => {
      b.removeEventListener('wheel', wheel);
      b.removeEventListener('gesturestart', stop);
      b.removeEventListener('gesturechange', stop);
    };
  }, [zoomAt]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Start (or restart) a gesture from the pointers now down: one pointer pans, two pinch.
  const begin = (moved: boolean) => {
    const pts = [...pointers.current.values()];
    const v = current.current;
    if (!pts.length) {
      gesture.current = null;
      return;
    }
    const px = pts.length > 1 ? (pts[0].x + pts[1].x) / 2 : pts[0].x;
    const py = pts.length > 1 ? (pts[0].y + pts[1].y) / 2 : pts[0].y;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { s: v.s, x: v.x, y: v.y, px, py, dist, moved };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, local(e));
    e.currentTarget.setPointerCapture(e.pointerId);
    begin(pointers.current.size > 1);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length > 1 && g.dist > 0) {
      const px = (pts[0].x + pts[1].x) / 2;
      const py = (pts[0].y + pts[1].y) / 2;
      const s = clampScale(g.s * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist));
      const k = s / g.s;
      g.moved = true;
      setView({ s, x: px - (g.px - g.x) * k, y: py - (g.py - g.y) * k });
    } else if (pts.length === 1) {
      const dx = pts[0].x - g.px;
      const dy = pts[0].y - g.py;
      if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
      if (current.current.s > MIN) setView({ s: g.s, x: g.x + dx, y: g.y + dy });
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const at = pointers.current.get(e.pointerId)!;
    pointers.current.delete(e.pointerId);
    const tapped = e.type === 'pointerup' && !gesture.current?.moved && !pointers.current.size;
    begin(true);
    if (!tapped || e.pointerType === 'mouse') return;
    const last = lastTap.current;
    const now = e.timeStamp;
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(at.x - last.x, at.y - last.y) < 30) {
      lastTap.current = null;
      toggle(at.x, at.y);
    } else lastTap.current = { t: now, x: at.x, y: at.y };
  };

  const toggle = (x: number, y: number) =>
    current.current.s > MIN ? setView({ s: 1, x: 0, y: 0 }) : zoomAt(DOUBLE_TAP_SCALE, x, y);

  const zoomed = view.s > MIN;
  return (
    <div
      ref={box}
      className={[classes.box, className].filter(Boolean).join(' ')}
      data-zoomed={zoomed || undefined}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={(e) => {
        if (lastPointer.current !== 'mouse') return;
        const p = local(e);
        toggle(p.x, p.y);
      }}
    >
      <img
        ref={img}
        src={src}
        alt={alt}
        draggable={false}
        className={[classes.image, imageClassName].filter(Boolean).join(' ')}
        style={{
          maxHeight,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
        }}
      />
    </div>
  );
}
