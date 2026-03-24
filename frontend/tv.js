const API = '';

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
let _tournamentType = null;
let _tournamentName = '';
let _tournamentSport = 'padel';

function _tvLabel() {
  return _tournamentSport === 'tennis' ? t('txt_txt_tennis_tv') : t('txt_txt_padel_tv');
}
let _refreshIntervalSecs = 15;
let _countdown = 15;
let _refreshInterval = null;
let _countdownInterval = null;
let _isRefreshing = false;
let _breakdowns = {}; // {match_id: {...}} for Mex breakdowns
let _tvPlayerMap = {}; // {player_id: player_name}
let _sectionOpenState = {}; // {data-tv-key: boolean} — persisted across refreshes
let _lastKnownVersion = null; // for on-update mode
let _tvScoreMode = {}; // {ctx: 'points'|'sets'} from admin TV settings
let _versionPollTimer = null; // setInterval handle for version polling
let _pickerPollTimer = null;  // setInterval handle for picker auto-refresh

// ── Player auth state ─────────────────────────────────────
let _playerJwt = null;     // JWT string
let _playerId = null;      // player ID from auth response
let _playerName = null;    // player name from auth response
let _allowPlayerScoring = true; // controlled by admin TV setting

function _playerStorageKey() { return `padel-player-${TID}`; }

function _loadPlayerSession() {
  if (!TID) return;
  try {
    const raw = localStorage.getItem(_playerStorageKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    _playerJwt = data.jwt || null;
    _playerId = data.playerId || null;
    _playerName = data.playerName || null;
  } catch { _clearPlayerSession(); }
}

function _savePlayerSession() {
  if (!TID || !_playerJwt) return;
  localStorage.setItem(_playerStorageKey(), JSON.stringify({
    jwt: _playerJwt, playerId: _playerId, playerName: _playerName,
  }));
}

function _clearPlayerSession() {
  _playerJwt = null; _playerId = null; _playerName = null;
  if (TID) localStorage.removeItem(_playerStorageKey());
}

function _isPlayerLoggedIn() { return !!_playerJwt; }

/** Check whether a match involves the authenticated player */
function _playerIsInMatch(m) {
  if (!_playerId) return false;
  return (m.team1_ids || []).includes(_playerId) || (m.team2_ids || []).includes(_playerId);
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
  _playerJwt = data.access_token;
  _playerId = data.player_id;
  _playerName = data.player_name;
  _savePlayerSession();
  return data;
}

/** Authenticated fetch for player score submission */
async function _playerApi(path, opts = {}) {
  if (!_playerJwt) throw new Error('Not authenticated');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  headers['Authorization'] = `Bearer ${_playerJwt}`;
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
      <h3>🔑 ${t('txt_txt_player_login')}</h3>
      <div class="login-error" id="player-login-error"></div>
      <input type="text" id="player-passphrase-input" placeholder="${t('txt_txt_enter_passphrase')}" autocomplete="off" spellcheck="false">
      <div style="display:flex;gap:0.5rem;justify-content:center">
        <button class="btn btn-primary" onclick="_doPlayerLogin()">${t('txt_txt_login')}</button>
        <button class="btn btn-cancel" onclick="document.getElementById('player-login-overlay').remove()">✕</button>
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

/** Render the player bar at the top (or the floating login button) */
function _renderPlayerBar() {
  // Remove existing
  document.getElementById('player-bar')?.remove();
  document.getElementById('player-login-fab')?.remove();

  if (!TID) return;

  // When player scoring is disabled by the admin, hide everything and clear any session
  if (!_allowPlayerScoring) {
    if (_isPlayerLoggedIn()) _clearPlayerSession();
    return;
  }

  if (_isPlayerLoggedIn()) {
    const bar = document.createElement('div');
    bar.id = 'player-bar';
    bar.className = 'player-bar';
    bar.innerHTML = `<span>🟢 ${t('txt_txt_logged_in_as')} <span class="player-name">${esc(_playerName || _playerId)}</span></span>
      <button onclick="_playerLogout()">${t('txt_txt_logout')}</button>`;
    document.body.prepend(bar);
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
  const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
  if (!entry) { alert('Unknown score context'); return; }

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
    if (sets.length === 0) { alert(t('txt_txt_enter_at_least_one_set_score')); return; }
    body = JSON.stringify({ match_id: matchId, sets });
  } else {
    const s1 = +document.getElementById('ps1-' + matchId).value;
    const s2 = +document.getElementById('ps2-' + matchId).value;
    body = JSON.stringify({ match_id: matchId, score1: s1, score2: s2 });
  }

  const path = (isTennis && entry.tennis) ? entry.tennis : entry.points;
  try {
    await _playerApi(`/api/tournaments/${TID}/${path}`, { method: 'POST', body });
    loadTV();
  } catch (e) {
    alert(e.message);
  }
}

/** Build inline score form HTML for a match the player can score */
function _buildPlayerScoreForm(m, scoreCtx) {
  if (!_allowPlayerScoring) return '';
  if (!_isPlayerLoggedIn() || !_playerIsInMatch(m)) return '';
  const hasTbd = !m.team1?.join('').trim() || !m.team2?.join('').trim();
  if (hasTbd) return '';

  const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
  const hasTennis = !!(entry && entry.tennis);
  const defaultMode = (_tvScoreMode[scoreCtx] === 'sets' && hasTennis) ? 'sets' : 'points';

  let html = '<div class="player-score-form" style="flex-direction:column;align-items:center">';

  // Points / Sets toggle (only when tennis scoring is available for this context)
  if (hasTennis) {
    html += `<div class="player-score-mode-toggle" data-match="${m.id}">`;
    html += `<button type="button" class="${defaultMode === 'points' ? 'active' : ''}" onclick="_setPlayerScoreMode('${m.id}','points')">${t('txt_txt_points_label')}</button>`;
    html += `<button type="button" class="${defaultMode === 'sets' ? 'active' : ''}" onclick="_setPlayerScoreMode('${m.id}','sets')">🎾 ${t('txt_txt_sets')}</button>`;
    html += `</div>`;
  }

  // Points inputs
  html += `<div id="ps-points-${m.id}"${defaultMode === 'sets' ? ' class="hidden"' : ''} style="display:flex;align-items:center;gap:0.35rem">`;
  html += `<input type="number" id="ps1-${m.id}" min="0" value="0" placeholder="0">`;
  html += `<span style="color:var(--text-muted)">–</span>`;
  html += `<input type="number" id="ps2-${m.id}" min="0" value="0" placeholder="0">`;
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

  html += `<button class="score-submit-btn" onclick="_playerSubmitScore('${m.id}','${scoreCtx}')">${t('txt_txt_save')}</button>`;
  html += `</div>`;
  return html;
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
function _captureOpenState() {
  document.querySelectorAll('details[data-tv-key]').forEach(el => {
    _sectionOpenState[el.dataset.tvKey] = el.open;
  });
}

function _applyOpenState() {
  document.querySelectorAll('details[data-tv-key]').forEach(el => {
    const key = el.dataset.tvKey;
    if (key in _sectionOpenState) el.open = _sectionOpenState[key];
  });
}

// ── Refresh scheduling ────────────────────────────────────────────

function _stopAllSchedules() {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
  if (_versionPollTimer) { clearInterval(_versionPollTimer); _versionPollTimer = null; }
  if (_pickerPollTimer) { clearInterval(_pickerPollTimer); _pickerPollTimer = null; }
}

function _updateCountdownEl(text) {
  const el = document.getElementById('tv-countdown');
  if (el) el.textContent = text;
}

function _startCountdown() {
  _stopAllSchedules();
  if (_refreshIntervalSecs === 0) {
    // “Never” — no auto-refresh
    _updateCountdownEl(t('txt_txt_manual_only'));
    return;
  }
  if (_refreshIntervalSecs === -1) {
    // “On update” — poll version endpoint every 2 s
    _updateCountdownEl('');
    _versionPollTimer = setInterval(async () => {
      if (_isRefreshing || !TID) return;
      try {
        const data = await fetch(`/api/tournaments/${TID}/version`).then(r => r.json());
        if (_lastKnownVersion !== null && data.version !== _lastKnownVersion) {
          loadTV();
        }
        _lastKnownVersion = data.version;
      } catch (_) { /* network blip — ignore */ }
    }, 2000);
    return;
  }
  // Timer mode
  _countdown = _refreshIntervalSecs;
  _updateCountdownEl(`↻ ${_countdown}s`);
  _countdownInterval = setInterval(() => {
    _countdown--;
    _updateCountdownEl(`↻ ${_countdown}s`);
    if (_countdown <= 0) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
      loadTV();
    }
  }, 1000);
}

// ── Load & render ─────────────────────────────────────────
async function loadTV() {
  if (_isRefreshing) return;
  _isRefreshing = true;
  if (_countdownInterval) clearInterval(_countdownInterval);

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
      document.getElementById('tv-root').innerHTML =
        `<div class="tv-error">${t('txt_txt_tournament_not_found_value', { value: esc(TID) })}</div>`;
      return;
    }
    _tournamentType = meta.type;
    _tournamentName = meta.name;
    _tournamentSport = meta.sport || 'padel';
    document.title = `${_tvLabel()} | ${meta.name}`;

    // Load TV settings and tournament data in parallel
    const [tvSettings, ...dataResults] = await Promise.all([
      api(`/api/tournaments/${TID}/tv-settings`),
      ...(
        _tournamentType === 'group_playoff'
          ? [
              api(`/api/tournaments/${TID}/gp/status`),
              api(`/api/tournaments/${TID}/gp/groups`),
              api(`/api/tournaments/${TID}/gp/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
          : _tournamentType === 'playoff'
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

    _refreshIntervalSecs = tvSettings.refresh_interval ?? 15;
    _tvScoreMode = tvSettings.score_mode || {};
    _allowPlayerScoring = tvSettings.allow_player_scoring !== false;
    // Seed _lastKnownVersion so first poll doesn’t trigger an immediate reload
    if (_refreshIntervalSecs === -1 && _lastKnownVersion === null) {
      try {
        const vd = await fetch(`/api/tournaments/${TID}/version`).then(r => r.json());
        _lastKnownVersion = vd.version;
      } catch (_) {}
    }
    if (_tournamentType === 'group_playoff') {
      const [status, groups, playoffs] = dataResults;
      _captureOpenState();
      _renderGP(tvSettings, status, groups, playoffs);
      _applyOpenState();
    } else if (_tournamentType === 'playoff') {
      const [status, playoffs] = dataResults;
      _captureOpenState();
      _renderPO(tvSettings, status, playoffs);
      _applyOpenState();
    } else {
      const [status, matches, playoffs] = dataResults;
      _breakdowns = matches.breakdowns || {};
      _tvPlayerMap = {};
      for (const p of (status.players || [])) _tvPlayerMap[p.id] = p.name;
      _captureOpenState();
      _renderMex(tvSettings, status, matches, playoffs);
      _applyOpenState();
    }
  } catch (e) {
    const root = document.getElementById('tv-root');
    if (root) root.innerHTML = `<div class="tv-error">${t('txt_txt_error_loading_data_value', { value: esc(e.message) })}</div>`;
  } finally {
    _isRefreshing = false;
    const dot = document.getElementById('refresh-dot');
    if (dot) dot.classList.remove('refreshing');
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

  let html = _buildHeader(_tournamentName, phase, champion);
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
      html += `<img class="bracket-img" src="${imgUrl}" alt="${t('txt_txt_play_off_bracket')}" onerror="this.style.display='none'">`;
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
        html += `<div class="group-block"><h3>${t('txt_txt_group_name_value', { value: esc(gName) })}</h3>`;
        html += `<table class="standings-table" data-type="gp"><thead><tr>`;
        html += `<th>#</th><th>${status.team_mode ? t('txt_txt_team') : t('txt_txt_player')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th><th>${t('txt_txt_pf_abbrev')}</th><th>${t('txt_txt_pa_abbrev')}</th><th>${t('txt_txt_pts_abbrev')}</th>`;
        html += `</tr></thead><tbody>`;
        rows.forEach((r, i) => {
          html += `<tr><td class="rank-cell">${i + 1}</td><td class="player-cell">${esc(r.player)}</td>`;
          html += `<td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>`;
          html += `<td>${r.points_for}</td><td>${r.points_against}</td>`;
          html += `<td class="pts-cell">${r.match_points}</td></tr>`;
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

  let html = _buildHeader(_tournamentName, phase, champion);
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
    html += `<img class="bracket-img" src="${imgUrl}" alt="${t('txt_txt_play_off_bracket')}" onerror="this.style.display='none'">`;
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

  let html = _buildHeader(_tournamentName, phase, champion);
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
      html += `<img class="bracket-img" src="${imgUrl}" alt="${t('txt_txt_play_off_bracket')}" onerror="this.style.display='none'">`;
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
}

// ── Shared builders ───────────────────────────────────────

// ── Abbreviation legend popup ──────────────────────────────
let _abbrevPopupBtn = null;

function _buildAbbrevLegend(type) {
  const rows = type === 'standings' ? [
    [t('txt_txt_p_abbrev'),    t('txt_txt_abbrev_mp_full')],
    [t('txt_txt_w_abbrev'),    t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),    t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),    t('txt_txt_abbrev_l_full')],
    [t('txt_txt_pf_abbrev'),   t('txt_txt_abbrev_pf_full')],
    [t('txt_txt_pa_abbrev'),   t('txt_txt_abbrev_pa_full')],
    [t('txt_txt_diff_abbrev'), t('txt_txt_abbrev_diff_full')],
    [t('txt_txt_pts_abbrev'),  t('txt_txt_abbrev_pts_full')],
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
  if (popup.style.display === 'block' && _abbrevPopupBtn === btn) {
    popup.style.display = 'none';
    _abbrevPopupBtn = null;
    return;
  }
  _abbrevPopupBtn = btn;
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
  if (p) { p.style.display = 'none'; _abbrevPopupBtn = null; }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const p = document.getElementById('abbrev-popup');
    if (p) { p.style.display = 'none'; _abbrevPopupBtn = null; }
  }
});

function _buildMexLeaderboard(status) {
  const lb = status.leaderboard || [];
  const byAvg = lb.length > 0 && lb[0].ranked_by_avg;
  let html = `<details class="tv-collapsible" data-tv-key="standings" open>`;
  html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_leaderboard')}</h2> <button class="format-info-btn" onclick="showAbbrevPopup(event,'leaderboard')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></summary>`;
  html += `<div class="tv-section">`;
  html += `<table class="standings-table" data-type="mex"><thead><tr>`;
  html += `<th>#</th><th>${status.team_mode ? t('txt_txt_team') : t('txt_txt_player')}</th><th>${t('txt_txt_total_pts_abbrev')}</th><th>${t('txt_txt_played_abbrev')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th><th>${t('txt_txt_avg_pts_abbrev')}</th>`;
  html += `</tr></thead><tbody>`;
  for (const r of lb) {
    html += `<tr><td class="rank-cell">${r.rank}</td><td class="player-cell">${esc(r.player)}</td>`;
    const totalCell = byAvg ? r.total_points : `<strong>${r.total_points}</strong>`;
    const avgCell   = byAvg ? `<strong>${r.avg_points.toFixed(2)}</strong>` : r.avg_points.toFixed(2);
    html += `<td class="${byAvg ? '' : 'pts-cell'}">${totalCell}</td>`;
    html += `<td>${r.matches_played}</td><td>${r.wins ?? 0}</td><td>${r.draws ?? 0}</td><td>${r.losses ?? 0}</td>`;
    html += `<td class="${byAvg ? 'pts-cell' : ''}">${avgCell}</td></tr>`;
  }
  html += `</tbody></table>`;
  html += `</div></details>`;
  return html;
}

function _buildHeader(name, phase, champion) {
  const phaseLabel = _phaseLabel(phase);
  const langToggle = _languageToggleMeta();
  return `
    <div class="tv-header">
      <div class="tv-header-title-row">
        <button type="button" id="lang-toggle-btn" class="theme-btn" onclick="_toggleLanguage()" title="${langToggle.label}" aria-label="${langToggle.label}">${langToggle.icon}</button>
        <div class="tv-title-center">
          <span class="tv-app-label">${_tvLabel()} —</span>
          <h1 class="tv-tournament-name">${esc(name)}</h1>
        </div>
        <button type="button" id="theme-toggle-btn" data-theme-toggle-icon="1" class="theme-btn" onclick="_toggleTheme()" title="${t('txt_txt_toggle_light_dark_mode')}">${_theme === 'dark' ? '🌙' : '☀️'}</button>
      </div>
      <div style="display:flex;justify-content:center;gap:0.5rem;flex-wrap:wrap;margin-top:0.15rem">
        ${phaseLabel && phase !== 'finished' ? `<span class="tv-badge tv-badge-phase">${esc(phaseLabel)}</span>` : ''}
        ${champion || phase === 'finished' ? `<span class="tv-badge tv-badge-champion">🏆 ${t('txt_txt_finished')}</span>` : `<span class="tv-badge tv-badge-live"><span style="font-size:0.7em">●</span> ${t('txt_txt_live')}</span>`}
      </div>
      </div>
      <div class="tv-header-row">
        <div class="tv-title">
          <button type="button" onclick="_backToTournaments()" style="background:var(--border);border:none;color:var(--text-muted);border-radius:999px;padding:0.3rem 0.8rem;cursor:pointer;font-size:0.78rem;font-weight:500;line-height:1;white-space:nowrap" title="${t('txt_txt_back_to_tournaments')}">← ${t('txt_txt_tournaments')}</button>
        </div>
        <div class="tv-meta">
          <div id="player-login-slot"></div>
          <div class="refresh-indicator">
            <div class="refresh-dot" id="refresh-dot"></div>
            <span id="tv-countdown">↻ ${_refreshIntervalSecs}s</span>
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
        html += `<div class="court-match-teams">${esc(_tl(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl(m.team2))}</div>`;
        html += _commentHtml(m);
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
    html += `<div class="court-match-teams">${esc(t1)}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(t2)}</div>`;
    if (m.round_label) html += `<div class="court-match-meta">${esc(m.round_label)}</div>`;
    html += _commentHtml(m);
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
      html += `<div class="court-match-teams">${esc(_tl2(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl2(m.team2))}</div>`;
      html += _commentHtml(m);
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
    const bd = _breakdowns[m.id];
    if (bd && Object.keys(bd).length > 0) {
      html += `<details style="margin-top:-0.3rem;margin-bottom:0.4rem">`;
      html += `<summary class="breakdown-toggle">📊 ${t('txt_txt_score_breakdown')}</summary>`;
      html += `<div class="breakdown-panel">`;
      html += `<table class="breakdown-table"><thead><tr>`;
      html += `<th>${t('txt_txt_player')}</th><th>${t('txt_txt_raw')}</th><th>${t('txt_txt_strength_multiplier')}</th><th>${t('txt_txt_loss_disc_multiplier')}</th><th>${t('txt_txt_win_bonus_header')}</th><th>${t('txt_txt_final')}</th>`;
      html += `</tr></thead><tbody>`;
      for (const [pid, d] of Object.entries(bd)) {
        html += `<tr><td>${esc(_tvPlayerMap[pid] || pid)}</td><td>${d.raw}</td>`;
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
      document.getElementById('tv-root').innerHTML =
        `<div class="tv-error">${t('txt_txt_no_tournament_found_with_alias')} <strong>${esc(_aliasParam)}</strong></div>`;
      return false;
    }
  }
  return true;
}

function _renderPickerHtml(tournaments) {
  const langToggle = _languageToggleMeta();
  let html = `<div class="tv-picker">`;
  html += `<div style="display:flex;justify-content:flex-end;gap:0.45rem;margin-bottom:0.75rem">`;
  html += `<button type="button" class="theme-btn" onclick="_toggleLanguage()" title="${langToggle.label}" aria-label="${langToggle.label}">${langToggle.icon}</button>`;
  html += `<button type="button" data-theme-toggle-icon="1" class="theme-btn" onclick="_toggleTheme()" title="${t('txt_txt_toggle_light_dark_mode')}">${_theme === 'dark' ? '🌙' : '☀️'}</button>`;
  html += `</div>`;
  html += `<h1>${t('txt_txt_app_title')}</h1>`;
  html += `<div class="subtitle">${t('txt_txt_select_a_tournament_to_display')}</div>`;

  if (tournaments.length > 0) {
    html += `<ul class="tv-picker-list">`;
    for (const tournament of tournaments) {
      const modeLabel = tournament.team_mode ? t('txt_txt_team_mode_short') : t('txt_txt_individual_mode');
      const phaseLabel = _phaseLabel(tournament.phase);
      const aliasTag = tournament.alias ? `<span class="picker-alias">${esc(tournament.alias)}</span>` : '';
      const isTennis = tournament.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const pickerSlug = tournament.alias || tournament.id;
      html += `<a class="tv-picker-item" href="/tv/${encodeURIComponent(pickerSlug)}">`;
      html += `${esc(tournament.name)}<span class="picker-badge picker-badge-sport">${esc(sportLabel)}</span>${!isTennis ? `<span class="picker-badge picker-badge-type">${modeLabel}</span>` : ''}<span class="picker-badge picker-badge-phase">${phaseLabel}</span>${aliasTag}`;
      html += `</a>`;
    }
    html += `</ul>`;
  } else {
    html += `<p style="color:var(--text-muted);margin-bottom:1.5rem">${t('txt_txt_no_tournaments_available')}</p>`;
  }

  html += `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0.5rem">${t('txt_txt_or_enter_a_tournament_id_alias_directly')}</div>`;
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

  // Poll /api/version every 2 s (lightweight). Re-fetch + re-render only when
  // the version changes, so visibility/creation changes appear within ~2 s.
  if (_pickerPollTimer) return; // already running — don't stack timers
  let _pickerVersion = null;
  try {
    const vd = await fetch('/api/version').then(r => r.json());
    _pickerVersion = vd.version;
  } catch (_) {}

  _pickerPollTimer = setInterval(async () => {
    try {
      const vd = await fetch('/api/version').then(r => r.json());
      if (_pickerVersion !== null && vd.version !== _pickerVersion) {
        let list = [];
        try { list = await api('/api/tournaments'); } catch (_) {}
        _renderPickerHtml(list);
      }
      _pickerVersion = vd.version;
    } catch (_) { /* network blip — ignore */ }
  }, 2000);
}

function _backToTournaments() {
  _stopAllSchedules();
  TID = null;
  history.replaceState(null, '', '/tv');
  _showPicker();
}

function _goToTournament(e) {
  e.preventDefault();
  const val = document.getElementById('picker-input').value.trim();
  if (!val) return false;
  location.href = `/tv/${encodeURIComponent(val)}`;
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
