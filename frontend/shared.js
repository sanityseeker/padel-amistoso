/**
 * shared.js — utilities used by both index.html (admin) and tv.html.
 *
 * Loaded as <script src="/shared.js"> in both pages.
 */

// ── HTML escaping ─────────────────────────────────────────

/**
 * Escape a value for safe insertion into HTML text content.
 * @param {*} s
 * @returns {string}
 */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
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

// ── Theme persistence ─────────────────────────────────────

/** Single storage key shared by all pages. */
const THEME_KEY = 'padel-theme';

/**
 * Apply a theme to the document root and return the normalised value.
 * Does NOT persist to localStorage.
 * @param {'light'|'dark'} theme
 * @returns {'light'|'dark'}
 */
function _applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  return t;
}

/**
 * Read the last saved theme from localStorage (defaults to 'dark').
 * @returns {'light'|'dark'}
 */
function _loadSavedTheme() {
  try { return /** @type {'light'|'dark'} */ (localStorage.getItem(THEME_KEY) || 'dark'); } catch (_) { return 'dark'; }
}

/**
 * Persist a theme value to localStorage.
 * @param {'light'|'dark'} theme
 */
function _saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}
