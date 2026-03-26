/**
 * shared.js — utilities used by both index.html (admin) and public.html.
 *
 * This file is loaded as a module, so it has its own scope. Functions and
 * variables defined here are not available to the global scope.
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

/**
 * Escape a value for safe insertion into an HTML attribute.
 * Extends esc() by also escaping single and double quotes.
 * @param {*} s
 * @returns {string}
 */
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
 * Refreshes the status of the tournament.
 * @param {Object} { id: string, alias: string }
 */
async function refreshStatus() {
  const { id: tournamentId, alias } = getTournamentIdFromUrl();
  if (!tournamentId && !alias) {
    return;
  }
  const response = await fetch(`/api/tournaments/${tournamentId}`);
  if (!response.ok) {
    console.error(`Failed to refresh status for tournament ${tournamentId}`);
    return;
  }
  const data = await response.json();
  console.log(`Status refreshed for tournament ${tournamentId}`, data);
}

/**
 * Sets the tournament link.
 * @param {Object} { id: string, alias: string }
 */
function setTournamentLink({ id, alias }) {
  const tournamentLink = document.getElementById('tournament-link');
  if (tournamentLink) {
    const link = alias ? `/${alias}` : `/tv?id=${id}`;
    tournamentLink.setAttribute('href', link);
  }
}

/**
 * Copies the tournament URL to the clipboard.
 */
function copyTournamentUrl() {
  const { id: tournamentId, alias } = getTournamentIdFromUrl();
  const link = alias ? `/${alias}` : `/tv?id=${tournamentId}`;
  const fullUrl = window.location.origin + link;
  navigator.clipboard.writeText(fullUrl).then(() => {
    const copyButton = document.getElementById('copy-tv-url-button');
    if (copyButton) {
      const originalText = copyButton.innerText;
      copyButton.innerText = t('txt_tv_url_copied');
      setTimeout(() => {
        copyButton.innerText = originalText;
      }, 2000);
    }
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
let _lbZoom = 1.0;
let _lbSrc  = '';

function _openBracketLightbox(src) {
  const lb  = document.getElementById('bracket-lightbox');
  const img = document.getElementById('bracket-lightbox-img');
  if (!lb || !img) return;
  _lbZoom = 1.0;
  _lbSrc  = src;
  img.style.width    = '';
  img.style.maxWidth = '';
  img.src = src;
  lb.classList.add('open');
  _bracketLightboxUpdateZoom();
  document.addEventListener('keydown', _bracketLightboxKeyHandler);
}

function _closeBracketLightbox(e) {
  // If click event, only close when clicking the backdrop (not the image)
  if (e && e.target && (e.target.tagName === 'IMG' || e.target.closest('.bracket-lb-toolbar'))) return;
  const lb = document.getElementById('bracket-lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.removeEventListener('keydown', _bracketLightboxKeyHandler);
}

function _bracketLightboxUpdateZoom() {
  const label = document.getElementById('bracket-lb-zoom-level');
  if (label) label.textContent = Math.round(_lbZoom * 100) + '%';
  const img = document.getElementById('bracket-lightbox-img');
  if (!img) return;
  if (_lbZoom === 1.0) {
    img.style.width    = '';
    img.style.maxWidth = '';
    img.style.cursor   = 'zoom-in';
  } else {
    const w = img.naturalWidth || 800;
    img.style.maxWidth = 'none';
    img.style.width    = Math.round(w * _lbZoom) + 'px';
    img.style.cursor   = _lbZoom > 1 ? 'zoom-out' : 'zoom-in';
  }
}

function _bracketLightboxZoomIn() {
  _lbZoom = Math.min(4.0, +(_lbZoom * 1.25).toFixed(3));
  _bracketLightboxUpdateZoom();
}

function _bracketLightboxZoomOut() {
  _lbZoom = Math.max(0.25, +(_lbZoom / 1.25).toFixed(3));
  _bracketLightboxUpdateZoom();
}

function _bracketLightboxZoomReset() {
  _lbZoom = 1.0;
  _bracketLightboxUpdateZoom();
}

function _bracketLightboxOpenFull() {
  if (_lbSrc) window.open(_lbSrc, '_blank', 'noopener');
}

function _bracketLightboxDownload() {
  if (!_lbSrc) return;
  const a    = document.createElement('a');
  a.href     = _lbSrc;
  a.download = 'bracket.png';
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

// ── Page selector (shared across all pages) ───────────────

function buildPageSelectorHtml(currentPage) {
  const pages = [
    { key: 'admin', href: '/', icon: '🛠️', label: t('txt_nav_admin') },
    { key: 'tv', href: '/tv', icon: '📺', label: t('txt_nav_tv_view') },
    { key: 'register', href: '/register', icon: '📋', label: t('txt_nav_registrations') },
  ];
  const current = pages.find(p => p.key === currentPage) || pages[0];
  let html = `<div class="tv-page-selector" id="page-selector">`;
  html += `<button type="button" class="tv-page-selector-btn" onclick="togglePageSelectorDropdown()">`;
  html += `<span>${current.icon}</span> <span>${esc(current.label)}</span> <span style="font-size:0.7rem;color:var(--text-muted)">▾</span>`;
  html += `</button>`;
  html += `<div class="tv-page-selector-menu" id="page-selector-menu">`;
  for (const p of pages) {
    const active = p.key === currentPage ? ' active' : '';
    html += `<a href="${p.href}" class="tv-page-selector-item${active}" onclick="savePageChoice('${p.key}')">`;
    html += `<span>${p.icon}</span> <span>${esc(p.label)}</span></a>`;
  }
  html += `</div></div>`;
  return html;
}

function togglePageSelectorDropdown() {
  const el = document.getElementById('page-selector');
  if (el) el.classList.toggle('open');
}

function savePageChoice(page) {
  try { localStorage.setItem('amistoso-last-page', page); } catch (_) {}
}

// Close page selector when clicking outside
document.addEventListener('click', (e) => {
  const sel = document.getElementById('page-selector');
  if (sel && !sel.contains(e.target)) sel.classList.remove('open');
});
