import { ApiError } from '../api';
import type { Session } from './types';

export const PLAYER_TOKEN = 'padel-player-profile';
export const PLAYER_DATA = 'padel-player-profile-data';

// Profile JWTs and tournament-scoped player JWTs must never be replaced by
// an organizer's token, even when both accounts are logged in on this browser.
export async function playerApi<T>(
  path: string,
  body?: unknown,
  method = 'GET',
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {};
  const credential = token === undefined ? localStorage.getItem(PLAYER_TOKEN) : token;
  if (credential) headers.Authorization = `Bearer ${credential}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail: unknown = data?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg: string }) => d.msg).join('. ')
          : `Request failed (${response.status})`;
    if (response.status === 401 && token === undefined)
      window.dispatchEvent(new Event('player-auth-expired'));
    throw new ApiError(message, response.status);
  }
  return data as T;
}
export function saveSession(session: Session) {
  localStorage.setItem(PLAYER_TOKEN, session.access_token);
  localStorage.setItem(PLAYER_DATA, JSON.stringify(session.profile));
  localStorage.setItem('amistoso-last-page', 'player');
}
export function eventUrl(entry: {
  entity_type: string;
  entity_id: string;
  alias: string | null;
  auto_login_token: string | null;
}) {
  const slug = encodeURIComponent(entry.alias || entry.entity_id);
  if (entry.entity_type === 'registration')
    return `/register/${slug}${entry.auto_login_token ? `?token=${encodeURIComponent(entry.auto_login_token)}` : ''}`;
  return `/tv/${slug}${entry.auto_login_token ? `?player_token=${encodeURIComponent(entry.auto_login_token)}` : ''}`;
}
