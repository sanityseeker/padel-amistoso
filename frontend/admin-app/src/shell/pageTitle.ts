import { matchPath, useLocation, useMatches } from 'react-router-dom';
import { t as tx, useLocale } from '../i18n';
import { useAdminChrome, useAdminRoute } from './layout';

/** Title from the deepest route handle, translated. Used for the document title too. */
export function useRouteTitle(): string | null {
  useLocale();
  const matches = useMatches();
  const found = [...matches].reverse().find((m) => (m.handle as { title?: string })?.title);
  const title = (found?.handle as { title?: string } | undefined)?.title;
  return title ? tx(title) : null;
}

const BAR_PATHS = ['/admin/info'];

/** The page title the top bar shows, or null when the page names itself. */
export function usePageTitle(): string | null {
  const { pathname } = useLocation();
  const adminChrome = useAdminChrome();
  const route = useAdminRoute();
  const routeTitle = useRouteTitle();
  if (BAR_PATHS.some((p) => matchPath({ path: p, end: true }, pathname))) return routeTitle;
  if (adminChrome && route.title) return route.title;
  return null;
}
