import { Navigate, useLocation } from 'react-router-dom';
import { lazy } from 'react';
import { hostClubSlug, readMeta } from '../features/public/meta';
import { NotFound } from './NotFound';
import { hasAdminToken, isDemoInstance, lastPage } from './env';

// Legacy cold-start rule (frontend/index.html): organizers go to admin, everyone
// else to the page they used last, defaulting to Events. The installed PWA opens
// on "/" (manifest start_url), so anonymous visitors never see an admin login wall.
const ClubLanding = lazy(() =>
  import('../features/club/ClubLanding').then((m) => ({ default: m.ClubHostLanding })),
);

export function RootRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  // On a club subdomain the server hands over the club: its landing page is this address.
  if (hostClubSlug()) return <ClubLanding />;
  // The server answered "no such club" for this host and told the shell where home is.
  if (readMeta('amistoso-home')) return <NotFound />;
  if (params.has('reset_token')) return <Navigate to={`/admin/account/reset${search}`} replace />;
  if (params.has('invite_token')) return <Navigate to={`/admin/account/invite${search}`} replace />;
  const target = hasAdminToken()
    ? '/admin'
    : lastPage() === 'player' && !isDemoInstance()
      ? '/player'
      : '/events';
  return <Navigate to={target} replace />;
}
