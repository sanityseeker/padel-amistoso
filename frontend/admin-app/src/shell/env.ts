// Synchronous facts about this page load. The backend injects the demo-instance
// class on <html>, so no request is needed before the first paint.
export const isDemoInstance = () => document.documentElement.classList.contains('demo-instance');

export const ADMIN_TOKEN_KEY = 'padel-auth-token';

// Mirrors hasAdminSession() in frontend/shared.js. Only presence is checked here;
// the admin provider validates the token with /auth/me.
export function hasAdminToken(): boolean {
  try {
    return Boolean(
      localStorage.getItem(ADMIN_TOKEN_KEY) || sessionStorage.getItem(ADMIN_TOKEN_KEY),
    );
  } catch {
    return false;
  }
}

export const LAST_PAGE_KEY = 'amistoso-last-page';
export function lastPage(): string | null {
  try {
    return localStorage.getItem(LAST_PAGE_KEY);
  } catch {
    return null;
  }
}
export function rememberPage(page: 'events' | 'player' | 'admin') {
  try {
    localStorage.setItem(LAST_PAGE_KEY, page);
  } catch {
    /* Preference only. */
  }
}
