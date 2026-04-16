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
 * Copies the tournament URL to the clipboard.
 */
function copyTournamentUrl() {
  const { id: tournamentId, alias } = getTournamentIdFromUrl();
  const link = alias ? `/${alias}` : `/tv/${encodeURIComponent(tournamentId)}`;
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
