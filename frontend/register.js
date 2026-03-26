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
  _fullRender();
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
let _rid = null;

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
  html += `<div id="state-directory" style="display:none"></div>`;
  html += `<div id="state-closed" class="card state-msg" style="display:none"></div>`;
  html += `<div id="state-form" class="card" style="display:none"></div>`;
  html += `<div id="state-success" class="card success-card" style="display:none"></div>`;
  html += `<div id="state-error" class="card state-msg" style="display:none"></div>`;
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
  _fullRender();
}

async function _fetchRegistration(rid) {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(rid)}/public`);
    if (!res.ok) {
      if (res.status === 404) {
        await _showDirectory();
        const form = document.querySelector('.tv-picker-form');
        if (form) {
          const errDiv = document.createElement('div');
          errDiv.className = 'tv-error picker-inline-error';
          errDiv.style.marginTop = '0.75rem';
          errDiv.textContent = t('txt_reg_not_found');
          form.after(errDiv);
        }
      } else {
        _showError(t('txt_reg_error'));
      }
      return;
    }
    _regData = await res.json();
    _render();
  } catch (e) {
    _showError(t('txt_reg_error'));
  }
}

// ── Directory view (no ID provided) ──────────────────────

async function _showDirectory() {
  _hideAll();
  const el = document.getElementById('state-directory');
  el.innerHTML = `<div class="loading">${t('txt_txt_loading')}</div>`;
  el.style.display = '';

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
  html += `<div class="tv-header-title-row" style="margin-bottom:1rem">`;
  html += `<div class="tv-lang-cell"><button type="button" class="theme-btn" onclick="_regToggleLanguage()" title="${esc(langMeta.label)}" aria-label="${esc(langMeta.label)}">${langMeta.icon}</button></div>`;
  html += buildPageSelectorHtml('register');
  html += `<div class="tv-toggle-btns">`;
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
    html += `<div style="color:var(--text-muted);font-size:0.85rem;margin-top:1.5rem;margin-bottom:0.5rem">${t('txt_reg_or_enter_id')}</div>`;
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
      errDiv.style.marginTop = '0.75rem';
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

  if (_regData.converted) { _showClosed(true); return; }
  if (!_regData.open) { _showClosed(false); return; }
  _showForm();
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
  el.style.display = '';
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
    if (_regData.converted_to_tid) {
      const tid = _regData.converted_to_tid;
      let tvUrl = `/public.html?id=${encodeURIComponent(tid)}`;
      try {
        const token = _getRegToken();
        if (token) tvUrl = `/tv/${encodeURIComponent(tid)}?player_token=${encodeURIComponent(token)}`;
      } catch (_) {}
      html += `<div style="text-align:center;margin-top:1rem"><a href="${tvUrl}" class="btn btn-primary" style="display:inline-block;text-decoration:none;max-width:300px">🏆 ${t('txt_reg_view_tournament_btn')}</a></div>`;
    }
  } else {
    html += `<p><span class="badge badge-closed">${t('txt_reg_closed')}</span></p>`;
    html += `<p>${t('txt_reg_closed_msg')}</p>`;
  }
  el.innerHTML = html;
  el.style.display = '';
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

  html += `<form id="reg-form" onsubmit="return false">`;
  html += `<div class="form-group">
    <label>${t('txt_reg_name')}</label>
    <input type="text" id="reg-player-name" maxlength="128" required placeholder="${esc(t('txt_reg_name_placeholder'))}">
  </div>`;

  if (_regData.join_code_required) {
    html += `<div class="form-group">
      <label>${t('txt_reg_join_code')}</label>
      <input type="password" id="reg-join-code" maxlength="64" required placeholder="${esc(t('txt_reg_join_code_placeholder'))}">
    </div>`;
  }

  if (_regData.questions && _regData.questions.length) {
    for (const q of _regData.questions) {
      const reqAttr = q.required ? 'required' : '';
      const optHint = q.required ? '' : ` <small style="font-weight:400;color:var(--text-muted)">(${t('txt_txt_optional')})</small>`;
      html += `<div class="form-group"><label>${esc(q.label)}${optHint}</label>`;
      if (q.type === 'choice' && q.choices && q.choices.length) {
        html += `<select class="reg-answer" data-key="${esc(q.key)}" ${reqAttr}>`;
        html += `<option value="">${t('txt_reg_select_option')}</option>`;
        for (const c of q.choices) {
          html += `<option value="${esc(c)}">${esc(c)}</option>`;
        }
        html += `</select>`;
      } else {
        html += `<input type="text" class="reg-answer" data-key="${esc(q.key)}" maxlength="256" ${reqAttr}>`;
      }
      html += `</div>`;
    }
  }

  html += `<div class="error-msg" id="reg-error"></div>`;
  html += `<button type="submit" class="btn btn-primary" id="reg-submit-btn">${t('txt_reg_submit')}</button>`;
  html += `</form>`;

  html += `<details class="returning-player-details" style="margin-top:1.25rem">`;
  html += `<summary style="cursor:pointer;color:var(--text-muted);font-size:0.85rem;list-style:none;display:flex;align-items:center;gap:0.4rem">`;
  html += `<span style="font-size:0.7em">▸</span> ${t('txt_reg_returning_player')}</summary>`;
  html += `<div style="margin-top:0.75rem">`;
  html += `<div class="form-group">`;
  html += `<label>${t('txt_reg_enter_passphrase')}</label>`;
  html += `<input type="text" id="reg-returning-passphrase" maxlength="128" placeholder="word-word-word" autocomplete="off" spellcheck="false" style="font-family:monospace">`;
  html += `</div>`;
  html += `<div class="error-msg" id="reg-returning-error"></div>`;
  html += `<button type="button" class="btn btn-secondary" id="reg-returning-btn" onclick="_lookupPlayer()">${t('txt_reg_lookup_btn')}</button>`;
  html += `</div>`;
  html += `</details>`;

  el.innerHTML = html;
  el.style.display = '';

  document.getElementById('reg-form').addEventListener('submit', _handleSubmit);
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
      token: null,
      from_login: true,
    };
    _showSuccess();
  } catch (_) {
    errorEl.textContent = t('txt_reg_error');
    btn.disabled = false;
  }
}

function _renderReturningPlayerEditor() {
  if (!_lastResult?.from_login || !_regData?.open || _regData?.converted) return '';

  const hasQuestions = _regData.questions && _regData.questions.length > 0;

  let html = `<details class="manage-reg">`;
  html += `<summary><span class="manage-reg-arrow">▸</span> ${t('txt_reg_manage_registration')}</summary>`;
  html += `<div class="manage-reg-body">`;

  if (hasQuestions) {
    for (const q of _regData.questions) {
      const reqAttr = q.required ? 'required' : '';
      const existingValue = _lastResult.answers?.[q.key] || '';
      const optHint = q.required ? '' : ` <small style="font-weight:400;color:var(--text-muted)">(${t('txt_txt_optional')})</small>`;
      html += `<div class="form-group"><label>${esc(q.label)}${optHint}</label>`;
      if (q.type === 'choice' && q.choices && q.choices.length) {
        html += `<select class="returning-answer" data-key="${esc(q.key)}" ${reqAttr}>`;
        html += `<option value="">${t('txt_reg_select_option')}</option>`;
        for (const c of q.choices) {
          const selected = c === existingValue ? 'selected' : '';
          html += `<option value="${esc(c)}" ${selected}>${esc(c)}</option>`;
        }
        html += `</select>`;
      } else {
        html += `<input type="text" class="returning-answer" data-key="${esc(q.key)}" maxlength="256" value="${esc(existingValue)}" ${reqAttr}>`;
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

    if (_regData?.registrants) {
      _regData.registrants = _regData.registrants.filter((p) => p.player_id !== _lastResult.player_id);
      _regData.registrant_count = _regData.registrants.length;
    }
    _lastResult = null;
    _render();
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

  let html = `<h2>✅ ${t('txt_reg_registered', { name: r.player_name })}</h2>`;
  html += `<div class="passphrase-label">${t('txt_reg_your_passphrase')}</div>`;
  html += `<div class="passphrase-box">${esc(r.passphrase)}</div>`;
  html += `<p class="keep-note">${t('txt_reg_keep_code')}</p>`;

  html += _renderPlayerList();

  html += _renderReturningPlayerEditor();

  html += `<button type="button" class="btn-secondary" onclick="_registerAnother()" style="margin-top:0.5rem">${t('txt_reg_register_another')}</button>`;

  el.innerHTML = html;
  el.style.display = '';

  if (_rid && r.token) {
    _setRegToken(r.token);
  }

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
  if (Object.keys(answers).length) body.answers = answers;

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
    _regData.registrant_count++;
    if (_regData.registrants) {
      _regData.registrants.push({ player_id: _lastResult.player_id, player_name: _lastResult.player_name, answers: body.answers || {}, registered_at: new Date().toISOString() });
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
  _pollTimer = setInterval(_pollLobby, 6000);
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
      _pollTimer = setInterval(_pollLobby, 6000);
    }
  }
}

async function _pollLobby() {
  if (!_rid) return;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(_rid)}/public`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.converted_to_tid) {
      _stopPolling();
      _regData = data;
      _showRedirectToast(data.converted_to_tid);
      return;
    }

    if (!data.open && !data.converted) {
      _stopPolling();
      _regData = data;
      _showClosed(false);
      return;
    }

    if (data.registrant_count !== _regData.registrant_count || data.registrants.length !== _regData.registrants.length) {
      _regData = data;
      if (_lastResult) _showSuccess();
    }
  } catch (_) { /* network blip */ }
}

function _showRedirectToast(tid) {
  const toast = document.createElement('div');
  toast.className = 'reg-toast';
  toast.textContent = `🎾 ${t('txt_reg_tournament_started')}`;
  document.body.appendChild(toast);

  let url = `/public.html?id=${encodeURIComponent(tid)}`;
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

// ── Public API (for onclick handlers) ────────────────────

function _registerAnother() {
  _lastResult = null;
  _stopPolling();
  _render();
}

// ── Boot ─────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}
