import { matchPath, useLocation } from 'react-router-dom';
import { useMediaQuery } from '@mantine/hooks';
import { useAuth } from '../auth';
import { t as tx } from '../i18n';

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

// Breakpoints from the redesign: phone < 48em, tablet 48em to 74.99em, desktop from 75em, wide from 88em.
// Exactly one navigation renderer is mounted per mode (never CSS hiding), so no link appears twice.
export function useLayoutMode(): { mode: LayoutMode; wide: boolean } {
  const options = { getInitialValueInEffect: false } as const;
  const notPhone = useMediaQuery('(min-width: 48em)', false, options);
  const desktop = useMediaQuery('(min-width: 75em)', false, options);
  const wide = useMediaQuery('(min-width: 88em)', false, options);
  return { mode: desktop ? 'desktop' : notPhone ? 'tablet' : 'phone', wide: !!wide };
}

export const isAdminPath = (pathname: string) =>
  pathname === '/admin' || pathname.startsWith('/admin/');
export const isAccountPath = (pathname: string) => pathname.startsWith('/admin/account');

/** The signed-in organizer console (dock, bottom tabs, palette data). Login and account pages stay plain. */
export function useAdminChrome(): boolean {
  const { pathname } = useLocation();
  const { user } = useAuth();
  return !!user && isAdminPath(pathname) && !isAccountPath(pathname);
}

export type AdminSection =
  'tournaments' | 'workspace' | 'lobby' | 'new' | 'clubs' | 'players' | 'users' | 'other';
export interface AdminRoute {
  section: AdminSection;
  id?: string;
  /** Static title for list pages; workspaces use the item name. */
  title: string;
  /** Deeper than a list: the phone header shows a back button. */
  deep: boolean;
}

export function useAdminRoute(): AdminRoute {
  const { pathname } = useLocation();
  const tournament = matchPath('/admin/t/:id', pathname)?.params.id;
  if (tournament) return { section: 'workspace', id: tournament, title: '', deep: true };
  const lobby = matchPath('/admin/lobby/:id', pathname)?.params.id;
  if (lobby) return { section: 'lobby', id: lobby, title: '', deep: true };
  if (pathname === '/admin/new') return { section: 'new', title: tx('New tournament'), deep: true };
  if (pathname === '/admin/clubs')
    return { section: 'clubs', title: tx('Clubs & communities'), deep: false };
  if (pathname.startsWith('/admin/clubs/'))
    return { section: 'clubs', title: tx('Clubs & communities'), deep: true };
  if (pathname === '/admin/players' || pathname.startsWith('/admin/players/'))
    return { section: 'players', title: tx('Player profiles'), deep: true };
  if (pathname === '/admin/users') return { section: 'users', title: tx('Users'), deep: true };
  if (pathname === '/admin')
    return { section: 'tournaments', title: tx('Tournaments'), deep: false };
  return { section: 'other', title: tx('Administration'), deep: true };
}
