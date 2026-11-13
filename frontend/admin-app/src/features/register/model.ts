import { ApiError } from '../../api';
import { playerApi, PLAYER_DATA, PLAYER_TOKEN } from '../../player/api';
import type { Question } from '../../types';

export interface PaymentMethod {
  kind: string;
  label?: string | null;
  value: string;
}
/** What the player owes (their own entry) or what the lobby asks for (public notice). */
export interface PaymentInfo {
  status: 'unpaid' | 'reported' | 'paid' | 'waived' | 'refund_due' | 'refunded';
  amount_cents: number;
  currency: string;
  due_at?: string | null;
  instructions?: string | null;
  methods: PaymentMethod[];
  concept: string;
  reference?: string | null;
}
export interface PublicLobby {
  id: string;
  name: string;
  open: boolean;
  converted?: boolean;
  description?: string | null;
  message?: string | null;
  registrant_count: number;
  sport?: string;
  registrants?: { player_id: string; player_name: string }[];
  questions?: Question[];
  join_code_required?: boolean;
  email_requirement?: 'required' | 'optional' | 'disabled';
  auto_send_email?: boolean;
  club_logo_url?: string | null;
  club_name?: string | null;
  community_id?: string;
  community_name?: string | null;
  converted_to_tids?: string[];
  converted_to_tid?: string | null;
  linked_tournaments?: { id: string; name: string; finished: boolean }[];
  payment?: {
    fee_cents: number;
    currency: string;
    due_at?: string | null;
    instructions?: string | null;
    methods?: PaymentMethod[];
  } | null;
}
/** The visitor's own entry in this lobby (from register, player-login or my-entry). */
export interface Entry {
  player_id: string;
  player_name: string;
  passphrase: string;
  token: string | null;
  answers: Record<string, string>;
  payment: PaymentInfo | null;
  profile_linked?: boolean;
  passphrase_differs_from_profile?: boolean;
}

export type Answer = string | string[];

export const kindOf = (q: Question): 'choice' | 'multi' | 'number' | 'text' => {
  const choices = Array.isArray(q.choices) && q.choices.length > 0;
  if (q.type === 'choice' && choices) return 'choice';
  if (q.type === 'multichoice' && choices) return 'multi';
  if (q.type === 'number') return 'number';
  return 'text';
};

/** A saved answer as the form holds it: multi-choice answers are stored as a JSON list. */
export function draftValue(q: Question, saved?: string): Answer {
  if (kindOf(q) === 'multi') {
    try {
      const list = JSON.parse(saved || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  return saved == null ? '' : String(saved);
}

/** The answers to send, or the first missing required one. Empty answers are left out. */
export function collectAnswers(
  questions: Question[],
  values: Record<string, Answer>,
): { answers: Record<string, string> } | { missing: true } {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const v = values[q.key];
    if (kindOf(q) === 'multi') {
      const picked = (q.choices || []).filter((c) => Array.isArray(v) && v.includes(c));
      if (picked.length) answers[q.key] = JSON.stringify(picked);
      else if (q.required) return { missing: true };
    } else {
      const text = (v == null ? '' : String(v)).trim();
      if (text) answers[q.key] = text;
      else if (q.required) return { missing: true };
    }
  }
  return { answers };
}

export const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

/** Link-type payment methods (Revolut, PayPal) open with the amount filled in;
 * a paypal.me link gets the amount in its path, any other PayPal link opens as given. */
export function paymentHref(m: PaymentMethod, cents: number, currency: string): string | null {
  if (!m.value || (m.kind !== 'revolut' && m.kind !== 'paypal_me')) return null;
  let url = String(m.value).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!cents) return url;
  const amount = (cents / 100).toFixed(2);
  const code = (currency || 'EUR').toUpperCase();
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (m.kind === 'paypal_me') {
      if (/(^|\.)paypal\.me$/i.test(u.hostname) && !/\/\d+(\.\d+)?[A-Za-z]{3}$/.test(u.pathname))
        u.pathname = `${u.pathname.replace(/\/$/, '')}/${amount}${code}`;
    } else if (!u.searchParams.has('amount')) {
      u.searchParams.set('amount', amount);
      u.searchParams.set('currency', code);
    }
    return u.toString();
  } catch {
    return null;
  }
}

// ---- Calls. All anonymous unless a token is named; none reads the organizer token. ----------------

export const lobbyPath = (rid: string) => `/registrations/${encodeURIComponent(rid)}`;
export const call = <T>(
  path: string,
  body?: unknown,
  method = 'GET',
  token: string | null = null,
) => playerApi<T>(path, body, method, token);

// ---- The Player Hub profile saved in this browser (the same keys the Hub uses) -------------------

export interface HubProfile {
  name?: string;
  email?: string;
  contact?: string;
  passphrase?: string | null;
}
export interface HubSession {
  jwt: string | null;
  profile: HubProfile | null;
}
export function readHub(): HubSession {
  try {
    const raw = localStorage.getItem(PLAYER_DATA);
    return {
      jwt: localStorage.getItem(PLAYER_TOKEN),
      profile: raw ? (JSON.parse(raw) as HubProfile) : null,
    };
  } catch {
    return { jwt: null, profile: null };
  }
}
export function saveHub(jwt: string, profile: unknown) {
  try {
    localStorage.setItem(PLAYER_TOKEN, jwt);
    localStorage.setItem(PLAYER_DATA, JSON.stringify(profile));
  } catch {
    /* The sign-up still works; the Hub login just is not remembered. */
  }
  window.dispatchEvent(new Event('player-session-changed'));
}
export function clearHub() {
  try {
    localStorage.removeItem(PLAYER_TOKEN);
    localStorage.removeItem(PLAYER_DATA);
  } catch {
    /* Nothing stored. */
  }
  window.dispatchEvent(new Event('player-session-changed'));
}

// ---- The entry token, remembered per lobby so links to the started tournament sign the player in ----

const tokenKeys = (ids: (string | undefined)[]) =>
  ids.filter((x): x is string => !!x).map((id) => `reg_token_${id}`);
export function readEntryToken(ids: (string | undefined)[]): string | null {
  for (const key of tokenKeys(ids)) {
    for (const storage of [() => localStorage, () => sessionStorage]) {
      try {
        const raw = storage().getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.token === 'string') return parsed.token;
        } catch {
          return raw;
        }
      } catch {
        /* Try the next store. */
      }
    }
  }
  return null;
}
export function writeEntryToken(id: string, token: string) {
  const value = JSON.stringify({ token });
  try {
    localStorage.setItem(`reg_token_${id}`, value);
  } catch {
    try {
      sessionStorage.setItem(`reg_token_${id}`, value);
    } catch {
      /* Not remembered. */
    }
  }
}

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
