import { t, i18n } from './i18n';
export const TOKEN_KEY = 'padel-auth-token';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg: string }) => item.msg).join('. ')
          : `Request failed (${response.status})`;
    if (response.status === 401 && path !== '/auth/login')
      window.dispatchEvent(new Event('auth-expired'));
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export function write<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

export const formatType = (type: string) =>
  t(
    { mexicano: 'Mexicano', group_playoff: 'Group + Play-off', playoff: 'Direct Play-off' }[type] ??
      type,
  );
export const formatPhase = (phase: string) =>
  t(
    {
      groups: 'Group stage',
      mexicano: 'In progress',
      playoffs: 'Play-offs',
      finished: 'Finished',
      setup: 'Ready to start',
    }[phase] ?? phase,
  );
export const money = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat(i18n.language === 'es' ? 'es-ES' : 'en-GB', {
    style: 'currency',
    currency,
  }).format(cents / 100);
