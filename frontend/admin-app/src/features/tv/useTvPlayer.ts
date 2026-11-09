import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api';
import { PLAYER_DATA, PLAYER_TOKEN, playerApi } from '../../player/api';
import { TV_TOKEN_REJECTED_EVENT } from '../player/eventData';

// The signed-in player of one TV page: a tournament-scoped token from POST /tournaments/{tid}/player-auth.
// It is stored under the legacy key (`padel-player-<tid>`), so the old and the new page share one login.
// It is never the organizer token and never the Player Hub profile token.
export interface TvSession {
  jwt: string;
  playerId: string;
  playerName: string;
  hasHubProfile?: boolean;
  loginPassphrase: string | null;
  hubPassphrase: string | null;
  hubAccessToken: string | null;
}
interface AuthResponse {
  access_token: string;
  player_id: string;
  player_name: string;
  has_hub_profile?: boolean;
  hub_passphrase?: string | null;
  hub_access_token?: string | null;
}
export interface Opponent {
  player_id: string;
  name: string;
  contact: string | null;
  match_id: string;
  round_number: number;
}

const sessionKey = (tid: string) => `padel-player-${tid}`;
const quietKey = (tid: string) => `padel-tv-no-autologin-${tid}`;

function readSession(tid: string): TvSession | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(sessionKey(tid));
  } catch {
    /* Fall through to the tab storage. */
  }
  if (!raw) {
    try {
      raw = sessionStorage.getItem(sessionKey(tid));
    } catch {
      return null;
    }
  }
  try {
    const data = raw ? JSON.parse(raw) : null;
    if (!data?.jwt) return null;
    return {
      jwt: data.jwt,
      playerId: data.playerId,
      playerName: data.playerName,
      hasHubProfile: data.hasHubProfile,
      loginPassphrase: data.loginPassphrase ?? null,
      hubPassphrase: data.hubPassphrase ?? null,
      hubAccessToken: data.hubAccessToken ?? null,
    };
  } catch {
    return null;
  }
}
function writeSession(tid: string, session: TvSession | null) {
  const store = (storage: Storage) => {
    if (session) storage.setItem(sessionKey(tid), JSON.stringify(session));
    else storage.removeItem(sessionKey(tid));
  };
  try {
    store(localStorage);
  } catch {
    try {
      store(sessionStorage);
    } catch {
      /* The login lasts for this page view only. */
    }
  }
  if (!session)
    try {
      sessionStorage.removeItem(sessionKey(tid));
    } catch {
      /* Nothing stored. */
    }
}
const quiet = (tid: string, on?: boolean): boolean => {
  try {
    if (on === undefined) return localStorage.getItem(quietKey(tid)) === '1';
    if (on) localStorage.setItem(quietKey(tid), '1');
    else localStorage.removeItem(quietKey(tid));
  } catch {
    /* Preference only. */
  }
  return !!on;
};

/** True when a JWT's `exp` is still ahead (an unverified read, only used to skip a doomed request). */
function jwtStillValid(token: string): boolean {
  try {
    const part = token.split('.')[1] || '';
    const b64 =
      part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp !== 'number' || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** Does the stored Player Hub session take part in this tournament? Any doubt answers false. */
async function hubSessionInTournament(tid: string): Promise<string | null> {
  let jwt: string | null = null;
  let passphrase: string | null = null;
  try {
    jwt = localStorage.getItem(PLAYER_TOKEN);
    passphrase = JSON.parse(localStorage.getItem(PLAYER_DATA) || 'null')?.passphrase ?? null;
  } catch {
    return null;
  }
  if (!jwt || !passphrase || !jwtStillValid(jwt)) return null;
  try {
    const space = await playerApi<{ entries?: { entity_type: string; entity_id: string }[] }>(
      '/player-profile/space',
      undefined,
      'GET',
      jwt,
    );
    return (space.entries || []).some((e) => e.entity_type === 'tournament' && e.entity_id === tid)
      ? passphrase
      : null;
  } catch {
    return null;
  }
}

/** `allowed` is the organizer's player-scoring switch; `undefined` while the settings are still loading. */
export function useTvPlayer(tid: string | undefined, allowed: boolean | undefined) {
  const [session, setSession] = useState<TvSession | null>(null);
  const [tokenFailed, setTokenFailed] = useState(false);
  const [params, setParams] = useSearchParams();
  const started = useRef<string | null>(null);

  const apply = useCallback(
    (id: string, data: AuthResponse, passphrase: string | null) => {
      const next: TvSession = {
        jwt: data.access_token,
        playerId: data.player_id,
        playerName: data.player_name,
        hasHubProfile: !!data.has_hub_profile,
        // Token-only logins leave this null, so the "create a Hub profile" banner stays hidden.
        loginPassphrase: passphrase,
        hubPassphrase: data.hub_passphrase || null,
        hubAccessToken: data.hub_access_token || null,
      };
      writeSession(id, next);
      quiet(id, false);
      setSession(next);
      return next;
    },
    [setSession],
  );

  const authenticate = useCallback(
    async (id: string, body: { passphrase?: string; token?: string }) => {
      const data = await playerApi<AuthResponse>(
        `/tournaments/${id}/player-auth`,
        body,
        'POST',
        null,
      );
      return apply(id, data, body.passphrase ?? null);
    },
    [apply],
  );

  const logout = useCallback(() => {
    if (!tid) return;
    writeSession(tid, null);
    quiet(tid, true);
    setSession(null);
  }, [tid]);

  // Load the stored login, then the QR / e-mail link (`?player_token=`), then the Hub profile.
  useEffect(() => {
    if (!tid || allowed === undefined) return;
    if (!allowed) {
      // With player scoring switched off nobody stays signed in on this page.
      writeSession(tid, null);
      setSession(null);
      return;
    }
    if (started.current === tid) return;
    started.current = tid;
    const stored = readSession(tid);
    setSession(stored);
    const link = params.get('player_token');
    if (link) {
      // Take the credential out of the address bar first, so a refresh or a shared link cannot reuse it.
      const next = new URLSearchParams(params);
      next.delete('player_token');
      setParams(next, { replace: true });
      authenticate(tid, { token: link }).catch(() => setTokenFailed(true));
      return;
    }
    if (stored || quiet(tid)) return;
    void hubSessionInTournament(tid).then((passphrase) => {
      if (passphrase) authenticate(tid, { passphrase }).catch(() => undefined);
    });
  }, [tid, allowed, params, setParams, authenticate]);

  // The server rejected the tournament token: the player has to sign in again.
  useEffect(() => {
    const rejected = (event: Event) => {
      if (tid && (event as CustomEvent).detail === tid) {
        writeSession(tid, null);
        setSession(null);
      }
    };
    window.addEventListener(TV_TOKEN_REJECTED_EVENT, rejected);
    return () => window.removeEventListener(TV_TOKEN_REJECTED_EVENT, rejected);
  }, [tid]);

  const opponents = useQuery({
    queryKey: ['player', 'tv-opponents', tid, session?.jwt],
    enabled: !!tid && !!session,
    queryFn: () =>
      playerApi<{ opponents?: Opponent[] }>(
        `/tournaments/${tid}/player/opponents`,
        undefined,
        'GET',
        session!.jwt,
      ),
    retry: false,
  });
  useEffect(() => {
    if (opponents.error instanceof ApiError && opponents.error.status === 401) logout();
  }, [opponents.error, logout]);

  const { refetch: refetchOpponents } = opponents;
  const refreshOpponents = useCallback(() => void refetchOpponents(), [refetchOpponents]);

  return {
    session,
    token: session?.jwt ?? null,
    tokenFailed,
    opponents: opponents.data?.opponents ?? [],
    opponentsLoaded: opponents.isSuccess || opponents.isError,
    refreshOpponents,
    loginWithPassphrase: (passphrase: string) => authenticate(tid!, { passphrase }),
    /** Sign in with the Player Hub profile saved in this browser. Rejects when there is none. */
    loginWithHub: async () => {
      let passphrase: string | null = null;
      try {
        passphrase = JSON.parse(localStorage.getItem(PLAYER_DATA) || 'null')?.passphrase ?? null;
      } catch {
        passphrase = null;
      }
      if (!passphrase) throw new Error('no-profile');
      return authenticate(tid!, { passphrase });
    },
    logout,
  };
}
