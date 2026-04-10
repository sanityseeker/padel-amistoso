/* ── Registration page ─────────────────────────────────── */
'use strict';

// ── Remember this page for the page selector ──────────────
try { localStorage.setItem('amistoso-last-page', 'register'); } catch (_) {}

// ── Theme & language (early, before render) ───────────────
let _theme = _loadSavedTheme();
_applyTheme(_theme);
let _lang = _loadSavedLanguage();
setAppLanguage(_lang);

// ── Build header into #reg-root ───────────────────────────
function _buildHeader() {
  const langMeta = _languageToggleMeta();
  const themeIcon = _theme === 'dark' ? '🌙' : '☀️';

  let html = `<div class="tv-header"><div class="tv-header-title-row">`;
  html += `<div class="tv-lang-cell"><button type="button" class="theme-btn" onclick="_regToggleLanguage()" title="${esc(langMeta.label)}" aria-label="${esc(langMeta.label)}">${langMeta.icon}</button></div>`;
  html += buildPageSelectorHtml('register');
  html += `<div class="tv-toggle-btns">`;
  html += `<button type="button" class="theme-btn" onclick="_regToggleTheme()" title="${t('txt_txt_toggle_light_dark_mode')}" data-theme-toggle-icon>${themeIcon}</button>`;
  html += `</div></div>`;
  html += `</div>`;
  return html;
}

function _languageToggleMeta() {
  const current = getAppLanguage();
  const currentLabel = current === 'es' ? t('txt_txt_spanish') : t('txt_txt_english');
  return {
    icon: current === 'es' ? '🇪🇸' : '🇬🇧',
    label: `${t('txt_txt_language')}: ${currentLabel}`,
  };
}

function _regToggleTheme() {
  _theme = _theme === 'dark' ? 'light' : 'dark';
  _applyTheme(_theme);
  _saveTheme(_theme);
  // Patch only the theme icon buttons — CSS handles the rest via data-theme
  const themeIcon = _theme === 'dark' ? '🌙' : '☀️';
  document.querySelectorAll('[data-theme-toggle-icon]').forEach(btn => { btn.textContent = themeIcon; });
}

function _regToggleLanguage() {
  _lang = _lang === 'es' ? 'en' : 'es';
  setAppLanguage(_lang);
  _fullRender();
}

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

function _redirectToNotFoundPage(message, redirectTo = '/register') {
  const params = new URLSearchParams();
  if (message) params.set('m', message);
  if (redirectTo) params.set('to', redirectTo);
  window.location.replace(`/404?${params.toString()}`);
}

function _isValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((value || '').trim());
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
  const isDirectory = !_lastResult && !_regData && !_rid;
  let html = isDirectory ? '' : _buildHeader();
  html += `<div id="state-loading" class="loading">${t('txt_txt_loading')}</div>`;
  html += `<div id="state-directory" class="reg-hidden"></div>`;
  html += `<div id="state-closed" class="card state-msg reg-hidden"></div>`;
  html += `<div id="state-form" class="card reg-hidden"></div>`;
  html += `<div id="state-success" class="card success-card reg-hidden"></div>`;
  html += `<div id="state-error" class="card state-msg reg-hidden"></div>`;
  root.innerHTML = html;

  if (_lastResult) { _showSuccess(); }
  else if (_regData) { _render(); }
  else if (_rid) { _fetchRegistration(_rid); }
  else { _showDirectory(); }
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
  _fullRender();
}

async function _fetchRegistration(rid) {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(rid)}/public`);
    if (!res.ok) {
      if (res.status === 404) {
        _redirectToNotFoundPage(t('txt_reg_not_found_deleted_hint'), '/register');
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

// ── Directory view (no ID provided) ──────────────────────

async function _showDirectory() {
  _hideAll();
  const el = document.getElementById('state-directory');
  el.innerHTML = `<div class="loading">${t('txt_txt_loading')}</div>`;
  el.style.display = 'block';

  try {
    const res = await fetch(`${API}/public`);
    if (!res.ok) throw new Error();
    const lobbies = await res.json();
    _renderDirectory(lobbies);
  } catch (e) {
    el.innerHTML = `<div class="card state-msg"><h2>⚠️</h2><p>${t('txt_reg_error')}</p></div>`;
  }
}

function _renderDirectory(lobbies) {
  const el = document.getElementById('state-directory');
  const langMeta = _languageToggleMeta();
  const themeIcon = _theme === 'dark' ? '🌙' : '☀️';

  let html = `<div class="tv-picker">`;
  html += `<div class="tv-header-title-row reg-directory-header-row">`;
  html += `<div class="tv-lang-cell"><button type="button" class="theme-btn" onclick="_regToggleLanguage()" title="${esc(langMeta.label)}" aria-label="${esc(langMeta.label)}">${langMeta.icon}</button></div>`;
  html += buildPageSelectorHtml('register');
  html += `<div class="tv-toggle-btns">`;
  html += buildCompactRefreshButtonHtml('_showDirectory()', t('txt_txt_refresh_now'));
  html += `<button type="button" data-theme-toggle-icon="1" class="theme-btn" onclick="_regToggleTheme()" title="${t('txt_txt_toggle_light_dark_mode')}">${themeIcon}</button>`;
  html += `</div>`;
  html += `</div>`;
  if (lobbies.length > 0) {
    html += `<div class="subtitle">${t('txt_reg_directory_subtitle')}</div>`;
    html += `<ul class="tv-picker-list">`;
    for (const lobby of lobbies) {
      const url = lobby.alias
        ? `/register/${encodeURIComponent(lobby.alias)}`
        : `/register?id=${encodeURIComponent(lobby.id)}`;
      const count = lobby.registrant_count || 0;
      const countText = `${count} ${t(count === 1 ? 'txt_reg_player_singular' : 'txt_reg_players_plural')}`;
      const isTennis = lobby.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');

      html += `<a class="tv-picker-item" href="${esc(url)}">`;
      html += esc(lobby.name);
      html += `<span class="picker-badge picker-badge-sport">${esc(sportLabel)}</span>`;
      html += `<span class="picker-badge picker-badge-phase">${countText}</span>`;
      if (lobby.join_code_required) {
        html += `<span class="picker-badge picker-badge-type">${t('txt_reg_join_code_badge')}</span>`;
      }
      html += `</a>`;
    }
    html += `</ul>`;
    html += `<div class="reg-directory-enter-id-hint">${t('txt_reg_or_enter_id')}</div>`;
  }
  html += `<form class="tv-picker-form" onsubmit="return _goToLobby(event)">`;
  html += `<input type="text" id="reg-picker-input" placeholder="${t('txt_reg_id_or_alias')}">`;
  html += `<button type="submit">${t('txt_txt_go')}</button>`;
  html += `</form>`;
  html += `</div>`;

  el.innerHTML = html;
}

async function _goToLobby(e) {
  e.preventDefault();
  const val = document.getElementById('reg-picker-input').value.trim();
  if (!val) return false;

  document.querySelector('.picker-inline-error')?.remove();

  try {
    const res = await fetch(`${API}/${encodeURIComponent(val)}/public`);
    if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : 'error');
    location.href = `/register/${encodeURIComponent(val)}`;
  } catch (err) {
    const form = document.querySelector('.tv-picker-form');
    if (form) {
      const errDiv = document.createElement('div');
      errDiv.className = 'tv-error picker-inline-error';
      errDiv.classList.add('picker-inline-error-spaced');
      errDiv.textContent = err.message === 'not_found' ? t('txt_reg_not_found') : t('txt_reg_error');
      form.after(errDiv);
    }
  }
  return false;
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
    const passphrase = profile?.passphrase;
    if (!passphrase) return false;

    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    _linkedProfilePassphrase = passphrase;
    _lastResult = {
      player_id: data.player_id,
      player_name: data.player_name,
      passphrase: data.passphrase,
      answers: data.answers || {},
      token: data.token || null,
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
  for (const id of ['state-loading', 'state-directory', 'state-closed', 'state-form', 'state-success', 'state-error']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
}

function _showError(msg) {
  _hideAll();
  const el = document.getElementById('state-error');
  el.innerHTML = `<h2>⚠️</h2><p>${esc(msg)}</p>`;
  el.style.display = 'block';
}

function _showClosed(converted) {
  _hideAll();
  const el = document.getElementById('state-closed');
  let html = `<h2>${esc(_regData.name)}</h2>`;
  if (_regData.description) {
    html += `<div class="reg-description">${_renderMarkdown(_regData.description)}</div>`;
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

function _getLinkedTournamentIds() {
  const tids = Array.isArray(_regData?.converted_to_tids)
    ? _regData.converted_to_tids.filter(Boolean)
    : [];
  if (tids.length > 0) return tids;
  if (_regData?.converted_to_tid) return [_regData.converted_to_tid];
  return [];
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
  const tids = _getLinkedTournamentIds();
  if (tids.length === 0) return '';

  const linkedById = new Map(
    ((_regData?.linked_tournaments || []).filter((item) => item?.id))
      .map((item) => [item.id, item]),
  );
  const activeLinks = [];
  const finishedLinks = [];

  tids.forEach(function(tid) {
    const linked = linkedById.get(tid);
    const shortId = tid.length > 10 ? `${tid.slice(0, 10)}…` : tid;
    const name = linked?.name || shortId;
    const label = `${t('txt_reg_view_tournament_btn')} · ${name}`;
    const linkHtml = `<a href="${_buildTournamentUrl(tid)}" class="linked-tournament-link" title="${esc(tid)}">${esc(label)}</a>`;
    if (linked?.finished) {
      finishedLinks.push(linkHtml);
    } else {
      activeLinks.push(linkHtml);
    }
  });

  let html = `<div class="linked-tournaments">`;
  html += `<div class="linked-tournaments-title">${t('txt_reg_linked_tournaments')}</div>`;
  if (activeLinks.length > 0) {
    html += `<div class="linked-tournaments-section-title">${t('txt_txt_active_tournaments')}</div>`;
    html += `<div class="linked-tournaments-list">${activeLinks.join('')}</div>`;
  }
  if (finishedLinks.length > 0) {
    html += `<div class="linked-tournaments-section-title">${t('txt_txt_finished_tournaments')}</div>`;
    html += `<div class="linked-tournaments-list">${finishedLinks.join('')}</div>`;
  }
  html += `</div>`;

  return html;
}

function _showForm() {
  _hideAll();
  const el = document.getElementById('state-form');
  let html = `<h1>${esc(_regData.name)}</h1>`;
  html += `<p class="subtitle"><span class="badge badge-count">${_regData.registrant_count} ${t(_regData.registrant_count === 1 ? 'txt_reg_player_singular' : 'txt_reg_players_plural')}</span></p>`;

  if (_regData.description) {
    html += `<div class="reg-description">${_renderMarkdown(_regData.description)}</div>`;
  }

  html += _renderMessage();
  html += _renderPlayerList();
  html += _renderLinkedTournaments();

  html += `<div class="returning-player-section">`;
  html += `<button type="button" class="returning-player-toggle" onclick="_toggleReturningPanel()">`;
  html += `<span class="returning-player-toggle-icon" id="returning-toggle-icon">▸</span>`;
  html += `${t('txt_reg_returning_player')}`;
  html += `</button>`;
  html += `<div class="returning-player-panel reg-hidden" id="returning-player-panel">`;
  html += `<div class="form-group returning-player-input-group">`;
  html += `<label>${t('txt_reg_enter_passphrase')}</label>`;
  html += `<input type="text" id="reg-returning-passphrase" class="returning-player-passphrase" maxlength="128" placeholder="word-word-word" autocomplete="off" spellcheck="false">`;
  html += `</div>`;
  html += `<div class="error-msg" id="reg-returning-error"></div>`;
  html += `<button type="button" class="btn btn-secondary" id="reg-returning-btn" onclick="_lookupPlayer()">${t('txt_reg_lookup_btn')}</button>`;
  html += `</div>`;
  html += `</div>`;

  // Detect existing Player Hub session or profile data
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

  html += `<form id="reg-form" onsubmit="return false">`;

  // Player Hub: logged-in banner shown at top of form
  if (isLoggedIn) {
    html += `<div class="reg-ps-logged-notice" id="reg-ps-logged-notice">`;
    html += `✦ ${t('txt_reg_ps_logged_in', { name: esc(prefillName || _regPrefill?.email || '') })}`;
    html += `<button type="button" class="reg-ps-logout-link" onclick="_logoutPlayerSpace()">${t('txt_reg_ps_logout')}</button>`;
    html += `</div>`;
  } else if (prefillName || prefillEmail) {
    html += `<p class="reg-prefill-notice">✦ ${t('txt_reg_prefilled_from_profile')}</p>`;
  }

  html += `<div class="form-group">
    <label>${t('txt_reg_name')}</label>
    <input type="text" id="reg-player-name" maxlength="128" required placeholder="${esc(t('txt_reg_name_placeholder'))}" value="${esc(prefillName)}">
  </div>`;

  // Player Hub: subtle prefill link below name field (only if not already logged in)
  if (!isLoggedIn) {
    html += `<div class="reg-ps-prefill" id="reg-ps-prefill">`;
    html += `<button type="button" class="reg-ps-prefill-link" id="reg-ps-prefill-link" onclick="_togglePsLogin()">🔑 ${t('txt_reg_ps_login')}</button>`;
    html += `<div class="reg-ps-prefill-panel reg-hidden" id="reg-ps-login-panel">`;
    html += `<div class="form-group">`;
    html += `<label>${t('txt_player_passphrase_label')}</label>`;
    html += `<input type="text" id="reg-ps-passphrase" maxlength="128" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false">`;
    html += `</div>`;
    html += `<div class="reg-ps-login-error" id="reg-ps-login-error"></div>`;
    html += `<button type="button" class="btn btn-secondary" id="reg-ps-login-btn" onclick="_loginPlayerSpace()">${t('txt_player_login_btn')}</button>`;
    html += `</div>`;
    html += `</details>`;
  }

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

function _toggleReturningPanel() {
  const panel = document.getElementById('returning-player-panel');
  const btn = panel?.previousElementSibling;
  const icon = document.getElementById('returning-toggle-icon');
  if (!panel) return;
  const isOpen = !panel.classList.contains('reg-hidden');
  panel.classList.toggle('reg-hidden', isOpen);
  if (btn) btn.classList.toggle('open', !isOpen);
  if (!isOpen) document.getElementById('reg-returning-passphrase')?.focus();
}

function _togglePsLogin() {
  const panel = document.getElementById('reg-ps-login-panel');
  const link = document.getElementById('reg-ps-prefill-link');
  if (!panel) return;
  const isOpen = !panel.classList.contains('reg-hidden');
  panel.classList.toggle('reg-hidden', isOpen);
  if (link) link.classList.toggle('open', !isOpen);
  if (!isOpen) document.getElementById('reg-ps-passphrase')?.focus();
}

async function _loginPlayerSpace() {
  const passphrase = document.getElementById('reg-ps-passphrase')?.value?.trim();
  const errorEl = document.getElementById('reg-ps-login-error');
  const btn = document.getElementById('reg-ps-login-btn');
  if (!passphrase) return;
  if (errorEl) errorEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = t('txt_reg_ps_logging_in'); }
  try {
    const res = await fetch('/api/player-profile/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      if (errorEl) errorEl.textContent = t('txt_reg_ps_login_error');
      return;
    }
    const data = await res.json();
    // Persist Player Hub session
    try {
      localStorage.setItem('padel-player-profile', data.access_token);
      localStorage.setItem('padel-player-profile-data', JSON.stringify(data.profile));
    } catch (_) {}
    // Re-render form with prefilled data
    _showForm();
  } catch (_) {
    if (errorEl) errorEl.textContent = t('txt_reg_ps_login_error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_player_login_btn'); }
  }
}

function _logoutPlayerSpace() {
  _linkedProfilePassphrase = null;
  try {
    localStorage.removeItem('padel-player-profile');
    localStorage.removeItem('padel-player-profile-data');
  } catch (_) {}
  _showForm();
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
      _lastResult = {
        player_id: data.player_id,
        player_name: data.player_name,
        passphrase: data.passphrase,
        answers: data.answers || {},
        token: data.token || null,
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

async function _lookupPlayer() {
  const passphrase = document.getElementById('reg-returning-passphrase')?.value?.trim();
  const errorEl = document.getElementById('reg-returning-error');
  const btn = document.getElementById('reg-returning-btn');
  if (!passphrase) return;
  errorEl.textContent = '';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      errorEl.textContent = t('txt_reg_login_not_found');
      btn.disabled = false;
      return;
    }
    const data = await res.json();
    _lastResult = {
      player_id: data.player_id,
      player_name: data.player_name,
      passphrase: data.passphrase,
      answers: data.answers || {},
      token: data.token || null,
      from_login: true,
    };
    if (data.token) _setRegToken(data.token);
    _showSuccess();
  } catch (_) {
    errorEl.textContent = t('txt_reg_error');
    btn.disabled = false;
  }
}

function _renderReturningPlayerEditor() {
  if (!_lastResult?.from_login || !_regData?.open) return '';

  const hasQuestions = _regData.questions && _regData.questions.length > 0;

  let html = `<details class="manage-reg">`;
  html += `<summary><span class="manage-reg-arrow">▸</span> ${t('txt_reg_manage_registration')}</summary>`;
  html += `<div class="manage-reg-body">`;

  if (hasQuestions) {
    for (const q of _regData.questions) {
      const reqAttr = q.required ? 'required' : '';
      const existingValue = _lastResult.answers?.[q.key] || '';
      const optHint = q.required ? '' : ` <small class="reg-optional-hint">(${t('txt_txt_optional')})</small>`;
      html += `<div class="form-group"><label>${esc(q.label)}${optHint}</label>`;
      if (q.type === 'choice' && q.choices && q.choices.length) {
        html += `<select class="returning-answer" data-key="${esc(q.key)}" ${reqAttr}>`;
        html += `<option value="">${t('txt_reg_select_option')}</option>`;
        for (const c of q.choices) {
          const selected = c === existingValue ? 'selected' : '';
          html += `<option value="${esc(c)}" ${selected}>${esc(c)}</option>`;
        }
        html += `</select>`;
      } else if (q.type === 'multichoice' && q.choices && q.choices.length) {
        let existingSelected = [];
        try { existingSelected = JSON.parse(existingValue) || []; } catch (_) {}
        html += `<div class="returning-multichoice" data-key="${esc(q.key)}" ${reqAttr}>`;
        for (const c of q.choices) {
          const checked = existingSelected.includes(c) ? 'checked' : '';
          html += `<label class="reg-multichoice-option"><input type="checkbox" value="${esc(c)}" ${checked}><span>${esc(c)}</span></label>`;
        }
        html += `</div>`;
      } else if (q.type === 'number') {
        html += `<input type="number" class="returning-answer" data-key="${esc(q.key)}" step="any" value="${esc(existingValue)}" ${reqAttr}>`;
      } else {
        html += `<textarea class="returning-answer reg-text-expand" data-key="${esc(q.key)}" maxlength="512" rows="1" ${reqAttr} oninput="_regAutoResize(this)">${esc(existingValue)}</textarea>`;
      }
      html += `</div>`;
    }
  }

  html += `<div class="error-msg" id="reg-returning-action-error"></div>`;
  html += `<div class="manage-reg-actions">`;
  html += `<div class="manage-reg-actions-left">`;
  if (hasQuestions) {
    html += `<button type="button" class="btn-outline" id="reg-returning-save-btn" onclick="_saveReturningAnswers()">${t('txt_reg_update_answers')}</button>`;
    html += `<span class="manage-reg-success" id="reg-returning-save-ok"></span>`;
  }
  html += `</div>`;
  html += `<button type="button" class="btn-outline-danger" id="reg-returning-cancel-btn" onclick="_cancelReturningRegistration()">${t('txt_reg_cancel_registration')}</button>`;
  html += `</div></div></details>`;
  return html;
}

async function _saveReturningAnswers() {
  if (!_lastResult?.from_login || !_rid) return;
  const errorEl = document.getElementById('reg-returning-action-error');
  const saveBtn = document.getElementById('reg-returning-save-btn');
  if (errorEl) errorEl.textContent = '';

  const answers = {};
  const answerEls = document.querySelectorAll('.returning-answer');
  for (const el of answerEls) {
    const key = el.getAttribute('data-key');
    const val = el.value?.trim();
    if (el.hasAttribute('required') && !val) {
      if (errorEl) errorEl.textContent = t('txt_reg_answer_required');
      return;
    }
    if (val) answers[key] = val;
  }
  // Collect multichoice answers (checkboxes)
  const multichoiceEls = document.querySelectorAll('.returning-multichoice');
  for (const container of multichoiceEls) {
    const key = container.getAttribute('data-key');
    const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    if (container.hasAttribute('required') && selected.length === 0) {
      if (errorEl) errorEl.textContent = t('txt_reg_answer_required');
      return;
    }
    if (selected.length > 0) answers[key] = JSON.stringify(selected);
  }

  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-answers`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: _lastResult.passphrase, answers }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (errorEl) errorEl.textContent = data.detail || t('txt_reg_error');
      return;
    }

    const updated = await res.json();
    _lastResult.answers = updated.answers || {};
    if (_regData?.registrants) {
      const idx = _regData.registrants.findIndex((p) => p.player_id === updated.player_id);
      if (idx >= 0) _regData.registrants[idx].answers = updated.answers || {};
    }
    const okEl = document.getElementById('reg-returning-save-ok');
    if (okEl) {
      okEl.textContent = t('txt_reg_saved');
      setTimeout(() => { okEl.textContent = ''; }, 3000);
    }
  } catch (_) {
    if (errorEl) errorEl.textContent = t('txt_reg_error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function _cancelReturningRegistration() {
  if (!_lastResult?.from_login || !_rid) return;
  const errorEl = document.getElementById('reg-returning-action-error');
  const cancelBtn = document.getElementById('reg-returning-cancel-btn');
  if (errorEl) errorEl.textContent = '';
  if (!confirm(t('txt_reg_confirm_cancel_registration'))) return;

  if (cancelBtn) cancelBtn.disabled = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/player-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: _lastResult.passphrase }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (errorEl) errorEl.textContent = data.detail || t('txt_reg_error');
      return;
    }

    if (_regData) {
      _regData.registrant_count = Math.max(0, (_regData.registrant_count || 1) - 1);
    }
    _lastResult = null;
    _render();
    const toast = document.createElement('div');
    toast.className = 'reg-toast';
    toast.textContent = `✓ ${t('txt_reg_cancelled')}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  } catch (_) {
    if (errorEl) errorEl.textContent = t('txt_reg_error');
  } finally {
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

function _showSuccess() {
  _hideAll();
  const el = document.getElementById('state-success');
  const r = _lastResult;

  // Store token early so _buildTournamentUrl can embed it in linked tournament links
  if (_rid && r.token) {
    _setRegToken(r.token);
  }

  let html = `<h2>✅ ${t('txt_reg_registered', { name: r.player_name })}</h2>`;
  html += `<div class="passphrase-label">${t('txt_reg_your_passphrase')}</div>`;
  html += `<div class="passphrase-box">${esc(r.passphrase)}</div>`;
  html += `<p class="keep-note">${t('txt_reg_keep_code')}</p>`;
  html += `<div class="success-actions"><a href="/register" class="btn btn-primary success-back-btn">${t('txt_reg_back_home')}</a><button type="button" class="success-register-another" onclick="_registerAnother()">${t('txt_reg_register_another')}</button></div>`;

  html += _renderMessage();

  html += _renderPlayerList();

  html += _renderLinkedTournaments();

  html += _renderReturningPlayerEditor();

  // Player Hub: show create section only if no profile is linked and no existing session
  const _hasProfileSession = (() => {
    try {
      return !!(localStorage.getItem('padel-player-profile') && localStorage.getItem('padel-player-profile-data'));
    } catch (_) { return false; }
  })();
  if (!_linkedProfilePassphrase && !_hasProfileSession) {
    const emailMode = _regData?.email_requirement || 'optional';
    const hasEmail = !!_submittedEmail;
    const needsEmail = emailMode === 'disabled' || !hasEmail;

    html += `<details class="reg-ps-create-section" id="reg-ps-create-section">`;
    html += `<summary class="reg-ps-create-summary">💡 ${t('txt_reg_ps_save_help')}</summary>`;
    html += `<div class="reg-ps-create-body">`;
    if (needsEmail) {
      html += `<div class="reg-ps-create-email"><label style="font-size:0.8rem;color:var(--text-muted)">${t('txt_reg_ps_email_needed')}</label>`;
      html += `<input type="email" id="reg-ps-create-email-input" maxlength="320" placeholder="${esc(t('txt_email_placeholder'))}"></div>`;
    }
    html += `<button type="button" class="reg-ps-create-btn" id="reg-ps-create-btn" onclick="_createPlayerSpace()">${t('txt_reg_ps_save')}</button>`;
    html += `<div class="reg-ps-create-error" id="reg-ps-create-error"></div>`;
    html += `<p class="reg-ps-already-have">${t('txt_reg_ps_already_have')} <a href="/player">${t('txt_player_login')}</a></p>`;
    html += `</div>`;
    html += `</div>`;
  }

  el.innerHTML = html;
  el.style.display = 'block';
  el.querySelectorAll('textarea.reg-text-expand').forEach(_regAutoResize);

  _startPolling();
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
      const msg = data.detail || t('txt_reg_error');
      errorEl.textContent = msg;
      submitBtn.disabled = false;
      return;
    }
    _lastResult = await res.json();
    // Backend response doesn't include answers; attach them so
    // _createPlayerSpace can access the contact answer.
    _lastResult.answers = answers;
    _regData.registrant_count++;
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
    if (questionsChanged || messageChanged || data.registrant_count !== _regData.registrant_count) {
      _regData = data;
      if (_lastResult) _showSuccess();
    }
  } catch (_) { /* network blip */ }
  finally { _lobbyFetching = false; }
}

function _showRedirectToast(tid) {
  const toast = document.createElement('div');
  toast.className = 'reg-toast';
  toast.textContent = `🎾 ${t('txt_reg_tournament_started')}`;
  document.body.appendChild(toast);

  let url = `/tv/${encodeURIComponent(tid)}`;
  try {
    const token = _getRegToken();
    if (token) url = `/tv/${encodeURIComponent(tid)}?player_token=${encodeURIComponent(token)}`;
  } catch (_) {}

  setTimeout(() => { window.location.href = url; }, 2000);
}

// ── Message + player list rendering ──────────────────────

function _renderMessage() {
  if (!_regData?.message) return '';
  return `<div class="reg-message-label">📢 ${t('txt_reg_admin_message')}</div>
    <div class="reg-message">${_renderMarkdown(_regData.message)}</div>`;
}

function _renderPlayerList() {
  const players = _regData?.registrants;
  if (!players || players.length === 0) return '';
  let chips = '';
  for (const p of players) {
    chips += `<span class="player-chip">${esc(p.player_name)}</span>`;
  }
  return `<details class="player-list" open>
    <summary>${t('txt_reg_registered_players')} (${players.length})</summary>
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

function _registerAnother() {
  _skipProfileAutoLoginOnce = true;
  _lastResult = null;
  _submittedEmail = '';
  _stopPolling();
  _render();
}

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
      html += `<p>✅ ${t('txt_reg_ps_created')}</p>`;
      if (samePassphrase) {
        html += `<p>${t('txt_reg_ps_created_same_pp')}</p>`;
      } else {
        html += `<p>${t('txt_reg_ps_created_diff_pp')}</p>`;
        html += `<div class="passphrase-box">${esc(data.profile.passphrase)}</div>`;
      }
      html += `</div>`;
      section.innerHTML = html;
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
