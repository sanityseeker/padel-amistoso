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
    'admin', 'tv', 'player', 'register', 'api', 'www', 'app', 'mail', 'ftp', 'static', 'assets'
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
 * Transient success feedback on the control the user just acted on.
 *
 * Plays the shared `flash-success` animation (theme.css) and optionally swaps
 * the element's label for a short moment (plain text — no ✓/✗ glyphs; the
 * animation itself is the success signal). Safe on any element.
 *
 * @param {HTMLElement|null} el
 * @param {string} [tempLabel] optional temporary label, e.g. t('txt_txt_copied')
 */
function flashSuccess(el, tempLabel) {
  if (!el) return;
  el.classList.remove('flash-success');
  void el.offsetWidth; // restart the animation when re-triggered quickly
  el.classList.add('flash-success');
  let originalLabel = null;
  const isButton = el.tagName === 'BUTTON';
  if (tempLabel !== undefined && tempLabel !== null) {
    originalLabel = el.textContent;
    el.textContent = tempLabel;
    if (isButton) el.disabled = true;
  }
  setTimeout(() => {
    el.classList.remove('flash-success');
    if (originalLabel !== null) {
      el.textContent = originalLabel;
      if (isButton) el.disabled = false;
    }
  }, 1400);
}

/**
 * Copies the tournament URL to the clipboard.
 */
function copyTournamentUrl() {
  const { id: tournamentId, alias } = getTournamentIdFromUrl();
  const link = alias ? `/${alias}` : `/tv/${encodeURIComponent(tournamentId)}`;
  const fullUrl = window.location.origin + link;
  navigator.clipboard.writeText(fullUrl).then(() => {
    flashSuccess(document.getElementById('copy-tv-url-button'), t('txt_tv_url_copied'));
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
let _lbDrag = { active: false, moved: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 };

function _openBracketLightbox(src) {
  const lb  = document.getElementById('bracket-lightbox');
  const img = document.getElementById('bracket-lightbox-img');
  if (!lb || !img) return;
  _lbZoom = 1.0;
  _lbSrc  = src;
  _lbDrag.active = false;
  _lbDrag.moved  = false;
  img.style.width    = '';
  img.style.maxWidth = '';
  img.src = src;
  lb.classList.add('open');
  _bracketLightboxUpdateZoom();
  document.addEventListener('keydown', _bracketLightboxKeyHandler);

  // Mouse drag-to-pan — listeners attached to document so dragging outside the
  // scroll container still works across the whole bracket lightbox.
  const scroll = lb.querySelector('.bracket-lightbox-scroll');
  if (scroll) {
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
  const lb = document.getElementById('bracket-lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  _lbDrag.active = false; // cancel any in-progress drag
  document.removeEventListener('keydown', _bracketLightboxKeyHandler);
  const scroll = lb.querySelector('.bracket-lightbox-scroll');
  if (scroll) {
    scroll.style.cursor     = '';
    scroll.style.userSelect = '';
    scroll.onmousedown = null;
    // document-level mousemove/mouseup listeners are self-removing (cleaned up in onMouseUp)
  }
}

function _bracketLightboxUpdateZoom() {
  const label = document.getElementById('bracket-lb-zoom-level');
  if (label) label.textContent = Math.round(_lbZoom * 100) + '%';
  const img = document.getElementById('bracket-lightbox-img');
  if (!img) return;
  if (_lbZoom === 1.0) {
    img.style.width    = '';
    img.style.maxWidth = '';
  } else {
    const w = img.naturalWidth || 800;
    img.style.maxWidth = 'none';
    img.style.width    = Math.round(w * _lbZoom) + 'px';
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
  html += `<span>${current.icon}</span> <span>${esc(current.label)}</span> <span style="font-size:0.7rem;color:var(--text-muted)">▾</span>`;
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
  return `<button type="button" onclick="${escAttr(onclickHandler)}" style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:0.15rem 0.45rem;cursor:pointer;font-size:0.8rem;line-height:1" title="${escAttr(title)}">↻</button>`;
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
