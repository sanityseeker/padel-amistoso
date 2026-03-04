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
  const mode = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', mode);
  return mode;
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

// ── Language persistence + i18n ───────────────────────────

/** Single storage key shared by all pages. */
const LANG_KEY = 'padel-lang';

/** @type {'en'|'es'} */
let _currentLang = 'en';

/** @returns {'en'|'es'} */
function _loadSavedLanguage() {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return value === 'es' ? 'es' : 'en';
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
}

function initLanguage() {
  _currentLang = _loadSavedLanguage();
  applyI18n(document);
}
