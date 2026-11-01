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

// ── Page selector (shared across all pages) ───────────────

function buildPageSelectorHtml(currentPage) {
  const pages = [
    { key: 'admin', href: '/admin', icon: '🛠️', label: t('txt_nav_admin') },
    { key: 'player', href: '/player', icon: '🎾', label: t('txt_nav_player_space') },
    { key: 'tv', href: '/tv', icon: '📺', label: t('txt_nav_tv_view') },
    { key: 'register', href: '/register', icon: '📋', label: t('txt_nav_registrations') },
  ];
  const current = pages.find(p => p.key === currentPage) || pages[0];
  const homePage = getHomePage();
  const isPinned = homePage === currentPage;
  let html = `<div class="tv-page-selector" id="page-selector">`;
  html += `<button type="button" class="tv-page-selector-btn" onclick="togglePageSelectorDropdown()">`;
  html += `<span>${current.icon}</span> <span>${esc(current.label)}</span> <span class="fs-2xs text-muted">▾</span>`;
  html += `</button>`;
  html += `<div class="tv-page-selector-menu" id="page-selector-menu">`;
  for (const p of pages) {
    const active = p.key === currentPage ? ' active' : '';
    const pinIndicator = p.key === homePage ? ' 📌' : '';
    html += `<a href="${p.href}" class="tv-page-selector-item${active}" onclick="savePageChoice('${p.key}')">`;
    html += `<span>${p.icon}</span> <span>${esc(p.label)}${pinIndicator}</span></a>`;
  }
  html += `<div class="page-selector-divider"></div>`;
  html += `<button type="button" class="page-selector-pin-btn" onclick="toggleHomePage('${currentPage}')">`;
  html += isPinned
    ? `<span>📌</span> <span>${esc(t('txt_nav_unset_home'))}</span>`
    : `<span>📍</span> <span>${esc(t('txt_nav_set_home'))}</span>`;
  html += `</button>`;
  html += `</div></div>`;
  return html;
}

function buildCompactRefreshButtonHtml(onclickHandler, title) {
  return `<button type="button" onclick="${escAttr(onclickHandler)}" class="btn-refresh" title="${escAttr(title)}">↻</button>`;
}

function togglePageSelectorDropdown() {
  const el = document.getElementById('page-selector');
  if (el) el.classList.toggle('open');
}

function savePageChoice(page) {
  try { localStorage.setItem('amistoso-last-page', page); } catch (_) {}
}

const HOME_PAGE_KEY = 'amistoso-home-page';

function getHomePage() {
  try { return localStorage.getItem(HOME_PAGE_KEY); } catch (_) { return null; }
}

function setHomePage(page) {
  try { localStorage.setItem(HOME_PAGE_KEY, page); } catch (_) {}
}

function clearHomePage() {
  try { localStorage.removeItem(HOME_PAGE_KEY); } catch (_) {}
}

function toggleHomePage(currentPage) {
  if (getHomePage() === currentPage) {
    clearHomePage();
  } else {
    setHomePage(currentPage);
  }
  // Re-render the dropdown to reflect the new state
  const sel = document.getElementById('page-selector');
  if (sel) {
    const parent = sel.parentNode;
    const newHtml = buildPageSelectorHtml(currentPage);
    sel.outerHTML = newHtml;
    // Re-open the dropdown so the user sees the change
    const newSel = document.getElementById('page-selector');
    if (newSel) newSel.classList.add('open');
  }
}

// Close page selector when clicking outside
document.addEventListener('click', (e) => {
  const sel = document.getElementById('page-selector');
  if (sel && !sel.contains(e.target)) sel.classList.remove('open');
});

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
// Player mini-card primitives (shared by club.js and tv.js)
// ---------------------------------------------------------------------------

const _MINI_CARD_FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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

/** Show a mini-card overlay, remember the trigger, and focus into it. */
function showMiniCardOverlay(overlay) {
  overlay._miniCardLastFocus = document.activeElement;
  overlay.hidden = false;
  // Defer focus so the rendered close button exists.
  setTimeout(() => {
    const first = overlay.querySelector(_MINI_CARD_FOCUSABLE);
    if (first) first.focus();
  }, 0);
}

/** Hide a mini-card overlay and restore focus to the originating element. */
function hideMiniCardOverlay(overlay) {
  if (!overlay) return;
  overlay.hidden = true;
  overlay.innerHTML = '';
  const restore = overlay._miniCardLastFocus;
  overlay._miniCardLastFocus = null;
  if (restore && typeof restore.focus === 'function') {
    try { restore.focus(); } catch (_) { /* ignore */ }
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
