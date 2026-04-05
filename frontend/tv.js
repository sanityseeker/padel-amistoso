const API = '';

// ── Remember this page for the page selector ──────────────
try { localStorage.setItem('amistoso-last-page', 'tv'); } catch (_) {}

// ── Theme ─────────────────────────────────────────────────
let _theme = _loadSavedTheme();
_applyTheme(_theme);
let _lang = _loadSavedLanguage();
setAppLanguage(_lang);

function _refreshThemeToggleButtons() {
  const icon = _theme === 'dark' ? '🌙' : '☀️';
  document.querySelectorAll('[data-theme-toggle-icon]').forEach((btn) => {
    btn.textContent = icon;
  });
}

function _toggleTheme() {
  _theme = _theme === 'dark' ? 'light' : 'dark';
  _applyTheme(_theme);
  _saveTheme(_theme);
  _refreshThemeToggleButtons();
}

function _toggleLanguage() {
  _lang = _lang === 'es' ? 'en' : 'es';
  setAppLanguage(_lang);
  if (TID) loadTV();
  else _showPicker();
}

function _languageToggleMeta() {
  const current = getAppLanguage();
  const currentLabel = current === 'es' ? t('txt_txt_spanish') : t('txt_txt_english');
  return {
    icon: current === 'es' ? '🇪🇸' : '🇬🇧',
    label: `${t('txt_txt_language')}: ${currentLabel}`,
  };
}

// ── URL params ────────────────────────────────────────────
const _params = new URLSearchParams(location.search);
// Extract slug from path: /tv/<slug>
const _pathSlug = (() => {
  const m = location.pathname.match(/^\/tv\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
})();
// Legacy query-param support (?tid= / ?t=) kept for backwards compat
let TID = _params.get('tid') || (/^t\d+$/.test(_pathSlug) ? _pathSlug : null);
const _aliasParam = _params.get('t') || (!TID ? _pathSlug : null);

// ── State ─────────────────────────────────────────────────
const tvState = {
  tournamentType: null,
  tournamentName: '',
  tournamentSport: 'padel',
  refreshIntervalSecs: 15,
  countdown: 15,
  countdownInterval: null,
  isRefreshing: false,
  breakdowns: {},           // {match_id: {...}} for Mex breakdowns
  playerMap: {},            // {player_id: player_name}
  sectionOpenState: {},     // {data-tv-key: boolean} — persisted across refreshes
  lastKnownVersion: null,   // for on-update mode
  scoreMode: {},            // {ctx: 'points'|'sets'} from admin TV settings
  totalPts: 0,              // total_points_per_match for Mexicano auto-fill
  versionPollTimer: null,   // setInterval handle for version polling
  pickerPollTimer: null,    // setInterval handle for picker auto-refresh
  // Player auth state
  playerJwt: null,          // JWT string
  playerId: null,           // player ID from auth response
  playerName: null,         // player name from auth response
  allowPlayerScoring: true, // controlled by admin TV setting
  teamRoster: null,         // {team_pid: [member_pid, ...]} for composite teams
  abbrevPopupBtn: null,     // currently active abbreviation popup button
  playerOpponents: [],      // [{player_id, name, contact, match_id, round_number}]
  playerOpponentsLoaded: false, // whether we have fetched at least once
  playerPanelOpen: false,   // whether the expand panel was open (survives re-renders)
  // Mexicano leaderboard sort state
  mexLeaderboard: [],       // cached leaderboard rows for client-side sort
  mexTeamMode: false,       // mirrors status.team_mode
  mexSortCol: null,         // null = server default order
  mexSortDir: 'desc',       // 'asc' | 'desc'
};

// ── In-flight guards for version polling ──────────────────
let _tvVersionFetching = false;
let _pickerFetching = false;
let _tvVersionEtag = null;
let _pickerVersionEtag = null;
const _TV_VERSION_POLL_INTERVAL_MS = 3000;
const _TV_PICKER_POLL_INTERVAL_MS = 3000;

function _tvLabel() {
  return tvState.tournamentSport === 'tennis' ? t('txt_txt_tennis_tv') : t('txt_txt_padel_tv');
}

function _playerStorageKey() { return `padel-player-${TID}`; }

function _readPlayerSessionRaw() {
  const key = _playerStorageKey();
  if (!key) return null;
  try {
    const localValue = localStorage.getItem(key);
    if (localValue) return localValue;
  } catch (_) {}
  try {
    const sessionValue = sessionStorage.getItem(key);
    if (sessionValue) {
      try { localStorage.setItem(key, sessionValue); } catch (_) {}
      return sessionValue;
    }
  } catch (_) {}
  return null;
}

function _writePlayerSessionRaw(value) {
  const key = _playerStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
  }
}

function _removePlayerSessionRaw() {
  const key = _playerStorageKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch (_) {}
  try { sessionStorage.removeItem(key); } catch (_) {}
}

function _loadPlayerSession() {
  if (!TID) return;
  try {
    const raw = _readPlayerSessionRaw();
    if (!raw) return;
    const data = JSON.parse(raw);
    tvState.playerJwt = data.jwt || null;
    tvState.playerId = data.playerId || null;
    tvState.playerName = data.playerName || null;
  } catch { _clearPlayerSession(); }
}

function _savePlayerSession() {
  if (!TID || !tvState.playerJwt) return;
  _writePlayerSessionRaw(JSON.stringify({
    jwt: tvState.playerJwt,
    playerId: tvState.playerId,
    playerName: tvState.playerName,
  }));
}

function _clearPlayerSession() {
  tvState.playerJwt = null; tvState.playerId = null; tvState.playerName = null;
  tvState.playerOpponents = []; tvState.playerOpponentsLoaded = false;
  _removePlayerSessionRaw();
}

function _isPlayerLoggedIn() { return !!tvState.playerJwt; }

/** Check whether a match involves the authenticated player (direct or via team_roster) */
function _playerIsInMatch(m) {
  if (!tvState.playerId) return false;
  const ids = [...(m.team1_ids || []), ...(m.team2_ids || [])];
  if (ids.includes(tvState.playerId)) return true;
  // Check team_roster: the player may be a member of a composite team
  const roster = tvState.teamRoster;
  if (roster) {
    for (const tid of ids) {
      if (roster[tid] && roster[tid].includes(tvState.playerId)) return true;
    }
  }
  return false;
}

/** Authenticate using passphrase or token */
async function _playerAuth(passphrase, token) {
  const body = {};
  if (passphrase) body.passphrase = passphrase;
  if (token) body.token = token;
  const res = await fetch(`${API}/api/tournaments/${TID}/player-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Authentication failed');
  }
  const data = await res.json();
  tvState.playerJwt = data.access_token;
  tvState.playerId = data.player_id;
  tvState.playerName = data.player_name;
  _savePlayerSession();
  return data;
}

/** Authenticated fetch for player score submission */
async function _playerApi(path, opts = {}) {
  if (!tvState.playerJwt) throw new Error('Not authenticated');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  headers['Authorization'] = `Bearer ${tvState.playerJwt}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    _clearPlayerSession();
    _renderPlayerBar();
    throw new Error(t('txt_txt_player_session_expired'));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Handle QR auto-login via player_token URL parameter */
async function _handleTokenAutoLogin() {
  const playerToken = _params.get('player_token');
  if (!playerToken || !TID) return;
  // Remove token from URL to prevent re-login on refresh
  const url = new URL(location.href);
  url.searchParams.delete('player_token');
  history.replaceState(null, '', url.toString());
  try {
    await _playerAuth(null, playerToken);
  } catch (e) {
    console.warn('Auto-login failed:', e.message);
  }
}

/** Show the player login modal */
function _showPlayerLoginModal() {
  const existing = document.getElementById('player-login-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'player-login-overlay';
  overlay.className = 'player-login-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="player-login-modal">
      <button class="player-login-modal-close" onclick="document.getElementById('player-login-overlay').remove()" title="Close">✕</button>
      <h3>🔑 ${t('txt_txt_player_login')}</h3>
      <div class="login-error" id="player-login-error"></div>
      <input type="text" id="player-passphrase-input" placeholder="${t('txt_txt_enter_passphrase')}" autocomplete="off" spellcheck="false">
      <p class="login-passphrase-hint">${t('txt_txt_passphrase_hint')}</p>
      <div style="display:flex;justify-content:center;margin-top:0.4rem">
        <button class="btn btn-primary" onclick="_doPlayerLogin()">${t('txt_txt_login')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById('player-passphrase-input');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doPlayerLogin(); });
}

/** Execute login from modal */
async function _doPlayerLogin() {
  const input = document.getElementById('player-passphrase-input');
  const errEl = document.getElementById('player-login-error');
  const passphrase = (input?.value || '').trim();
  if (!passphrase) { errEl.textContent = t('txt_txt_enter_passphrase'); return; }
  errEl.textContent = '';
  try {
    await _playerAuth(passphrase, null);
    document.getElementById('player-login-overlay')?.remove();
    loadTV(); // re-render with score inputs
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/** Logout player */
function _playerLogout() {
  _clearPlayerSession();
  loadTV(); // re-render without score inputs
}

/** Copy contact info to clipboard with brief visual feedback */
function _copyContact(el) {
  const text = el.dataset.contact;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('player-opponents-contact--copied');
    el.dataset.orig = el.textContent;
    el.textContent = '✓ Copied';
    setTimeout(() => {
      el.textContent = el.dataset.orig;
      el.classList.remove('player-opponents-contact--copied');
    }, 1500);
  }).catch(() => {});
}

/** Build the opponents HTML string from current tvState */
function _buildPlayerOpponentsHtml() {
  const opponents = tvState.playerOpponents || [];
  if (opponents.length === 0) {
    return tvState.playerOpponentsLoaded
      ? `<div class="player-opponents-empty">${t('txt_txt_no_upcoming_opponents')}</div>`
      : '';
  }
  const byRound = {};
  for (const o of opponents) {
    const key = o.round_number > 0 ? String(o.round_number) : '';
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(o);
  }
  let html = `<div class="player-opponents-body">`;
  for (const [round, list] of Object.entries(byRound)) {
    if (round) html += `<div class="player-opponents-round">${t('txt_txt_round')} ${esc(round)}</div>`;
    for (const o of list) {
      const contactHtml = o.contact
        ? `<span class="player-opponents-contact" data-contact="${esc(o.contact)}" onclick="_copyContact(this)" title="Click to copy">${esc(o.contact)}</span>`
        : '';
      html += `<div class="player-opponents-row"><span class="player-opponents-name">${esc(o.name)}</span>${contactHtml}</div>`;
    }
  }
  html += `</div>`;
  return html;
}

/** Build the expand panel DOM element using current tvState */
function _buildPlayerPanel() {
  const panel = document.createElement('div');
  panel.id = 'player-expand-panel';
  panel.className = 'player-expand-panel';
  panel.innerHTML = `
    <button class="player-expand-close" onclick="_closePlayerPanel()" title="Close">✕</button>
    <div class="player-expand-inner">
      <span class="player-expand-title">${t('txt_txt_upcoming_opponents')}</span>
      ${_buildPlayerOpponentsHtml()}
    </div>
    <div class="player-expand-footer">
      <button class="player-dropdown-logout-btn" onclick="_playerLogout()">${t('txt_txt_logout')}</button>
    </div>`;
  return panel;
}

/** Close the expand panel */
function _closePlayerPanel() {
  document.getElementById('player-expand-panel')?.remove();
  tvState.playerPanelOpen = false;
  const tr = document.getElementById('player-session-trigger');
  if (tr) {
    tr.classList.remove('player-session-trigger--open');
    const chevron = tr.querySelector('.player-session-chevron');
    if (chevron) chevron.textContent = '▾';
  }
}

/** Toggle the expand panel open/closed — called from inline onclick */
function _togglePlayerPanel() {
  const existing = document.getElementById('player-expand-panel');
  if (existing) {
    _closePlayerPanel();
  } else {
    const header = document.getElementById('tv-header-main');
    if (!header) return;
    header.appendChild(_buildPlayerPanel());
    tvState.playerPanelOpen = true;
    const tr = document.getElementById('player-session-trigger');
    if (tr) {
      tr.classList.add('player-session-trigger--open');
      const chevron = tr.querySelector('.player-session-chevron');
      if (chevron) chevron.textContent = '▴';
    }
  }
}

/** Render the player bar at the top (or the floating login button) */
function _renderPlayerBar() {
  // Remove existing
  document.getElementById('player-bar')?.remove();
  document.getElementById('player-login-fab')?.remove();
  document.getElementById('player-name-btn')?.remove();
  document.getElementById('player-session-widget')?.remove();
  // Capture panel open state before removing it
  if (document.getElementById('player-expand-panel')) tvState.playerPanelOpen = true;
  document.getElementById('player-expand-panel')?.remove();
  document.getElementById('player-dropdown')?.remove();

  if (!TID) return;

  // When player scoring is disabled by the admin, hide everything and clear any session
  if (!tvState.allowPlayerScoring) {
    if (_isPlayerLoggedIn()) _clearPlayerSession();
    return;
  }

  if (_isPlayerLoggedIn()) {
    const slot = document.getElementById('player-login-slot');
    if (!slot) return;
    slot.innerHTML = '';

    // Single compact pill button — inline onclick calls global _togglePlayerPanel()
    const widget = document.createElement('div');
    widget.id = 'player-session-widget';
    widget.className = 'player-session-widget';

    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'player-session-trigger';
    triggerBtn.className = 'player-session-trigger';
    triggerBtn.setAttribute('onclick', '_togglePlayerPanel()');
    triggerBtn.innerHTML = `🔑 <span class="player-name">${esc(tvState.playerName || tvState.playerId)}</span> <span class="player-session-chevron">▾</span>`;

    widget.appendChild(triggerBtn);
    slot.appendChild(widget);

    // Restore open state after re-render
    if (tvState.playerPanelOpen) {
      const header = document.getElementById('tv-header-main');
      if (header) {
        header.appendChild(_buildPlayerPanel());
        triggerBtn.classList.add('player-session-trigger--open');
        triggerBtn.querySelector('.player-session-chevron').textContent = '▴';
      }
    }
  } else {
    const slot = document.getElementById('player-login-slot');
    if (slot) {
      slot.innerHTML = '';
      const btn = document.createElement('button');
      btn.id = 'player-login-fab';
      btn.className = 'player-login-btn';
      btn.title = t('txt_txt_player_login');
      btn.innerHTML = '🔑 ' + t('txt_txt_player_login');
      btn.onclick = _showPlayerLoginModal;
      slot.appendChild(btn);
    }
  }
}

/** Fetch upcoming opponents + their contacts for the logged-in player */
async function _fetchPlayerOpponents() {
  if (!TID || !_isPlayerLoggedIn()) return;
  try {
    const data = await _playerApi(`/api/tournaments/${TID}/player/opponents`);
    tvState.playerOpponents = (data && data.opponents) ? data.opponents : [];
  } catch (_) {
    tvState.playerOpponents = [];
  }
  tvState.playerOpponentsLoaded = true;
  // Update the panel in-place if it's currently open, otherwise just update state
  const panel = document.getElementById('player-expand-panel');
  if (panel) {
    const inner = panel.querySelector('.player-expand-inner');
    if (inner) {
      inner.innerHTML = `<span class="player-expand-title">${t('txt_txt_upcoming_opponents')}</span>${_buildPlayerOpponentsHtml()}`;
    }
  }
}

// ── Player score submission ────────────────────────────────

/** Map scoring context to API path suffix — mirrors admin _SCORE_ENDPOINTS. */
const _PLAYER_SCORE_ENDPOINTS = {
  'gp-group':   { points: 'gp/record-group',    tennis: 'gp/record-group-tennis' },
  'gp-playoff': { points: 'gp/record-playoff',  tennis: 'gp/record-playoff-tennis' },
  'mex':        { points: 'mex/record',          tennis: null },
  'mex-playoff':{ points: 'mex/record-playoff',  tennis: 'mex/record-playoff-tennis' },
  'po-playoff': { points: 'po/record',           tennis: 'po/record-tennis' },
};

/** Submit a score from the public player view */
async function _playerSubmitScore(matchId, scoreCtx) {
  const saveBtn = document.getElementById('ps-save-' + matchId);
  const errDiv = document.getElementById('ps-err-' + matchId);
  const _showErr = (msg) => { if (errDiv) errDiv.textContent = msg; };

  const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
  if (!entry) { _showErr('Unknown score context'); return; }

  // Detect whether the player has the sets view active
  const setsDiv = document.getElementById('ps-sets-' + matchId);
  const isTennis = setsDiv && !setsDiv.classList.contains('hidden');

  let body;
  if (isTennis && entry.tennis) {
    // Gather set scores
    const sets = [];
    for (let i = 0; i < 10; i++) {
      const e1 = document.getElementById('pts1-' + matchId + '-' + i);
      const e2 = document.getElementById('pts2-' + matchId + '-' + i);
      if (!e1 || !e2) break;
      const v1 = +e1.value || 0;
      const v2 = +e2.value || 0;
      if (v1 === 0 && v2 === 0) continue;
      sets.push([v1, v2]);
    }
    if (sets.length === 0) { _showErr(t('txt_txt_enter_at_least_one_set_score')); return; }
    body = JSON.stringify({ match_id: matchId, sets });
  } else {
    const s1 = +(document.getElementById('ps1-' + matchId)?.value) || 0;
    const s2 = +(document.getElementById('ps2-' + matchId)?.value) || 0;
    // 0–0 guard: require a second tap to confirm
    if (s1 === 0 && s2 === 0 && !saveBtn?.dataset.zeroWarned) {
      _showErr(t('txt_txt_zero_zero_confirm'));
      if (saveBtn) saveBtn.dataset.zeroWarned = '1';
      return;
    }
    body = JSON.stringify({ match_id: matchId, score1: s1, score2: s2 });
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
  if (errDiv) errDiv.textContent = '';
  const path = (isTennis && entry.tennis) ? entry.tennis : entry.points;
  try {
    await _playerApi(`/api/tournaments/${TID}/${path}`, { method: 'POST', body });
    if (saveBtn) saveBtn.textContent = t('txt_txt_score_saved');
    setTimeout(() => loadTV(), 800);
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_txt_save'); }
    _showErr(e.message);
    if (!_isPlayerLoggedIn()) setTimeout(() => loadTV(), 1500);
  }
}

/** Build inline score form HTML for a match the player can score */
function _buildPlayerScoreForm(m, scoreCtx) {
  if (!tvState.allowPlayerScoring) return '';
  if (!_isPlayerLoggedIn() || !_playerIsInMatch(m)) return '';
  const hasTbd = !m.team1?.join('').trim() || !m.team2?.join('').trim();
  if (hasTbd) return '';

  const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
  const hasTennis = !!(entry && entry.tennis);
  const defaultMode = (tvState.scoreMode[scoreCtx] === 'sets' && hasTennis) ? 'sets' : 'points';
  const isMex = scoreCtx === 'mex' || scoreCtx === 'mex-playoff';
  const autoCalc = tvState.totalPts > 0 && scoreCtx === 'mex';
  const onInput = autoCalc ? `oninput="_playerAutoFillScore('${m.id}', ${tvState.totalPts})"` : '';

  let html = '<div class="player-score-form">';

  // Points / Sets toggle (only when tennis scoring is available for this context)
  if (hasTennis) {
    html += `<div class="player-score-mode-toggle" data-match="${m.id}">`;
    html += `<button type="button" class="${defaultMode === 'points' ? 'active' : ''}" onclick="_setPlayerScoreMode('${m.id}','points')">${t('txt_txt_points_label')}</button>`;
    html += `<button type="button" class="${defaultMode === 'sets' ? 'active' : ''}" onclick="_setPlayerScoreMode('${m.id}','sets')">🎾 ${t('txt_txt_sets')}</button>`;
    html += `</div>`;
  }

  // Points inputs — compact single row: Alice [0] – [0] Bob [Save]
  html += `<div class="score-inline-row">`;
  html += `<div id="ps-points-${m.id}" class="score-teams-row${defaultMode === 'sets' ? ' hidden' : ''}">`;
  html += `<input type="number" id="ps1-${m.id}" min="0" value="" placeholder="0" ${onInput}>`;
  html += `<span class="score-dash">–</span>`;
  html += `<input type="number" id="ps2-${m.id}" min="0" value="" placeholder="${autoCalc ? tvState.totalPts : 0}" ${onInput}>`;
  html += `</div>`;

  // Sets inputs (hidden by default unless admin chose sets)
  if (hasTennis) {
    html += `<div id="ps-sets-${m.id}"${defaultMode === 'sets' ? '' : ' class="hidden"'}><div class="player-sets-grid">`;
    for (let i = 0; i < 3; i++) {
      html += `<div class="player-set-row">`;
      html += `<span class="player-set-label">S${i + 1}</span>`;
      html += `<input type="number" id="pts1-${m.id}-${i}" min="0" max="13" value="" placeholder="0">`;
      html += `<span style="color:var(--text-muted)">-</span>`;
      html += `<input type="number" id="pts2-${m.id}-${i}" min="0" max="13" value="" placeholder="0">`;
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  html += `<button id="ps-save-${m.id}" class="score-submit-btn" onclick="_playerSubmitScore('${m.id}','${scoreCtx}')">${t('txt_txt_save')}</button>`;
  html += `</div>`;
  html += `<div id="ps-err-${m.id}" class="score-error-msg"></div>`;
  html += `</div>`;
  return html;
}

/** Auto-fill the complementary score field for Mexicano matches in the player panel. */
function _playerAutoFillScore(matchId, total) {
  const s1El = document.getElementById('ps1-' + matchId);
  const s2El = document.getElementById('ps2-' + matchId);
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

/** Toggle between points and sets input for a specific match */
function _setPlayerScoreMode(matchId, mode) {
  const pointsDiv = document.getElementById('ps-points-' + matchId);
  const setsDiv = document.getElementById('ps-sets-' + matchId);
  if (!pointsDiv || !setsDiv) return;
  if (mode === 'sets') {
    pointsDiv.classList.add('hidden');
    setsDiv.classList.remove('hidden');
  } else {
    pointsDiv.classList.remove('hidden');
    setsDiv.classList.add('hidden');
  }
  // Update toggle button states
  const toggle = pointsDiv.closest('.player-score-form')?.querySelector('.player-score-mode-toggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
    const idx = mode === 'sets' ? 1 : 0;
    toggle.children[idx]?.classList.add('active');
  }
}

// ── API ───────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}


// ── Open-state persistence ───────────────────────────────
function _sectionStateKey() { return TID ? `padel-tv-sections-${TID}` : null; }

function _captureOpenState() {
  document.querySelectorAll('details[data-tv-key]').forEach(el => {
    tvState.sectionOpenState[el.dataset.tvKey] = el.open;
  });
  // Persist to localStorage so preference survives page reload
  const key = _sectionStateKey();
  if (key && Object.keys(tvState.sectionOpenState).length > 0) {
    try { localStorage.setItem(key, JSON.stringify(tvState.sectionOpenState)); } catch (_) {}
  }
}

function _applyOpenState() {
  // On first render sectionOpenState is empty — load from localStorage
  if (Object.keys(tvState.sectionOpenState).length === 0) {
    const key = _sectionStateKey();
    if (key) {
      try {
        const saved = localStorage.getItem(key);
        if (saved) tvState.sectionOpenState = JSON.parse(saved);
      } catch (_) {}
    }
  }
  document.querySelectorAll('details[data-tv-key]').forEach(el => {
    const key = el.dataset.tvKey;
    if (key in tvState.sectionOpenState) el.open = tvState.sectionOpenState[key];
  });
}

// ── Refresh scheduling ────────────────────────────────────────────

function _stopAllSchedules() {
  if (tvState.countdownInterval) { clearInterval(tvState.countdownInterval); tvState.countdownInterval = null; }
  if (tvState.versionPollTimer) { clearInterval(tvState.versionPollTimer); tvState.versionPollTimer = null; }
  if (tvState.pickerPollTimer) { clearInterval(tvState.pickerPollTimer); tvState.pickerPollTimer = null; }
  _tvVersionFetching = false;
  _pickerFetching = false;
  _tvVersionEtag = null;
  _pickerVersionEtag = null;
}

function _updateCountdownEl(text) {
  const el = document.getElementById('tv-countdown');
  if (el) el.textContent = text;
}

function _startCountdown() {
  _stopAllSchedules();
  if (tvState.refreshIntervalSecs === 0) {
    // “Never” — no auto-refresh
    _updateCountdownEl(t('txt_txt_manual_only'));
    return;
  }
  if (tvState.refreshIntervalSecs === -1) {
    // “On update” — poll version endpoint every 2 s
    _updateCountdownEl('');
    tvState.versionPollTimer = setInterval(async () => {
      if (tvState.isRefreshing || !TID || _tvVersionFetching || document.hidden) return;
      _tvVersionFetching = true;
      try {
        const data = await fetch(`/api/tournaments/${TID}/version`, {
          headers: _tvVersionEtag ? { 'If-None-Match': _tvVersionEtag } : undefined,
        }).then((r) => {
          if (r.status === 304) return null;
          const etag = r.headers.get('etag');
          if (etag) _tvVersionEtag = etag;
          return r.json();
        });
        if (!data) return; // 304 — version unchanged
        if (tvState.lastKnownVersion !== null && data.version !== tvState.lastKnownVersion) {
          loadTV();
        }
        tvState.lastKnownVersion = data.version;
      } catch (_) { /* network blip — ignore */ }
      finally { _tvVersionFetching = false; }
    }, _TV_VERSION_POLL_INTERVAL_MS);
    return;
  }
  // Timer mode
  tvState.countdown = tvState.refreshIntervalSecs;
  _updateCountdownEl(`↻ ${tvState.countdown}s`);
  tvState.countdownInterval = setInterval(() => {
    tvState.countdown--;
    _updateCountdownEl(`↻ ${tvState.countdown}s`);
    if (tvState.countdown <= 0) {
      clearInterval(tvState.countdownInterval);
      tvState.countdownInterval = null;
      loadTV();
    }
  }, 1000);
}

// ── Load & render ─────────────────────────────────────────
async function loadTV() {
  if (tvState.isRefreshing) return;
  tvState.isRefreshing = true;
  if (tvState.countdownInterval) clearInterval(tvState.countdownInterval);

  const dot = document.getElementById('refresh-dot');
  if (dot) dot.classList.add('refreshing');

  try {
    if (!TID) {
      await _showPicker();
      return;
    }

    // Resolve tournament metadata — use /meta endpoint so private tournaments
    // are still accessible when reached by alias or direct ID.
    const meta = await api(`/api/tournaments/${TID}/meta`);
    if (!meta) {
      const root = document.getElementById('tv-root');
      let _notFoundCountdown = 5;
      const _notFoundMsg = () =>
        `<div class="tv-error"><p>${t('txt_txt_tournament_not_found_value', { value: esc(TID) })}</p>` +
        `<p>${t('txt_txt_redirecting_in_n', { n: _notFoundCountdown })}</p></div>`;
      root.innerHTML = _notFoundMsg();
      const _notFoundTimer = setInterval(() => {
        _notFoundCountdown--;
        if (_notFoundCountdown <= 0) {
          clearInterval(_notFoundTimer);
          location.href = '/tv';
        } else {
          root.innerHTML = _notFoundMsg();
        }
      }, 1000);
      return;
    }
    tvState.tournamentType = meta.type;
    tvState.tournamentName = meta.name;
    tvState.tournamentSport = meta.sport || 'padel';
    document.title = `${_tvLabel()} | ${meta.name}`;

    // Load TV settings and tournament data in parallel
    const [tvSettings, ...dataResults] = await Promise.all([
      api(`/api/tournaments/${TID}/tv-settings`),
      ...(
        tvState.tournamentType === 'group_playoff'
          ? [
              api(`/api/tournaments/${TID}/gp/status`),
              api(`/api/tournaments/${TID}/gp/groups`),
              api(`/api/tournaments/${TID}/gp/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
          : tvState.tournamentType === 'playoff'
          ? [
              api(`/api/tournaments/${TID}/po/status`),
              api(`/api/tournaments/${TID}/po/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
          : [
              api(`/api/tournaments/${TID}/mex/status`),
              api(`/api/tournaments/${TID}/mex/matches`),
              api(`/api/tournaments/${TID}/mex/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
      ),
    ]);

    tvState.refreshIntervalSecs = tvSettings.refresh_interval ?? 15;
    tvState.scoreMode = tvSettings.score_mode || {};
    tvState.allowPlayerScoring = tvSettings.allow_player_scoring !== false;
    // Seed tvState.lastKnownVersion so first poll doesn’t trigger an immediate reload
    if (tvState.refreshIntervalSecs === -1 && tvState.lastKnownVersion === null) {
      try {
        const vd = await fetch(`/api/tournaments/${TID}/version`).then(r => r.json());
        tvState.lastKnownVersion = vd.version;
      } catch (_) {}
    }
    if (tvState.tournamentType === 'group_playoff') {
      const [status, groups, playoffs] = dataResults;
      tvState.teamRoster = status.team_roster || null;
      _captureOpenState();
      _renderGP(tvSettings, status, groups, playoffs);
      _applyOpenState();
    } else if (tvState.tournamentType === 'playoff') {
      const [status, playoffs] = dataResults;
      _captureOpenState();
      _renderPO(tvSettings, status, playoffs);
      _applyOpenState();
    } else {
      const [status, matches, playoffs] = dataResults;
      tvState.breakdowns = matches.breakdowns || {};
      tvState.totalPts = status.total_points_per_match || 0;
      tvState.strengthWeight = status.strength_weight || 0;
      tvState.playerMap = {};
      for (const p of (status.players || [])) tvState.playerMap[p.id] = p.name;
      tvState.mexLeaderboard = status.leaderboard || [];
      tvState.mexTeamMode = status.team_mode || false;
      _captureOpenState();
      _renderMex(tvSettings, status, matches, playoffs);
      _applyOpenState();
    }
  } catch (e) {
    const root = document.getElementById('tv-root');
    if (root) root.innerHTML = `<div class="tv-error">${t('txt_txt_error_loading_data_value', { value: esc(e.message) })}</div>`;
  } finally {
    tvState.isRefreshing = false;
    const dot = document.getElementById('refresh-dot');
    if (dot) dot.classList.remove('refreshing');
    // Fetch opponent contacts for the logged-in player (fire-and-forget, won't block render)
    if (_isPlayerLoggedIn()) _fetchPlayerOpponents();
    _renderPlayerBar();
    _startCountdown();
  }
}

// ── GP tournament renderer ────────────────────────────────
function _renderGP(tvSettings, status, groups, playoffs) {
  const phase = status.phase || '';
  const isPlayoffs = phase === 'playoffs' || phase === 'finished';
  const champion = status.champion;

  // Court assignments: pending group OR playoff matches
  const pendingGroup = _sortTbdLast(
    Object.values(groups.matches || {}).flat().filter(m => m.status !== 'completed')
  );
  const pendingPlayoff = _sortTbdLast(
    (playoffs?.pending || []).filter(m => m.status !== 'completed')
  );
  const assignmentMatches = isPlayoffs ? pendingPlayoff : pendingGroup;
  const courtTitle = isPlayoffs ? t('txt_txt_court_assignments_play_offs') : t('txt_txt_court_assignments_group_stage');

  let html = _buildHeader(tvState.tournamentName, phase, champion);
  html += _buildBanner(tvSettings);

  if (champion) {
    html += `<div class="champion-banner">🏆 ${t('txt_txt_champion')}: ${esc(champion.join(' & '))}</div>`;
  }

  const hasCourts = status.assign_courts !== false;
  const _gpScoreCtx = isPlayoffs ? 'gp-playoff' : 'gp-group';
  html += _buildCourts(assignmentMatches, courtTitle, hasCourts && tvSettings.show_courts !== false, tvSettings.show_pending_matches === true, _gpScoreCtx);

  if (isPlayoffs) {
    // Play-offs phase: past playoff matches → bracket → group past
    if (tvSettings.show_past_matches) {
      const playoffPast = (playoffs?.matches || []).filter(m => m.status === 'completed');
      if (playoffPast.length > 0)
        html += _buildPastMatches(playoffPast, tvSettings, false, t('txt_txt_play_off_matches'), 'past-playoffs');
    }

  if (tvSettings.show_bracket) {
      const bs = tvSettings.schema_box_scale   || 1.0;
      const lw = tvSettings.schema_line_width  || 1.0;
      const as_ = tvSettings.schema_arrow_scale || 1.0;
      const tfs = tvSettings.schema_title_font_scale || 1.0;
      const imgUrl = `/api/tournaments/${TID}/gp/playoffs-schema?fmt=png&box_scale=${bs}&line_width=${lw}&arrow_scale=${as_}&title_font_scale=${tfs}&_t=${Date.now()}`;
      html += `<details class="tv-collapsible" data-tv-key="bracket" open>`;
      html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_play_off_bracket')}</h2></summary>`;
      html += `<div class="tv-section">`;
      html += `<img class="bracket-img" src="${imgUrl}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand" onerror="this.style.display='none'">`;
      html += `</div></details>`;
    }

    if (tvSettings.show_past_matches) {
      const groupPast = Object.values(groups.matches || {}).flat().filter(m => m.status === 'completed');
      if (groupPast.length > 0)
        html += _buildPastMatches(groupPast, tvSettings, false, t('txt_txt_group_stage_matches'), 'past-groups');
    }
  } else {
    // Group phase: standings → group past matches
    if (tvSettings.show_standings) {
      html += `<details class="tv-collapsible" data-tv-key="standings" open>`;
      html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_group_standings')}</h2> <button class="format-info-btn" onclick="showAbbrevPopup(event,'standings')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></summary>`;
      html += `<div class="tv-section">`;
      for (const [gName, rows] of Object.entries(groups.standings || {})) {
        const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
        html += `<div class="group-block"><h3>${t('txt_txt_group_name_value', { value: esc(gName) })}</h3>`;
        html += `<table class="standings-table" data-type="gp"><thead><tr>`;
        html += `<th class="col-hash">#</th><th class="col-player">${status.team_mode ? t('txt_txt_team') : t('txt_txt_player')}</th><th class="col-played">${t('txt_txt_p_abbrev')}</th><th class="col-w">${t('txt_txt_w_abbrev')}</th><th class="col-d">${t('txt_txt_d_abbrev')}</th><th class="col-l">${t('txt_txt_l_abbrev')}</th>`;
        if (hasSets) html += `<th class="col-sw">${t('txt_txt_sw_abbrev')}</th><th class="col-sl">${t('txt_txt_sl_abbrev')}</th><th class="col-sd">${t('txt_txt_sd_abbrev')}</th>`;
        html += `<th class="col-pf">${t('txt_txt_pf_abbrev')}</th><th class="col-pa">${t('txt_txt_pa_abbrev')}</th><th class="col-diff">${t('txt_txt_diff_abbrev')}</th>`;
        html += `</tr></thead><tbody>`;
        rows.forEach((r, i) => {
          const isMe = tvState.playerId && r.player_id === tvState.playerId;
          html += `<tr${isMe ? ' class="my-row"' : ''}><td class="rank-cell col-hash">${i + 1}</td><td class="player-cell col-player">${esc(r.player)}</td>`;
          html += `<td class="col-played">${r.played}</td><td class="col-w">${r.wins}</td><td class="col-d">${r.draws}</td><td class="col-l">${r.losses}</td>`;
          if (hasSets) html += `<td class="col-sw">${r.sets_won}</td><td class="col-sl">${r.sets_lost}</td><td class="col-sd">${r.sets_diff}</td>`;
          html += `<td class="col-pf">${r.points_for}</td><td class="col-pa">${r.points_against}</td>`;
          html += `<td class="col-diff">${r.point_diff}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      }
      html += `</div></details>`;
    }

    if (tvSettings.show_past_matches) {
      const groupPast = Object.values(groups.matches || {}).flat().filter(m => m.status === 'completed');
      if (groupPast.length > 0)
        html += _buildPastMatches(groupPast, tvSettings, false, t('txt_txt_group_stage_matches'), 'past-groups');
    }
  }

  document.getElementById('tv-root').innerHTML = html;
}

// ── Standalone Playoff renderer ──────────────────────────
function _renderPO(tvSettings, status, playoffs) {
  const phase = status.phase || '';
  const champion = status.champion;

  const pending = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));

  let html = _buildHeader(tvState.tournamentName, phase, champion);
  html += _buildBanner(tvSettings);

  if (champion) {
    html += `<div class="champion-banner">🏆 ${t('txt_txt_champion')}: ${esc(champion.join(' & '))}</div>`;
  }

  const hasCourts = status.assign_courts !== false;
  html += _buildCourts(pending, t('txt_txt_court_assignments_play_offs'), hasCourts && tvSettings.show_courts !== false, tvSettings.show_pending_matches === true, 'po-playoff');

  if (tvSettings.show_bracket) {
    const bs  = tvSettings.schema_box_scale        || 1.0;
    const lw  = tvSettings.schema_line_width       || 1.0;
    const as_ = tvSettings.schema_arrow_scale      || 1.0;
    const tfs = tvSettings.schema_title_font_scale || 1.0;
    const imgUrl = `/api/tournaments/${TID}/po/playoffs-schema?fmt=png&box_scale=${bs}&line_width=${lw}&arrow_scale=${as_}&title_font_scale=${tfs}&_t=${Date.now()}`;
    html += `<details class="tv-collapsible" data-tv-key="bracket" open>`;
    html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_play_off_bracket')}</h2></summary>`;
    html += `<div class="tv-section">`;
    html += `<img class="bracket-img" src="${imgUrl}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand" onerror="this.style.display='none'">`;
    html += `</div></details>`;
  }

  if (tvSettings.show_past_matches) {
    const past = (playoffs?.matches || []).filter(m => m.status === 'completed');
    if (past.length > 0)
      html += _buildPastMatches(past, tvSettings, false, t('txt_txt_play_off_matches'), 'past-playoffs');
  }

  document.getElementById('tv-root').innerHTML = html;
}

// ── Mex tournament renderer ───────────────────────────────
function _renderMex(tvSettings, status, matches, playoffs) {
  const phase = status.phase || '';
  const isPlayoffs = phase === 'playoffs' || phase === 'finished';
  const champion = status.champion;

  const pendingCurrent = _sortTbdLast((matches.current_matches || []).filter(m => m.status !== 'completed'));
  const pendingPlayoff = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));
  const assignmentMatches = isPlayoffs ? pendingPlayoff : pendingCurrent;
  const courtTitle = isPlayoffs ? t('txt_txt_court_assignments_mexicano_play_offs') : t('txt_txt_court_assignments_current_round');

  let html = _buildHeader(tvState.tournamentName, phase, champion);
  html += _buildBanner(tvSettings);

  if (champion) {
    html += `<div class="champion-banner">🏆 ${t('txt_txt_champion')}: ${esc(champion.join(' & '))}</div>`;
  }

  const hasCourts = status.assign_courts !== false;
  const _mexScoreCtx = isPlayoffs ? 'mex-playoff' : 'mex';
  html += _buildCourts(assignmentMatches, courtTitle, hasCourts && tvSettings.show_courts !== false, tvSettings.show_pending_matches === true, _mexScoreCtx);

  if (isPlayoffs) {
    // Play-offs phase: past playoff matches → bracket → leaderboard → mexicano rounds
    if (tvSettings.show_past_matches) {
      const playoffPast = (playoffs?.matches || []).filter(m => m.status === 'completed');
      if (playoffPast.length > 0)
        html += _buildPastMatches(playoffPast, tvSettings, false, t('txt_txt_play_off_matches'), 'past-playoffs');
    }

    if (tvSettings.show_bracket) {
      const bs = tvSettings.schema_box_scale   || 1.0;
      const lw = tvSettings.schema_line_width  || 1.0;
      const as_ = tvSettings.schema_arrow_scale || 1.0;
      const tfs = tvSettings.schema_title_font_scale || 1.0;
      const imgUrl = `/api/tournaments/${TID}/mex/playoffs-schema?fmt=png&box_scale=${bs}&line_width=${lw}&arrow_scale=${as_}&title_font_scale=${tfs}&_t=${Date.now()}`;
      html += `<details class="tv-collapsible" data-tv-key="bracket" open>`;
      html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_play_off_bracket')}</h2></summary>`;
      html += `<div class="tv-section">`;
      html += `<img class="bracket-img" src="${imgUrl}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand" onerror="this.style.display='none'">`;
      html += `</div></details>`;
    }

    if (tvSettings.show_standings) {
      html += _buildMexLeaderboard(status);
    }

    if (tvSettings.show_past_matches) {
      const mexPast = (matches.all_matches || []).filter(m => m.status === 'completed');
      if (mexPast.length > 0)
        html += _buildPastMatches(mexPast, tvSettings, true, t('txt_txt_mexicano_rounds'), 'past-mexicano');
    }
  } else {
    // Mexicano phase: leaderboard → mexicano rounds
    if (tvSettings.show_standings) {
      html += _buildMexLeaderboard(status);
    }

    if (tvSettings.show_past_matches) {
      const mexPast = (matches.all_matches || []).filter(m => m.status === 'completed');
      if (mexPast.length > 0)
        html += _buildPastMatches(mexPast, tvSettings, true, t('txt_txt_mexicano_rounds'), 'past-mexicano');
    }
  }

  document.getElementById('tv-root').innerHTML = html;
  _tvRenderMexLeaderboard();
}

function _tvMexSetSort(col) {
  if (tvState.mexSortCol === col) {
    tvState.mexSortDir = tvState.mexSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    tvState.mexSortCol = col;
    tvState.mexSortDir = (col === 'player' || col === 'rank') ? 'asc' : 'desc';
  }
  _tvRenderMexLeaderboard();
}

function _tvRenderMexLeaderboard() {
  const container = document.getElementById('tv-mex-leaderboard-inner');
  if (!container) return;
  const lb = tvState.mexLeaderboard;
  const byAvg = lb.length > 0 && lb[0].ranked_by_avg;

  const rows = [...lb];
  if (tvState.mexSortCol !== null) {
    rows.sort((a, b) => {
      let va = a[tvState.mexSortCol];
      let vb = b[tvState.mexSortCol];
      if (typeof va === 'string' || typeof vb === 'string') {
        const cmp = (va || '').localeCompare(vb || '');
        return tvState.mexSortDir === 'asc' ? cmp : -cmp;
      }
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      return tvState.mexSortDir === 'desc' ? vb - va : va - vb;
    });
  }

  const indicator = (col) => {
    if (tvState.mexSortCol !== col) return '';
    return tvState.mexSortDir === 'desc' ? ' ↓' : ' ↑';
  };
  const thHtml = (col, label) => {
    const isDefaultRankCol = tvState.mexSortCol === null && ((col === 'total_points' && !byAvg) || (col === 'avg_points' && byAvg));
    const isActive = tvState.mexSortCol === col;
    const inner = isDefaultRankCol
      ? `<strong>${label} ↓</strong>`
      : isActive
        ? `<strong>${label}${indicator(col)}</strong>`
        : label;
    return `<th class="tv-sortable-col${isActive ? ' tv-sort-active' : ''}" onclick="_tvMexSetSort('${col}')">${inner}</th>`;
  };

  let html = `<table class="standings-table" data-type="mex"><thead><tr>`;
  html += thHtml('rank', '#');
  html += thHtml('player', tvState.mexTeamMode ? t('txt_txt_team') : t('txt_txt_player'));
  html += thHtml('total_points', t('txt_txt_total_pts_abbrev'));
  html += thHtml('matches_played', t('txt_txt_played_abbrev'));
  html += thHtml('wins', t('txt_txt_w_abbrev'));
  html += thHtml('draws', t('txt_txt_d_abbrev'));
  html += thHtml('losses', t('txt_txt_l_abbrev'));
  html += thHtml('avg_points', t('txt_txt_avg_pts_abbrev'));
  html += `</tr></thead><tbody>`;

  for (const r of rows) {
    const isMe = tvState.playerId && r.player_id === tvState.playerId;
    const removedStyle = r.removed ? 'opacity:0.45' : '';
    const rankCell = r.removed ? `<span style="color:var(--text-muted)">—</span>` : r.rank;
    const nameCell = r.removed
      ? `${esc(r.player)} <span style="font-size:0.7em;opacity:0.7">(${t('txt_txt_removed')})</span>`
      : esc(r.player);
    html += `<tr${isMe ? ' class="my-row"' : ''}${removedStyle ? ` style="${removedStyle}"` : ''}><td class="rank-cell">${rankCell}</td><td class="player-cell">${nameCell}</td>`;
    const totalCell = byAvg ? r.total_points : `<strong>${r.total_points}</strong>`;
    const avgCell   = byAvg ? `<strong>${r.avg_points.toFixed(2)}</strong>` : r.avg_points.toFixed(2);
    html += `<td class="${byAvg ? '' : 'pts-cell'}">${totalCell}</td>`;
    html += `<td>${r.matches_played}</td><td>${r.wins ?? 0}</td><td>${r.draws ?? 0}</td><td>${r.losses ?? 0}</td>`;
    html += `<td class="${byAvg ? 'pts-cell' : ''}">${avgCell}</td></tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ── Shared builders ───────────────────────────────────────

// ── Abbreviation legend popup ──────────────────────────────

function _buildAbbrevLegend(type) {
  const rows = type === 'standings' ? [
    [t('txt_txt_p_abbrev'),    t('txt_txt_abbrev_mp_full')],
    [t('txt_txt_w_abbrev'),    t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),    t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),    t('txt_txt_abbrev_l_full')],
    [t('txt_txt_sw_abbrev'),   t('txt_txt_abbrev_sw_full')],
    [t('txt_txt_sl_abbrev'),   t('txt_txt_abbrev_sl_full')],
    [t('txt_txt_sd_abbrev'),   t('txt_txt_abbrev_sd_full')],
    [t('txt_txt_pf_abbrev'),   t('txt_txt_abbrev_pf_full')],
    [t('txt_txt_pa_abbrev'),   t('txt_txt_abbrev_pa_full')],
    [t('txt_txt_diff_abbrev'), t('txt_txt_abbrev_diff_full')],
  ] : [
    [t('txt_txt_total_pts_abbrev'), t('txt_txt_abbrev_total_pts_full')],
    [t('txt_txt_played_abbrev'),    t('txt_txt_abbrev_played_full')],
    [t('txt_txt_w_abbrev'),         t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),         t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),         t('txt_txt_abbrev_l_full')],
    [t('txt_txt_avg_pts_abbrev'),   t('txt_txt_abbrev_avg_pts_full')],
  ];
  return `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
}

function showAbbrevPopup(event, type) {
  event.stopPropagation();
  const popup = document.getElementById('abbrev-popup');
  const btn = event.currentTarget;
  if (popup.style.display === 'block' && tvState.abbrevPopupBtn === btn) {
    popup.style.display = 'none';
    tvState.abbrevPopupBtn = null;
    return;
  }
  tvState.abbrevPopupBtn = btn;
  popup.innerHTML = _buildAbbrevLegend(type);
  popup.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  const pw = popup.offsetWidth || 210;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
  popup.style.left = left + 'px';
  popup.style.top = (rect.bottom + 6) + 'px';
}

document.addEventListener('click', () => {
  const p = document.getElementById('abbrev-popup');
  if (p) { p.style.display = 'none'; tvState.abbrevPopupBtn = null; }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const p = document.getElementById('abbrev-popup');
    if (p) { p.style.display = 'none'; tvState.abbrevPopupBtn = null; }
  }
});

function _buildMexLeaderboard(_status) {
  let html = `<details class="tv-collapsible" data-tv-key="standings" open>`;
  html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_leaderboard')}</h2> <button class="format-info-btn" onclick="showAbbrevPopup(event,'leaderboard')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></summary>`;
  html += `<div class="tv-section"><div id="tv-mex-leaderboard-inner"></div></div></details>`;
  return html;
}

function _buildHeader(name, phase, champion) {
  const phaseLabel = _phaseLabel(phase);
  const langToggle = _languageToggleMeta();
  return `
    <div class="tv-header" id="tv-header-main">
      <div class="tv-header-title-row">
        <div class="tv-lang-cell"><button type="button" id="lang-toggle-btn" class="theme-btn" onclick="_toggleLanguage()" title="${langToggle.label}" aria-label="${langToggle.label}">${langToggle.icon}</button></div>
        ${buildPageSelectorHtml('tv')}
        <div class="tv-toggle-btns">
          <button type="button" id="theme-toggle-btn" data-theme-toggle-icon="1" class="theme-btn" onclick="_toggleTheme()" title="${t('txt_txt_toggle_light_dark_mode')}">${_theme === 'dark' ? '🌙' : '☀️'}</button>
        </div>
      </div>
      <div class="tv-title-center">
        <h1 class="tv-tournament-name">${esc(name)}</h1>
      </div>
      <div style="display:flex;justify-content:center;gap:0.5rem;flex-wrap:wrap;margin-top:0.15rem">
        ${phaseLabel && phase !== 'finished' ? `<span class="tv-badge tv-badge-phase">${esc(phaseLabel)}</span>` : ''}
        ${champion || phase === 'finished' ? `<span class="tv-badge tv-badge-champion">🏆 ${t('txt_txt_finished')}</span>` : ''}
      </div>
      <div class="tv-header-row">
        <div class="tv-title">
          <button type="button" onclick="_backToTournaments()" style="background:var(--border);border:none;color:var(--text-muted);border-radius:999px;padding:0.3rem 0.8rem;cursor:pointer;font-size:0.78rem;font-weight:500;line-height:1;white-space:nowrap" title="${t('txt_txt_back_to_tournaments')}">← ${t('txt_txt_tournaments')}</button>
        </div>
        <div class="tv-meta">
          <div id="player-login-slot"></div>
          <div class="refresh-indicator">
            <div class="refresh-dot" id="refresh-dot"></div>
            <span id="tv-countdown">↻ ${tvState.refreshIntervalSecs}s</span>
            <button type="button" onclick="loadTV()" style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:4px;padding:0.15rem 0.45rem;cursor:pointer;font-size:0.8rem;line-height:1" title="${t('txt_txt_refresh_now')}">↻</button>
          </div>
        </div>
      </div>
    </div>`;
}

function _buildBanner(tvSettings) {
  const text = (tvSettings && tvSettings.banner_text) ? tvSettings.banner_text.trim() : '';
  if (!text) return '';
  return `<div class="admin-banner">📢 ${esc(text)}</div>`;
}

function _buildCourts(matches, title, assignCourts = true, showPending = false, scoreCtx = null) {
  const _commentHtml = (m) => m.comment ? `<div class="match-comment">${esc(m.comment)}</div>` : '';
  if (!assignCourts && !showPending) return '';
  if (!assignCourts) {
    // Courts disabled — group by round, defined players first, multi-column grid
    let html = `<div class="tv-section">`;
    html += `<div class="tv-section-header"><h2>${t('txt_txt_pending_matches')}</h2></div>`;
    if (!matches || matches.length === 0) {
      html += `<p class="tv-empty">${t('txt_txt_no_pending_court_assignments')}</p>`;
      html += `</div>`;
      return html;
    }
    const _tl = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
    const _hasTbd = (m) => !m.team1?.join('').trim() || !m.team2?.join('').trim();
    // Group by round_label, preserving first-seen order
    const _byRound = {};
    const _roundOrder = [];
    for (const m of matches) {
      const key = m.round_label || '';
      if (!_byRound[key]) { _byRound[key] = []; _roundOrder.push(key); }
      _byRound[key].push(m);
    }
    // Within each round: defined-player matches first, TBD last
    for (const key of _roundOrder) {
      _byRound[key].sort((a, b) => _hasTbd(a) - _hasTbd(b));
    }
    html += `<div class="court-board">`;
    for (const key of _roundOrder) {
      html += `<div class="court-card">`;
      if (key) html += `<div class="court-name">${esc(key)}</div>`;
      for (const m of _byRound[key]) {
        const tbd = _hasTbd(m);
        html += `<div class="court-match"${tbd ? ' style="opacity:0.5"' : ''}>`;
        html += `<div class="court-match-info"><div class="court-match-teams">${esc(_tl(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl(m.team2))}</div>`;
        html += _commentHtml(m);
        html += `</div>`;
        if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  let html = `<div class="tv-section">`;
  html += `<div class="tv-section-header"><h2>${esc(title)}</h2></div>`;
  if (!matches || matches.length === 0) {
    html += `<p class="tv-empty">${t('txt_txt_no_pending_court_assignments')}</p>`;
    html += `</div>`;
    return html;
  }

  // For each court show only the current (lowest slot_number) pending match.
  const currentByCourt = {};
  for (const m of matches) {
    if (!m.court) continue;
    const s = m.slot_number ?? 0;
    if (!(m.court in currentByCourt) || s < currentByCourt[m.court].slot_number) {
      currentByCourt[m.court] = m;
    }
  }

  const courtNames = Object.keys(currentByCourt).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (courtNames.length === 0) {
    html += `<p class="tv-empty">${t('txt_txt_no_pending_court_assignments')}</p>`;
    html += `</div>`;
    return html;
  }

  const _teamLabel = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';

  html += `<div class="court-board">`;
  for (const courtName of courtNames) {
    const m = currentByCourt[courtName];
    const t1 = _teamLabel(m.team1);
    const t2 = _teamLabel(m.team2);
    html += `<div class="court-card">`;
    html += `<div class="court-name">${esc(courtName)}</div>`;
    html += `<div class="court-match">`;
    html += `<div class="court-match-info"><div class="court-match-teams">${esc(t1)}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(t2)}</div>`;
    if (m.round_label) html += `<div class="court-match-meta">${esc(m.round_label)}</div>`;
    html += _commentHtml(m);
    html += `</div>`;
    if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
    html += `</div>`;
    html += `</div>`;
  }
  html += `</div></div>`;

  if (!showPending) return html;

  // Also show pending matches view below court board
  const _tl2 = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
  const _hasTbd2 = (m) => !m.team1?.join('').trim() || !m.team2?.join('').trim();
  const byRound2 = {};
  const roundOrder2 = [];
  for (const m of matches) {
    const key = m.round_label || '';
    if (!byRound2[key]) { byRound2[key] = []; roundOrder2.push(key); }
    byRound2[key].push(m);
  }
  for (const key of roundOrder2) {
    byRound2[key].sort((a, b) => _hasTbd2(a) - _hasTbd2(b));
  }
  html += `<div class="tv-section">`;
  html += `<div class="tv-section-header"><h2>${t('txt_txt_pending_matches')}</h2></div>`;
  html += `<div class="court-board">`;
  for (const key of roundOrder2) {
    html += `<div class="court-card">`;
    if (key) html += `<div class="court-name">${esc(key)}</div>`;
    for (const m of byRound2[key]) {
      const tbd = _hasTbd2(m);
      html += `<div class="court-match"${tbd ? ' style="opacity:0.5"' : ''}>`;
      html += `<div class="court-match-info"><div class="court-match-teams">${esc(_tl2(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl2(m.team2))}</div>`;
      html += _commentHtml(m);
      html += `</div>`;
      if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}

function _buildPastMatches(matches, tvSettings, isMex, sectionTitle = t('txt_txt_past_matches'), tvKey = 'past-matches') {
  if (!matches || matches.length === 0) return '';

  // Group by round_label first (more descriptive), fall back to round_number
  const byRound = {};
  const roundOrder = [];
  for (const m of matches) {
    const key = m.round_label || `Round ${m.round_number ?? 0}`;
    if (!byRound[key]) { byRound[key] = []; roundOrder.push(key); }
    byRound[key].push(m);
  }
  // Reverse so most recent is first; dedupe while preserving order
  const orderedKeys = [...new Set(roundOrder)].reverse();

  let html = `<details class="tv-collapsible" data-tv-key="${tvKey}" open>`;
  html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${esc(sectionTitle)}</h2></summary>`;
  html += `<div class="tv-section">`;

  for (let ri = 0; ri < orderedKeys.length; ri++) {
    const key = orderedKeys[ri];
    const rMatches = byRound[key];
    const openAttr = ri === 0 ? ' open' : ''; // most recent open by default

    html += `<details class="round-block" data-tv-key="${tvKey}-${esc(key)}"${openAttr}>`;
    html += `<summary class="round-summary">▶ ${esc(key)} — ${rMatches.length} ${rMatches.length > 1 ? t('txt_txt_matches') : t('txt_txt_match')}</summary>`;
    html += `<div class="round-body">`;
    for (const m of rMatches) {
      html += _buildHistoryMatch(m, tvSettings, isMex);
    }
    html += `</div></details>`;
  }

  html += `</div></details>`;
  return html;
}

function _buildHistoryMatch(m, tvSettings, isMex) {
  const t1 = (m.team1 || []).join(' & ') || 'TBD';
  const t2 = (m.team2 || []).join(' & ') || 'TBD';
  const court = m.court ? `<span class="history-court">${esc(m.court)}</span>` : '';

  let scoreHtml;
  if (m.score) {
    if (m.sets && m.sets.length > 0) {
      scoreHtml = `<span class="history-score sets-stack">`;
      scoreHtml += m.sets.map(s => `<span>${s[0]}-${s[1]}</span>`).join('');
      scoreHtml += `</span>`;
    } else {
      scoreHtml = `<span class="history-score">${m.score[0]} – ${m.score[1]}</span>`;
    }
  } else {
    scoreHtml = `<span class="history-score" style="color:var(--text-muted)">—</span>`;
  }

  let html = `<div class="history-match">`;
  html += `<div class="history-teams">${esc(t1)}<span class="history-vs">${t('txt_txt_vs')}</span>${esc(t2)}</div>`;
  html += scoreHtml;
  html += court;
  html += `</div>`;

  // Score breakdown for Mexicano matches
  if (isMex && tvSettings.show_score_breakdown) {
    const bd = tvState.breakdowns[m.id];
    if (bd && Object.keys(bd).length > 0) {
      html += `<details style="margin-top:-0.3rem;margin-bottom:0.4rem">`;
      html += `<summary class="breakdown-toggle">📊 ${t('txt_txt_score_breakdown')}</summary>`;
      html += `<div class="breakdown-panel">`;
      html += `<table class="breakdown-table"><thead><tr>`;
      html += `<th>${t('txt_txt_player')}</th><th>${t('txt_txt_raw')}</th><th>${t('txt_txt_relative_strength')}</th><th>${t('txt_txt_strength_weight')}</th><th>${t('txt_txt_strength_multiplier')}</th><th>${t('txt_txt_loss_disc_multiplier')}</th><th>${t('txt_txt_win_bonus_header')}</th><th>${t('txt_txt_final')}</th>`;
      html += `</tr></thead><tbody>`;
      for (const [pid, d] of Object.entries(bd)) {
        const rs = d.relative_strength || 0;
        html += `<tr><td>${esc(tvState.playerMap[pid] || pid)}</td><td>${d.raw}</td>`;
        html += `<td>${rs > 0 ? rs.toFixed(3) : '—'}</td>`;
        html += `<td>${tvState.strengthWeight > 0 ? '×' + tvState.strengthWeight : '—'}</td>`;
        html += `<td>${d.strength_mult !== 1 ? '×' + d.strength_mult.toFixed(2) : '—'}</td>`;
        html += `<td>${d.loss_disc !== 1 ? '×' + d.loss_disc.toFixed(2) : '—'}</td>`;
        html += `<td>${d.win_bonus > 0 ? '+' + d.win_bonus : '—'}</td>`;
        html += `<td><strong>${d.final}</strong></td></tr>`;
      }
      html += `</tbody></table></div></details>`;
    }
  }

  return html;
}

// ── Helpers ───────────────────────────────────────────────
function _phaseLabel(phase) {
  const map = {
    setup: t('txt_txt_setup'), groups: t('txt_txt_group_stage'), playoffs: t('txt_txt_play_offs'),
    finished: t('txt_txt_finished'), mexicano: t('txt_txt_mexicano'),
  };
  return map[phase] || phase;
}

// ── Bootstrap ─────────────────────────────────────────────

async function _resolveAlias() {
  if (_aliasParam && !TID) {
    try {
      const data = await api(`/api/tournaments/resolve-alias/${encodeURIComponent(_aliasParam)}`);
      TID = data.id;
    } catch (_) {
      await _showPicker();
      const form = document.querySelector('.tv-picker-form');
      if (form) {
        const errDiv = document.createElement('div');
        errDiv.className = 'tv-error picker-inline-error';
        errDiv.style.marginTop = '0.75rem';
        errDiv.innerHTML = `${t('txt_txt_no_tournament_found_with_alias')} <strong>${esc(_aliasParam)}</strong>`;
        form.after(errDiv);
      }
      return false;
    }
  }
  return true;
}

function _renderPickerHtml(tournaments) {
  const langToggle = _languageToggleMeta();
  let html = `<div class="tv-picker">`;
  html += `<div class="tv-header-title-row" style="margin-bottom:1rem">`;
  html += `<div class="tv-lang-cell"><button type="button" class="theme-btn" onclick="_toggleLanguage()" title="${langToggle.label}" aria-label="${langToggle.label}">${langToggle.icon}</button></div>`;
  html += buildPageSelectorHtml('tv');
  html += `<div class="tv-toggle-btns">`;
  html += buildCompactRefreshButtonHtml('_showPicker()', t('txt_txt_refresh_now'));
  html += `<button type="button" data-theme-toggle-icon="1" class="theme-btn" onclick="_toggleTheme()" title="${t('txt_txt_toggle_light_dark_mode')}">${_theme === 'dark' ? '🌙' : '☀️'}</button>`;
  html += `</div>`;
  html += `</div>`;
  if (tournaments.length > 0) {
    html += `<div class="subtitle">${t('txt_txt_select_a_tournament_to_display')}</div>`;
    html += `<ul class="tv-picker-list">`;
    for (const tournament of tournaments) {
      const modeLabel = tournament.team_mode ? t('txt_txt_team_mode_short') : t('txt_txt_individual_mode');
      const phaseLabel = _phaseLabel(tournament.phase);
      const aliasTag = tournament.alias ? `<span class="picker-alias">${esc(tournament.alias)}</span>` : '';
      const isTennis = tournament.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const pickerSlug = tournament.alias || tournament.id;
      html += `<a class="tv-picker-item" href="/tv/${encodeURIComponent(pickerSlug)}">`;
      html += `${esc(tournament.name)}<span class="picker-badge picker-badge-sport">${esc(sportLabel)}</span>${!isTennis ? `<span class="picker-badge picker-badge-type">${esc(modeLabel)}</span>` : ''}<span class="picker-badge picker-badge-phase">${esc(phaseLabel)}</span>${aliasTag}`;
      html += `</a>`;
    }
    html += `</ul>`;
    html += `<div style="color:var(--text-muted);font-size:0.85rem;margin-top:1.5rem;margin-bottom:0.5rem">${t('txt_txt_or_enter_a_tournament_id_alias_directly')}</div>`;
  }
  html += `<form class="tv-picker-form" onsubmit="return _goToTournament(event)">`;
  html += `<input type="text" id="picker-input" placeholder="${t('txt_txt_tournament_id_or_alias')}">`;
  html += `<button type="submit">${t('txt_txt_go')}</button>`;
  html += `</form>`;
  html += `</div>`;

  document.getElementById('tv-root').innerHTML = html;
}

async function _showPicker() {
  let tournaments = [];
  try { tournaments = await api('/api/tournaments'); } catch (_) {}
  _renderPickerHtml(tournaments);

  // Poll /api/version (lightweight). Re-fetch + re-render only when
  // the version changes, so visibility/creation changes appear within ~3 s.
  if (tvState.pickerPollTimer) return; // already running — don't stack timers
  let _pickerVersion = null;
  try {
    const vd = await fetch('/api/version', {
      headers: _pickerVersionEtag ? { 'If-None-Match': _pickerVersionEtag } : undefined,
    }).then((r) => {
      if (r.status === 304) return null;
      const etag = r.headers.get('etag');
      if (etag) _pickerVersionEtag = etag;
      return r.json();
    });
    if (!vd) return;
    _pickerVersion = vd.version;
  } catch (_) {}

  tvState.pickerPollTimer = setInterval(async () => {
    if (_pickerFetching || document.hidden) return;
    _pickerFetching = true;
    try {
      const vd = await fetch('/api/version', {
        headers: _pickerVersionEtag ? { 'If-None-Match': _pickerVersionEtag } : undefined,
      }).then((r) => {
        if (r.status === 304) return null;
        const etag = r.headers.get('etag');
        if (etag) _pickerVersionEtag = etag;
        return r.json();
      });
      if (!vd) return; // 304 — version unchanged
      if (_pickerVersion !== null && vd.version !== _pickerVersion) {
        let list = [];
        try { list = await api('/api/tournaments'); } catch (_) {}
        _renderPickerHtml(list);
      }
      _pickerVersion = vd.version;
    } catch (_) { /* network blip — ignore */ }
    finally { _pickerFetching = false; }
  }, _TV_PICKER_POLL_INTERVAL_MS);
}

function _backToTournaments() {
  _stopAllSchedules();
  TID = null;
  history.replaceState(null, '', '/tv');
  _showPicker();
}

async function _goToTournament(e) {
  e.preventDefault();
  const val = document.getElementById('picker-input').value.trim();
  if (!val) return false;

  document.querySelector('.picker-inline-error')?.remove();

  try {
    if (/^t\d+$/.test(val)) {
      await api(`/api/tournaments/${encodeURIComponent(val)}/meta`);
    } else {
      await api(`/api/tournaments/resolve-alias/${encodeURIComponent(val)}`);
    }
    location.href = `/tv/${encodeURIComponent(val)}`;
  } catch (_) {
    const form = document.querySelector('.tv-picker-form');
    if (form) {
      const errDiv = document.createElement('div');
      errDiv.className = 'tv-error picker-inline-error';
      errDiv.style.marginTop = '0.75rem';
      errDiv.innerHTML = `${t('txt_txt_no_tournament_found_with_alias')} <strong>${esc(val)}</strong>`;
      form.after(errDiv);
    }
  }
  return false;
}

(async () => {
  if (!TID && !_aliasParam) {
    await _showPicker();
    return;
  }
  const resolved = await _resolveAlias();
  if (!resolved) return;
  _loadPlayerSession();
  await _handleTokenAutoLogin();
  loadTV();
})();
