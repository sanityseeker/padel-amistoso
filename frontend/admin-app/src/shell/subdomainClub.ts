import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getClubSubdomain } from '../club-context';
import { playerApi } from '../player/api';

// On `{club}.{domain}/admin` the organizer works inside one club: a banner names it and the create
// forms are locked to it. This is a convenience only; every permission check stays on the server.
const DISMISS_KEY = 'admin-subdomain-banner-dismissed';
const listeners = new Set<() => void>();
const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};
let dismissed = readDismissed();

export interface SubdomainClub {
  club_id: string;
  community_id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
}

export function useSubdomainClub() {
  const slug = getClubSubdomain();
  const hidden = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dismissed,
  );
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
  if (!slug || hidden || !club.data) return null;
  return {
    ...club.data,
    dismiss: () => {
      dismissed = true;
      try {
        sessionStorage.setItem(DISMISS_KEY, '1');
      } catch {
        /* Dismissed for this visit only. */
      }
      listeners.forEach((listener) => listener());
    },
  };
}
