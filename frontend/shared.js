/**
 * shared.js — utilities used by both index.html (admin) and public.html.
 *
 * This file is loaded as a module, so it has its own scope. Functions and
 * variables defined here are not available to the global scope.
 */

// Mark this session as active so the cold-start redirect in index.html
// doesn't fire when navigating back to the admin page from another page.
try { sessionStorage.setItem('amistoso-session-active', '1'); } catch (_) {}

// ── HTML escaping ─────────────────────────────────────────

/** Lookup map for HTML-escape characters — avoids creating a DOM node per call. */
const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape a value for safe insertion into HTML text content or attributes.
 * Uses a regex lookup map (~10-30× faster than the DOM-based approach).
 * @param {*} s
 * @returns {string}
 */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => _ESC_MAP[c]);
}

/**
 * Escape a value for safe insertion into an HTML attribute.
 * Identical to esc() since both quote characters are already escaped.
 * @param {*} s
 * @returns {string}
 */
function escAttr(s) {
  return esc(s);
}

// ── Icon helper ───────────────────────────────────────────
/**
 * Return an inline SVG icon element for use inside button labels.
 * Shared by every page (admin, TV / Events, Player Hub); decorative, so it
 * carries aria-hidden — pair it with visible text or an aria-label.
 * Icons are stroke-based Lucide-style, inherit currentColor.
 * Usage: `${_ic('trash')} ${t('txt_txt_remove')}`
 */
function _ic(name) {
  const paths = {
    trash:    `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>`,
    edit:     `<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    link:     `<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>`,
    reset:    `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>`,
    mail:     `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>`,
    print:    `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
    copy:     `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>`,
    key:      `<path d="M2.586 17.414A2 2 0 002 18.828V21a1 1 0 001 1h3a1 1 0 001-1v-1a1 1 0 011-1h1a1 1 0 001-1v-1a1 1 0 011-1h.172a2 2 0 001.414-.586l.814-.814a6.5 6.5 0 10-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>`,
    shield:   `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
    settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>`,
    qr:       `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/><line x1="14" y1="14" x2="14" y2="14"/><line x1="17" y1="14" x2="17" y2="14"/><line x1="20" y1="14" x2="20" y2="14"/><line x1="14" y1="17" x2="14" y2="17"/><line x1="17" y1="17" x2="17" y2="17"/><line x1="20" y1="17" x2="20" y2="17"/>`,
    trophy:   `<path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/>`,
    chevdown: `<polyline points="6 9 12 15 18 9"/>`,
    lock:     `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>`,
    unlock:   `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 019.9-1"/>`,
    chart:    `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
    shuffle:  `<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>`,
    monitor:  `<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
    wallet:   `<path d="M20 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h13a2 2 0 002-2v-2"/><path d="M3 7h17a1 1 0 011 1v8a1 1 0 01-1 1h-5a2 2 0 01-2-2v-4a2 2 0 012-2h6"/><circle cx="16.5" cy="12" r="0.5" fill="currentColor"/>`,
    globe:    `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>`,
    users:    `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>`,
    user:     `<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    userplus: `<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>`,
    grid:     `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`,
    building: `<rect x="2" y="7" width="20" height="14" rx="1"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>`,
    star:     `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
    more:     `<circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/>`,
    sun:      `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`,
    moon:     `<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>`,
    info:     `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
    alert:    `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    checkcircle: `<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
    court:    `<rect x="4" y="2" width="16" height="20" rx="1"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><line x1="12" y1="7" x2="12" y2="17"/>`,
    ball:     `<circle cx="12" cy="12" r="10"/><path d="M5.6 4.9a10 10 0 010 14.2"/><path d="M18.4 4.9a10 10 0 000 14.2"/>`,
    bench:    `<path d="M19 9V6a2 2 0 00-2-2H7a2 2 0 00-2 2v3"/><path d="M3 16a2 2 0 002 2h14a2 2 0 002-2v-5a2 2 0 00-4 0v2H7v-2a2 2 0 00-4 0z"/><path d="M5 18v2M19 18v2"/>`,
    medal:    `<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>`,
    bell:     `<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>`,
    belloff:  `<path d="M13.73 21a2 2 0 01-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0118 8"/><path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 00-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>`,
    megaphone: `<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/>`,
    clock:    `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
    clipboard: `<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>`,
    eye:      `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
    eyeoff:   `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`,
    search:   `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
    message:  `<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>`,
    pin:      `<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z"/>`,
    calendar: `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
    zap:      `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
    check:    `<polyline points="20 6 9 17 4 12"/>`,
    ban:      `<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>`,
    repeat:   `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>`,
    wrench:   `<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>`,
    file:     `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
    plus:     `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    tag:      `<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`,
    camera:   `<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>`,
    archive:  `<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>`,
    help:     `<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    contact:  `<path d="M17 18a2 2 0 00-2-2H9a2 2 0 00-2 2"/><rect x="3" y="4" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="2"/><line x1="8" y1="2" x2="8" y2="4"/><line x1="16" y1="2" x2="16" y2="4"/>`,
    refresh:  `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>`,
    login:    `<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>`,
  };
  const p = paths[name] || '';
  return `<svg class="ic" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

// ── TBD helpers ───────────────────────────────────────────

/**
 * Returns true when a team array is absent or consists solely of "TBD" names.
 * @param {string[]} team
 * @returns {boolean}
 */
function _is_tbd_team(team) {
  if (!Array.isArray(team) || team.length === 0) return true;
  return team.every(name => !name || String(name).trim().toUpperCase() === 'TBD');
}

/**
 * True when set *index* of *sets* is a match tie-break (super tie-break)
 * under *decider*: only the third set of a three-set result can be one.
 * @param {number[][]} sets
 * @param {number} index
 * @param {string|null|undefined} decider  'full_set' | 'match_tiebreak'
 * @returns {boolean}
 */
function isMatchTiebreakSet(sets, index, decider) {
  return decider === 'match_tiebreak' && Array.isArray(sets) && sets.length === 3 && index === 2;
}

/**
 * Format set scores as text, bracketing a match tie-break: "6-4 3-6 [10-8]".
 * Shared by admin, TV, Player Hub and club pages — do not re-implement.
 * @param {number[][]} sets
 * @param {string|null|undefined} decider  'full_set' | 'match_tiebreak'
 * @param {string} [sep]  Separator between sets.
 * @returns {string}
 */
function formatSetScore(sets, decider, sep = ' / ') {
  if (!Array.isArray(sets) || sets.length === 0) return '';
  return sets.map((s, i) => {
    const text = `${s[0]}-${s[1]}`;
    return isMatchTiebreakSet(sets, i, decider) ? `[${text}]` : text;
  }).join(sep);
}

/**
 * Return a copy of *matches* sorted so TBD-team matches come last.
 * @param {object[]} matches
 * @returns {object[]}
 */
function _sortTbdLast(matches) {
  return [...matches].sort((a, b) => {
    const aTbd = _is_tbd_team(a.team1) || _is_tbd_team(a.team2);
    const bTbd = _is_tbd_team(b.team1) || _is_tbd_team(b.team2);
    return Number(aTbd) - Number(bTbd);
  });
}

// ── Demo instance ────────────────────────────────────────

/**
 * True on the demo sandbox instance. The server stamps
 * ``<html class="demo-instance">`` there, so this is synchronous and never
 * true on the core site. Use it to skip community/club UI in string-built
 * views; static markup uses the ``core-only`` class (theme.css) instead.
 * @returns {boolean}
 */
function isDemoInstance() {
  return document.documentElement.classList.contains('demo-instance');
}

// ── Subdomain detection ──────────────────────────────────

/**
 * Return the leftmost host label when the page is being served from a
 * ``{label}.amistoso.club``-style subdomain (or any non-localhost host with
 * 3+ parts). Returns null on the apex domain, on ``admin.``, on reserved
 * labels, on ``localhost``, or on bare-IP hosts.
 *
 * Used by club.html to fetch ``/api/clubs/by-slug/{slug}`` and by callers
 * that want to know whether they are on a per-club landing page.
 *
 * @returns {string | null}
 */
function getClubSubdomain() {
  const RESERVED = new Set([
    'admin', 'tv', 'player', 'register', 'api', 'www', 'app', 'mail', 'ftp', 'static', 'assets', 'demo'
  ]);
  try {
    const host = (window.location.hostname || '').toLowerCase();
    if (!host || host === 'localhost') return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    const parts = host.split('.');
    // Accept either ``{slug}.{base}.{tld}`` (production) or ``{slug}.localhost``
    // (local dev via /etc/hosts aliases or *.localhost auto-resolution).
    const isLocalhostChild = parts.length >= 2 && parts[parts.length - 1] === 'localhost';
    if (parts.length < 3 && !isLocalhostChild) return null;
    const label = parts[0];
    if (!label || RESERVED.has(label)) return null;
    if (!/^[a-z0-9-]{2,30}$/.test(label)) return null;
    return label;
  } catch (_) {
    return null;
  }
}

/**
 * Memoized resolver for the current subdomain's club, if any.
 *
 * Returns the same promise on subsequent calls, so multiple consumers (TV
 * picker, register directory, player hub) share a single ``GET
 * /api/clubs/by-slug/{slug}`` request per page load.
 *
 * @returns {Promise<null | {club_id: string, name: string, slug: string, has_logo: boolean, logo_url: string}>}
 */
let _subdomainClubPromise = null;
function resolveClubSubdomainContext() {
  if (_subdomainClubPromise) return _subdomainClubPromise;
  const slug = (typeof getClubSubdomain === 'function') ? getClubSubdomain() : null;
  if (!slug) {
    _subdomainClubPromise = Promise.resolve(null);
    return _subdomainClubPromise;
  }
  _subdomainClubPromise = fetch(`/api/clubs/by-slug/${encodeURIComponent(slug)}`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);
  return _subdomainClubPromise;
}

// ── Theme persistence ─────────────────────────────────────

/** Single storage key shared by all pages. */
const THEME_KEY = 'amistoso-theme';

/**
 * Apply a theme to the document root and return the normalised value.
 * Does NOT persist to localStorage.
 * @param {'light'|'dark'} theme
 * @returns {'light'|'dark'}
 */
function _applyTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', mode);
  return mode;
}

/**
 * Read the last saved theme from localStorage (defaults to 'dark').
 * Migrates the legacy key if present.
 * @returns {'light'|'dark'}
 */
function _loadSavedTheme() {
  const osDefault = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  try {
    const legacy = localStorage.getItem('padel-theme');
    if (legacy && !localStorage.getItem(THEME_KEY)) {
      localStorage.setItem(THEME_KEY, legacy);
      localStorage.removeItem('padel-theme');
    }
    return /** @type {'light'|'dark'} */ (localStorage.getItem(THEME_KEY) || osDefault);
  } catch (_) { return osDefault; }
}

/**
 * Persist a theme value to localStorage.
 * @param {'light'|'dark'} theme
 */
function _saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

// ── Language persistence + i18n ───────────────────────────

/** Single storage key shared by all pages. */
const LANG_KEY = 'amistoso-lang';

/** @type {'en'|'es'} */
let _currentLang = 'en';

/**
 * Read the last saved language from localStorage (defaults to 'en').
 * Migrates the legacy key if present.
 * @returns {'en'|'es'}
 */
function _loadSavedLanguage() {
  try {
    const legacy = localStorage.getItem('padel-lang');
    if (legacy && !localStorage.getItem(LANG_KEY)) {
      localStorage.setItem(LANG_KEY, legacy);
      localStorage.removeItem('padel-lang');
    }
    const saved = localStorage.getItem(LANG_KEY);
    if (saved) return saved === 'es' ? 'es' : 'en';

    // Auto-detect from browser language on first visit
    const browserLang = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase();
    const detected = browserLang.startsWith('es') ? 'es' : 'en';
    localStorage.setItem(LANG_KEY, detected);
    return detected;
  } catch (_) {
    return 'en';
  }
}

/**
 * @param {'en'|'es'} lang
 */
function _saveLanguage(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
}

/**
 * @param {string} text
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
function t(text, params = {}) {
  const translator = window.__i18n?.translate;
  if (typeof translator === 'function') {
    return translator(text, _currentLang, params);
  }
  return text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

/**
 * Sport-aware translation: tries key + '_' + sport first, then falls back.
 * @param {string} text
 * @param {string} sport - 'padel' or 'tennis'
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
function ts(text, sport, params = {}) {
  const translator = window.__i18n?.translateSport;
  if (typeof translator === 'function') {
    return translator(text, _currentLang, sport, params);
  }
  return t(text, params);
}

/**
 * Translate backend round-label tokens (e.g. "Group A R1") into the
 * current locale.
 * @param {string} label
 * @returns {string}
 */
function trl(label) {
  if (!label) return label;
  if (label === '3rd Place') return t('txt_third_place_label');
  return label.replace(/\bGroup\b/g, t('txt_txt_group_word'));
}

/** @returns {'en'|'es'} */
function getAppLanguage() {
  return _currentLang;
}

/**
 * @param {'en'|'es'} lang
 */
function setAppLanguage(lang) {
  _currentLang = lang === 'en' ? 'en' : 'es';
  _saveLanguage(_currentLang);
  applyI18n(document);
  document.dispatchEvent(new CustomEvent('app-language-changed', { detail: { lang: _currentLang } }));
}

/**
 * @param {ParentNode} [root]
 */
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = t(key);
  });

  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (!key) return;
    const val = t(key);
    // Only set innerHTML when the translation differs from the raw key
    // (i.e., a real translation exists).
    if (val !== key) el.innerHTML = val;
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    el.setAttribute('placeholder', t(key));
  });

  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    el.setAttribute('title', t(key));
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (!key) return;
    el.setAttribute('aria-label', t(key));
  });

  root.querySelectorAll('[data-i18n-alt]').forEach((el) => {
    const key = el.getAttribute('data-i18n-alt');
    if (!key) return;
    el.setAttribute('alt', t(key));
  });
}

function initLanguage() {
  _currentLang = _loadSavedLanguage();
  applyI18n(document);
}

// ── Form state persistence ────────────────────────────────

/**
 * @param {string} key
 * @param {string} value
 */
function _saveFormValue(key, value) {
  if (!key) return;
  try {
    localStorage.setItem(`form-val-${key}`, value);
  } catch (_) {}
}

/**
 * @param {string} key
 * @returns {string | null}
 */
function _loadFormValue(key) {
  if (!key) return null;
  try {
    return localStorage.getItem(`form-val-${key}`);
  } catch (_) {
    return null;
  }
}

/**
 * @param {ParentNode} [root]
 */
function initPersistedForms(root = document) {
  root.querySelectorAll('[data-persist-id]').forEach((el) => {
    const id = el.getAttribute('data-persist-id');
    if (!id) return;

    const savedValue = _loadFormValue(id);
    if (savedValue !== null) {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        el.checked = savedValue === 'true';
      } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        el.value = savedValue;
      }
    }

    el.addEventListener('change', (e) => {
      const target = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (e.target);
      let valueToSave;
      if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
        valueToSave = String(target.checked);
      } else {
        valueToSave = target.value;
      }
      _saveFormValue(id, valueToSave);
    });
  });
}

/**
 * Returns the tournament ID from the URL.
 * @param {string} url
 * @returns {Object} { id: string, alias: string }
 */
function getTournamentIdFromUrl(url) {
  const urlParams = new URL(url || window.location.href);
  const tournamentId = urlParams.get('id');
  if (!tournamentId) {
    const alias = window.location.pathname.split('/').pop();
    if (alias && alias !== 'tv') {
      return { id: null, alias };
    }
  }
  return { id: tournamentId, alias };
}

/**
 * Sets the tournament link.
 * @param {Object} { id: string, alias: string }
 */
function setTournamentLink({ id, alias }) {
  const tournamentLink = document.getElementById('tournament-link');
  if (tournamentLink) {
    const link = alias ? `/${alias}` : `/tv/${encodeURIComponent(id)}`;
    tournamentLink.setAttribute('href', link);
  }
}

/**
 * Transient success feedback: a non-text pulse on the control the user acted on
 * (theme.css `.flash-success`). No label swap, no disabled toggling.
 *
 * @param {HTMLElement|string|null} target element, or an element id re-queried now.
 *   Call AFTER any re-render, otherwise the node may be detached.
 * @param {string} [announce] screen-reader-only text, never rendered visibly
 */
function flashSuccess(target, announce) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el && el.isConnected) {
    clearTimeout(el._flashT);
    el.classList.remove('flash-success');
    void el.offsetWidth; // restart the animation when re-triggered quickly
    el.classList.add('flash-success');
    el._flashT = setTimeout(() => el.classList.remove('flash-success'), 900);
  }
  if (announce) _srAnnounce(announce);
}

/** Announce text to screen readers via a lazily created polite live region. */
function _srAnnounce(text) {
  let live = document.getElementById('sr-status');
  if (!live) {
    live = document.createElement('div');
    live.id = 'sr-status';
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = text;
    clearTimeout(live._clearT);
    live._clearT = setTimeout(() => { live.textContent = ''; }, 2000);
  });
}

/**
 * Sets the language.
 * @param {string} lang
 */
function setLanguage(lang) {
  setAppLanguage(lang);
}

// ── Bracket image lightbox ─────────────────────────────────────────────────────
// Zoom is relative to the fit-to-screen width (100% = whole bracket visible),
// so every step is a visible change. Touch: two-finger pinch and double-tap
// zoom around the finger; one-finger drag scrolls natively. Mouse: drag-to-pan.
let _lbZoom = 1.0;
let _lbSrc  = '';
let _lbDrag = { active: false, moved: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 };
let _lbPinch = null;          // { dist, zoom } while a two-finger pinch is active
let _lbHistoryPushed = false; // a history entry exists so Back closes the lightbox

const _LB_MIN_ZOOM = 0.5;
const _LB_STEP = 1.25;
const _LB_DOUBLE_TAP_ZOOM = 2.5;

function _lbEls() {
  const lb = document.getElementById('bracket-lightbox');
  return {
    lb,
    img: document.getElementById('bracket-lightbox-img'),
    scroll: lb ? lb.querySelector('.bracket-lightbox-scroll') : null,
  };
}

/** Width at which the whole image fits the lightbox (never upscaled). */
function _lbFitWidth() {
  const { img, scroll } = _lbEls();
  const natural = (img && img.naturalWidth) || 800;
  if (!scroll) return natural;
  const cs = getComputedStyle(scroll);
  const avail = scroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return Math.max(1, Math.min(natural, avail));
}

/** Max zoom: native resolution (sharpest available), but at least 4x. */
function _lbMaxZoom() {
  const { img } = _lbEls();
  const natural = (img && img.naturalWidth) || 800;
  return Math.max(4, natural / _lbFitWidth());
}

/**
 * Set the zoom level, keeping the image point under (clientX, clientY) fixed
 * on screen. Without an anchor, zooms around the centre of the viewport.
 */
function _lbSetZoom(zoom, clientX, clientY) {
  const { img, scroll } = _lbEls();
  _lbZoom = Math.min(_lbMaxZoom(), Math.max(_LB_MIN_ZOOM, zoom));
  const label = document.getElementById('bracket-lb-zoom-level');
  if (label) label.textContent = Math.round(_lbZoom * 100) + '%';
  if (!img || !scroll) return;

  const sRect = scroll.getBoundingClientRect();
  if (clientX === undefined) {
    clientX = sRect.left + sRect.width / 2;
    clientY = sRect.top + sRect.height / 2;
  }
  const before = img.getBoundingClientRect();
  const fx = before.width ? (clientX - before.left) / before.width : 0.5;
  const fy = before.height ? (clientY - before.top) / before.height : 0.5;

  if (_lbZoom === 1.0) {
    img.style.width    = '';
    img.style.maxWidth = '';
  } else {
    img.style.maxWidth = 'none';
    img.style.width    = Math.round(_lbFitWidth() * _lbZoom) + 'px';
  }

  const after = img.getBoundingClientRect();
  const imgLeft = after.left - sRect.left + scroll.scrollLeft;
  const imgTop  = after.top  - sRect.top  + scroll.scrollTop;
  scroll.scrollLeft = imgLeft + fx * after.width  - (clientX - sRect.left);
  scroll.scrollTop  = imgTop  + fy * after.height - (clientY - sRect.top);
}

function _lbTouchDist(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function _lbOnTouchStart(e) {
  if (e.touches.length === 2) {
    _lbPinch = { dist: _lbTouchDist(e.touches), zoom: _lbZoom };
  }
}

function _lbOnTouchMove(e) {
  if (!_lbPinch || e.touches.length !== 2) return;
  e.preventDefault(); // keep the browser from zooming the page underneath
  const [a, b] = e.touches;
  _lbSetZoom(
    _lbPinch.zoom * (_lbTouchDist(e.touches) / _lbPinch.dist),
    (a.clientX + b.clientX) / 2,
    (a.clientY + b.clientY) / 2,
  );
}

function _lbOnTouchEnd(e) {
  if (e.touches.length < 2) _lbPinch = null;
}

function _lbOnDoubleClick(e) {
  e.preventDefault();
  _lbSetZoom(_lbZoom > 1.0 ? 1.0 : _LB_DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
}

function _lbOnPopState() {
  // Back gesture/button while open: close without navigating away.
  _lbHistoryPushed = false;
  _closeBracketLightbox();
}

function _openBracketLightbox(src) {
  const { lb, img, scroll } = _lbEls();
  if (!lb || !img) return;
  _lbZoom = 1.0;
  _lbSrc  = src;
  _lbDrag.active = false;
  _lbDrag.moved  = false;
  _lbPinch = null;
  img.style.width    = '';
  img.style.maxWidth = '';
  img.src = src;
  lb.classList.add('open');
  document.documentElement.classList.add('bracket-lb-open');
  _bracketLightboxUpdateZoom();
  document.addEventListener('keydown', _bracketLightboxKeyHandler);

  if (!_lbHistoryPushed) {
    history.pushState({ bracketLightbox: true }, '');
    _lbHistoryPushed = true;
    window.addEventListener('popstate', _lbOnPopState);
  }

  if (scroll) {
    scroll.scrollLeft = 0;
    scroll.scrollTop  = 0;
    scroll.addEventListener('touchstart', _lbOnTouchStart, { passive: true });
    scroll.addEventListener('touchmove', _lbOnTouchMove, { passive: false });
    scroll.addEventListener('touchend', _lbOnTouchEnd, { passive: true });
    scroll.addEventListener('touchcancel', _lbOnTouchEnd, { passive: true });
    img.addEventListener('dblclick', _lbOnDoubleClick);

    // Mouse drag-to-pan — listeners attached to document so dragging outside the
    // scroll container still works across the whole bracket lightbox.
    scroll.style.cursor = 'grab';

    const onMouseMove = (e) => {
      if (!_lbDrag.active) return;
      const dx = e.clientX - _lbDrag.startX;
      const dy = e.clientY - _lbDrag.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _lbDrag.moved = true;
      scroll.scrollLeft = _lbDrag.scrollLeft - dx;
      scroll.scrollTop  = _lbDrag.scrollTop  - dy;
    };

    const onMouseUp = () => {
      if (!_lbDrag.active) return;
      _lbDrag.active          = false;
      scroll.style.cursor     = 'grab';
      scroll.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };

    scroll.onmousedown = (e) => {
      if (e.button !== 0) return;
      _lbDrag.active     = true;
      _lbDrag.moved      = false;
      _lbDrag.startX     = e.clientX;
      _lbDrag.startY     = e.clientY;
      _lbDrag.scrollLeft = scroll.scrollLeft;
      _lbDrag.scrollTop  = scroll.scrollTop;
      scroll.style.cursor     = 'grabbing';
      scroll.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    };
  }
}

function _closeBracketLightbox(e) {
  // Only block clicks directly on the image (e.g. drag-end or image interaction).
  // Toolbar propagation is already stopped by stopPropagation/data-action on the toolbar element.
  if (e && e.target && e.target.tagName === 'IMG') return;
  // Don't close if this click was the end of a drag gesture
  if (e && _lbDrag.moved) { _lbDrag.moved = false; return; }
  const { lb, img, scroll } = _lbEls();
  if (!lb || !lb.classList.contains('open')) return;
  lb.classList.remove('open');
  document.documentElement.classList.remove('bracket-lb-open');
  _lbDrag.active = false; // cancel any in-progress drag
  _lbPinch = null;
  document.removeEventListener('keydown', _bracketLightboxKeyHandler);
  window.removeEventListener('popstate', _lbOnPopState);
  // Closed via button/Esc/backdrop: drop the history entry pushed on open.
  if (_lbHistoryPushed) {
    _lbHistoryPushed = false;
    if (history.state && history.state.bracketLightbox) history.back();
  }
  if (img) img.removeEventListener('dblclick', _lbOnDoubleClick);
  if (scroll) {
    scroll.removeEventListener('touchstart', _lbOnTouchStart);
    scroll.removeEventListener('touchmove', _lbOnTouchMove);
    scroll.removeEventListener('touchend', _lbOnTouchEnd);
    scroll.removeEventListener('touchcancel', _lbOnTouchEnd);
    scroll.style.cursor     = '';
    scroll.style.userSelect = '';
    scroll.onmousedown = null;
    // document-level mousemove/mouseup listeners are self-removing (cleaned up in onMouseUp)
  }
}

function _bracketLightboxUpdateZoom() {
  _lbSetZoom(_lbZoom);
}

function _bracketLightboxZoomIn() {
  _lbSetZoom(_lbZoom * _LB_STEP);
}

function _bracketLightboxZoomOut() {
  _lbSetZoom(_lbZoom / _LB_STEP);
}

function _bracketLightboxZoomReset() {
  _lbSetZoom(1.0);
}

function _bracketLightboxOpenFull() {
  if (_lbSrc) window.open(_lbSrc, '_blank', 'noopener');
}

function _bracketLightboxDownload() {
  if (!_lbSrc) return;
  // Derive a sensible filename from the active title field (if present) and the
  // format embedded in the src URL (blob URLs default to 'png').
  const titleEl = document.getElementById('schema-title');
  const baseName = (titleEl && titleEl.value.trim()) ? titleEl.value.trim() : 'bracket';
  let ext = 'png';
  if (!_lbSrc.startsWith('blob:')) {
    const fmtMatch = _lbSrc.match(/[?&]fmt=([a-z]+)/i);
    if (fmtMatch) ext = fmtMatch[1];
  } else if (_lbSrc.includes('svg+xml') || document.getElementById('schema-fmt')?.value === 'svg') {
    ext = 'svg';
  }
  const a    = document.createElement('a');
  a.href     = _lbSrc;
  a.download = `${baseName}.${ext}`;
  a.rel      = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function _bracketLightboxKeyHandler(e) {
  if      (e.key === 'Escape')            _closeBracketLightbox();
  else if (e.key === '+' || e.key === '=') _bracketLightboxZoomIn();
  else if (e.key === '-')                  _bracketLightboxZoomOut();
  else if (e.key === '0')                  _bracketLightboxZoomReset();
}

// ── Public header (club page, Player Hub, registration form, Events) ──────
//
// One shared header for every public surface: a centred page dropdown
// [current page ▾] listing Club|Events, Player Hub (initials + "My Hub" when
// signed in) and Admin (hidden on club subdomains — club visitors aren't
// platform organizers). A quiet "Display: English · Light" line in the page
// footer opens the Display sheet (language + theme). Pages re-render their
// own content on language change; header and footer re-render themselves via
// `app-language-changed`.

/** localStorage key of the Player Hub profile JWT (player.js keeps it there). */
const _HUB_JWT_KEY = 'padel-player-profile';
/** localStorage key of the cached Player Hub profile object. */
const _HUB_PROFILE_DATA_KEY = 'padel-player-profile-data';

/** @type {string|null} key of the page the header was last built for. */
let _publicHeaderCurrent = null;

/**
 * Theme as the user chose it: 'light' | 'dark' | 'auto' (= follow the OS).
 * @returns {'light'|'dark'|'auto'}
 */
function getThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  return 'auto';
}

/**
 * Apply + persist a theme preference. 'auto' clears the saved key so the OS
 * `prefers-color-scheme` applies again (see `_loadSavedTheme`). Dispatches
 * `app-theme-changed` with the effective theme so pages can sync their state.
 * @param {'light'|'dark'|'auto'} mode
 * @returns {'light'|'dark'} the theme now applied
 */
function setDisplayTheme(mode) {
  let effective;
  if (mode === 'auto') {
    try { localStorage.removeItem(THEME_KEY); } catch (_) {}
    effective = _applyTheme(_loadSavedTheme());
  } else {
    effective = _applyTheme(mode);
    _saveTheme(effective);
  }
  document.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { theme: effective, preference: mode } }));
  refreshPublicHeader();
  _refreshDisplayButtons();
  _renderDisplaySheetContent();
  return effective;
}

/**
 * Switch the UI language. Pages listen to `app-language-changed` (dispatched
 * by setAppLanguage) and re-render; the header does the same.
 * @param {'en'|'es'} lang
 */
function setDisplayLanguage(lang) {
  setAppLanguage(lang);
}

/** Player Hub session present on this origin? */
function hasHubSession() {
  try { return Boolean(localStorage.getItem(_HUB_JWT_KEY)); } catch (_) { return false; }
}

/**
 * Organizer (admin JWT) session present on this origin? auth.js is not loaded
 * on public pages, so this reads the same storage keys directly. A stale token
 * only means the Admin entry shows; /admin itself re-checks the session.
 */
function hasAdminSession() {
  try {
    return Boolean(localStorage.getItem('padel-auth-token') || sessionStorage.getItem('padel-auth-token'));
  } catch (_) {
    return false;
  }
}

/**
 * Visitors get a header dropdown of Club/Events + Player Hub only; the admin
 * sign-in is a low-emphasis key + "Admin" link at the right end of the header
 * row instead (organizers who already have a session on this origin get the
 * Admin dropdown entry back, which replaces the link).
 */
function _showHeaderAdminSignIn() {
  return Boolean(_publicHeaderCurrent) && _publicHeaderCurrent !== 'admin' && !hasAdminSession();
}

/**
 * Up to two initials from the cached Hub profile name. Never exposes the
 * full name in the header.
 * @returns {string}
 */
function hubProfileInitials() {
  try {
    const raw = localStorage.getItem(_HUB_PROFILE_DATA_KEY);
    const profile = raw ? JSON.parse(raw) : null;
    const name = (profile && typeof profile.name === 'string') ? profile.name.trim() : '';
    if (!name) return '';
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] ? parts[0][0] : '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  } catch (_) {
    return '';
  }
}

/**
 * Pages reachable from the public header dropdown.
 * @returns {{key: string, href: string, label: string, icon: string, cls?: string}[]}
 */
function _publicHeaderPages(current) {
  const pages = [];
  if (getClubSubdomain()) {
    pages.push({ key: 'club', href: '/', label: t('txt_nav_club'), icon: _ic('building'), cls: 'public-page-item--club' });
  } else {
    pages.push({ key: 'events', href: '/events', label: t('txt_nav_events'), icon: _ic('trophy') });
  }
  // The Player Hub is a core-site feature: never offered on the demo instance.
  if (!isDemoInstance()) {
    const initials = hasHubSession() ? hubProfileInitials() : '';
    pages.push({
      key: 'player',
      href: '/player',
      label: hasHubSession() ? t('txt_nav_my_hub') : t('txt_nav_player_space'),
      icon: initials ? `<span class="public-avatar" aria-hidden="true">${esc(initials)}</span>` : _ic('user'),
    });
  }
  if (current === 'admin' || hasAdminSession()) {
    pages.push({ key: 'admin', href: '/admin', label: t('txt_nav_admin'), icon: _ic('settings') });
  }
  return pages;
}

/**
 * Build the shared public header.
 * @param {'club'|'events'|'player'|'register'|'admin'} current  Page key (the sign-up
 *   form shows its parent directory, Club or Events, as the current page).
 * @returns {string} HTML
 */
function buildPublicHeaderHtml(current) {
  _publicHeaderCurrent = current;
  const pages = _publicHeaderPages(current);
  const currentPage = pages.find(p => p.key === current) || pages[0];

  let html = `<header class="public-header" id="public-header">`;
  html += buildDisplayButtonHtml();
  html += `<nav class="public-page-selector" id="public-page-selector" aria-label="${escAttr(t('txt_nav_pages'))}">`;
  html += `<button type="button" class="public-page-btn" aria-haspopup="true" aria-expanded="false" aria-controls="public-page-menu" onclick="togglePublicPageMenu()">`;
  html += `<span class="public-page-icon">${currentPage.icon}</span><span class="public-page-label">${esc(currentPage.label)}</span>${_ic('chevdown')}</button>`;
  html += `<div class="public-page-menu" id="public-page-menu" hidden>`;
  for (const p of pages) {
    const active = p.key === currentPage.key;
    html += `<a class="public-page-item${p.cls ? ' ' + p.cls : ''}${active ? ' is-active' : ''}" href="${p.href}"`;
    if (active) html += ` aria-current="page"`;
    html += ` onclick="savePageChoice('${p.key}')"><span class="public-page-icon">${p.icon}</span><span>${esc(p.label)}</span></a>`;
  }
  html += `</div></nav>`;
  if (_showHeaderAdminSignIn()) {
    // Compact key + "Admin" so it never collides with the centred page button;
    // the full "Admin sign in" label stays the accessible name.
    html += `<a class="public-admin-link" href="/admin" aria-label="${escAttr(t('txt_nav_admin_sign_in'))}" onclick="savePageChoice('admin')">`
      + `${_ic('key')}<span aria-hidden="true">${esc(t('txt_nav_admin'))}</span></a>`;
  }
  html += `</header>`;
  if (getClubSubdomain()) _patchPublicHeaderClubName();
  return html;
}

/** "English · Dark" — the current values shown on the language/theme button. */
function _displayLineValue() {
  const lang = getAppLanguage() === 'es' ? 'Español' : 'English';
  const pref = getThemePreference();
  const themeLabel = pref === 'auto'
    ? t('txt_display_theme_auto')
    : (pref === 'light' ? t('txt_display_theme_light') : t('txt_display_theme_dark'));
  return `${lang} · ${themeLabel}`;
}

/** Inner markup of the language/theme button: globe + "English · Dark" (phones: "EN"). */
function _displayButtonInner() {
  const short = getAppLanguage() === 'es' ? 'ES' : 'EN';
  return `${_ic('globe')}<span class="public-display-value">${esc(_displayLineValue())}</span>`
    + `<span class="public-display-value-short" aria-hidden="true">${short}</span>`;
}

/** Accessible name of the language/theme button ("Language and theme: English · Dark"). */
function _displayButtonLabel() {
  return t('txt_display_btn_aria', { value: _displayLineValue() });
}

/**
 * Language/theme button (opens the Display sheet). Sits at the left end of
 * the shared header (buildPublicHeaderHtml) and of the TV live-board header.
 * @returns {string} HTML
 */
function buildDisplayButtonHtml() {
  const open = Boolean(document.getElementById('display-sheet-backdrop'));
  return `<button type="button" class="public-display-btn" aria-haspopup="dialog" aria-expanded="${open ? 'true' : 'false'}" aria-controls="display-sheet" `
    + `aria-label="${escAttr(_displayButtonLabel())}" title="${escAttr(_displayButtonLabel())}" onclick="openDisplaySheet(this)">`
    + `${_displayButtonInner()}</button>`;
}

/** Open/close the header page dropdown. */
function togglePublicPageMenu(open) {
  const btn = document.querySelector('#public-page-selector .public-page-btn');
  const menu = document.getElementById('public-page-menu');
  if (!btn || !menu) return;
  const show = typeof open === 'boolean' ? open : menu.hidden;
  menu.hidden = !show;
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}

document.addEventListener('click', (ev) => {
  const sel = document.getElementById('public-page-selector');
  if (sel && !sel.contains(ev.target)) togglePublicPageMenu(false);
});
document.addEventListener('keydown', (ev) => {
  const menu = document.getElementById('public-page-menu');
  if (ev.key !== 'Escape' || !menu || menu.hidden) return;
  togglePublicPageMenu(false);
  document.querySelector('#public-page-selector .public-page-btn')?.focus();
});

/**
 * The club entry is rendered as "Club" immediately; once the subdomain
 * resolves the full club name is set as its tooltip/accessible name.
 */
function _patchPublicHeaderClubName() {
  resolveClubSubdomainContext().then(club => {
    if (!club || !club.name) return;
    document.querySelectorAll('.public-page-item--club').forEach(el => {
      el.setAttribute('title', club.name);
      el.setAttribute('aria-label', club.name);
    });
  }).catch(() => {});
}

/** Re-render the header in place (session/language/theme changes). */
function refreshPublicHeader() {
  const el = document.getElementById('public-header');
  if (!el || !_publicHeaderCurrent) return;
  el.outerHTML = buildPublicHeaderHtml(_publicHeaderCurrent);
}

// ── Display sheet (language + theme) ─────────────────────

let _displaySheetTrigger = null;

function _displaySheetMarkup() {
  const lang = getAppLanguage();
  const pref = getThemePreference();
  const seg = (group, value, current, label) => {
    const on = value === current;
    return `<button type="button" role="radio" aria-checked="${on ? 'true' : 'false'}" class="display-seg-btn${on ? ' is-active' : ''}" `
      + `onclick="${group === 'lang' ? `setDisplayLanguage('${value}')` : `setDisplayTheme('${value}')`}">${esc(label)}</button>`;
  };
  return `
    <div class="display-sheet-head">
      <h2 class="display-sheet-title" id="display-sheet-title">${esc(t('txt_display_label'))}</h2>
      <button type="button" class="display-sheet-close" aria-label="${escAttr(t('txt_txt_close'))}" onclick="closeDisplaySheet()">×</button>
    </div>
    <div class="display-sheet-group">
      <div class="display-sheet-group-label" id="display-lang-label">${esc(t('txt_txt_language'))}</div>
      <div class="display-seg" role="radiogroup" aria-labelledby="display-lang-label">
        ${seg('lang', 'en', lang, 'English')}${seg('lang', 'es', lang, 'Español')}
      </div>
    </div>
    <div class="display-sheet-group">
      <div class="display-sheet-group-label" id="display-theme-label">${esc(t('txt_display_theme'))}</div>
      <div class="display-seg" role="radiogroup" aria-labelledby="display-theme-label">
        ${seg('theme', 'light', pref, t('txt_display_theme_light'))}${seg('theme', 'dark', pref, t('txt_display_theme_dark'))}${seg('theme', 'auto', pref, t('txt_display_theme_auto'))}
      </div>
    </div>`;
}

/** Re-render the sheet body while it is open (after a language/theme change). */
function _renderDisplaySheetContent() {
  const sheet = document.getElementById('display-sheet');
  if (!sheet) return;
  const focused = document.activeElement;
  const focusedLabel = focused && sheet.contains(focused) ? focused.textContent : null;
  sheet.innerHTML = _displaySheetMarkup();
  if (focusedLabel !== null) {
    const again = [...sheet.querySelectorAll('button')].find(b => b.textContent === focusedLabel);
    if (again) again.focus();
  }
}

/**
 * Open the Display sheet (bottom sheet on phones, centred above the footer on desktop).
 * @param {HTMLElement} [trigger] the Display button, focus returns to it on close
 */
function openDisplaySheet(trigger) {
  if (document.getElementById('display-sheet-backdrop')) return;
  _displaySheetTrigger = trigger || document.querySelector('.public-display-btn');
  const backdrop = document.createElement('div');
  backdrop.id = 'display-sheet-backdrop';
  backdrop.className = 'display-sheet-backdrop';
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) closeDisplaySheet(); });
  const sheet = document.createElement('div');
  sheet.id = 'display-sheet';
  sheet.className = 'display-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'display-sheet-title');
  sheet.innerHTML = _displaySheetMarkup();
  backdrop.appendChild(sheet);
  // Wider screens: anchor the card under the button instead of a bottom sheet.
  if (_displaySheetTrigger && window.matchMedia('(min-width: 640px)').matches) {
    const r = _displaySheetTrigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
    backdrop.style.setProperty('--display-sheet-top', `${Math.round(r.bottom + 6)}px`);
    backdrop.style.setProperty('--display-sheet-left', `${Math.round(left)}px`);
  }
  document.body.appendChild(backdrop);
  lockPageScroll();
  document.querySelectorAll('.public-display-btn').forEach(b => b.setAttribute('aria-expanded', 'true'));
  document.addEventListener('keydown', _displaySheetKeyHandler);
  const first = sheet.querySelector('.display-seg-btn.is-active') || sheet.querySelector('button');
  if (first) first.focus();
}

function closeDisplaySheet() {
  const backdrop = document.getElementById('display-sheet-backdrop');
  if (!backdrop) return;
  backdrop.remove();
  unlockPageScroll();
  document.removeEventListener('keydown', _displaySheetKeyHandler);
  document.querySelectorAll('.public-display-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  const trigger = _displaySheetTrigger && _displaySheetTrigger.isConnected
    ? _displaySheetTrigger
    : document.querySelector('.public-display-btn');
  _displaySheetTrigger = null;
  if (trigger) trigger.focus();
}

function _displaySheetKeyHandler(ev) {
  if (ev.key === 'Escape') { closeDisplaySheet(); return; }
  if (ev.key !== 'Tab') return;
  // Keep focus inside the dialog.
  const sheet = document.getElementById('display-sheet');
  if (!sheet) return;
  const focusable = [...sheet.querySelectorAll('button')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
}

/** Update every language/theme button in place (keeps the element and its focus). */
function _refreshDisplayButtons() {
  document.querySelectorAll('.public-display-btn').forEach(btn => {
    btn.innerHTML = _displayButtonInner();
    btn.setAttribute('aria-label', _displayButtonLabel());
    btn.setAttribute('title', _displayButtonLabel());
  });
}

document.addEventListener('app-language-changed', () => {
  refreshPublicHeader();
  _refreshDisplayButtons();
  _renderDisplaySheetContent();
});

/** Remember the page the visitor navigated to (read by the root redirect). */
function savePageChoice(page) {
  try { localStorage.setItem('amistoso-last-page', page); } catch (_) {}
}


// ── Public event directory helpers (club page + /events) ─────────────────
// Both directories render the same card: name + badges, whole card is the
// link. Keeping badge + grouping rules here means a status rule changes in
// one place for both surfaces.

/** Public page for a directory item: live board for tournaments, sign-up form for lobbies. */
function publicEventHref(it) {
  const slug = encodeURIComponent(it.alias || it.id);
  return it.kind === 'registration' ? `/register/${slug}` : `/tv/${slug}`;
}

const _PUBLIC_EVENT_TYPE_KEY = {
  group_playoff: 'txt_club_type_gp',
  mexicano: 'txt_club_type_mex',
  playoff: 'txt_club_type_po',
};

/**
 * Badges for a public directory item (text labels, never colour alone).
 * @param {object} it directory item from /api/public-events or /public-tournaments
 * @param {{hideSport?: boolean}} [opts] hide the sport badge when a sport filter already implies it
 * @returns {{cls: string, label: string}[]}
 */
function publicEventBadges(it, opts = {}) {
  const out = [];
  if (it.sport && !opts.hideSport) {
    out.push({
      cls: `club-item-badge--sport club-item-badge--${it.sport}`,
      label: it.sport === 'tennis' ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel'),
    });
  }
  if (it.kind === 'registration') {
    const n = Number(it.registrant_count) || 0;
    out.push({ cls: 'club-item-badge--count', label: t(n === 1 ? 'txt_club_signed_up_one' : 'txt_club_signed_up_many', { n }) });
    if (it.join_code_required) out.push({ cls: 'club-item-badge--code', label: t('txt_reg_join_code_badge') });
    return out;
  }
  const typeKey = _PUBLIC_EVENT_TYPE_KEY[it.type];
  if (typeKey) out.push({ cls: 'club-item-badge--type', label: t(typeKey) });
  if (it.status === 'upcoming') out.push({ cls: 'club-item-badge--status', label: t('txt_club_status_not_started') });
  return out;
}

/**
 * Group live-tab items: "Tournaments" (live first, then not started) and
 * "Sign-ups open". Server order is kept inside each bucket (pinned first).
 * @param {object[]} items
 * @returns {{key: string, labelKey: string, items: object[]}[]} non-empty groups only
 */
function publicEventGroups(items) {
  const list = Array.isArray(items) ? items : [];
  const tournaments = [
    ...list.filter(it => it.kind !== 'registration' && it.status === 'in_progress'),
    ...list.filter(it => it.kind !== 'registration' && it.status === 'upcoming'),
  ];
  const signups = list.filter(it => it.kind === 'registration' && it.status === 'open_registration');
  return [
    { key: 'tournaments', labelKey: 'txt_club_group_tournaments', items: tournaments },
    { key: 'signups', labelKey: 'txt_club_group_signups', items: signups },
  ].filter(g => g.items.length > 0);
}

// ── SSE (Server-Sent Events) helper ─────────────────────────────────────

/**
 * Subscribe to an SSE endpoint with automatic reconnection and polling fallback.
 *
 * Returns a controller object with a `close()` method to cleanly tear down the
 * subscription (closes the EventSource or clears the poll timer).
 *
 * @param {object} opts
 * @param {string} opts.url              SSE endpoint URL, e.g. `/api/tournaments/018f0c36-7b4a-7cc2-9e6b-7f6cfd6d3f6c/events`
 * @param {string} opts.pollUrl          Polling fallback URL, e.g. `/api/tournaments/018f0c36-7b4a-7cc2-9e6b-7f6cfd6d3f6c/version`
 * @param {number} opts.pollIntervalMs   Polling interval in ms (default: 3000)
 * @param {function} opts.onVersion      Called with the parsed data object on each event
 * @returns {{ close: function }}
 */
function createVersionStream(opts) {
  const { url, pollUrl, pollIntervalMs = 3000, onVersion } = opts;
  let eventSource = null;
  let pollTimer = null;
  let pollEtag = null;
  let closed = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY_MS = 30000;

  function _connectSSE() {
    if (closed) return;
    try {
      eventSource = new EventSource(url);
    } catch (_) {
      _fallbackToPoll();
      return;
    }
    eventSource.onmessage = (ev) => {
      if (closed) return;
      reconnectAttempts = 0;
      try {
        const data = JSON.parse(ev.data);
        onVersion(data);
      } catch (_) {}
    };
    eventSource.onopen = () => { reconnectAttempts = 0; };
    eventSource.onerror = () => {
      if (closed) return;
      // EventSource will auto-reconnect, but if we keep failing fall back
      // to polling after a few attempts.
      reconnectAttempts++;
      if (reconnectAttempts > 3) {
        eventSource.close();
        eventSource = null;
        _fallbackToPoll();
      }
    };
  }

  function _fallbackToPoll() {
    if (closed || pollTimer) return;
    let _fetching = false;
    pollTimer = setInterval(async () => {
      if (closed || _fetching) return;
      _fetching = true;
      try {
        const r = await fetch(pollUrl, {
          headers: pollEtag ? { 'If-None-Match': pollEtag } : undefined,
        });
        if (r.status === 304) return;
        const etag = r.headers.get('etag');
        if (etag) pollEtag = etag;
        const data = await r.json();
        onVersion(data);
      } catch (_) {}
      finally { _fetching = false; }
    }, pollIntervalMs);
  }

  // Start with SSE; fall back automatically.
  _connectSSE();

  return {
    close() {
      closed = true;
      if (eventSource) { eventSource.close(); eventSource = null; }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    },
  };
}

// ---------------------------------------------------------------------------
// Page scroll lock (modals: player mini-cards, Display sheet)
// ---------------------------------------------------------------------------

let _scrollLockCount = 0;
let _scrollLockY = 0;

/**
 * Freeze the page behind a modal. `overflow: hidden` alone does not stop iOS
 * Safari from scrolling the page when a swipe starts on the backdrop, so the
 * body is pinned with `position: fixed` at the current offset and the scroll
 * position is restored on unlock. Ref-counted: nested modals unlock once.
 */
function lockPageScroll() {
  _scrollLockCount += 1;
  if (_scrollLockCount > 1) return;
  _scrollLockY = window.scrollY || window.pageYOffset || 0;
  const body = document.body;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  body.style.position = 'fixed';
  body.style.top = `-${_scrollLockY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  document.documentElement.classList.add('scroll-locked');
}

/** Release one lockPageScroll() call; the last one restores the page. */
function unlockPageScroll() {
  if (_scrollLockCount === 0) return;
  _scrollLockCount -= 1;
  if (_scrollLockCount > 0) return;
  const body = document.body;
  for (const prop of ['position', 'top', 'left', 'right', 'width', 'paddingRight']) body.style[prop] = '';
  document.documentElement.classList.remove('scroll-locked');
  window.scrollTo({ top: _scrollLockY, left: 0, behavior: 'instant' });
}

// ---------------------------------------------------------------------------
// Player mini-card primitives (shared by club.js and tv.js)
// ---------------------------------------------------------------------------

const _MINI_CARD_FOCUSABLE ='button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Create (once) and return the modal overlay element for a mini-card.
 * Wires Esc + backdrop close, focus trap, and focus restoration.
 *
 * @param {object} opts
 * @param {string} opts.id        — DOM id of the overlay node (per page).
 * @param {string} opts.className — overlay CSS class (e.g. 'club-mini-card-overlay').
 * @param {() => void} opts.onClose — invoked when user dismisses the overlay.
 * @returns {HTMLElement}
 */
function ensureMiniCardOverlay({ id, className, onClose }) {
  let overlay = document.getElementById(id);
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = className;
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay._miniCardLastFocus = null;
  overlay._miniCardOnClose = onClose;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) onClose();
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const focusables = overlay.querySelectorAll(_MINI_CARD_FOCUSABLE);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Show a mini-card overlay, remember the trigger, and focus into it. Locks
 * the page scroll and pushes a history entry so the back gesture closes the
 * card instead of leaving the page. Idempotent while the card is open.
 */
function showMiniCardOverlay(overlay) {
  if (overlay.hidden) {
    overlay._miniCardLastFocus = document.activeElement;
    overlay.hidden = false;
    lockPageScroll();
    try {
      history.pushState({ miniCard: overlay.id }, '');
      overlay._miniCardPop = () => {
        // Back gesture: the entry is already gone, just close.
        window.removeEventListener('popstate', overlay._miniCardPop);
        overlay._miniCardPop = null;
        if (typeof overlay._miniCardOnClose === 'function') overlay._miniCardOnClose();
        else hideMiniCardOverlay(overlay);
      };
      window.addEventListener('popstate', overlay._miniCardPop);
    } catch (_) { /* history unavailable */ }
  }
  // Defer focus so the rendered close button exists.
  setTimeout(() => {
    const first = overlay.querySelector(_MINI_CARD_FOCUSABLE);
    if (first) first.focus();
  }, 0);
}

/**
 * Hide a mini-card overlay, release the scroll lock, drop the history entry
 * pushed on open (unless the back gesture already did), and restore focus.
 */
function hideMiniCardOverlay(overlay) {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  overlay.innerHTML = '';
  unlockPageScroll();
  if (overlay._miniCardPop) {
    window.removeEventListener('popstate', overlay._miniCardPop);
    overlay._miniCardPop = null;
    if (history.state && history.state.miniCard === overlay.id) history.back();
  }
  const restore = overlay._miniCardLastFocus;
  overlay._miniCardLastFocus = null;
  if (restore && typeof restore.focus === 'function') {
    try { restore.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }
}

// ── Petite-Vue reactive islands ─────────────────────────────────────────
//
// Petite-Vue (loaded via CDN as the `PetiteVue` global) is the sanctioned
// reactive layer for this app — no build step, mounted one container at a
// time so unconverted views keep working alongside converted ones. These two
// helpers are the shared entry point for every migrated view: build a store
// with `reactiveStore()`, mount it onto a `v-scope` root with `mountIsland()`.
// See `.github/skills/frontend-dev/SKILL.md` → "Reactive views with Petite-Vue"
// for the full conversion recipe.

/**
 * Shared globals injected into every reactive island's scope so templates can
 * call them as bare functions (`{{ t('txt_key') }}`, `@click="esc(...)"`, …)
 * without each view re-wiring them. Values are read lazily at mount time, so a
 * page that defines its own `api()` (admin/tv) still gets that page's version.
 * @returns {object}
 */
function _islandGlobals() {
  const g = {};
  for (const name of ['t', 'ts', 'trl', 'esc', 'escAttr', 'api']) {
    const fn = window[name];
    if (typeof fn === 'function') g[name] = fn;
  }
  return g;
}

/**
 * Wrap a plain object in Petite-Vue reactivity, giving a view one named store
 * whose mutations auto-patch the bound DOM — replacing the scattered
 * module-level `let` vars + manual `renderX()` calls of the legacy pattern.
 *
 * Falls back to returning the object unchanged if Petite-Vue is unavailable
 * (e.g. CDN blocked offline before caching), so callers never crash — the view
 * just won't be reactive until the library loads.
 *
 * @param {object} obj  Initial state (data + methods).
 * @returns {object}    The reactive proxy (or `obj` if Petite-Vue is missing).
 */
function reactiveStore(obj) {
  if (typeof PetiteVue === 'undefined' || !PetiteVue.reactive) return obj;
  return PetiteVue.reactive(obj);
}

/**
 * Mount a Petite-Vue app onto a single existing container (a `v-scope` root),
 * not the whole page. Injects the shared globals (`t`, `esc`, `api`, …) into
 * the scope so templates can call them directly. Guards against double-mount
 * (re-calling on the same element is a no-op) and against a missing root or a
 * missing Petite-Vue library.
 *
 * SSE-driven views should mutate the returned store inside their
 * `createVersionStream({ onVersion })` callback rather than calling a full
 * `loadX()` rebuild — Petite-Vue patches only the changed nodes, so open forms
 * and scroll position survive live updates.
 *
 * @param {string|Element} rootSelector  CSS selector or element to mount on.
 * @param {object|function} scope        The reactive store (or a factory returning one).
 * @returns {object|null}                The mounted scope, or null if it couldn't mount.
 */
function mountIsland(rootSelector, scope) {
  const root = typeof rootSelector === 'string'
    ? document.querySelector(rootSelector)
    : rootSelector;
  if (!root) {
    console.warn('[mountIsland] root not found:', rootSelector);
    return null;
  }
  if (root._petiteVueMounted) return root._petiteVueScope || null;
  if (typeof PetiteVue === 'undefined' || !PetiteVue.createApp) {
    console.warn('[mountIsland] Petite-Vue not loaded; skipping mount for', rootSelector);
    return null;
  }
  const resolved = typeof scope === 'function' ? scope() : scope;
  // Inject the globals onto the store itself rather than copying the store
  // into a new object: petite-vue's createApp() reuses an already-reactive
  // scope as-is, so this keeps the caller's store and the mounted scope the
  // SAME reactive proxy — external mutations (store.foo = x) patch the DOM.
  // An Object.assign copy here would silently disconnect the two.
  const globals = _islandGlobals();
  for (const key in globals) {
    if (!(key in resolved)) resolved[key] = globals[key];
  }
  PetiteVue.createApp(resolved).mount(root);
  root._petiteVueMounted = true;
  root._petiteVueScope = resolved;
  return resolved;
}

// ─── Payments (shared by admin, register and Player Hub views) ───────────

/**
 * Format an amount in minor units as a localized currency string.
 * @param {number} cents
 * @param {string} currency  ISO-4217 code (e.g. "EUR")
 * @returns {string}
 */
function formatMoney(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  const code = (currency || 'EUR').toUpperCase();
  const locale = _currentLang === 'es' ? 'es-ES' : 'en-GB';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/**
 * Human label for a payment method (custom label wins over the kind name).
 * @param {{kind: string, label?: string|null}} m
 * @returns {string}
 */
function paymentMethodLabel(m) {
  if (!m) return '';
  if (m.label) return m.label;
  return t(`txt_pay_kind_${m.kind}`);
}

/**
 * For link-type methods (Revolut, PayPal.me) return an absolute URL, optionally
 * with the amount embedded the way each service accepts it; otherwise null.
 * @param {{kind: string, value: string}} m
 * @param {number} [cents]
 * @param {string} [currency]
 * @returns {string|null}
 */
function paymentMethodHref(m, cents, currency) {
  if (!m || !m.value) return null;
  if (m.kind !== 'revolut' && m.kind !== 'paypal_me') return null;
  let url = String(m.value).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!cents) return url;
  const amount = (Number(cents) / 100).toFixed(2);
  const code = (currency || 'EUR').toUpperCase();
  try {
    const u = new URL(url);
    if (m.kind === 'paypal_me') {
      // paypal.me/<user>/<amount><CUR>
      if (!/\/\d+(\.\d+)?[A-Za-z]{3}$/.test(u.pathname)) {
        u.pathname = `${u.pathname.replace(/\/$/, '')}/${amount}${code}`;
      }
    } else if (!u.searchParams.has('amount')) {
      u.searchParams.set('amount', amount);
      u.searchParams.set('currency', code);
    }
    return u.toString();
  } catch (_) {
    return url;
  }
}

/**
 * Copy text to the clipboard (with a textarea fallback). Resolves true on success.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'clipboard-shim';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}
