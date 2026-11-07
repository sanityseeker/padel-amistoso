import { useLocale } from './i18n';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, TOKEN_KEY, write } from './api';
import type { User } from './types';
interface Auth {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const client = useQueryClient();
  const logout = () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('padel-auth-')) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('padel-auth-')) sessionStorage.removeItem(key);
    setUser(null);
    client.clear();
  };
  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY))
      api<User>('/auth/me')
        .then(setUser)
        .catch(logout)
        .finally(() => setLoading(false));
    else setLoading(false);
    const expired = () => logout();
    const changed = (event: StorageEvent) => {
      if (event.key === TOKEN_KEY) window.location.reload();
    };
    window.addEventListener('auth-expired', expired);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('auth-expired', expired);
      window.removeEventListener('storage', changed);
    };
    // Read the existing browser session once; subsequent changes come from login/logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function login(username: string, password: string) {
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
    client.clear();
    setUser(profile);
  }
  return (
    <Context.Provider
      value={{
        user,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('AuthProvider is missing');
  return auth;
}
