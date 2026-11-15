import { TOKEN_KEY } from '../../api';

/**
 * The organizer's token as request headers, for fetches that cannot go through `api` (a server-drawn
 * picture). Module-level, so hooks can list it as a stable dependency.
 */
export function authHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
