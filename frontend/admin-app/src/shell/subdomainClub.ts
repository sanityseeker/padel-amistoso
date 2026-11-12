import { useQuery } from '@tanstack/react-query';
import { getClubSubdomain } from '../club-context';
import { playerApi } from '../player/api';

// On `{club}.{domain}/admin` the organizer works inside one club: the Hub lists only its events, the
// create forms are locked to it, and the account menu links to the platform admin on the apex
// domain. This is a convenience only; every permission check stays on the server.

export interface SubdomainClub {
  club_id: string;
  community_id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
}

export function useSubdomainClub() {
  const slug = getClubSubdomain();
  const club = useQuery({
    queryKey: ['public', 'subdomain-club', slug],
    enabled: !!slug,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const [found, config] = await Promise.all([
        playerApi<SubdomainClub>(
          `/clubs/by-slug/${encodeURIComponent(slug ?? '')}`,
          undefined,
          'GET',
          null,
        ),
        playerApi<{ apex_origin?: string | null }>('/config', undefined, 'GET', null).catch(
          () => null,
        ),
      ]);
      const apex = new URL(config?.apex_origin || window.location.origin);
      if (!config?.apex_origin) {
        apex.hostname = window.location.hostname.split('.').slice(1).join('.') || apex.hostname;
        apex.port = window.location.port;
      }
      apex.pathname = '/admin';
      return { club: found, apexUrl: apex.href };
    },
  });
  return slug ? (club.data ?? null) : null;
}
