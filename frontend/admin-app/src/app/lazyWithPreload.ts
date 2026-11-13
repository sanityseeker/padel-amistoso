import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// React.lazy takes any component type; the props are checked where the route renders it.
type AnyComponent = ComponentType<any>;

export type PreloadableComponent<T extends AnyComponent> = LazyExoticComponent<T> & {
  /** Starts loading the route's chunk now (idle time, hover, focus, touch). Safe to call often. */
  preload: () => Promise<unknown>;
};

/** `React.lazy` with a `.preload()`. The import promise is shared with the lazy component, so a
 *  preloaded route renders without suspending. A failed import is forgotten, so the next preload or
 *  render tries again (and main.tsx's `vite:preloadError` reload still applies after a deploy). */
export function lazyWithPreload<T extends AnyComponent>(
  load: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let pending: Promise<{ default: T }> | null = null;
  const start = () => {
    if (!pending)
      pending = load().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
  const component = lazy(start) as PreloadableComponent<T>;
  component.preload = () => start().catch(() => undefined);
  return component;
}
