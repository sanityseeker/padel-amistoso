import { useLocale } from './i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, TOKEN_KEY, write } from './api';
import { hasAdminToken } from './shell/env';
import type { User } from './types';
interface Auth {
  user: User | null;
  /** An admin token is stored in this browser (it may still be unvalidated). */
  hasToken: boolean;
  /** Username remembered at login, available before the token is validated. */
  username: string;
  /** A stored token is being checked (only happens on /admin routes). */
  loading: boolean;
  /** Validate the stored token with /auth/me. Called by the admin gate, never at boot. */
  validate: () => void;
  login: (username: string, password: string) => Promise<void>;
  /** Demo instance only: mint a throwaway account and sign in as it (POST /auth/demo). */
  startDemo: () => Promise<void>;
  /** Replace the cached profile after the user changed a setting. */
  setProfile: (profile: User) => void;
  logout: () => void;
}
export const DEMO_PASSPHRASE_KEY = 'padel-demo-passphrase';
export const DEMO_LAST_KEY = 'padel-demo-last';
const Context = createContext<Auth | null>(null);
const storedUsername = () => {
  try {
    return localStorage.getItem('padel-auth-username') || '';
  } catch {
    return '';
  }
};
export function AuthProvider({ children }: { children: ReactNode }) {
  useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [hasToken, setHasToken] = useState(hasAdminToken);
  const [checked, setChecked] = useState(false);
  const [username, setUsername] = useState(storedUsername);
  const client = useQueryClient();
  // Only admin data is dropped: a Player Hub session in the same runtime keeps its cache.
  const clearAdminData = useCallback(() => client.removeQueries({ queryKey: ['admin'] }), [client]);
  const logout = useCallback(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('padel-auth-')) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('padel-auth-')) sessionStorage.removeItem(key);
    sessionStorage.removeItem(DEMO_PASSPHRASE_KEY);
    setUser(null);
    setHasToken(false);
    setUsername('');
    setChecked(true);
    clearAdminData();
  }, [clearAdminData]);
  // The token is validated lazily by the admin gate. A stored token that an admin
  // route never looks at is left alone, so browsing Events or the Player Hub cannot
  // clear an organizer session as a side effect.
  const validate = useCallback(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setUser(null);
      setHasToken(false);
      setChecked(true);
      return;
    }
    setHasToken(true);
    api<User>('/auth/me')
      .then((profile) => {
        setUser(profile);
        setUsername(profile.username);
      })
      .catch(logout)
      .finally(() => setChecked(true));
  }, [logout]);
  useEffect(() => {
    const expired = () => logout();
    // Another tab logged in or out: re-validate in place instead of reloading, so a
    // Player Hub view open in this tab keeps its state.
    const changed = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY) return;
      clearAdminData();
      setUser(null);
      setHasToken(Boolean(event.newValue));
      setUsername(storedUsername());
      setChecked(!event.newValue);
    };
    window.addEventListener('auth-expired', expired);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('auth-expired', expired);
      window.removeEventListener('storage', changed);
    };
  }, [logout, clearAdminData]);
  const login = useCallback(
    async (username: string, password: string) => {
      const result = await write<{
        access_token: string;
        username: string;
        role: string;
      }>('/auth/login', {
        username,
        password,
      });
      localStorage.setItem(TOKEN_KEY, result.access_token);
      localStorage.setItem('padel-auth-username', result.username);
      localStorage.setItem('padel-auth-role', result.role);
      const profile = await api<User>('/auth/me');
      localStorage.setItem('padel-auth-default-community', profile.default_community_id);
      clearAdminData();
      setHasToken(true);
      setUsername(profile.username);
      setUser(profile);
      setChecked(true);
    },
    [clearAdminData],
  );
  const startDemo = useCallback(async () => {
    const result = await write<{
      access_token: string;
      username: string;
      passphrase: string;
      role: string;
      expires_at: string;
    }>('/auth/demo');
    localStorage.setItem(TOKEN_KEY, result.access_token);
    localStorage.setItem('padel-auth-username', result.username);
    localStorage.setItem('padel-auth-role', result.role);
    localStorage.setItem('padel-auth-is-demo', '1');
    localStorage.setItem('padel-auth-demo-expires', result.expires_at);
    // Username only is remembered across sign-outs, never the passphrase; that one is shown once.
    localStorage.setItem(
      DEMO_LAST_KEY,
      JSON.stringify({ u: result.username, expiresAt: result.expires_at || null }),
    );
    sessionStorage.setItem(DEMO_PASSPHRASE_KEY, result.passphrase);
    const profile = await api<User>('/auth/me');
    localStorage.setItem('padel-auth-default-community', profile.default_community_id);
    clearAdminData();
    setHasToken(true);
    setUsername(profile.username);
    setUser(profile);
    setChecked(true);
  }, [clearAdminData]);
  const setProfile = useCallback((profile: User) => {
    localStorage.setItem('padel-auth-default-community', profile.default_community_id);
    setUser(profile);
  }, []);
  const loading = hasToken && !user && !checked;
  const value = useMemo(
    () => ({ user, hasToken, username, loading, validate, login, startDemo, setProfile, logout }),
    [user, hasToken, username, loading, validate, login, startDemo, setProfile, logout],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('AuthProvider is missing');
  return auth;
}
