import { matchPath, useLocation, useMatches } from 'react-router-dom';
import { t as tx, useLocale } from '../i18n';
import { usePlayerSession } from '../player/session';
import { useAdminChrome, useAdminRoute } from './layout';

/** Title from the deepest route handle, translated. Used for the document title too. */
export function useRouteTitle(): string | null {
  useLocale();
  const matches = useMatches();
  const found = [...matches].reverse().find((m) => (m.handle as { title?: string })?.title);
  const title = (found?.handle as { title?: string } | undefined)?.title;
  return title ? tx(title) : null;
}

// Non-admin pages whose title the top bar shows. Entity pages (event, club, sign-up, TV) name
// themselves and stay out.
const BAR_PATHS = ['/events', '/player/matches', '/player/ratings', '/player/me', '/admin/info'];

/** The page title the top bar shows, or null when the page names itself. */
export function usePageTitle(): string | null {
  const { pathname } = useLocation();
  const adminChrome = useAdminChrome();
  const route = useAdminRoute();
  const routeTitle = useRouteTitle();
  const hub = usePlayerSession();
  // The Hub's own page; signed out, /player is the login card, which names itself.
  if (pathname === '/player' && hub.token) return routeTitle;
  if (BAR_PATHS.some((p) => matchPath({ path: p, end: true }, pathname))) return routeTitle;
  if (adminChrome && route.title) return route.title;
  return null;
}
