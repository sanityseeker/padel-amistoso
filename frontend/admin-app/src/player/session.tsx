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
import { PLAYER_DATA, PLAYER_TOKEN, saveSession } from './api';
import type { Profile, Session } from './types';

interface PlayerSession {
  token: string | null;
  profile: Profile | null;
  logout: () => void;
  start: (session: Session) => void;
}
const Context = createContext<PlayerSession | null>(null);

function readProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PLAYER_DATA);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}
function readToken(): string | null {
  try {
    return localStorage.getItem(PLAYER_TOKEN);
  } catch {
    return null;
  }
}

// Always mounted at the root next to the admin provider. The two sessions use
// separate storage keys, fetchers and query-key namespaces (['player', ...] here,
// ['admin', ...] there), so signing out of one never clears the other.
export function PlayerSessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [token, setToken] = useState(readToken);
  const [profile, setProfile] = useState(readProfile);
  const logout = useCallback(() => {
    try {
      localStorage.removeItem(PLAYER_TOKEN);
      localStorage.removeItem(PLAYER_DATA);
    } catch {
      /* Storage unavailable: the in-memory state below still signs out. */
    }
    setToken(null);
    setProfile(null);
    client.removeQueries({ queryKey: ['player'] });
  }, [client]);
  const start = useCallback(
    (session: Session) => {
      client.removeQueries({ queryKey: ['player'] });
      saveSession(session);
      setToken(session.access_token);
      setProfile(session.profile);
    },
    [client],
  );
  useEffect(() => {
    const expired = () => logout();
    const reread = () => {
      setToken(readToken());
      setProfile(readProfile());
    };
    const storage = (event: StorageEvent) => {
      if (event.key === PLAYER_TOKEN && !event.newValue) logout();
      else if (event.key === PLAYER_TOKEN || event.key === PLAYER_DATA) reread();
    };
    window.addEventListener('player-auth-expired', expired);
    window.addEventListener('player-session-changed', reread);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('player-auth-expired', expired);
      window.removeEventListener('player-session-changed', reread);
      window.removeEventListener('storage', storage);
    };
  }, [logout]);
  const value = useMemo(() => ({ token, profile, logout, start }), [token, profile, logout, start]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePlayerSession() {
  const session = useContext(Context);
  if (!session) throw new Error('PlayerSessionProvider is missing');
  return session;
}

export function profileInitials(name: string | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
