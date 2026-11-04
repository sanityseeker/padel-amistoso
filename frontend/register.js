/* ── Registration page ─────────────────────────────────── */
'use strict';

// ── Remember this page for the root redirect ──────────────
try { localStorage.setItem('amistoso-last-page', 'register'); } catch (_) {}

// ── Theme & language (early, before render) ───────────────
// The shared public header (shared.js) owns the language/theme controls; the
// page re-renders on `app-language-changed`.
_applyTheme(_loadSavedTheme());
setAppLanguage(_loadSavedLanguage());

// ── Build header into #reg-root ───────────────────────────
function _buildHeader() {
  return buildPublicHeaderHtml('register');
}

document.addEventListener('app-language-changed', () => _fullRender());

// ── Registration page logic ──────────────────────────────
const API = '/api/registrations';
let _regData = null;
let _lastResult = null;
let _pollTimer = null;
let _lobbyFetching = false;
let _rid = null;
let _urlToken = null; // token passed via email link for auto-login
let _linkedProfilePassphrase = null; // set when Player Hub session is active
let _submittedEmail = ''; // email entered in the form, captured on submit
let _skipProfileAutoLoginOnce = false;
// Success-view UI state lives in `_successStore` (Petite-Vue island, defined
// below next to the success-view logic).
function _resetSuccessUi() {
  _successStore.resetUi();
}

function _registrationIdentityLabel(data) {
  if (!data) return '';
  return data.club_name || data.community_name || '';
}

function _redirectToNotFoundPage(message, redirectTo = '/events') {
  const params = new URLSearchParams();
  if (message) params.set('m', message);
  if (redirectTo) params.set('to', redirectTo);
  window.location.replace(`/404?${params.toString()}`);
}

function _isValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((value || '').trim());
}

// ── Inline SVG icons (no emoji/unicode glyphs in padel-facing UI) ──────────
const _IC_CHECK = 'M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 00-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z';
const _IC_USER = 'M858.5 763.6a374 374 0 00-80.6-119.5 375.63 375.63 0 00-119.5-80.6c-.4-.2-.8-.3-1.2-.5C719.5 518 760 444.7 760 362c0-137-111-248-248-248S264 225 264 362c0 82.7 40.5 156 102.8 201.1-.4.2-.8.3-1.2.5-44.8 18.9-85 46-119.5 80.6a375.63 375.63 0 00-80.6 119.5A371.7 371.7 0 00136 901.8a8 8 0 008 8.2h60c4.4 0 7.9-3.5 8-7.8 2-77.2 33-149.5 87.8-204.3 56.7-56.7 132-87.9 212.2-87.9s155.5 31.2 212.2 87.9C779 752.7 810 825 812 902.2c.1 4.4 3.6 7.8 8 7.8h60a8 8 0 008-8.2c-1-47.8-10.9-94.3-29.5-138.2z';
const _IC_CHEVRON = 'M517.6 273.5L230.2 499.3a16.14 16.14 0 000 25.4l287.4 225.8c10.7 8.4 26.4.8 26.4-12.7V286.2c0-13.5-15.7-21.1-26.4-12.7z';
const _IC_WARN = 'M955.7 856l-416-720c-6.2-10.7-16.9-16-27.7-16s-21.6 5.3-27.7 16l-416 720C56 877.4 71.4 904 96 904h832c24.6 0 40-26.6 27.7-48zM480 416c0-4.4 3.6-8 8-8h48c4.4 0 8 3.6 8 8v184c0 4.4-3.6 8-8 8h-48c-4.4 0-8-3.6-8-8V416zm32 352a48.01 48.01 0 010-96 48.01 48.01 0 010 96z';

function _svgIcon(path) {
  return `<svg class="ic" viewBox="64 64 896 896" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
}

function _nameInitials(name) {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const first = tokens[0][0] || '';
  const last = tokens.length > 1 ? tokens[tokens.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Identity strip shown on the form and success screens: who the visitor is
 * (Player Hub identity) and whether they hold an entry in THIS tournament.
 * The two facts are deliberately side by side so "signed in" is never
 * mistaken for "registered".
 */
function _renderIdentityStrip(opts) {
  const loggedIn = !!opts.loggedIn;
  const name = opts.name || '';
  const showEntryChip = opts.showEntryChip !== false;
  const caption = opts.caption || t('txt_reg_identity_hub_in');

  let html = `<div class="reg-identity-strip">`;
  html += `<div class="reg-identity-who">`;
  if (loggedIn) {
    const initials = _nameInitials(name);
    html += `<span class="reg-avatar in" aria-hidden="true">${initials ? esc(initials) : _svgIcon(_IC_USER)}</span>`;
    html += `<span class="reg-identity-text">`;
    html += `<span class="reg-identity-name">${esc(name)}</span>`;
    html += `<span class="reg-identity-caption">${esc(caption)}</span>`;
    html += `</span>`;
  } else {
    html += `<span class="reg-avatar out" aria-hidden="true">${_svgIcon(_IC_USER)}</span>`;
    html += `<span class="reg-identity-text">`;
    html += `<span class="reg-identity-name reg-identity-name-muted">${t('txt_reg_identity_guest')}</span>`;
    html += `<span class="reg-identity-caption">${t('txt_reg_identity_hub_out')}</span>`;
    html += `</span>`;
  }
  html += `</div>`;
  html += `<div class="reg-identity-actions">`;
  if (showEntryChip) {
    html += `<span class="reg-entry-chip pending">${t('txt_reg_chip_not_registered')}</span>`;
  }
  if (loggedIn) {
    html += `<button type="button" class="reg-ps-logout-link" onclick="_logoutPlayerSpace()">${t('txt_reg_ps_logout')}</button>`;
  }
  html += `</div></div>`;
  return html;
}

function _regTokenKeyCandidates() {
  const ids = [];
  if (_regData?.id) ids.push(_regData.id);
  if (_rid && !ids.includes(_rid)) ids.push(_rid);
  return ids.map((id) => `reg_token_${id}`);
}

function _regTokenPrimaryKey() {
  const keys = _regTokenKeyCandidates();
  return keys.length ? keys[0] : null;
}

function _getRegToken() {
  const keys = _regTokenKeyCandidates();
  if (!keys.length) return null;
  const primaryKey = _regTokenPrimaryKey();

  const parseToken = (value) => {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object') return null;
      const token = typeof parsed.token === 'string' ? parsed.token : null;
      return token;
    } catch (_) {
      _setRegToken(value);
      return value;
    }
  };

  for (const key of keys) {
    try {
      const token = parseToken(localStorage.getItem(key));
      if (token) {
        if (primaryKey && key !== primaryKey) _setRegToken(token);
        return token;
      }
    } catch (_) {}
  }

  for (const key of keys) {
    try {
      const sessionValue = sessionStorage.getItem(key);
      if (sessionValue) {
        try { localStorage.setItem(key, sessionValue); } catch (_) {}
        const token = parseToken(sessionValue);
        if (token) {
          if (primaryKey && key !== primaryKey) _setRegToken(token);
          return token;
        }
      }
    } catch (_) {}
  }

  return null;
}

function _setRegToken(token) {
  const key = _regTokenPrimaryKey();
  if (!key) return;
  const payload = JSON.stringify({ token });
  try {
    localStorage.setItem(key, payload);
  } catch (_) {
    try { sessionStorage.setItem(key, payload); } catch (_) {}
  }
}

function _fullRender() {
  const root = document.getElementById('reg-root');
  if (!_lastResult && !_regData && !_rid) {
    // No lobby in the URL: the sign-up directory now lives on /events (the
    // server redirects bare /register there too; this covers ?id= misses).
    location.replace('/events');
    return;
  }
  let html = _buildHeader();
  html += `<div id="state-loading" class="loading">${t('txt_txt_loading')}</div>`;
  html += `<div id="state-closed" class="card state-msg reg-hidden"></div>`;
  html += `<div id="state-form" class="card reg-hidden"></div>`;
  html += `<div id="state-success" class="card success-card reg-hidden" v-scope></div>`;
  html += `<div id="state-error" class="card state-msg reg-hidden"></div>`;
  root.innerHTML = html;

  if (_lastResult) { _showSuccess(); }
  else if (_regData) { _render(); }
  else { _fetchRegistration(_rid); }
}

// ── Initialisation ───────────────────────────────────────

function _init() {
  const params = new URLSearchParams(window.location.search);
  let rid = params.get('id');
  if (!rid) {
    const pathMatch = window.location.pathname.match(/^\/register\/(.+)$/);
    if (pathMatch) rid = decodeURIComponent(pathMatch[1]);
  }
  _rid = rid || null;
  _urlToken = params.get('token') || null;
  // Strip the token from the URL bar so it isn't leaked in browser history
  if (_urlToken && window.history?.replaceState) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('token');
    window.history.replaceState(null, '', clean.toString());
  }
  // Hub auto-login token from email invite (`#hub_token=...`). Consumed
  // before fetching the registration so the form renders pre-filled.
  const hubToken = _readHubTokenFromHash();
  if (hubToken) {
    _resumeHubSessionFromToken(hubToken).finally(() => _fullRender());
    return;
  }
  _fullRender();
}

/**
 * Pull the Hub auto-login token from the URL hash (if any) and strip it
 * from the address bar to avoid leaking it via history / bookmarks.
 */
function _readHubTokenFromHash() {
  if (!location.hash) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('hub_token');
  if (!token) return null;
  if (window.history?.replaceState) {
    params.delete('hub_token');
    const remaining = params.toString();
    history.replaceState(null, '', location.pathname + location.search + (remaining ? `#${remaining}` : ''));
  }
  return token;
}

/**
 * Resume the recipient's Player Hub session from a one-shot magic-link
 * token: stash the JWT, fetch the profile (incl. passphrase), and persist
 * both so `_tryProfileAutoLogin` finds them on the next render.
 */
async function _resumeHubSessionFromToken(token) {
  try {
    const res = await fetch('/api/player-profile/space', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.profile) return;
    try {
      localStorage.setItem('padel-player-profile', data.access_token || token);
      localStorage.setItem('padel-player-profile-data', JSON.stringify(data.profile));
    } catch (_) {}
  } catch (_) {
    // Silent: invalid/expired token just falls back to anonymous registration.
  }
}

async function _fetchRegistration(rid) {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(rid)}/public`);
    if (!res.ok) {
      if (res.status === 404) {
        _redirectToNotFoundPage(t('txt_reg_not_found_deleted_hint'), '/events');
      } else {
        _showError(t('txt_reg_error'));
      }
      return;
    }
    _regData = await res.json();
    if (_urlToken) {
      await _autoLoginWithToken(_urlToken);
    } else {
      _render();
    }
  } catch (e) {
    _showError(t('txt_reg_error'));
  }
}

// ── Rendering ────────────────────────────────────────────

function _render() {
  _hideAll();
  _stopPolling();
  if (!_regData) return;
  try {
    if (!_regData.open) { _showClosed(_regData.converted); return; }
    // If a Player Hub session exists, try auto-login with the profile passphrase
    if (!_lastResult && !_skipProfileAutoLoginOnce) {
      _tryProfileAutoLogin().then(found => { if (!found) _showForm(); });
      return;
    }
    _skipProfileAutoLoginOnce = false;
    _showForm();
  } catch (_) {
    _showError(t('txt_reg_error'));
  }
}

async function _tryProfileAutoLogin() {
  try {
    const rawData = localStorage.getItem('padel-player-profile-data');
    const rawJwt = localStorage.getItem('padel-player-profile');
    if (!rawData || !rawJwt) return false;
    const profile = JSON.parse(rawData);
    const passphrase = profile?.passphrase || null;

    // Preferred: ask the server by profile JWT — finds the entry via the
    // profile link even when the cached passphrase is stale or missing.
    let data = null;
    try {
      const res = await fetch(`${API}/${encodeURIComponent(_rid)}/my-entry`, {
        headers: { 'Authorization': `Bearer ${rawJwt}` },
      });
      if (res.ok) data = await res.json();
    } catch (_) {}

    // Fallback: this-lobby login with the profile's global passphrase
    // (covers an expired JWT while the passphrase still matches).
    if (!data && passphrase) {
      const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) data = await res.json();
    }
    if (!data) return false;

    _linkedProfilePassphrase = passphrase;
    _resetSuccessUi();
    _lastResult = {
      player_id: data.player_id,
      player_name: data.player_name,
      passphrase: data.passphrase,
      answers: data.answers || {},
      token: data.token || null,
      payment: data.payment || null,
      from_login: true,
    };
    if (data.token) _setRegToken(data.token);
    _showSuccess();
    return true;
  } catch (_) {
    return false;
  }
}

function _hideAll() {
  for (const id of ['state-loading', 'state-closed', 'state-form', 'state-success', 'state-error']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
}

function _showError(msg) {
  _hideAll();
  const el = document.getElementById('state-error');
  el.innerHTML = `<div class="reg-error-icon">${_svgIcon(_IC_WARN)}</div><p>${esc(msg)}</p>`;
  el.style.display = 'block';
}

function _showClosed(converted) {
  _hideAll();
  const el = document.getElementById('state-closed');
  const identityLabel = _registrationIdentityLabel(_regData);
  let html = '';
  if (_regData.club_logo_url) {
    html += `<div class="lobby-title-row">`;
    html += `<img src="${_regData.club_logo_url}" alt="" class="lobby-logo">`;
    html += `<h2 class="m-0">${esc(_regData.name)}</h2></div>`;
  } else {
    html += `<h2>${esc(_regData.name)}</h2>`;
  }
  if (_regData.description) {
    html += `<div class="reg-description">${_renderMarkdown(_regData.description)}</div>`;
  }
  if (identityLabel) {
    html += `<p class="subtitle subtitle-strong">${esc(identityLabel)}</p>`;
  }
  html += _renderMessage();
  html += _renderPlayerList();
  if (converted) {
    html += `<p><span class="badge badge-converted">${t('txt_reg_converted')}</span></p>`;
    html += `<p>${t('txt_reg_converted_msg')}</p>`;
    html += _renderLinkedTournaments();
  } else {
    html += `<p class="subtitle subtitle-strong">${t('txt_reg_closed_msg')}</p>`;
  }
  el.innerHTML = html;
  el.style.display = 'block';
}

function _buildTournamentUrl(tid) {
  let tvUrl = `/tv/${encodeURIComponent(tid)}`;
  try {
    const token = _getRegToken();
    if (token) tvUrl = `/tv/${encodeURIComponent(tid)}?player_token=${encodeURIComponent(token)}`;
  } catch (_) {}
  return tvUrl;
}

function _renderLinkedTournaments() {
  const groups = _linkedTournamentGroups(_regData);
  if (groups.active.length + groups.finished.length === 0) return '';
  const link = (e) => `<a href="${e.href}" class="linked-tournament-link" title="${esc(e.tid)}">${esc(e.label)}</a>`;

  let html = `<div class="linked-tournaments">`;
  html += `<div class="linked-tournaments-title">${t('txt_reg_linked_tournaments')}</div>`;
  if (groups.active.length > 0) {
    html += `<div class="linked-tournaments-section-title">${t('txt_txt_active_tournaments')}</div>`;
    html += `<div class="linked-tournaments-list">${groups.active.map(link).join('')}</div>`;
  }
  if (groups.finished.length > 0) {
    html += `<div class="linked-tournaments-section-title">${t('txt_txt_finished_tournaments')}</div>`;
    html += `<div class="linked-tournaments-list">${groups.finished.map(link).join('')}</div>`;
  }
  html += `</div>`;

  return html;
}

function _showForm() {
  _hideAll();
  const el = document.getElementById('state-form');
  // Clear the success container so its element ids don't shadow the form's
  // (both live in #reg-root; only one is visible at a time).
  const successEl = document.getElementById('state-success');
  if (successEl) successEl.innerHTML = '';
  const identityLabel = _registrationIdentityLabel(_regData);
  let html = '';
  if (_regData.club_logo_url) {
    html += `<div class="lobby-title-row">`;
    html += `<img src="${_regData.club_logo_url}" alt="" class="lobby-logo lobby-logo--lg">`;
    html += `<h1 class="m-0">${esc(_regData.name)}</h1></div>`;
  } else {
    html += `<h1>${esc(_regData.name)}</h1>`;
  }
  html += `<p class="subtitle"><span class="badge badge-count">${_regData.registrant_count} ${t(_regData.registrant_count === 1 ? 'txt_reg_player_singular' : 'txt_reg_players_plural')}</span></p>`;
  if (identityLabel) {
    html += `<p class="subtitle subtitle-strong">${esc(identityLabel)}</p>`;
  }

  if (_regData.description) {
    html += `<div class="reg-description">${_renderMarkdown(_regData.description)}</div>`;
  }

  html += _renderMessage();
  html += _renderFeeNotice();
  html += _renderPlayerList();
  html += _renderLinkedTournaments();

  // Detect existing Player Hub session or profile data (localStorage)
  let _regPrefill = null;
  _linkedProfilePassphrase = null;
  try {
    const rawData = localStorage.getItem('padel-player-profile-data');
    const rawJwt = localStorage.getItem('padel-player-profile');
    if (rawData && rawJwt) {
      _regPrefill = JSON.parse(rawData);
      _linkedProfilePassphrase = _regPrefill?.passphrase || null;
    } else if (rawData) {
      _regPrefill = JSON.parse(rawData);
    }
  } catch (_) {}
  const prefillName = _regPrefill?.name || '';
  const prefillEmail = _regPrefill?.email || '';
  const prefillContact = _regPrefill?.contact || '';
  const isLoggedIn = !!_linkedProfilePassphrase;

  // Identity strip: Player Hub identity vs this-tournament entry, side by
  // side so "signed in" is never mistaken for "registered". Skipped on the
  // demo instance, which has no Player Hub to sign in to.
  if (!isDemoInstance()) {
    html += _renderIdentityStrip({
      loggedIn: isLoggedIn,
      name: prefillName || _regPrefill?.email || '',
    });
  }

  // ── Unified "Returning player?" section: code / email / name ──
  html += _renderReturningPlayerSection(isLoggedIn);

  html += `<form id="reg-form" onsubmit="return false">`;

  if (prefillName || prefillEmail) {
    html += `<p class="reg-prefill-notice">${_svgIcon(_IC_USER)} ${t('txt_reg_prefilled_from_profile')}</p>`;
  }

  html += `<div class="form-group">
    <label>${t('txt_reg_name')}</label>
    <input type="text" id="reg-player-name" maxlength="128" required placeholder="${esc(t('txt_reg_name_placeholder'))}" value="${esc(prefillName)}">
  </div>`;

  const emailMode = _regData?.email_requirement || 'optional';
  if (emailMode !== 'disabled') {
    const emailLabel = emailMode === 'required' ? t('txt_email_required') : t('txt_email_optional');
    const emailRequiredAttr = emailMode === 'required' ? 'required' : '';
    html += `<div class="form-group">
      <label>${emailLabel}</label>
      <input type="email" id="reg-player-email" maxlength="320" ${emailRequiredAttr} placeholder="${esc(t('txt_email_placeholder'))}" value="${esc(prefillEmail)}">
    </div>`;
  }

  if (_regData.join_code_required) {
    html += `<div class="form-group">
      <label>${t('txt_reg_join_code')}</label>
      <input type="text" id="reg-join-code" maxlength="64" required placeholder="${esc(t('txt_reg_join_code_placeholder'))}">
    </div>`;
  }

  if (_regData.questions && _regData.questions.length) {
    for (const q of _regData.questions) {
      const reqAttr = q.required ? 'required' : '';
      const optHint = q.required ? '' : ` <small class="reg-optional-hint">(${t('txt_txt_optional')})</small>`;
      // Pre-fill contact question from Player Hub profile
      const contactPrefill = (q.key === 'contact' && prefillContact) ? prefillContact : '';
      html += `<div class="form-group"><label>${esc(q.label)}${optHint}</label>`;
      if (q.type === 'choice' && q.choices && q.choices.length) {
        html += `<select class="reg-answer" data-key="${esc(q.key)}" ${reqAttr}>`;
        html += `<option value="">${t('txt_reg_select_option')}</option>`;
        for (const c of q.choices) {
          html += `<option value="${esc(c)}">${esc(c)}</option>`;
        }
        html += `</select>`;
      } else if (q.type === 'multichoice' && q.choices && q.choices.length) {
        html += `<div class="reg-multichoice" data-key="${esc(q.key)}" ${reqAttr}>`;
        for (const c of q.choices) {
          html += `<label class="reg-multichoice-option"><input type="checkbox" value="${esc(c)}"><span>${esc(c)}</span></label>`;
        }
        html += `</div>`;
      } else if (q.type === 'number') {
        html += `<input type="number" class="reg-answer" data-key="${esc(q.key)}" step="any" ${reqAttr} value="${esc(contactPrefill)}">`;
      } else {
        html += `<textarea class="reg-answer reg-text-expand" data-key="${esc(q.key)}" maxlength="512" rows="1" ${reqAttr} oninput="_regAutoResize(this)">${esc(contactPrefill)}</textarea>`;
      }
      html += `</div>`;
    }
  }

  html += `<div class="error-msg" id="reg-error"></div>`;
  html += `<button type="submit" class="btn btn-primary" id="reg-submit-btn">${t('txt_reg_submit')}</button>`;
  html += `</form>`;

  el.innerHTML = html;
  el.style.display = 'block';

  document.getElementById('reg-form').addEventListener('submit', _handleSubmit);
  el.querySelectorAll('textarea.reg-text-expand').forEach(_regAutoResize);
}

function _logoutPlayerSpace() {
  _resetSuccessUi();
  _linkedProfilePassphrase = null;
  try {
    localStorage.removeItem('padel-player-profile');
    localStorage.removeItem('padel-player-profile-data');
  } catch (_) {}
  _showForm();
}

// ── Unified "Returning player?" section (code / email / name) ──────────────
//
// One place for a returning player to be recognized, with three tiers ordered
// by how strongly they prove identity:
//   code  → passphrase (Hub prefill, or this-lobby login)  — strongest
//   email → magic-link recovery (find-or-create + sweep)    — inbox proof
//   name  → organizer-approved claim                        — no secret, needs a human
function _renderReturningPlayerSection(isLoggedIn) {
  // When already logged into the Hub there's nothing to recover — the status
  // header already shows the identity and a logout link.
  if (isLoggedIn) return '';

  let html = `<details class="reg-returning">`;
  html += `<summary class="reg-returning-summary"><span class="reg-returning-arrow">▸</span> ${t('txt_reg_returning_title')}</summary>`;
  html += `<div class="reg-returning-body">`;

  // Tabs
  html += `<div class="reg-returning-tabs" role="tablist">`;
  html += `<button type="button" class="reg-returning-tab active" data-tab="code" onclick="_switchReturningTab('code')">${t('txt_reg_returning_have_code')}</button>`;
  html += `<button type="button" class="reg-returning-tab" data-tab="email" onclick="_switchReturningTab('email')">${t('txt_reg_returning_by_email')}</button>`;
  html += `<button type="button" class="reg-returning-tab" data-tab="name" onclick="_switchReturningTab('name')">${t('txt_reg_returning_by_name')}</button>`;
  html += `</div>`;

  // Tier 1: code (passphrase)
  html += `<div class="reg-returning-pane" data-pane="code">`;
  html += `<p class="reg-returning-help">${t('txt_reg_returning_code_help')}</p>`;
  html += `<div class="form-group">`;
  html += `<label>${t('txt_player_passphrase_label')}</label>`;
  html += `<input type="text" id="reg-returning-passphrase" maxlength="128" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false">`;
  html += `</div>`;
  html += `<div class="error-msg" id="reg-returning-error"></div>`;
  html += `<button type="button" class="btn btn-secondary" id="reg-returning-btn" onclick="_returningCodeLogin()">${t('txt_player_login_btn')}</button>`;
  html += `</div>`;

  // Tier 2: email (magic link)
  html += `<div class="reg-returning-pane reg-hidden" data-pane="email">`;
  html += `<p class="reg-returning-help">${t('txt_reg_recover_email_help')}</p>`;
  html += `<div class="form-group">`;
  html += `<label>${t('txt_email')}</label>`;
  html += `<input type="email" id="reg-recover-email" maxlength="320" placeholder="${esc(t('txt_email_placeholder'))}" autocomplete="email">`;
  html += `</div>`;
  html += `<div class="reg-returning-msg" id="reg-recover-msg"></div>`;
  html += `<button type="button" class="btn btn-secondary" id="reg-recover-btn" onclick="_recoverByEmail()">${t('txt_reg_recover_email_cta')}</button>`;
  html += `</div>`;

  // Tier 3: name (organizer-approved claim)
  html += `<div class="reg-returning-pane reg-hidden" data-pane="name">`;
  html += _renderNameSearchPane();
  html += `</div>`;

  html += `</div>`; // .reg-returning-body
  html += `</details>`;
  return html;
}

/**
 * Name-search pane with live autosuggest, shared between the returning
 * section (form) and the past-participation section (success screen).
 * Only one instance exists in the DOM at a time — the state containers
 * are cleared when switching screens.
 */
function _renderNameSearchPane() {
  let html = `<p class="reg-returning-help">${t('txt_reg_name_search_help')}</p>`;
  html += `<div class="form-group">`;
  html += `<label>${t('txt_reg_name')}</label>`;
  html += `<input type="text" id="reg-name-search" maxlength="128" placeholder="${esc(t('txt_reg_name_placeholder'))}" autocomplete="off" oninput="_onNameSearchInput()">`;
  html += `</div>`;
  html += `<div class="reg-returning-msg" id="reg-name-msg"></div>`;
  html += `<button type="button" class="btn btn-secondary" id="reg-name-btn" onclick="_searchByName()">${t('txt_reg_name_search_cta')}</button>`;
  html += `<div class="reg-name-results" id="reg-name-results"></div>`;
  return html;
}

/**
 * Success-screen variant: with a profile at hand (session or fresh
 * creation), past participations can be found and claimed right here —
 * the moment the "needs a profile" precondition is actually satisfied.
 */
function _renderPastClaimSection() {
  let html = `<details class="reg-returning reg-claim-past">`;
  html += `<summary class="reg-returning-summary">${t('txt_reg_claim_past_title')}</summary>`;
  html += `<div class="reg-returning-body">`;
  html += _renderNameSearchPane();
  html += `</div></details>`;
  return html;
}

/**
 * Context line for a name-search match: which event the found name belongs
 * to — event name, type (tournament / lobby), sport, and date.
 */
function _matchEventLine(m) {
  const parts = [m.entity_name || ''];
  const typeKey = m.entity_type === 'tournament' ? 'txt_reg_match_type_tournament'
    : m.entity_type === 'profile' ? 'txt_reg_match_type_profile'
    : 'txt_reg_match_type_lobby';
  parts.push(t(typeKey));
  if (m.sport) parts.push(t(m.sport === 'tennis' ? 'txt_player_sport_tennis' : 'txt_player_sport_padel'));
  if (m.event_date) {
    const d = new Date(m.event_date);
    if (!isNaN(d)) {
      parts.push(d.toLocaleDateString(getAppLanguage() === 'es' ? 'es' : 'en', { year: 'numeric', month: 'short' }));
    }
  }
  return parts.filter(Boolean).join(' · ');
}

// Live autosuggest: debounce keystrokes into _searchByName(auto=true).
let _nameSearchTimer = null;
function _onNameSearchInput() {
  if (_nameSearchTimer) clearTimeout(_nameSearchTimer);
  const val = document.getElementById('reg-name-search')?.value?.trim() || '';
  if (val.length < 2) {
    const resultsEl = document.getElementById('reg-name-results');
    const msgEl = document.getElementById('reg-name-msg');
    if (resultsEl) resultsEl.innerHTML = '';
    if (msgEl) msgEl.textContent = '';
    return;
  }
  _nameSearchTimer = setTimeout(() => _searchByName(true), 350);
}

function _switchReturningTab(tab) {
  document.querySelectorAll('.reg-returning-tab').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.reg-returning-pane').forEach((p) => {
    p.classList.toggle('reg-hidden', p.getAttribute('data-pane') !== tab);
  });
}

// Tier 1: check for a registration under the typed code in THIS lobby first,
// then fall back to a Hub login (which just prefills the form). Order matters:
// a Hub passphrase can differ from the entry's own registrant code, so trying
// Hub login first could log the player into the Hub yet miss their registration
// and wrongly show "not registered". The direct this-lobby lookup is the
// authoritative "is there a registration connected with this code?" answer.
async function _returningCodeLogin() {
  const passphrase = document.getElementById('reg-returning-passphrase')?.value?.trim();
  const errorEl = document.getElementById('reg-returning-error');
  const btn = document.getElementById('reg-returning-btn');
  if (!passphrase) return;
  if (errorEl) errorEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = t('txt_reg_ps_logging_in'); }
  try {
    // 1) This-lobby registrant code: the exact code the player typed, matched
    //    against a registration here. If it hits, they're registered — land
    //    them on their entry so they can edit or cancel it right away.
    const lobby = await fetch(`${API}/${encodeURIComponent(_rid)}/player-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (lobby.ok) {
      const data = await lobby.json();
      _resetSuccessUi();
      _lastResult = {
        player_id: data.player_id,
        player_name: data.player_name,
        passphrase: data.passphrase,
        answers: data.answers || {},
        token: data.token || null,
        payment: data.payment || null,
        from_login: true,
      };
      if (data.token) _setRegToken(data.token);
      _showSuccess();
      return;
    }
    // 2) Fall back to a Hub login — a global passphrase that prefills the form.
    //    _render()'s profile-based entry check still lands a registered player
    //    on their entry when the registration is linked to the profile.
    const hub = await fetch('/api/player-profile/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (hub.ok) {
      const data = await hub.json();
      try {
        localStorage.setItem('padel-player-profile', data.access_token);
        localStorage.setItem('padel-player-profile-data', JSON.stringify(data.profile));
      } catch (_) {}
      // Re-render through _render() so the "am I already registered here?"
      // check runs — a registered player lands on their entry, not the form.
      _render();
      return;
    }
    if (errorEl) errorEl.textContent = t('txt_reg_login_not_found');
  } catch (_) {
    if (errorEl) errorEl.textContent = t('txt_reg_error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_player_login_btn'); }
  }
}

// Tier 2: enumeration-safe email recovery (magic link).
async function _recoverByEmail() {
  const email = document.getElementById('reg-recover-email')?.value?.trim();
  const msgEl = document.getElementById('reg-recover-msg');
  const btn = document.getElementById('reg-recover-btn');
  if (!email || !_isValidEmail(email)) {
    if (msgEl) { msgEl.className = 'reg-returning-msg error'; msgEl.textContent = t('txt_reg_email_invalid'); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = t('txt_reg_recover_sending'); }
  try {
    await fetch('/api/player-profile/recover-by-participation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Always neutral — never reveal whether the email matched.
    if (msgEl) { msgEl.className = 'reg-returning-msg ok'; msgEl.textContent = t('txt_reg_recover_sent'); }
  } catch (_) {
    if (msgEl) { msgEl.className = 'reg-returning-msg ok'; msgEl.textContent = t('txt_reg_recover_sent'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_reg_recover_email_cta'); }
  }
}

// Tier 3: name search → organizer-approved claim. `auto` marks a debounced
// autosuggest call (no button state changes, quieter empty state).
async function _searchByName(auto) {
  const name = document.getElementById('reg-name-search')?.value?.trim();
  const msgEl = document.getElementById('reg-name-msg');
  const resultsEl = document.getElementById('reg-name-results');
  const btn = document.getElementById('reg-name-btn');
  if (!name) return;
  if (msgEl) msgEl.textContent = '';
  if (!auto && resultsEl) resultsEl.innerHTML = '';
  if (!auto && btn) { btn.disabled = true; btn.textContent = t('txt_reg_name_search_searching'); }
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/find-by-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_name: name }),
    });
    const matches = res.ok ? await res.json() : [];
    // A stale response must not overwrite results for newer input.
    const current = document.getElementById('reg-name-search')?.value?.trim();
    if (current !== name) return;
    if (!matches.length) {
      if (resultsEl) resultsEl.innerHTML = '';
      if (msgEl) { msgEl.className = 'reg-returning-msg'; msgEl.textContent = t('txt_reg_name_search_none'); }
      return;
    }
    let html = '';
    for (const m of matches) {
      const key = `${m.entity_type}:${m.entity_id}:${m.player_id}`;
      html += `<div class="reg-name-result">`;
      html += `<span class="reg-name-result-info">`;
      html += `<span class="reg-name-result-label">${esc(m.player_name)}</span>`;
      html += `<span class="reg-name-result-event">${esc(_matchEventLine(m))}</span>`;
      html += `</span>`;
      if (m.already_linked) {
        html += `<span class="reg-name-result-linked">${t('txt_reg_name_already_linked')}</span>`;
      } else {
        // A ghost-linked hit claims the whole ghost profile (all its events
        // merge at once), not just this one displayed event.
        const claimType = m.ghost_profile_id ? 'profile' : m.entity_type;
        const claimId = m.ghost_profile_id || m.entity_id;
        const claimPlayerId = m.ghost_profile_id || m.player_id;
        html += `<button type="button" class="btn btn-secondary reg-name-claim-btn" data-key="${esc(key)}" `;
        html += `onclick="_claimParticipation('${esc(claimType)}','${esc(claimId)}','${esc(claimPlayerId)}',this)">`;
        html += `${t('txt_reg_name_search_this_is_me')}</button>`;
      }
      html += `</div>`;
    }
    if (resultsEl) resultsEl.innerHTML = html;
  } catch (_) {
    if (msgEl) { msgEl.className = 'reg-returning-msg error'; msgEl.textContent = t('txt_reg_error'); }
  } finally {
    if (!auto && btn) { btn.disabled = false; btn.textContent = t('txt_reg_name_search_cta'); }
  }
}

async function _claimParticipation(entityType, entityId, playerId, btnEl) {
  const msgEl = document.getElementById('reg-name-msg');
  // The claimant must have a Hub profile to attach the claim to.
  let profilePassphrase = null;
  try {
    const raw = localStorage.getItem('padel-player-profile-data');
    if (raw) profilePassphrase = JSON.parse(raw)?.passphrase || null;
  } catch (_) {}
  if (!profilePassphrase) {
    if (msgEl) { msgEl.className = 'reg-returning-msg error'; msgEl.textContent = t('txt_reg_claim_needs_profile'); }
    return;
  }
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/claim-participation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_passphrase: profilePassphrase,
        entity_type: entityType,
        entity_id: entityId,
        player_id: playerId,
      }),
    });
    if (!res.ok) {
      if (msgEl) { msgEl.className = 'reg-returning-msg error'; msgEl.textContent = t('txt_reg_claim_error'); }
      if (btnEl) btnEl.disabled = false;
      return;
    }
    if (msgEl) { msgEl.className = 'reg-returning-msg ok'; msgEl.textContent = t('txt_reg_claim_sent'); }
  } catch (_) {
    if (msgEl) { msgEl.className = 'reg-returning-msg error'; msgEl.textContent = t('txt_reg_claim_error'); }
    if (btnEl) btnEl.disabled = false;
  }
}

async function _autoLoginWithToken(token) {
  _urlToken = null; // consume once
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      const data = await res.json();
      _resetSuccessUi();
      _lastResult = {
        player_id: data.player_id,
        player_name: data.player_name,
        passphrase: data.passphrase,
        answers: data.answers || {},
        token: data.token || null,
        payment: data.payment || null,
        from_login: true,
      };
      // Persist the token so refreshing the page keeps the session
      if (data.token) _setRegToken(data.token);
      _showSuccess();
      return;
    }
  } catch (_) {}
  // Token invalid or expired — fall through to the normal registration view
  _render();
}

/**
 * Post-registration actions for the visitor's own entry: edit answers and
 * withdraw, with an inline confirm strip instead of a native confirm().
 */
// ── Success view: Petite-Vue island (#state-success) ─────────────────────
//
// Markup lives in register.html (`<template id="tpl-success">`) and is cloned
// into #state-success once per DOM root, then bound to `_successStore`. The
// store survives `_fullRender()` (language toggle), so UI flags and, above
// all, the "Edit answers" draft are never lost: the draft lives here, not in
// the DOM, and is mirrored to sessionStorage so a reload keeps it too.
// Player Hub sections stay legacy innerHTML inside `#reg-ps-host` (v-pre).

const _DRAFT_STORAGE_PREFIX = 'amistoso-reg-draft:';

/** Which input widget a question renders as (unknown/empty-choice types fall back to text). */
function _questionKind(q) {
  const hasChoices = Array.isArray(q?.choices) && q.choices.length > 0;
  if (q?.type === 'choice' && hasChoices) return 'choice';
  if (q?.type === 'multichoice' && hasChoices) return 'multi';
  if (q?.type === 'number') return 'number';
  return 'text';
}

/** Initial draft value for a question from a saved (string) answer. */
function _draftValueFor(q, saved) {
  if (_questionKind(q) === 'multi') {
    try {
      const arr = JSON.parse(saved || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  return saved == null ? '' : String(saved);
}

function _draftStorageKey(playerId) {
  return `${_DRAFT_STORAGE_PREFIX}${_rid || ''}:${playerId}`;
}

function _loadStoredDraft(playerId) {
  try {
    const raw = sessionStorage.getItem(_draftStorageKey(playerId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) { return null; }
}

function _clearStoredDraft(playerId) {
  try { sessionStorage.removeItem(_draftStorageKey(playerId)); } catch (_) {}
}

/** Active/finished linked-tournament links for a lobby payload. */
function _linkedTournamentGroups(data) {
  let tids = Array.isArray(data?.converted_to_tids) ? data.converted_to_tids.filter(Boolean) : [];
  if (tids.length === 0 && data?.converted_to_tid) tids = [data.converted_to_tid];
  const linkedById = new Map(
    ((data?.linked_tournaments || []).filter((item) => item?.id)).map((item) => [item.id, item]),
  );
  const groups = { active: [], finished: [] };
  tids.forEach((tid) => {
    const linked = linkedById.get(tid);
    if (!linked) return; // skip deleted tournaments
    const entry = {
      tid,
      href: _buildTournamentUrl(tid),
      label: `${t('txt_reg_view_tournament_btn')} · ${linked.name}`,
    };
    (linked.finished ? groups.finished : groups.active).push(entry);
  });
  return groups;
}

const _successStore = reactiveStore({
  result: null,       // registration result (player_name, passphrase, answers, ...)
  lobby: null,        // public lobby payload (name, open, questions, registrants, message, ...)
  subtitle: '',
  identityHtml: '',   // identity strip (legacy builder, only when signed in)
  editOpen: false,
  confirmingWithdraw: false,
  playersOpen: false,
  draft: {},          // answer key -> string | string[]; survives close/reopen, polls, failed saves
  draftFor: null,     // player_id the draft belongs to
  saving: false,
  withdrawing: false,
  error: '',
  payReference: '',   // optional note sent with "I've paid"
  payReporting: false,
  payCopied: '',      // last copied value (drives the "Copied" label)
  payError: '',

  // ── derived ──
  kind(q) { return _questionKind(q); },
  payAmount() {
    const p = _successStore.result?.payment;
    return p ? formatMoney(p.amount_cents, p.currency) : '';
  },
  payPending() {
    const st = _successStore.result?.payment?.status;
    return st === 'unpaid' || st === 'reported';
  },
  payHref(m) {
    const p = _successStore.result?.payment;
    return p ? paymentMethodHref(m, p.amount_cents, p.currency) : null;
  },
  hasQuestions() { return (_successStore.lobby?.questions || []).length > 0; },
  canManage() { return !!(_successStore.result?.passphrase && _successStore.lobby?.open); },
  messageHtml() { return _renderMarkdown(_successStore.lobby?.message || ''); },
  linked() { return _linkedTournamentGroups(_successStore.lobby); },
  hasLinked() {
    const g = _successStore.linked();
    return g.active.length + g.finished.length > 0;
  },

  // ── data in ──
  setResult(result, lobby, extras) {
    const S = _successStore;
    S.result = result;
    S.lobby = lobby;
    S.subtitle = extras?.subtitle || '';
    S.identityHtml = extras?.identityHtml || '';
    if (S.draftFor !== result.player_id) S.seedDraft(true);
    else S.syncDraftKeys();
  },
  /** Lobby poll: patch lobby data in place; never touches the draft values. */
  setLobby(lobby) {
    const S = _successStore;
    S.lobby = lobby;
    S.syncDraftKeys();
  },
  /** Seed the draft from the saved answers (and, on first sight, any stored unsaved draft). */
  seedDraft(useStored) {
    const S = _successStore;
    const answers = S.result?.answers || {};
    const stored = useStored ? _loadStoredDraft(S.result.player_id) : null;
    const draft = {};
    for (const q of S.lobby?.questions || []) {
      draft[q.key] = stored && q.key in stored
        ? stored[q.key]
        : _draftValueFor(q, answers[q.key]);
    }
    S.draft = draft;
    S.draftFor = S.result.player_id;
  },
  /** New questions appear in the draft; existing typed values are kept as-is. */
  syncDraftKeys() {
    const S = _successStore;
    for (const q of S.lobby?.questions || []) {
      if (!(q.key in S.draft)) S.draft[q.key] = _draftValueFor(q, S.result?.answers?.[q.key]);
    }
  },
  persistDraft() {
    const S = _successStore;
    if (S.draftFor == null) return;
    try { sessionStorage.setItem(_draftStorageKey(S.draftFor), JSON.stringify(S.draft)); } catch (_) {}
  },
  resetUi() {
    const S = _successStore;
    S.editOpen = false;
    S.confirmingWithdraw = false;
    S.playersOpen = false;
    S.error = '';
  },

  // ── actions ──
  toggleEdit() {
    const S = _successStore;
    S.editOpen = !S.editOpen;
    S.error = '';
    if (S.editOpen) {
      setTimeout(() => {
        document.querySelectorAll('#reg-edit-panel textarea.reg-text-expand').forEach(_regAutoResize);
        document.querySelector('#reg-edit-panel .returning-answer, #reg-edit-panel input')?.focus();
      }, 0);
    }
  },
  askWithdraw() {
    const S = _successStore;
    S.error = '';
    S.confirmingWithdraw = true;
  },
  keepSpot() {
    _successStore.confirmingWithdraw = false;
    setTimeout(() => document.getElementById('reg-withdraw-btn')?.focus(), 0);
  },

  async save() {
    const S = _successStore;
    if (S.saving || !S.result?.passphrase || !_rid) return;
    S.error = '';

    const answers = {};
    for (const q of S.lobby?.questions || []) {
      const v = S.draft[q.key];
      if (_questionKind(q) === 'multi') {
        // Keep the option order (checkbox click order is arbitrary).
        const selected = (q.choices || []).filter((c) => Array.isArray(v) && v.includes(c));
        if (selected.length) answers[q.key] = JSON.stringify(selected);
        else if (q.required) { S.error = t('txt_reg_answer_required'); return; }
      } else {
        const val = (v == null ? '' : String(v)).trim();
        if (val) answers[q.key] = val;
        else if (q.required) { S.error = t('txt_reg_answer_required'); return; }
      }
    }

    S.saving = true;
    try {
      const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-answers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: S.result.passphrase, answers }),
      });
      if (!res.ok) {
        // Failed save: keep the draft and the open panel exactly as typed.
        const data = await res.json().catch(() => ({}));
        S.error = data.detail || t('txt_reg_error');
        return;
      }
      const updated = await res.json();
      const saved = updated.answers || {};
      S.result.answers = saved;
      if (_lastResult) _lastResult.answers = saved;
      const regs = S.lobby?.registrants;
      const idx = Array.isArray(regs) ? regs.findIndex((p) => p.player_id === updated.player_id) : -1;
      if (idx >= 0) regs[idx].answers = saved;
      // Saved: the draft now equals the saved answers; drop the stored copy and re-seed.
      _clearStoredDraft(S.draftFor);
      S.seedDraft(false);
      S.editOpen = false;
      setTimeout(() => flashSuccess(document.getElementById('reg-edit-btn'), t('txt_reg_saved')), 0);
    } catch (_) {
      S.error = t('txt_reg_error');
    } finally {
      S.saving = false;
    }
  },

  async payCopy(text, btn) {
    const S = _successStore;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    S.payCopied = text;
    if (btn) flashSuccess(btn, t('txt_pay_player_copied'));
    setTimeout(() => { if (S.payCopied === text) S.payCopied = ''; }, 1800);
  },

  /** "I've paid": unpaid -> reported; the server never downgrades a confirmed row. */
  async reportPayment() {
    const S = _successStore;
    const r = S.result;
    if (S.payReporting || !r?.payment || !_rid || !(r.passphrase || r.token)) return;
    S.payError = '';
    S.payReporting = true;
    try {
      const body = r.passphrase ? { passphrase: r.passphrase } : { token: r.token };
      const ref = (S.payReference || '').trim();
      if (ref) body.reference = ref;
      const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-payment-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        S.payError = data.detail || t('txt_pay_error');
        return;
      }
      const info = await res.json();
      r.payment = info;
      if (_lastResult) _lastResult.payment = info;
      S.payReference = '';
    } catch (_) {
      S.payError = t('txt_pay_error');
    } finally {
      S.payReporting = false;
    }
  },

  async withdraw() {
    const S = _successStore;
    if (S.withdrawing || !S.result?.passphrase || !_rid) return;
    S.error = '';
    S.withdrawing = true;
    try {
      const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: S.result.passphrase }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        S.error = data.detail || t('txt_reg_error');
        return;
      }
      if (_regData) {
        _regData.registrant_count = Math.max(0, (_regData.registrant_count || 1) - 1);
      }
      if (Array.isArray(_regData?.registrants)) {
        const pid = S.result.player_id;
        _regData.registrants = _regData.registrants.filter((p) => p.player_id !== pid);
      }
      // Withdrawn: the one case (besides a successful save) where the draft is discarded.
      _clearStoredDraft(S.draftFor);
      S.draftFor = null;
      S.draft = {};
      S.resetUi();
      _lastResult = null;
      _render();
      const toast = document.createElement('div');
      toast.className = 'reg-toast';
      toast.textContent = t('txt_reg_withdrawn');
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    } catch (_) {
      S.error = t('txt_reg_error');
    } finally {
      S.withdrawing = false;
    }
  },
});

/** Player Hub create / past-claim sections: legacy innerHTML rendered into the v-pre host. */
function _renderHubSections(r, profileLinked, hasProfileSession) {
  // No Player Hub on the demo instance: never offer to create a profile.
  if (isDemoInstance()) return '';
  let html = '';
  if (!profileLinked && !_linkedProfilePassphrase && !hasProfileSession) {
    const emailMode = _regData?.email_requirement || 'optional';
    const hasEmail = !!_submittedEmail;
    const needsEmail = emailMode === 'disabled' || !hasEmail;

    html += `<details class="reg-ps-create-section" id="reg-ps-create-section">`;
    html += `<summary class="reg-ps-create-summary">${t('txt_reg_ps_save_help')}</summary>`;
    html += `<div class="reg-ps-create-body">`;
    if (needsEmail) {
      html += `<div class="reg-ps-create-email"><label class="fs-sm text-muted">${t('txt_reg_ps_email_needed')}</label>`;
      html += `<input type="email" id="reg-ps-create-email-input" maxlength="320" placeholder="${esc(t('txt_email_placeholder'))}"></div>`;
    }
    html += `<button type="button" class="reg-ps-create-btn" id="reg-ps-create-btn" onclick="_createPlayerSpace()">${t('txt_reg_ps_save')}</button>`;
    html += `<div class="reg-ps-create-error" id="reg-ps-create-error"></div>`;
    html += `<p class="reg-ps-already-have">${t('txt_reg_ps_already_have')} <a href="/player">${t('txt_player_login')}</a></p>`;
    html += `</div>`;
    html += `</details>`;
  }
  // With a profile session, past participations can be found and claimed
  // right here — the claim precondition (a profile) is now satisfied.
  if (hasProfileSession) html += _renderPastClaimSection();
  return html;
}

function _showSuccess() {
  _hideAll();
  const el = document.getElementById('state-success');
  // Clear the form container so its input ids don't shadow the success
  // screen's (both live in #reg-root; only one is visible at a time).
  const formEl = document.getElementById('state-form');
  if (formEl) formEl.innerHTML = '';
  const r = _lastResult;

  // Store token early so _buildTournamentUrl can embed it in linked tournament links
  if (_rid && r.token) {
    _setRegToken(r.token);
  }

  // Identity strip only when signed in to the Player Hub (no "registered"
  // chip: the heading already says so).
  let sessProfile = null;
  try {
    const rawData = localStorage.getItem('padel-player-profile-data');
    const rawJwt = localStorage.getItem('padel-player-profile');
    if (rawData && rawJwt) sessProfile = JSON.parse(rawData);
  } catch (_) {}
  // If the registration was linked to an existing Hub profile server-side,
  // say so instead of offering to create a new profile.
  const profileLinked = !!r.profile_linked;
  const identityHtml = sessProfile
    ? _renderIdentityStrip({
      loggedIn: true,
      name: sessProfile.name || sessProfile.email || '',
      showEntryChip: false,
      caption: profileLinked ? t('txt_reg_identity_hub_linked') : '',
    })
    : '';
  const subtitle = [_regData?.name, _registrationIdentityLabel(_regData)].filter(Boolean).join(' · ');

  // Feed the store first so the very first bind already sees real data.
  _successStore.setResult(r, _regData, { subtitle, identityHtml });

  // Mount exactly once per DOM root (_fullRender creates a fresh root).
  if (!el._petiteVueMounted) {
    const tpl = document.getElementById('tpl-success');
    el.innerHTML = tpl ? tpl.innerHTML : '';
    if (!mountIsland('#state-success', _successStore)) {
      _showError(t('txt_reg_error'));
      return;
    }
  }

  const hasProfileSession = (() => {
    try {
      return !!(localStorage.getItem('padel-player-profile') && localStorage.getItem('padel-player-profile-data'));
    } catch (_) { return false; }
  })();
  const host = document.getElementById('reg-ps-host');
  if (host) host.innerHTML = _renderHubSections(r, profileLinked, hasProfileSession);

  el.style.display = 'block';
  _startPolling();
}

function _copyPassphrase() {
  const box = document.getElementById('reg-passphrase-box');
  const btn = document.getElementById('reg-copy-btn');
  if (!box || !btn) return;
  const text = box.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    flashSuccess(btn, t('txt_txt_copied'));
  }).catch(() => {
    // Fallback for browsers without clipboard API
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// ── Form submission ──────────────────────────────────────

async function _handleSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('reg-error');
  const submitBtn = document.getElementById('reg-submit-btn');
  errorEl.textContent = '';

  const playerName = document.getElementById('reg-player-name')?.value?.trim();
  if (!playerName) { errorEl.textContent = t('txt_reg_name_required'); return; }

  const body = { player_name: playerName };

  const emailMode = _regData?.email_requirement || 'optional';
  const playerEmail = document.getElementById('reg-player-email')?.value?.trim() || '';
  if (emailMode === 'required' && !playerEmail) {
    errorEl.textContent = t('txt_reg_email_required');
    return;
  }
  if (playerEmail && !_isValidEmail(playerEmail)) {
    errorEl.textContent = t('txt_reg_email_invalid');
    return;
  }
  if (playerEmail) body.email = playerEmail;

  if (_regData.join_code_required) {
    const code = document.getElementById('reg-join-code')?.value?.trim();
    if (!code) { errorEl.textContent = t('txt_reg_join_code_required'); return; }
    body.join_code = code;
  }

  const answers = {};
  const answerEls = document.querySelectorAll('.reg-answer');
  for (const el of answerEls) {
    const key = el.getAttribute('data-key');
    const val = el.value?.trim();
    if (el.hasAttribute('required') && !val) {
      errorEl.textContent = t('txt_reg_answer_required');
      return;
    }
    if (val) answers[key] = val;
  }
  // Collect multichoice answers (checkboxes)
  const multichoiceEls = document.querySelectorAll('.reg-multichoice');
  for (const container of multichoiceEls) {
    const key = container.getAttribute('data-key');
    const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    if (container.hasAttribute('required') && selected.length === 0) {
      errorEl.textContent = t('txt_reg_answer_required');
      return;
    }
    if (selected.length > 0) answers[key] = JSON.stringify(selected);
  }
  if (Object.keys(answers).length) body.answers = answers;

  // Auto-link Player Hub profile if logged in
  if (_linkedProfilePassphrase) {
    body.profile_passphrase = _linkedProfilePassphrase;
  }

  // Capture current UI language so emails arrive in the player's language
  body.lang = getAppLanguage();

  // Capture submitted email for post-registration profile creation
  _submittedEmail = playerEmail;

  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_regData.id)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Same name already registered — likely a returning player. Point
        // them at the recovery section instead of a dead-end error.
        errorEl.textContent = t('txt_reg_name_taken_hint');
        const returning = document.querySelector('#state-form .reg-returning');
        if (returning) returning.setAttribute('open', '');
      } else {
        errorEl.textContent = data.detail || t('txt_reg_error');
      }
      submitBtn.disabled = false;
      return;
    }
    _resetSuccessUi();
    _lastResult = await res.json();
    // Backend response doesn't include answers; attach them so
    // _createPlayerSpace can access the contact answer.
    _lastResult.answers = answers;
    _regData.registrant_count++;
    if (Array.isArray(_regData.registrants) && !_regData.registrants.some((p) => p.player_id === _lastResult.player_id)) {
      _regData.registrants.push({ player_id: _lastResult.player_id, player_name: _lastResult.player_name });
    }
    _showSuccess();
  } catch (err) {
    errorEl.textContent = t('txt_reg_error');
    submitBtn.disabled = false;
  }
}

// ── Lobby polling ────────────────────────────────────────

function _startPolling() {
  _stopPolling();
  _pollLobby();
  _pollTimer = setInterval(_pollLobby, 8000);
  document.addEventListener('visibilitychange', _onVisibilityChange);
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  document.removeEventListener('visibilitychange', _onVisibilityChange);
}

function _onVisibilityChange() {
  if (document.hidden) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  } else {
    if (!_pollTimer && _rid && _lastResult) {
      _pollLobby();
      _pollTimer = setInterval(_pollLobby, 8000);
    }
  }
}

async function _pollLobby() {
  if (!_rid || _lobbyFetching) return;
  _lobbyFetching = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/public`);
    if (!res.ok) return;
    const data = await res.json();

    const linkedTids = Array.isArray(data.converted_to_tids)
      ? data.converted_to_tids.filter(Boolean)
      : (data.converted_to_tid ? [data.converted_to_tid] : []);

    if (linkedTids.length > 0 && !data.open) {
      _stopPolling();
      _regData = data;
      _showRedirectToast(linkedTids[linkedTids.length - 1]);
      return;
    }

    if (!data.open) {
      _stopPolling();
      _regData = data;
      _showClosed(data.converted);
      return;
    }

    const questionsChanged = JSON.stringify(data.questions ?? []) !== JSON.stringify(_regData.questions ?? []);
    const messageChanged = (data.message || '') !== (_regData.message || '');
    const playersChanged = JSON.stringify((data.registrants ?? []).map((p) => p.player_id))
      !== JSON.stringify((_regData.registrants ?? []).map((p) => p.player_id));
    if (questionsChanged || messageChanged || playersChanged || data.registrant_count !== _regData.registrant_count) {
      _regData = data;
      // Patch the island's store; the open edit panel, draft and withdraw
      // strip are untouched (no innerHTML rebuild).
      if (_lastResult) _successStore.setLobby(_regData);
    }
  } catch (_) { /* network blip */ }
  finally { _lobbyFetching = false; }
}

function _showRedirectToast(tid) {
  const toast = document.createElement('div');
  toast.className = 'reg-toast';
  toast.textContent = t('txt_reg_tournament_started');
  document.body.appendChild(toast);

  let url = `/tv/${encodeURIComponent(tid)}`;
  try {
    const token = _getRegToken();
    if (token) url = `/tv/${encodeURIComponent(tid)}?player_token=${encodeURIComponent(token)}`;
  } catch (_) {}

  setTimeout(() => { window.location.href = url; }, 2000);
}

// ── Message + player list rendering ──────────────────────

/**
 * Public entry-fee notice (form / closed views). Methods only appear when the
 * organizer chose "show always"; otherwise the player sees them after
 * registering (success view). Legacy string builder, matches its siblings.
 */
function _renderFeeNotice() {
  const p = _regData?.payment;
  if (!p || !p.fee_cents) return '';
  let html = `<div class="pay-block">`;
  html += `<div class="pay-block-title"><span>${t('txt_pay_player_title')}</span><span class="pay-block-amount">${esc(formatMoney(p.fee_cents, p.currency))}</span></div>`;
  if (p.due_at) html += `<p class="pay-block-due">${esc(t('txt_pay_player_due', { date: p.due_at }))}</p>`;
  if (p.instructions) html += `<p class="pay-block-instructions">${esc(p.instructions)}</p>`;
  if (Array.isArray(p.methods) && p.methods.length) {
    html += `<div class="pay-methods">`;
    for (const m of p.methods) {
      const href = paymentMethodHref(m, p.fee_cents, p.currency);
      html += `<div class="pay-method"><span class="pay-method-kind">${esc(paymentMethodLabel(m))}</span>`;
      if (href) html += `<a class="pay-method-value" href="${escAttr(href)}" target="_blank" rel="noopener">${esc(m.value)}</a>`;
      else if (m.value) html += `<span class="pay-method-value">${esc(m.value)}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  } else {
    html += `<p class="pay-block-due">${t('txt_pay_player_methods_after')}</p>`;
  }
  html += `</div>`;
  return html;
}

function _renderMessage() {
  if (!_regData?.message) return '';
  return `<div class="reg-message-label">${t('txt_reg_admin_message')}</div>
    <div class="reg-message">${_renderMarkdown(_regData.message)}</div>`;
}

/**
 * Registered-players disclosure for the form / closed views (always open).
 * The success view renders its own collapsed variant inside the island.
 */
function _renderPlayerList() {
  const players = _regData?.registrants;
  if (!players || players.length === 0) return '';
  let chips = '';
  for (const p of players) {
    chips += `<span class="player-chip">${esc(p.player_name)}</span>`;
  }
  return `<details class="player-list" open>
    <summary><svg class="ic player-list-chevron" viewBox="64 64 896 896" fill="currentColor" aria-hidden="true"><path d="${_IC_CHEVRON}"/></svg><span>${t('txt_reg_registered_players')} (${players.length})</span></summary>
    <div class="player-list-items">${chips}</div>
  </details>`;
}

// ── Markdown rendering ───────────────────────────────────

function _renderMarkdown(md) {
  if (!md) return '';
  try {
    const rawHtml = typeof marked !== 'undefined' && marked.parse
      ? marked.parse(md)
      : md.replace(/</g, '&lt;');
    return typeof DOMPurify !== 'undefined'
      ? DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] })
      : esc(md);
  } catch (_) {
    return esc(md);
  }
}

function _regAutoResize(el) {
  el.style.overflow = 'hidden';
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ── Public API (for onclick handlers) ────────────────────

async function _createPlayerSpace() {
  const errorEl = document.getElementById('reg-ps-create-error');
  const btn = document.getElementById('reg-ps-create-btn');
  if (errorEl) errorEl.textContent = '';

  const r = _lastResult;
  if (!r?.passphrase) return;

  // Determine email: use submitted email or inline input
  let email = _submittedEmail || '';
  const emailInput = document.getElementById('reg-ps-create-email-input');
  if (emailInput) email = emailInput.value.trim();
  if (!email || !_isValidEmail(email)) {
    if (errorEl) errorEl.textContent = t('txt_reg_ps_email_needed');
    if (emailInput) emailInput.focus();
    return;
  }

  // Collect contact from answers if available
  let contact = '';
  if (r.answers?.contact) contact = r.answers.contact;

  if (btn) { btn.disabled = true; btn.textContent = t('txt_reg_ps_creating'); }
  try {
    const res = await fetch('/api/player-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_passphrase: r.passphrase,
        name: r.player_name || '',
        email,
        contact,
        lang: getAppLanguage(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (errorEl) errorEl.textContent = data.detail || t('txt_reg_ps_create_error');
      return;
    }
    const data = await res.json();
    // Persist Player Hub session
    try {
      localStorage.setItem('padel-player-profile', data.access_token);
      localStorage.setItem('padel-player-profile-data', JSON.stringify(data.profile));
    } catch (_) {}
    // Replace the create section with success
    const section = document.getElementById('reg-ps-create-section');
    if (section) {
      const samePassphrase = data.profile.passphrase === r.passphrase;
      let html = `<div class="reg-ps-create-success">`;
      html += `<p>${_svgIcon(_IC_CHECK)} ${t('txt_reg_ps_created')}</p>`;
      if (samePassphrase) {
        html += `<p>${t('txt_reg_ps_created_same_pp')}</p>`;
      } else {
        html += `<p>${t('txt_reg_ps_created_diff_pp')}</p>`;
        html += `<div class="passphrase-box">${esc(data.profile.passphrase)}</div>`;
      }
      html += `</div>`;
      section.innerHTML = html;
      // The visitor now has a profile — surface the past-participation finder.
      if (!document.querySelector('.reg-claim-past')) {
        section.insertAdjacentHTML('afterend', _renderPastClaimSection());
      }
    }
  } catch (_) {
    if (errorEl) errorEl.textContent = t('txt_reg_ps_create_error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_reg_ps_save'); }
  }
}

// ── Boot ─────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}
