import { playerApi } from './player/api';

const RESERVED = new Set([
  'admin',
  'tv',
  'player',
  'register',
  'api',
  'www',
  'app',
  'mail',
  'ftp',
  'static',
  'assets',
  'demo',
]);

// Port of getClubSubdomain() in frontend/shared.js: purely hostname based, so it
// can be evaluated synchronously (the header needs it on first paint).
export function getClubSubdomain(host = window.location.hostname): string | null {
  const name = (host || '').toLowerCase();
  if (!name || name === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(name)) return null;
  const parts = name.split('.');
  const localhostChild = parts.length >= 2 && parts[parts.length - 1] === 'localhost';
  if (parts.length < 3 && !localhostChild) return null;
  const label = parts[0];
  if (!label || RESERVED.has(label) || !/^[a-z0-9-]{2,30}$/.test(label)) return null;
  return label;
}

export interface HostClub {
  club_id: string;
  name: string;
}

// Resolves the club for the current host using the configured apex domain, the
// same way the Player Hub scopes its stats on a club subdomain.
export async function resolveHostClub(): Promise<HostClub | null> {
  const config = await playerApi<{ amistoso_domain: string | null }>(
    '/config',
    undefined,
    'GET',
    null,
  );
  const host = window.location.hostname;
  if (host === 'localhost' || /^[\d.]+$/.test(host)) return null;
  const suffix = config.amistoso_domain ? `.${config.amistoso_domain}` : null;
  // Without a configured domain, the same hostname rule as the header (it also knows `club.localhost`).
  const slug = suffix
    ? host.endsWith(suffix)
      ? host.slice(0, -suffix.length)
      : ''
    : (getClubSubdomain(host) ?? '');
  if (!slug || slug.includes('.') || ['admin', 'www', 'demo', 'app'].includes(slug)) return null;
  return playerApi<HostClub>(`/clubs/by-slug/${encodeURIComponent(slug)}`, undefined, 'GET', null);
}
