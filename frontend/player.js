/* ── Player Hub page ──────────────────────────────────── */
'use strict';

// ── Remember this page for the page selector ──────────────
try { localStorage.setItem('amistoso-last-page', 'player'); } catch (_) {}

// ── Theme & language (early, before render) ───────────────
let _theme = _loadSavedTheme();
_applyTheme(_theme);
let _lang = _loadSavedLanguage();
setAppLanguage(_lang);

// ── State ─────────────────────────────────────────────────
const API = '/api/player-profile';
const STORAGE_JWT_KEY = 'padel-player-profile';
const STORAGE_PROFILE_KEY = 'padel-player-profile-data';
const STORAGE_PARTICIPANT_LOOKUP_KEY = 'padel-player-participant-lookup';
const STORAGE_HISTORY_PANEL_KEY = 'padel-player-history-panel-open';
const STORAGE_PATH_PANEL_KEY = 'padel-player-path-panel-open';
const STORAGE_ELO_HISTORY_KEY = 'padel-player-elo-history-settings';
const STORAGE_ELO_HISTORY_PANEL_KEY = 'padel-player-elo-history-panel-open';
const STORAGE_LEADERBOARD_PANEL_KEY = 'padel-player-leaderboard-panel-open';

let _jwt = null;
let _profile = null;
let _entries = [];
let _eloHistory = [];
let _leaderboard = null; // { padel: [], tennis: [] } or null
let _leaderboardSport = 'padel'; // 'padel' | 'tennis'
let _eloHistorySport = 'padel'; // 'padel' | 'tennis'
let _authStep = 'passphrase'; // 'passphrase' | 'create'
let _resolveResult = null;    // null | {type: 'profile'|'participation'|'not_found', matches: [...]}
let _resolvedPassphrase = ''; // the passphrase that was resolved
let _resolving = false;
let _editMode = false;
let _showLinkModal = false;
let _showPassphrase = false;
let _recoverSent = false;
let _errorMsg = '';
let _successMsg = '';
let _passphraseEmailedMsg = '';
let _spacePollTimer = null;
let _spacePollInFlight = false;
let _passphraseEmailedMsgTimer = null;
let _pathPanelOpen = {};
let _pathCache = {};
let _pathLoading = {};
let _pathErrors = {};
const SPACE_POLL_MS = 30000;
const PASSPHRASE_EMAILED_MSG_MS = 10000;

function _clearPassphraseEmailedMsgTimer() {
  if (_passphraseEmailedMsgTimer) {
    clearTimeout(_passphraseEmailedMsgTimer);
    _passphraseEmailedMsgTimer = null;
  }
}

function _setPassphraseEmailedMsg(message) {
  _passphraseEmailedMsg = message;
  _clearPassphraseEmailedMsgTimer();
  _passphraseEmailedMsgTimer = setTimeout(() => {
    _passphraseEmailedMsg = '';
    _passphraseEmailedMsgTimer = null;
    _render();
  }, PASSPHRASE_EMAILED_MSG_MS);
}

function _participantSortModeOrDefault(value) {
  const allowed = new Set(['interactions', 'together', 'against', 'win_rate', 'name']);
  return allowed.has(value) ? value : 'interactions';
}

function _getParticipantLookupState() {
  const defaults = { open: false, query: '', sort: 'interactions' };
  try {
    const raw = localStorage.getItem(STORAGE_PARTICIPANT_LOOKUP_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      open: !!parsed?.open,
      query: typeof parsed?.query === 'string' ? parsed.query : '',
      sort: _participantSortModeOrDefault(parsed?.sort),
    };
  } catch (_) {
    return defaults;
  }
}

function _setParticipantLookupState(patch) {
  const prev = _getParticipantLookupState();
  const next = {
    open: typeof patch?.open === 'boolean' ? patch.open : prev.open,
    query: typeof patch?.query === 'string' ? patch.query : prev.query,
    sort: _participantSortModeOrDefault(patch?.sort || prev.sort),
  };
  try {
    localStorage.setItem(STORAGE_PARTICIPANT_LOOKUP_KEY, JSON.stringify(next));
  } catch (_) {}
}

function _eloHistoryLimitOrDefault(value) {
  const n = Number(value);
  return n === 5 || n === 10 || n === 20 || n === 50 ? n : 5;
}

function _getEloHistorySettings() {
  const defaults = { limit: 5 };
  try {
    const raw = localStorage.getItem(STORAGE_ELO_HISTORY_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { limit: _eloHistoryLimitOrDefault(parsed?.limit) };
  } catch (_) {
    return defaults;
  }
}

function _setEloHistorySettings(patch) {
  const prev = _getEloHistorySettings();
  const next = { limit: _eloHistoryLimitOrDefault(patch?.limit ?? prev.limit) };
  try {
    localStorage.setItem(STORAGE_ELO_HISTORY_KEY, JSON.stringify(next));
  } catch (_) {}
}

function _isHistoryPanelOpen() {
  try {
    return localStorage.getItem(STORAGE_HISTORY_PANEL_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function _setHistoryPanelOpen(isOpen) {
  try {
    localStorage.setItem(STORAGE_HISTORY_PANEL_KEY, isOpen ? '1' : '0');
  } catch (_) {}
}

function _isEloHistoryPanelOpen() {
  try {
    return sessionStorage.getItem(STORAGE_ELO_HISTORY_PANEL_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function _setEloHistoryPanelOpen(isOpen) {
  try {
    sessionStorage.setItem(STORAGE_ELO_HISTORY_PANEL_KEY, isOpen ? '1' : '0');
  } catch (_) {}
}

function _isLeaderboardPanelOpen() {
  try {
    return sessionStorage.getItem(STORAGE_LEADERBOARD_PANEL_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function _setLeaderboardPanelOpen(isOpen) {
  try {
    sessionStorage.setItem(STORAGE_LEADERBOARD_PANEL_KEY, isOpen ? '1' : '0');
  } catch (_) {}
}

function _getPathPanelState() {
  try {
    const raw = localStorage.getItem(STORAGE_PATH_PANEL_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (_) {
    return {};
  }
}

function _savePathPanelState() {
  try {
    localStorage.setItem(STORAGE_PATH_PANEL_KEY, JSON.stringify(_pathPanelOpen || {}));
  } catch (_) {}
}

function _entryPathKey(entry) {
  return `${entry.entity_id}::${entry.player_id}`;
}

function _prunePathState() {
  const valid = new Set(_entries.filter(_supportsPath).map(_entryPathKey));

  const nextOpen = {};
  for (const key of Object.keys(_pathPanelOpen)) {
    if (valid.has(key)) nextOpen[key] = !!_pathPanelOpen[key];
  }
  _pathPanelOpen = nextOpen;

  for (const key of Object.keys(_pathCache)) {
    if (!valid.has(key)) delete _pathCache[key];
  }
  for (const key of Object.keys(_pathLoading)) {
    if (!valid.has(key)) delete _pathLoading[key];
  }
  for (const key of Object.keys(_pathErrors)) {
    if (!valid.has(key)) delete _pathErrors[key];
  }

  _savePathPanelState();
}

// ── Init ─────────────────────────────────────────────────

function _init() {
  // Fetch leaderboard (public, no auth) — fire-and-forget, re-renders when ready
  _fetchLeaderboard().then(() => _render()).catch(() => {});

  // Check for JWT autologin and/or email verification via URL fragment.
  // Used by email links like #token=<jwt> and #verify_token=<jwt>.
  const _hashParams = new URLSearchParams(location.hash.slice(1));
  const _tokenFromHash = _hashParams.get('token');
  const _verifyTokenFromHash = _hashParams.get('verify_token');
  if (_tokenFromHash || _verifyTokenFromHash) {
    history.replaceState(null, '', location.pathname + location.search);
    Promise.resolve()
      .then(async () => {
        if (_verifyTokenFromHash) {
          await _apiPost('/verify-email', { token: _verifyTokenFromHash });
          _successMsg = t('txt_player_email_verified_success');
        }
        let _tokenFromStorage = null;
        try {
          _tokenFromStorage = localStorage.getItem(STORAGE_JWT_KEY) || null;
        } catch (_) {}
        const _effectiveToken = _tokenFromHash || _tokenFromStorage;
        if (_effectiveToken) {
          _jwt = _effectiveToken;
          await _fetchSpace();
        }
      })
      .then(() => _render())
      .catch(err => {
        if (_verifyTokenFromHash) {
          _errorMsg = err?.message || t('txt_player_email_verified_error');
        }
        if (_tokenFromHash) {
          _jwt = null;
          _profile = null;
        }
        _render();
      });
    return;
  }

  // Try resuming a saved session
  try {
    _jwt = localStorage.getItem(STORAGE_JWT_KEY) || null;
    const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
    if (raw) _profile = JSON.parse(raw);
  } catch (_) {}

  if (_jwt && _profile) {
    // Refresh space from server in background
    _fetchSpace().then(() => _render()).catch(() => {
      _jwt = null;
      _profile = null;
      _render();
    });
  }
  _render();
}

function _startSpacePolling() {
  if (_spacePollTimer || !_jwt || !_profile || document.hidden) return;
  _spacePollTimer = setInterval(_pollSpace, SPACE_POLL_MS);
  document.addEventListener('visibilitychange', _onSpaceVisibilityChange);
}

function _stopSpacePolling() {
  if (_spacePollTimer) {
    clearInterval(_spacePollTimer);
    _spacePollTimer = null;
  }
  document.removeEventListener('visibilitychange', _onSpaceVisibilityChange);
}

function _onSpaceVisibilityChange() {
  if (document.hidden) {
    if (_spacePollTimer) {
      clearInterval(_spacePollTimer);
      _spacePollTimer = null;
    }
    return;
  }
  if (_jwt && _profile && !_spacePollTimer) {
    _pollSpace();
    _spacePollTimer = setInterval(_pollSpace, SPACE_POLL_MS);
  }
}

async function _pollSpace() {
  if (_spacePollInFlight || !_jwt || !_profile) return;
  if (_editMode || _showLinkModal) return;

  _spacePollInFlight = true;
  try {
    const prevProfile = JSON.stringify(_profile || {});
    const prevEntries = JSON.stringify(_entries || []);
    const prevEloHistory = JSON.stringify(_eloHistory || []);
    await _fetchSpace();
    const nextProfile = JSON.stringify(_profile || {});
    const nextEntries = JSON.stringify(_entries || []);
    const nextEloHistory = JSON.stringify(_eloHistory || []);
    if (prevProfile !== nextProfile || prevEntries !== nextEntries || prevEloHistory !== nextEloHistory) {
      _render();
    }
  } catch (_) {
    // Ignore transient polling errors
  } finally {
    _spacePollInFlight = false;
  }
}

async function _refreshSpaceNow() {
  if (!_jwt || !_profile || _spacePollInFlight) return;
  if (_editMode || _showLinkModal) return;

  _spacePollInFlight = true;
  try {
    await _fetchSpace();
    _render();
  } catch (_) {
    // Keep current view; next successful refresh will sync again
  } finally {
    _spacePollInFlight = false;
  }
}

// ── API helpers ───────────────────────────────────────────

async function _apiPost(path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Error ${res.status}`);
  }
  return res.json();
}

async function _apiGet(path, auth) {
  const headers = {};
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Error ${res.status}`);
  }
  return res.json();
}

async function _apiPut(path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  const res = await fetch(`${API}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Error ${res.status}`);
  }
  return res.json();
}

async function _apiDelete(path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  const res = await fetch(`${API}${path}`, { method: 'DELETE', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Error ${res.status}`);
  }
  return res.json();
}

async function _fetchSpace() {
  const settings = _getEloHistorySettings();
  const data = await _apiGet(`/space?elo_history_limit=${settings.limit}`, _jwt);
  _jwt = data.access_token;
  _profile = data.profile;
  _entries = data.entries || [];
  _eloHistory = data.elo_history || [];
  _prunePathState();
  _saveSession();
}

async function _fetchLeaderboard() {
  try {
    const res = await fetch(`${API}/leaderboard`);
    if (!res.ok) return;
    _leaderboard = await res.json();
  } catch (_) {
    // Silently ignore — leaderboard is non-critical
  }
}

function _saveSession() {
  try {
    localStorage.setItem(STORAGE_JWT_KEY, _jwt || '');
    localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(_profile || {}));
  } catch (_) {}
}

function _clearSession() {
  _stopSpacePolling();
  _jwt = null;
  _profile = null;
  _entries = [];
  _eloHistory = [];
  _pathPanelOpen = {};
  _pathCache = {};
  _pathLoading = {};
  _pathErrors = {};
  try {
    localStorage.removeItem(STORAGE_JWT_KEY);
    localStorage.removeItem(STORAGE_PROFILE_KEY);
  } catch (_) {}
}

// ── Helpers ───────────────────────────────────────────────

function _sportLabel(sport) {
  if (sport === 'tennis') return t('txt_player_sport_tennis');
  return t('txt_player_sport_padel');
}

function _typeLabel(type) {
  if (!type) return t('txt_player_type_registration');
  if (type === 'mexicano') return t('txt_player_type_mexicano');
  if (type === 'group_playoff') return t('txt_player_type_group_playoff');
  if (type === 'playoff') return t('txt_player_type_playoff');
  return type;
}

function _entityUrl(entry) {
  const slug = entry.alias || entry.entity_id;
  if (entry.entity_type === 'tournament') {
    if (entry.auto_login_token) return `/tv/${encodeURIComponent(slug)}?player_token=${encodeURIComponent(entry.auto_login_token)}`;
    return `/tv/${encodeURIComponent(slug)}`;
  }
  // registration
  if (entry.auto_login_token) return `/register/${encodeURIComponent(slug)}?token=${encodeURIComponent(entry.auto_login_token)}`;
  return `/register/${encodeURIComponent(slug)}`;
}

function _supportsPath(entry) {
  if (!entry || entry.entity_type !== 'tournament') return false;
  return entry.tournament_type === 'group_playoff' || entry.tournament_type === 'mexicano';
}

function _isPathOpen(entry) {
  return !!_pathPanelOpen[_entryPathKey(entry)];
}

function _setPathOpen(entry, isOpen) {
  _pathPanelOpen[_entryPathKey(entry)] = !!isOpen;
  _savePathPanelState();
}

async function _loadPathForEntry(entry) {
  const key = _entryPathKey(entry);
  if (_pathLoading[key] || _pathCache[key]) return;
  _pathLoading[key] = true;
  _pathErrors[key] = '';
  _render();
  try {
    const path = `/tournament-path/${encodeURIComponent(entry.entity_id)}/${encodeURIComponent(entry.player_id)}`;
    _pathCache[key] = await _apiGet(path, _jwt);
  } catch (err) {
    _pathErrors[key] = err.message || t('txt_player_path_error');
  } finally {
    _pathLoading[key] = false;
    _render();
  }
}

function _togglePath(entityId, playerId) {
  const entry = _entries.find(e => e.entity_id === entityId && e.player_id === playerId && _supportsPath(e));
  if (!entry) return;
  const willOpen = !_isPathOpen(entry);
  _setPathOpen(entry, willOpen);
  _render();
  if (willOpen) {
    _loadPathForEntry(entry);
  }
}

function _buildPathPanel(entry) {
  const key = _entryPathKey(entry);
  const loading = !!_pathLoading[key];
  const errorMsg = _pathErrors[key] || '';
  const payload = _pathCache[key] || null;

  let html = `<div class="entry-path-panel">`;
  html += `<div class="entry-path-title">${esc(t('txt_player_path_title'))}</div>`;

  if (loading) {
    html += `<div class="entry-path-empty">${esc(t('txt_player_path_loading'))}</div>`;
    html += `</div>`;
    return html;
  }

  if (errorMsg) {
    html += `<div class="entry-path-empty">${esc(errorMsg)}</div>`;
    html += `</div>`;
    return html;
  }

  if (!payload || payload.available === false) {
    html += `<div class="entry-path-empty">${esc(t('txt_player_path_unavailable'))}</div>`;
    html += `</div>`;
    return html;
  }

  const rows = Array.isArray(payload.rounds) ? payload.rounds : [];
  if (rows.length === 0) {
    html += `<div class="entry-path-empty">${esc(t('txt_player_path_empty'))}</div>`;
    html += `</div>`;
    return html;
  }

  // ── Summary bar ────────────────────────────────────────
  const playedWithRank = rows.filter(r => r.played && r.rank != null);
  if (playedWithRank.length >= 2) {
    const firstRank = playedWithRank[0].rank;
    const lastRank  = playedWithRank[playedWithRank.length - 1].rank;
    const total     = playedWithRank[playedWithRank.length - 1].total_players || '?';
    const delta     = lastRank - firstRank;
    let deltaHtml;
    if (delta < 0)      deltaHtml = `<span class="entry-path-summary-delta entry-path-summary-delta--up">▲ ${Math.abs(delta)}</span>`;
    else if (delta > 0) deltaHtml = `<span class="entry-path-summary-delta entry-path-summary-delta--down">▼ ${delta}</span>`;
    else                deltaHtml = `<span class="entry-path-summary-delta entry-path-summary-delta--same">=</span>`;
    html += `<div class="entry-path-summary">#${firstRank}/${total} → #${lastRank}/${total} ${deltaHtml}</div>`;
  }

  // ── Best rank across all played rounds ─────────────────
  const bestRank = playedWithRank.length ? Math.min(...playedWithRank.map(r => r.rank)) : null;

  html += `<div class="entry-path-list">`;
  let _prevRank  = null;
  let _prevPoints = 0;
  for (const row of rows) {
    const rankText    = row.rank ? `#${row.rank}/${row.total_players || '?'}` : '—';
    const partners = Array.isArray(row.partners) ? row.partners.filter(Boolean) : [];
    const opponents = Array.isArray(row.opponents) ? row.opponents.filter(Boolean) : [];
    const playerTeam = [(_profile && _profile.name) ? _profile.name : '', ...partners].filter(Boolean);
    const playerTeamNames = playerTeam.length ? playerTeam : [row.played ? '—' : t('txt_player_path_sit_out')];
    const opponentNames = opponents.length ? opponents : [row.played ? '—' : t('txt_player_path_sit_out')];
    const playerTeamNamesHtml = playerTeamNames
      .map((name) => `<span class="entry-path-team-name">${esc(name)}</span>`)
      .join('');
    const opponentNamesHtml = opponentNames
      .map((name) => `<span class="entry-path-team-name">${esc(name)}</span>`)
      .join('');
    const isTennisRow = row.score_mode === 'tennis';

    // Rank trend
    let dotMod = '', trendArrow = '', trendClass = '';
    if (row.played && row.rank != null && _prevRank != null) {
      if (row.rank < _prevRank)      { dotMod = ' entry-path-row--up';   trendArrow = '↑'; trendClass = 'up'; }
      else if (row.rank > _prevRank) { dotMod = ' entry-path-row--down'; trendArrow = '↓'; trendClass = 'down'; }
      else                           { dotMod = ' entry-path-row--same'; trendArrow = '→'; trendClass = 'same'; }
    }
    if (row.rank != null) _prevRank = row.rank;

    // Points delta (or explicit backend-provided value)
    const roundPoints = row.played
      ? (row.round_points_delta != null ? row.round_points_delta : (row.cumulative_points || 0) - _prevPoints)
      : 0;
    if (row.played && !isTennisRow) _prevPoints = row.cumulative_points || 0;

    // Best-rank highlight
    const isBest = bestRank != null && row.rank === bestRank && row.played;
    let rowClass = (row.played ? 'entry-path-row' : 'entry-path-row is-sitout') + dotMod;
    if (isBest) rowClass += ' entry-path-row--best';

    const deltaPtsHtml  = (row.played && roundPoints > 0)
      ? ` <span class="entry-path-pts-delta">+${roundPoints}</span>` : '';
    const rankArrowHtml = trendArrow
      ? ` <span class="entry-path-rank-arrow entry-path-rank-arrow--${trendClass}">${trendArrow}</span>` : '';

    const _fmtSigned = (n) => {
      if (n == null) return '0';
      const num = Number(n) || 0;
      return num > 0 ? `+${num}` : `${num}`;
    };
    const setsDeltaHtml = (row.round_sets_diff_delta == null || row.round_sets_diff_delta === 0)
      ? ''
      : ` <span class="entry-path-pts-delta">${esc(_fmtSigned(row.round_sets_diff_delta))}</span>`;
    const gamesDeltaHtml = (row.round_games_diff_delta == null || row.round_games_diff_delta === 0)
      ? ''
      : ` <span class="entry-path-pts-delta">${esc(_fmtSigned(row.round_games_diff_delta))}</span>`;
    const eliminatedBadgeHtml = row.eliminated
      ? ` <span class="entry-path-eliminated-badge">${esc(t('txt_player_path_eliminated'))}</span>`
      : '';

    html += `<div class="${rowClass}">`;
    html += `<div class="entry-path-head">`;
    html += `<div class="entry-path-head-top">`;
    html += `<div class="entry-path-round">${esc(row.round_label || `${t('txt_player_path_round')} ${row.round_number || ''}`)}${eliminatedBadgeHtml}</div>`;
    html += `<div class="entry-path-chips entry-path-chips--perf">`;
    if (isTennisRow) {
      html += `<span class="entry-path-chip"><strong>${esc(t('txt_player_path_sets_diff'))}</strong> ${esc(_fmtSigned(row.cumulative_sets_diff || 0))}${setsDeltaHtml}</span>`;
      html += `<span class="entry-path-chip"><strong>${esc(t('txt_player_path_games_diff'))}</strong> ${esc(_fmtSigned(row.cumulative_games_diff || 0))}${gamesDeltaHtml}</span>`;
    } else {
      html += `<span class="entry-path-chip"><strong>${esc(t('txt_player_path_points'))}</strong> ${esc(String(row.cumulative_points || 0))}${deltaPtsHtml}</span>`;
    }
    html += `</div>`;
    html += `<div class="entry-path-chips entry-path-chips--rank">`;
    html += `<span class="entry-path-chip"><strong>${esc(t('txt_player_path_rank'))}</strong> ${esc(rankText)}${rankArrowHtml}</span>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="entry-path-match">`;
    html += `<div class="entry-path-team entry-path-team--player"><span class="entry-path-team-names">${playerTeamNamesHtml}</span></div>`;
    html += `<div class="entry-path-score-center">${esc(row.score || '—')}</div>`;
    html += `<div class="entry-path-team entry-path-team--opponents"><span class="entry-path-team-names">${opponentNamesHtml}</span></div>`;
    html += `</div>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _toggleTheme() {
  _theme = _theme === 'dark' ? 'light' : 'dark';
  _applyTheme(_theme);
  _saveTheme(_theme);
  document.querySelectorAll('[data-theme-toggle-icon]').forEach(btn => {
    btn.textContent = _theme === 'dark' ? '🌙' : '☀️';
  });
}

function _toggleLanguage() {
  _lang = _lang === 'es' ? 'en' : 'es';
  setAppLanguage(_lang);
  _render();
}

// ── Leaderboard ───────────────────────────────────────────

function _toggleLeaderboardPanel() {
  const next = !_isLeaderboardPanelOpen();
  _setLeaderboardPanelOpen(next);
  _render();
}

function _setLeaderboardSport(sport) {
  _leaderboardSport = sport;
  _render();
}

function _buildLeaderboardTable(entries) {
  if (!entries || entries.length === 0) {
    return `<div class="leaderboard-empty">${esc(t('txt_player_leaderboard_empty'))}</div>`;
  }
  let html = `<table class="leaderboard-table">`;
  html += `<thead><tr>`;
  html += `<th class="leaderboard-col-rank">${esc(t('txt_player_leaderboard_rank'))}</th>`;
  html += `<th class="leaderboard-col-name">${esc(t('txt_player_leaderboard_name'))}</th>`;
  html += `<th class="leaderboard-col-elo">${esc(t('txt_player_leaderboard_elo'))}</th>`;
  html += `<th class="leaderboard-col-matches">${esc(t('txt_player_leaderboard_matches'))}</th>`;
  html += `</tr></thead><tbody>`;
  const currentName = _profile ? _profile.name : null;
  for (const e of entries) {
    const isMe = currentName && e.name === currentName;
    html += `<tr${isMe ? ' class="leaderboard-row--me"' : ''}>`;
    html += `<td class="leaderboard-col-rank">${esc(String(e.rank))}</td>`;
    html += `<td class="leaderboard-col-name${e.has_profile === false ? ' leaderboard-name--unlinked' : ''}">${esc(e.name)}</td>`;
    html += `<td class="leaderboard-col-elo">${esc(String(Math.round(e.elo)))}</td>`;
    html += `<td class="leaderboard-col-matches">${esc(String(e.matches))}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function _buildLeaderboardPanel() {
  if (!_leaderboard) return '';
  const hasPadel = _leaderboard.padel && _leaderboard.padel.length > 0;
  const hasTennis = _leaderboard.tennis && _leaderboard.tennis.length > 0;
  if (!hasPadel && !hasTennis) return '';

  const isOpen = _isLeaderboardPanelOpen();
  const chevron = isOpen ? '▼' : '▶';

  let html = `<div class="card leaderboard-card">`;
  html += `<div class="leaderboard-header" onclick="_toggleLeaderboardPanel()">`;
  html += `<span class="leaderboard-chevron">${chevron}</span>`;
  html += `<h3 class="leaderboard-title">${esc(t('txt_player_leaderboard_title'))}</h3>`;
  html += `</div>`;

  if (isOpen) {
    // Sport toggle pills (only if both sports have data)
    if (hasPadel && hasTennis) {
      const activeSport = _leaderboardSport;
      html += `<div class="leaderboard-sport-toggle">`;
      html += `<button type="button" class="leaderboard-pill${activeSport === 'padel' ? ' leaderboard-pill--active' : ''}" onclick="event.stopPropagation(); _setLeaderboardSport('padel')">Padel</button>`;
      html += `<button type="button" class="leaderboard-pill${activeSport === 'tennis' ? ' leaderboard-pill--active' : ''}" onclick="event.stopPropagation(); _setLeaderboardSport('tennis')">Tennis</button>`;
      html += `</div>`;
    }

    // Show active sport (or whichever has data)
    const activeSport = (hasPadel && hasTennis) ? _leaderboardSport : (hasPadel ? 'padel' : 'tennis');
    const entries = activeSport === 'tennis' ? _leaderboard.tennis : _leaderboard.padel;
    html += _buildLeaderboardTable(entries);
  }

  html += `</div>`;
  return html;
}

// ── Render ────────────────────────────────────────────────

function _render() {
  const root = document.getElementById('player-root');
  if (!root) return;
  if (_jwt && _profile) _startSpacePolling();
  else _stopSpacePolling();
  let html = _buildHeader();
  if (_jwt && _profile) {
    html += _buildDashboard();
  } else {
    html += _buildAuthPanel();
  }
  html += _buildLeaderboardPanel();
  if (_showLinkModal) html += _buildLinkModal();
  root.innerHTML = html;
}

function _buildHeader() {
  const langMeta = { icon: _lang === 'es' ? '🇪🇸' : '🇬🇧', label: _lang === 'es' ? t('txt_txt_spanish') : t('txt_txt_english') };
  const themeIcon = _theme === 'dark' ? '🌙' : '☀️';
  let html = `<div class="tv-header"><div class="tv-header-title-row">`;
  html += `<div class="tv-lang-cell"><button type="button" class="theme-btn" onclick="_toggleLanguage()" title="${esc(langMeta.label)}">${langMeta.icon}</button></div>`;
  html += buildPageSelectorHtml('player');
  html += `<div class="tv-toggle-btns">`;
  if (_jwt && _profile) {
    html += buildCompactRefreshButtonHtml('_refreshSpaceNow()', t('txt_txt_refresh_now'));
  }
  html += `<button type="button" class="theme-btn" onclick="_toggleTheme()" data-theme-toggle-icon>${themeIcon}</button>`;
  html += `</div>`;
  html += `</div></div>`;
  return html;
}

function _buildAuthPanel() {
  let html = `<div class="card">`;
  html += `<p class="subtitle">${esc(t('txt_player_space_subtitle'))}</p>`;
  if (_successMsg) html += `<div class="success-msg">${esc(_successMsg)}</div>`;

  if (_authStep === 'passphrase') {
    // ── Info panel: why Player Hub ──
    html += `<div class="hub-info-panel">`;
    html += `<div class="hub-info-item"><span class="hub-info-bullet" aria-hidden="true"></span><span>${esc(t('txt_player_hub_benefit_stats'))}</span></div>`;
    html += `<div class="hub-info-item"><span class="hub-info-bullet" aria-hidden="true"></span><span>${esc(t('txt_player_hub_benefit_history'))}</span></div>`;
    html += `<div class="hub-info-item"><span class="hub-info-bullet" aria-hidden="true"></span><span>${esc(t('txt_player_hub_benefit_login'))}</span></div>`;
    html += `<div class="hub-info-item"><span class="hub-info-bullet" aria-hidden="true"></span><span>${esc(t('txt_player_hub_benefit_email'))}</span></div>`;
    html += `<div class="hub-info-item"><span class="hub-info-bullet" aria-hidden="true"></span><span>${esc(t('txt_player_hub_benefit_one_phrase'))}</span></div>`;
    html += `</div>`;

    // ── Step 1: single passphrase input ──
    html += `<div class="form-group">
      <label>${esc(t('txt_player_passphrase_label'))}</label>
      <input type="text" id="ps-passphrase" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false">
    </div>`;
    if (_errorMsg) html += `<div class="error-msg">${esc(_errorMsg)}</div>`;
    html += `<button type="button" class="btn btn-primary btn-block" onclick="_doResolve()"${_resolving ? ' disabled' : ''}>${esc(_resolving ? t('txt_player_resolving') : t('txt_player_resolve_btn'))}</button>`;

    // Passphrase recovery (collapsed)
    html += `<details class="player-recover"${_recoverSent ? ' open' : ''}>`;
    html += `<summary class="player-recover-summary"><span class="player-recover-chevron">▶</span>${esc(t('txt_player_recover_title'))}</summary>`;
    html += `<div class="player-recover-body">`;
    html += `<p class="player-recover-help">${esc(t('txt_player_recover_help'))}</p>`;
    if (_recoverSent) {
      html += `<div class="player-recover-sent">${esc(t('txt_player_recover_sent'))}</div>`;
    } else {
      html += `<input type="email" id="ps-recover-email" class="player-recover-input" placeholder="your@email.com" autocomplete="email">`;
      html += `<button type="button" class="btn btn-secondary btn-block" onclick="_doRecover()">${esc(t('txt_player_recover_btn'))}</button>`;
    }
    html += `</div></details>`;

  } else if (_authStep === 'create') {
    // ── Step 2b: participation found — show matches + create profile form ──
    html += `<button type="button" class="btn btn-sm btn-secondary resolve-back-btn" onclick="_goBackToPassphrase()">${esc(t('txt_player_back_btn'))}</button>`;

    // Show matched participations
    html += `<p class="resolve-found-msg">${esc(t('txt_player_found_participation'))}</p>`;
    html += `<ul class="resolve-matches-list">`;
    for (const m of (_resolveResult?.matches || [])) {
      const typeLabel = m.entity_type === 'tournament' ? t('txt_player_match_tournament') : t('txt_player_match_registration');
      html += `<li class="resolve-match-item">`;
      html += `<span class="resolve-match-type">${esc(typeLabel)}</span>`;
      html += `<span class="resolve-match-name">${esc(m.entity_name)}</span>`;
      html += `<span class="resolve-match-player">— ${esc(m.player_name)}</span>`;
      html += `</li>`;
    }
    html += `</ul>`;

    // Profile creation form
    html += `<p class="resolve-create-prompt">${esc(t('txt_player_found_create_prompt'))}</p>`;
    html += `<div class="form-group">
      <label>${esc(t('txt_player_name_label'))}</label>
      <input type="text" id="ps-name" value="${esc(_prefillName())}" autocomplete="name">
    </div>`;
    html += `<div class="form-group">
      <label>${esc(t('txt_player_email_label'))} <span class="required-mark">*</span></label>
      <input type="email" id="ps-email" placeholder="your@email.com" autocomplete="email" required>
    </div>`;
    html += `<div class="form-group">
      <label>${esc(t('txt_player_contact_label'))}</label>
      <input type="text" id="ps-contact" placeholder="e.g. +34 600 000 000" autocomplete="tel">
    </div>`;
    if (_errorMsg) html += `<div class="error-msg">${esc(_errorMsg)}</div>`;
    html += `<button type="button" class="btn btn-primary btn-block" onclick="_doCreate()">${esc(t('txt_player_create_btn'))}</button>`;
  }

  html += `</div>`;
  return html;
}

function _prefillName() {
  if (!_resolveResult?.matches?.length) return '';
  return _resolveResult.matches[0].player_name || '';
}

function _formatEloChip(sportLabel, eloValue, matchCount) {
  const matches = Number.isFinite(matchCount) ? matchCount : 0;
  const hasRatedElo = Number.isFinite(eloValue) && matches > 0;
  if (!hasRatedElo) return '';
  return `<span class="elo-chip elo-chip--rated">${esc(sportLabel)} <strong>${Math.round(eloValue)}</strong> <span class="elo-chip-count">(${matches})</span></span>`;
}

function _buildDashboard() {
  const active = _entries.filter(e => e.status === 'active');
  const history = _entries.filter(e => e.status === 'finished');

  let html = ``;

  // Profile bar
  const name = _profile.name || `ID: ${_profile.id.slice(0, 8)}`;
  const emailUnverified = Boolean(_profile.email && !_profile.email_verified);
  html += `<div class="profile-bar">`;
  html += `<div class="profile-bar-header">`;
  html += `<div class="profile-bar-name">${esc(name)}</div>`;
  const eloChipsHtml = [
    _formatEloChip(t('txt_player_sport_padel'), _profile.elo_padel, _profile.elo_padel_matches),
    _formatEloChip(t('txt_player_sport_tennis'), _profile.elo_tennis, _profile.elo_tennis_matches),
  ].filter(Boolean).join('');
  if (eloChipsHtml) html += `<div class="profile-elo-row">${eloChipsHtml}</div>`;
  html += `<div class="player-profile-actions">`;
  html += `<button type="button" class="btn btn-sm btn-secondary" onclick="_toggleEditProfile()">${esc(t('txt_player_edit_btn'))}</button>`;
  html += `<button type="button" class="btn btn-sm btn-danger-outline player-logout-btn" onclick="_doLogout()">${esc(t('txt_player_logout_btn'))}</button>`;
  html += `</div>`;
  html += `</div>`;
  if (_profile.email) {
    html += `<div class="profile-email-row">`;
    html += `<span class="profile-bar-meta">${esc(_profile.email)}</span>`;
    if (emailUnverified) {
      html += `<span class="badge badge-verify-pending">⚠ ${esc(t('txt_player_email_unverified_badge'))}</span>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  // Compact passphrase strip (always visible)
  html += `<div class="passphrase-strip">`;
  html += `<span class="passphrase-strip-label">${esc(t('txt_player_your_passphrase'))}</span>`;
  html += `<span id="ps-phrase-text" class="passphrase-strip-text${_showPassphrase ? '' : ' passphrase-hidden'}">${esc(_profile.passphrase || '***')}</span>`;
  html += `<button type="button" class="btn btn-sm btn-secondary" onclick="_togglePassphrase()">${esc(_showPassphrase ? t('txt_player_hide_passphrase') : t('txt_player_reveal_passphrase'))}</button>`;
  if (_passphraseEmailedMsg) {
    html += `<div class="success-msg passphrase-strip-success">${esc(_passphraseEmailedMsg)}</div>`;
  }
  html += `</div>`;

  // Edit profile inline
  if (_editMode) {
    html += `<div class="card" id="edit-profile-panel">`;
    html += `<div class="form-group"><label>${esc(t('txt_player_name_label'))}</label>`;
    html += `<input type="text" id="edit-name" value="${esc(_profile.name || '')}" autocomplete="name"></div>`;
    html += `<div class="form-group"><label>${esc(t('txt_player_email_label'))}</label>`;
    html += `<input type="email" id="edit-email" value="${esc(_profile.email || '')}" autocomplete="email"></div>`;
    html += `<div class="form-group"><label>${esc(t('txt_player_contact_label'))}</label>`;
    html += `<input type="text" id="edit-contact" value="${esc(_profile.contact || '')}" autocomplete="tel" placeholder="e.g. +34 600 000 000"></div>`;

    if (_errorMsg) html += `<div class="error-msg">${esc(_errorMsg)}</div>`;
    html += `<div class="player-edit-actions">`;
    html += `<button type="button" id="save-profile-btn" class="btn btn-primary btn-sm" onclick="_doSaveProfile()">${esc(t('txt_player_save_btn'))}</button>`;
    html += `<button type="button" class="btn btn-secondary btn-sm" onclick="_toggleEditProfile()">✕</button>`;
    html += `</div></div>`;
  }

  // Post-create success notice (passphrase already shown in strip above)
  if (_successMsg && !_editMode) {
    html += `<div class="card">`;
    html += `<div class="success-msg">${esc(_successMsg)}</div>`;
    html += `</div>`;
  }

  if (emailUnverified) {
    html += `<div class="card player-verification-card">`;
    html += `<div class="player-verification-title">${esc(t('txt_player_email_unverified_section_title'))}</div>`;
    html += `<div class="profile-verify-help">${esc(t('txt_player_email_unverified_help'))}</div>`;
    html += `<div class="player-verification-actions">`;
    html += `<button type="button" class="btn btn-sm btn-primary" onclick="_doResendVerification()">${esc(t('txt_player_send_verification_email_btn'))}</button>`;
    html += `</div>`;
    html += `</div>`;
  }

  // Career stats card — shown only when there is finished history
  html += _buildGlobalStatsCard();
  html += _buildEloHistoryCard();

  // Active section
  html += `<div class="player-section-header">`;
  html += `<div class="section-heading">${esc(t('txt_player_active'))}</div>`;
  html += `<button type="button" class="player-link-existing-btn" onclick="_openLinkModal()">+ ${esc(t('txt_player_link_btn'))}</button>`;
  html += `</div>`;
  if (active.length === 0) {
    html += `<div class="empty-state">${esc(t('txt_player_no_active'))}</div>`;
  } else {
    for (const entry of active) {
      html += _buildEntryCard(entry);
    }
  }

  // History (collapsed by default, persisted)
  const historyOpenAttr = _isHistoryPanelOpen() ? ' open' : '';
  html += `<details class="player-history-panel" ontoggle="_rememberHistoryPanelOpen(this)"${historyOpenAttr}>`;
  html += `<summary class="player-history-summary"><span class="player-history-chevron">▶</span><span class="section-heading section-heading-inline">${esc(t('txt_player_finished'))}</span></summary>`;
  html += `<div class="player-history-body">`;

  if (history.length === 0) {
    html += `<div class="empty-state">${esc(t('txt_player_no_history'))}</div>`;
  } else {
    for (const entry of history) {
      html += _buildEntryCard(entry);
    }
  }

  html += `</div>`;
  html += `</details>`;

  return html;
}

function _rememberHistoryPanelOpen(detailsEl) {
  _setHistoryPanelOpen(!!detailsEl?.open);
}

function _rememberEloHistoryPanelOpen(detailsEl) {
  _setEloHistoryPanelOpen(!!detailsEl?.open);
}

function _buildStatsCardForEntries(entries, heading) {
  let totalTournaments = 0, totalWins = 0, totalLosses = 0, totalDraws = 0;
  const partnerMap = {};
  const rivalMap = {};

  for (const e of entries) {
    const games = (e.wins || 0) + (e.losses || 0) + (e.draws || 0);
    if (games > 0 || e.entity_type === 'tournament') {
      totalTournaments++;
      totalWins   += e.wins   || 0;
      totalLosses += e.losses || 0;
      totalDraws  += e.draws  || 0;
    }
    const partners = (e.all_partners && e.all_partners.length > 0) ? e.all_partners : (e.top_partners || []);
    const rivals = (e.all_rivals && e.all_rivals.length > 0) ? e.all_rivals : (e.top_rivals || []);
    for (const p of partners) {
      if (!partnerMap[p.name]) partnerMap[p.name] = {games: 0, wins: 0};
      partnerMap[p.name].games += p.games || 0;
      partnerMap[p.name].wins  += p.wins  || 0;
    }
    for (const r of rivals) {
      if (!rivalMap[r.name]) rivalMap[r.name] = {games: 0, wins: 0};
      rivalMap[r.name].games += r.games || 0;
      rivalMap[r.name].wins  += r.wins  || 0;
    }
  }

  const totalGames = totalWins + totalLosses + totalDraws;
  if (totalTournaments === 0) return '';

  const winRate = totalGames > 0 ? Math.round(totalWins / totalGames * 100) : null;

  const toRanked = (map) => Object.entries(map)
    .map(([name, s]) => ({ name, games: s.games, wins: s.wins, win_pct: s.games > 0 ? Math.round(s.wins / s.games * 100) : 0 }))
    .filter(e => e.games > 0);
  const topPartners = toRanked(partnerMap).sort((a, b) => b.win_pct - a.win_pct || b.wins - a.wins).slice(0, 3);
  const topRivals   = toRanked(rivalMap).sort((a, b) => a.win_pct - b.win_pct || b.games - a.games).slice(0, 3);
  const participantMap = {};

  for (const [name, stats] of Object.entries(partnerMap)) {
    participantMap[name] = { name, together_games: stats.games, together_wins: stats.wins, against_games: 0, against_wins: 0 };
  }
  for (const [name, stats] of Object.entries(rivalMap)) {
    if (!participantMap[name]) {
      participantMap[name] = { name, together_games: 0, together_wins: 0, against_games: 0, against_wins: 0 };
    }
    participantMap[name].against_games = stats.games;
    participantMap[name].against_wins = stats.wins;
  }
  const participantRows = Object.values(participantMap)
    .filter(row => (row.together_games + row.against_games) > 0)
    .sort((a, b) => {
      const gamesA = a.together_games + a.against_games;
      const gamesB = b.together_games + b.against_games;
      if (gamesA !== gamesB) return gamesB - gamesA;
      return a.name.localeCompare(b.name);
    });

  const fmt = arr => arr.map(p => `${esc(p.name)} <em>${p.win_pct}%</em>`).join(', ');
  let html = `<div class="card global-stats-card">`;
  html += `<div class="section-heading section-heading-card">${esc(heading)}</div>`;
  html += `<div class="global-stats-grid">`;
  html += `<div class="global-stats-cell"><div class="global-stats-value">${totalTournaments}</div><div class="global-stats-label">${esc(t('txt_player_career_played'))}</div></div>`;
  html += `<div class="global-stats-divider"></div>`;
  html += `<div class="global-stats-cell"><div class="global-stats-value">${totalWins}</div><div class="global-stats-label">${esc(t('txt_player_career_wins'))}</div></div>`;
  html += `<div class="global-stats-cell"><div class="global-stats-value">${totalLosses}</div><div class="global-stats-label">${esc(t('txt_player_career_losses'))}</div></div>`;
  if (winRate !== null) html += `<div class="global-stats-cell"><div class="global-stats-value">${winRate}%</div><div class="global-stats-label">${esc(t('txt_player_career_win_rate'))}</div></div>`;
  html += `</div>`;

  if (topPartners.length > 0 || topRivals.length > 0) {
    html += `<div class="entry-card-social entry-card-social-spaced">`;
    if (topPartners.length > 0) html += `<span>${esc(t('txt_player_best_partners'))}: ${fmt(topPartners)}</span>`;
    if (topPartners.length > 0 && topRivals.length > 0) html += ` &middot; `;
    if (topRivals.length > 0)   html += `<span>${esc(t('txt_player_toughest_rivals'))}: ${fmt(topRivals)}</span>`;
    html += `</div>`;
  }

  html += _buildParticipantExplorer(participantRows);

  html += `</div>`;
  return html;
}

function _formatRankLabel(rank) {
  if (!rank) return null;
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function _bestAchievements(entries) {
  let bestGroupRank = null;
  let bestGroupRankTournament = null;
  let bestPlayoffStage = null;
  let bestPlayoffStageRank = null;
  let bestPlayoffStageTournament = null;

  for (const e of entries) {
    if (e.rank && e.rank > 0 && (bestGroupRank === null || e.rank < bestGroupRank)) {
      bestGroupRank = e.rank;
      bestGroupRankTournament = e.entity_name || null;
    }
    if (e.playoff_stage && e.playoff_stage_rank != null) {
      if (bestPlayoffStageRank === null || e.playoff_stage_rank < bestPlayoffStageRank) {
        bestPlayoffStageRank = e.playoff_stage_rank;
        bestPlayoffStage = e.playoff_stage;
        bestPlayoffStageTournament = e.entity_name || null;
      }
    }
  }

  return {
    bestGroupRank,
    bestGroupRankTournament,
    bestPlayoffStage,
    bestPlayoffStageTournament,
  };
}

function _buildBestResultsCardForEntries(entries, heading) {
  const { bestGroupRank, bestGroupRankTournament, bestPlayoffStage, bestPlayoffStageTournament } = _bestAchievements(entries);
  const groupRankLabel = _formatRankLabel(bestGroupRank);
  if (!groupRankLabel && !bestPlayoffStage) return '';

  let html = `<div class="card global-stats-card">`;
  html += `<div class="section-heading section-heading-card">${esc(heading)}</div>`;
  html += `<div class="global-stats-grid">`;
  if (groupRankLabel) {
    html += `<div class="global-stats-cell"><div class="global-stats-value">${groupRankLabel}</div><div class="global-stats-label">${esc(t('txt_player_career_best_group_rank'))}</div>`;
    if (bestGroupRankTournament) html += `<div class="global-stats-tournament">${esc(bestGroupRankTournament)}</div>`;
    html += `</div>`;
  }
  if (bestPlayoffStage) {
    html += `<div class="global-stats-cell"><div class="global-stats-value">${esc(bestPlayoffStage)}</div><div class="global-stats-label">${esc(t('txt_player_career_best_playoff_stage'))}</div>`;
    if (bestPlayoffStageTournament) html += `<div class="global-stats-tournament">${esc(bestPlayoffStageTournament)}</div>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _formatParticipantStat(games, wins) {
  if (!games) return t('txt_player_participant_no_data');
  const winPct = Math.round((wins / games) * 100);
  return t('txt_player_participant_stat_line', { games, win_pct: winPct });
}

function _participantSearchKey(value) {
  return (value || '').toLowerCase().trim();
}

function _sortParticipantDataRows(rows, mode) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const aTotalGames = (a.together_games || 0) + (a.against_games || 0);
    const bTotalGames = (b.together_games || 0) + (b.against_games || 0);
    const aTotalWins = (a.together_wins || 0) + (a.against_wins || 0);
    const bTotalWins = (b.together_wins || 0) + (b.against_wins || 0);
    const aWinRate = aTotalGames > 0 ? Math.round((aTotalWins / aTotalGames) * 100) : 0;
    const bWinRate = bTotalGames > 0 ? Math.round((bTotalWins / bTotalGames) * 100) : 0;

    if (mode === 'name') return a.name.localeCompare(b.name);
    if (mode === 'together') {
      const diff = (b.together_games || 0) - (a.together_games || 0);
      return diff || a.name.localeCompare(b.name);
    }
    if (mode === 'against') {
      const diff = (b.against_games || 0) - (a.against_games || 0);
      return diff || a.name.localeCompare(b.name);
    }
    if (mode === 'win_rate') {
      const diff = bWinRate - aWinRate;
      if (diff) return diff;
      const gamesDiff = bTotalGames - aTotalGames;
      return gamesDiff || a.name.localeCompare(b.name);
    }
    const diff = bTotalGames - aTotalGames;
    return diff || a.name.localeCompare(b.name);
  });
  return sorted;
}

function _buildParticipantExplorer(rows) {
  if (!rows.length) return '';

  const lookupState = _getParticipantLookupState();
  const queryRaw = lookupState.query || '';
  const query = _participantSearchKey(queryRaw);
  const sortMode = _participantSortModeOrDefault(lookupState.sort);
  const renderRows = _sortParticipantDataRows(rows, sortMode);
  const openAttr = lookupState.open ? ' open' : '';
  let visibleRows = 0;

  let html = `<details class="player-participant-explorer" ontoggle="_rememberParticipantLookupOpen(this)"${openAttr}>`;
  html += `<summary class="player-participant-summary"><span class="player-participant-chevron">▶</span>${esc(t('txt_player_participant_lookup_title'))}</summary>`;
  html += '<div class="player-participant-body">';
  html += `<div class="player-participant-controls">`;
  html += `<input type="text" class="player-participant-search" value="${esc(queryRaw)}" placeholder="${esc(t('txt_player_participant_search_placeholder'))}" aria-label="${esc(t('txt_player_participant_search_aria'))}" oninput="_onParticipantFilterInput(this)">`;
  html += `<label class="player-participant-sort-label">${esc(t('txt_player_participant_sort_label'))}</label>`;
  html += `<select class="player-participant-sort" aria-label="${esc(t('txt_player_participant_sort_aria'))}" onchange="_onParticipantSortChange(this)">`;
  html += `<option value="interactions"${sortMode === 'interactions' ? ' selected' : ''}>${esc(t('txt_player_participant_sort_interactions'))}</option>`;
  html += `<option value="together"${sortMode === 'together' ? ' selected' : ''}>${esc(t('txt_player_participant_sort_together'))}</option>`;
  html += `<option value="against"${sortMode === 'against' ? ' selected' : ''}>${esc(t('txt_player_participant_sort_against'))}</option>`;
  html += `<option value="win_rate"${sortMode === 'win_rate' ? ' selected' : ''}>${esc(t('txt_player_participant_sort_win_rate'))}</option>`;
  html += `<option value="name"${sortMode === 'name' ? ' selected' : ''}>${esc(t('txt_player_participant_sort_name'))}</option>`;
  html += `</select>`;
  html += `</div>`;
  html += '<div class="player-participant-list">';
  html += `<div class="player-participant-row player-participant-row-header">`;
  html += `<span>${esc(t('txt_player_participant_col_player'))}</span>`;
  html += `<span>${esc(t('txt_player_participant_col_together'))}</span>`;
  html += `<span>${esc(t('txt_player_participant_col_against'))}</span>`;
  html += `</div>`;

  for (const row of renderRows) {
    const searchKey = _participantSearchKey(row.name);
    const isVisible = !query || searchKey.includes(query);
    if (isVisible) visibleRows++;
    const totalGames = (row.together_games || 0) + (row.against_games || 0);
    const totalWins = (row.together_wins || 0) + (row.against_wins || 0);
    const totalWinRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
    html += `<div class="player-participant-row${isVisible ? '' : ' is-hidden'}" data-name="${esc(searchKey)}" data-together-games="${row.together_games || 0}" data-against-games="${row.against_games || 0}" data-total-games="${totalGames}" data-total-win-rate="${totalWinRate}">`;
    html += `<span class="player-participant-name">${esc(row.name)}</span>`;
    html += `<span class="player-participant-stat"><span class="player-participant-mobile-label">${esc(t('txt_player_participant_mobile_with'))}:</span>${esc(_formatParticipantStat(row.together_games, row.together_wins))}</span>`;
    html += `<span class="player-participant-stat"><span class="player-participant-mobile-label">${esc(t('txt_player_participant_mobile_vs'))}:</span>${esc(_formatParticipantStat(row.against_games, row.against_wins))}</span>`;
    html += `</div>`;
  }

  html += `</div>`;
  html += `<div class="player-participant-empty${visibleRows > 0 ? ' is-hidden' : ''}">${esc(t('txt_player_participant_no_results'))}</div>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _rememberParticipantLookupOpen(detailsEl) {
  _setParticipantLookupState({ open: !!detailsEl?.open });
}

function _onParticipantFilterInput(inputEl) {
  _filterParticipantRows(inputEl);
  _setParticipantLookupState({ query: inputEl?.value || '' });
}

function _onParticipantSortChange(selectEl) {
  _sortParticipantRows(selectEl);
  _setParticipantLookupState({ sort: selectEl?.value || 'interactions' });
}

function _filterParticipantRows(inputEl) {
  const query = _participantSearchKey(inputEl?.value || '');
  const root = inputEl?.closest('.player-participant-explorer');
  if (!root) return;

  const rows = Array.from(root.querySelectorAll('.player-participant-row[data-name]'));
  let visibleRows = 0;
  for (const row of rows) {
    const key = row.getAttribute('data-name') || '';
    const isVisible = !query || key.includes(query);
    row.classList.toggle('is-hidden', !isVisible);
    if (isVisible) visibleRows++;
  }

  const empty = root.querySelector('.player-participant-empty');
  if (empty) empty.classList.toggle('is-hidden', visibleRows > 0);
}

function _sortParticipantRows(selectEl) {
  const mode = selectEl?.value || 'interactions';
  const root = selectEl?.closest('.player-participant-explorer');
  if (!root) return;
  const list = root.querySelector('.player-participant-list');
  if (!list) return;

  const rows = Array.from(list.querySelectorAll('.player-participant-row[data-name]'));
  const cmpName = (a, b) => (a.getAttribute('data-name') || '').localeCompare(b.getAttribute('data-name') || '');
  const num = (el, key) => Number(el.getAttribute(key) || 0);

  rows.sort((a, b) => {
    if (mode === 'name') return cmpName(a, b);
    if (mode === 'together') {
      const diff = num(b, 'data-together-games') - num(a, 'data-together-games');
      return diff || cmpName(a, b);
    }
    if (mode === 'against') {
      const diff = num(b, 'data-against-games') - num(a, 'data-against-games');
      return diff || cmpName(a, b);
    }
    if (mode === 'win_rate') {
      const diff = num(b, 'data-total-win-rate') - num(a, 'data-total-win-rate');
      if (diff) return diff;
      const gamesDiff = num(b, 'data-total-games') - num(a, 'data-total-games');
      return gamesDiff || cmpName(a, b);
    }
    const diff = num(b, 'data-total-games') - num(a, 'data-total-games');
    return diff || cmpName(a, b);
  });

  for (const row of rows) list.appendChild(row);
}

function _buildGlobalStatsCard() {
  const withStats = _entries.filter(e => {
    if (e.status === 'finished') return true;
    // Include active entries that have live stats from round completions
    return (e.wins || 0) + (e.losses || 0) + (e.draws || 0) > 0;
  });
  if (withStats.length === 0) return '';

  // Group entries with stats by sport
  const bySport = {};
  for (const e of withStats) {
    const sport = e.sport || 'padel';
    if (!bySport[sport]) bySport[sport] = [];
    bySport[sport].push(e);
  }

  const sports = Object.keys(bySport);
  let html = '';

  if (sports.length === 1) {
    // Single sport — use generic heading
    html += _buildStatsCardForEntries(withStats, t('txt_player_career_stats'));
    html += _buildBestResultsCardForEntries(withStats, t('txt_player_career_best_results'));
  } else {
    // Multiple sports — one card per sport with sport-qualified heading
    for (const sport of sports) {
      const sportLabel = _sportLabel(sport);
      const statsHeading = t('txt_player_career_stats_sport').replace('{sport}', sportLabel);
      const bestResultsHeading = t('txt_player_career_best_results_sport').replace('{sport}', sportLabel);
      html += _buildStatsCardForEntries(bySport[sport], statsHeading);
      html += _buildBestResultsCardForEntries(bySport[sport], bestResultsHeading);
    }
  }

  return html;
}

function _formatEloHistoryScore(match) {
  if (Array.isArray(match.sets) && match.sets.length > 0) {
    return match.sets.map(s => `${s[0]}-${s[1]}`).join(', ');
  }
  if (Array.isArray(match.score) && match.score.length === 2) {
    return `${match.score[0]}-${match.score[1]}`;
  }
  return '—';
}

function _findCurrentPlayerEloChange(match) {
  const allPlayers = [...(match.team1 || []), ...(match.team2 || [])];
  const current = allPlayers.find((p) => match.player_id && p.player_id === match.player_id);
  if (!current) return null;
  const before = Number(current.elo_before);
  const after = Number(current.elo_after);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return { before: Math.round(before), after: Math.round(after), delta: Math.round(after - before) };
}

function _formatEloTeamSide(players, currentPid) {
  if (!Array.isArray(players) || players.length === 0) return '<span class="elo-team-player">—</span>';
  return players.map((p, idx) => {
    const d = Math.round((p.elo_after || 0) - (p.elo_before || 0));
    const isCurrent = currentPid && p.player_id === currentPid;
    const cls = isCurrent ? (d > 0 ? 'elo-delta--gain' : d < 0 ? 'elo-delta--loss' : 'elo-delta--neutral') : 'elo-delta--dim';
    const joiner = idx < players.length - 1 ? '<span class="elo-team-join">&amp;</span>' : '';
    return `<span class="elo-team-player">${esc(p.player_name)}<span class="elo-player-rating">${Math.round(p.elo_before)}</span><span class="elo-player-delta ${cls}">${d > 0 ? '+' : ''}${d}</span>${joiner}</span>`;
  }).join('');
}

function _formatEloTeamVsLine(team1, team2, currentPid, scoreStr) {
  const mid = scoreStr ? `<span class="elo-score-sep">${esc(scoreStr)}</span>` : `<span class="elo-vs-sep">vs</span>`;
  return `<span class="elo-team elo-team--a">${_formatEloTeamSide(team1, currentPid)}</span>${mid}<span class="elo-team elo-team--b">${_formatEloTeamSide(team2, currentPid)}</span>`;
}

function _setEloHistorySport(sport) {
  _eloHistorySport = sport;
  _render();
}

function _buildEloHistoryCard() {
  const settings = _getEloHistorySettings();
  const openAttr = _isEloHistoryPanelOpen() ? ' open' : '';
  let html = `<details class="player-history-panel" ontoggle="_rememberEloHistoryPanelOpen(this)"${openAttr}>`;
  html += `<summary class="player-history-summary"><span class="player-history-chevron">▶</span><span class="section-heading section-heading-inline">${esc(t('txt_player_elo_history'))}</span></summary>`;
  html += `<div class="player-history-body">`;

  // Sport toggle pills (only when both sports have history)
  const hasPadel = _eloHistory.some(m => m.sport === 'padel');
  const hasTennis = _eloHistory.some(m => m.sport === 'tennis');
  const activeSport = (hasPadel && hasTennis) ? _eloHistorySport : (hasPadel ? 'padel' : 'tennis');
  if (hasPadel && hasTennis) {
    html += `<div class="leaderboard-sport-toggle">`;
    html += `<button type="button" class="leaderboard-pill${activeSport === 'padel' ? ' leaderboard-pill--active' : ''}" onclick="event.stopPropagation(); _setEloHistorySport('padel')">Padel</button>`;
    html += `<button type="button" class="leaderboard-pill${activeSport === 'tennis' ? ' leaderboard-pill--active' : ''}" onclick="event.stopPropagation(); _setEloHistorySport('tennis')">Tennis</button>`;
    html += `</div>`;
  }

  html += `<div class="player-elo-controls">`;
  html += `<label class="player-elo-control-label">${esc(t('txt_player_elo_show_last'))}</label>`;
  html += `<select class="player-elo-control-select" onchange="_onEloHistoryLimitChange(this)">`;
  html += `<option value="5"${settings.limit === 5 ? ' selected' : ''}>5</option>`;
  html += `<option value="10"${settings.limit === 10 ? ' selected' : ''}>10</option>`;
  html += `<option value="20"${settings.limit === 20 ? ' selected' : ''}>20</option>`;
  html += `<option value="50"${settings.limit === 50 ? ' selected' : ''}>50</option>`;
  html += `</select>`;
  html += `</div>`;

  const filtered = _eloHistory.filter(m => m.sport === activeSport);

  if (!filtered.length) {
    html += `<div class="empty-state">${esc(t('txt_player_elo_no_history'))}</div>`;
    html += `</div></details>`;
    return html;
  }

  html += `<div class="elo-log">`;
  for (const match of filtered) {
    const url = _entityUrl({ entity_type: 'tournament', entity_id: match.tournament_id, alias: match.tournament_alias });
    const when = match.updated_at
      ? new Date(match.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      : '';
    const change = _findCurrentPlayerEloChange(match);
    const changeClass = change
      ? (change.delta > 0 ? 'elo-transition--gain' : change.delta < 0 ? 'elo-transition--loss' : 'elo-transition--neutral')
      : 'elo-transition--neutral';
    const changeText = change ? `${change.before} -> ${change.after}` : '->';
    html += `<div class="elo-log-row">`;
    html += `<div class="elo-log-main">`;
    html += `<a href="${esc(url)}" class="elo-log-name">${esc(match.tournament_name || match.tournament_id)}</a>`;
    if (match.match_order) html += `<span class="elo-log-dim">#${match.match_order}</span>`;
    if (when) html += `<span class="elo-log-dim">${esc(when)}</span>`;
    html += `<span class="elo-transition ${changeClass}">${esc(changeText)}</span>`;
    html += `</div>`;
    html += `<div class="elo-log-teams">${_formatEloTeamVsLine(match.team1, match.team2, match.player_id, _formatEloHistoryScore(match))}</div>`;
    html += `</div>`;
  }
  html += `</div>`;

  html += `</div></details>`;
  return html;
}

async function _onEloHistoryLimitChange(selectEl) {
  const limit = _eloHistoryLimitOrDefault(selectEl?.value);
  _setEloHistorySettings({ limit });
  await _refreshSpaceNow();
}

function _buildEntryCard(entry) {
  const url = _entityUrl(entry);
  const isFinished = entry.status === 'finished';
  const canViewFinishedTournament = !(isFinished && entry.entity_type === 'tournament' && entry.entity_deleted);
  const canUnlink = entry.entity_type === 'tournament';
  const canShowPath = _supportsPath(entry);
  const isPathOpen = canShowPath ? _isPathOpen(entry) : false;
  let html = `<div class="entry-card${isFinished ? ' finished' : ''}">`;
  html += `<div class="entry-card-info">`;
  html += `<div class="entry-card-title-row">`;
  if (canViewFinishedTournament) {
    html += `<a href="${esc(url)}" class="entry-card-name entry-card-name--link">${esc(entry.entity_name)}</a>`;
  } else {
    html += `<div class="entry-card-name">${esc(entry.entity_name)}</div>`;
  }
  if (canUnlink) {
    html += `<button type="button" class="entry-card-unlink-inline" onclick="_doUnlink('${esc(entry.entity_type)}','${esc(entry.entity_id)}',${isFinished})">${esc(t('txt_player_unlink_btn'))}</button>`;
  }
  html += `</div>`;
  html += `<div class="entry-card-badges">`;
  html += `<span class="badge badge-sport">${esc(_sportLabel(entry.sport))}</span>`;
  html += `<span class="badge badge-type">${esc(_typeLabel(entry.tournament_type))}</span>`;
  if (isFinished && entry.finished_at) {
    const d = new Date(entry.finished_at);
    html += `<span class="badge badge-finished">${esc(d.toLocaleDateString())}</span>`;
  }
  html += `</div>`;
  if (entry.player_name) html += `<div class="entry-card-meta">${esc(entry.player_name)}</div>`;
  const hasStats =
    (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0) > 0 ||
    (entry.rank != null && entry.rank > 0) ||
    !!entry.playoff_stage ||
    (entry.elo_before != null && entry.elo_after != null);
  if (isFinished || hasStats) {
    const statsLine = _buildStatsLine(entry);
    if (statsLine) html += `<div class="entry-card-stats">${statsLine}</div>`;
  }
  if (isFinished) {
    const social = _buildPartnerRivalSection(entry);
    if (social) html += social;
  }
  if (canShowPath) {
    const pathBtnText = isPathOpen ? t('txt_player_path_hide') : t('txt_player_path_show');
    html += `<div class="entry-card-path-row"><button type="button" class="entry-card-path-btn" onclick="_togglePath('${esc(entry.entity_id)}','${esc(entry.player_id)}')">${esc(pathBtnText)}</button></div>`;
  }
  if (_supportsPath(entry) && _isPathOpen(entry)) {
    html += _buildPathPanel(entry);
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _buildStatsLine(entry) {
  const hasRank = entry.rank != null && entry.rank > 0;
  const hasPlayoffStage = !!entry.playoff_stage;
  const hasWL = (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0) > 0;
  const parts = [];
  if (hasRank) {
    const suffix = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`;
    const of = entry.total_players ? ` ${t('txt_player_stats_of')} ${entry.total_players}` : '';
    parts.push(`${suffix}${of}`);
  } else if (hasPlayoffStage) {
    parts.push(entry.playoff_stage);
  }
  if (hasWL) {
    let wl = `${entry.wins || 0}W`;
    if (entry.losses) wl += ` ${entry.losses}L`;
    if (entry.draws) wl += ` ${entry.draws}D`;
    parts.push(wl);
  }
  if (entry.elo_before != null && entry.elo_after != null) {
    const delta = Math.round(entry.elo_after - entry.elo_before);
    const sign = delta >= 0 ? '+' : '';
    parts.push(`ELO ${sign}${delta}`);
  }
  return parts.join(' · ');
}

function _buildPartnerRivalSection(entry) {
  const partners = entry.top_partners || [];
  const rivals = entry.top_rivals || [];
  if (!partners.length && !rivals.length) return '';
  const fmt = (arr) => arr.map(p => `${esc(p.name)} <em>${p.win_pct}%</em>`).join(', ');
  let html = '<div class="entry-card-social">';
  if (partners.length) {
    html += `<span>${esc(t('txt_player_best_partners'))}: ${fmt(partners)}</span>`;
  }
  if (rivals.length) {
    if (partners.length) html += ' &middot; ';
    html += `<span>${esc(t('txt_player_toughest_rivals'))}: ${fmt(rivals)}</span>`;
  }
  html += '</div>';
  return html;
}

function _buildLinkModal() {
  let html = `<div class="modal-overlay" onclick="_closeLinkModal(event)">`;
  html += `<div class="modal-box" onclick="event.stopPropagation()">`;
  html += `<div class="modal-title">${esc(t('txt_player_link_title'))}</div>`;
  html += `<p class="player-link-modal-help">${esc(t('txt_player_link_tutorial'))}</p>`;
  html += `<div class="form-group"><label>${esc(t('txt_player_link_entity_type'))}</label>`;
  html += `<select id="link-type"><option value="tournament">${esc(t('txt_player_link_type_tournament'))}</option><option value="registration">${esc(t('txt_player_link_type_registration'))}</option></select></div>`;
  html += `<div class="form-group"><label>${esc(t('txt_player_link_entity_id'))}</label>`;
  html += `<input type="text" id="link-entity-id" placeholder="e.g. tournament UUID, alias, or registration ID" autocomplete="off"></div>`;
  html += `<div class="form-group"><label>${esc(t('txt_player_link_passphrase'))}</label>`;
  html += `<input type="text" id="link-passphrase" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>`;
  if (_errorMsg) html += `<div class="error-msg">${esc(_errorMsg)}</div>`;
  if (_successMsg) html += `<div class="success-msg">${esc(_successMsg)}</div>`;
  html += `<div class="player-link-modal-actions">`;
  html += `<button type="button" class="player-link-existing-btn player-link-modal-submit" onclick="_doLink()">${esc(t('txt_player_link_submit'))}</button>`;
  html += `<button type="button" class="btn btn-secondary btn-sm" onclick="_closeLinkModal(null)">✕</button>`;
  html += `</div>`;
  html += `</div></div>`;
  return html;
}

// ── Actions ───────────────────────────────────────────────

function _goBackToPassphrase() {
  _authStep = 'passphrase';
  _resolveResult = null;
  _resolvedPassphrase = '';
  _errorMsg = '';
  _render();
}

async function _doResolve() {
  const input = document.getElementById('ps-passphrase');
  const passphrase = (input?.value || '').trim();
  if (!passphrase) return;
  _errorMsg = '';
  _resolving = true;
  _render();
  try {
    const result = await _apiPost('/resolve', { passphrase });
    _resolveResult = result;
    _resolvedPassphrase = passphrase;

    if (result.type === 'profile') {
      // Auto-login immediately
      try {
        const data = await _apiPost('/login', { passphrase });
        _jwt = data.access_token;
        _profile = data.profile;
        _successMsg = '';
        _saveSession();
        await _fetchSpace();
        _resolving = false;
        _render();
      } catch (loginErr) {
        _resolving = false;
        _errorMsg = loginErr.message || t('txt_player_wrong_passphrase');
        _render();
      }
    } else if (result.type === 'participation') {
      _authStep = 'create';
      _resolving = false;
      _render();
    } else {
      _resolving = false;
      _errorMsg = t('txt_player_not_found');
      _render();
    }
  } catch (err) {
    _resolving = false;
    _errorMsg = err.message;
    _render();
  }
}

async function _doLogin() {
  const input = document.getElementById('ps-passphrase');
  const passphrase = (input?.value || '').trim();
  if (!passphrase) return;
  _errorMsg = '';
  try {
    const data = await _apiPost('/login', { passphrase });
    _jwt = data.access_token;
    _profile = data.profile;
    _successMsg = '';
    _saveSession();
    await _fetchSpace();
    _render();
  } catch (err) {
    _errorMsg = err.message || t('txt_player_wrong_passphrase');
    _render();
  }
}

async function _doRecover() {
  const email = (document.getElementById('ps-recover-email')?.value || '').trim();
  if (!email) return;
  try {
    await _apiPost('/recover', { email });
  } catch (_) { /* always show success to prevent enumeration */ }
  _recoverSent = true;
  _render();
}

async function _doResendVerification() {
  _errorMsg = '';
  _successMsg = '';
  _render();
  try {
    const res = await _apiPost('/resend-verification', {}, _jwt);
    if (res?.already_verified) {
      _successMsg = t('txt_player_email_already_verified');
    } else {
      _successMsg = t('txt_player_resend_verification_sent');
    }
    await _fetchSpace();
    _render();
  } catch (err) {
    _errorMsg = err.message || t('txt_player_resend_verification_error');
    _render();
  }
}

async function _doCreate() {
  const participantPp = _resolvedPassphrase;
  const name = (document.getElementById('ps-name')?.value || '').trim();
  const email = (document.getElementById('ps-email')?.value || '').trim();
  const contact = (document.getElementById('ps-contact')?.value || '').trim();
  _errorMsg = '';
  if (!participantPp) {
    _errorMsg = t('txt_player_participant_pp_required');
    _render();
    return;
  }
  if (!email) {
    _errorMsg = t('txt_player_email_required');
    _render();
    return;
  }
  try {
    const data = await _apiPost('', { participant_passphrase: participantPp, name, email, contact });
    _jwt = data.access_token;
    _profile = data.profile;
    _entries = data.entries || [];
    _setPassphraseEmailedMsg(t('txt_player_passphrase_emailed', { email: data.profile.email }));
    _showPassphrase = true;
    _saveSession();
    _render();
  } catch (err) {
    _errorMsg = err.message;
    _render();
  }
}

function _doLogout() {
  _clearSession();
  _clearPassphraseEmailedMsgTimer();
  _passphraseEmailedMsg = '';
  _errorMsg = '';
  _successMsg = '';
  _editMode = false;
  _render();
}

function _toggleEditProfile() {
  _editMode = !_editMode;
  _errorMsg = '';
  _successMsg = '';
  _render();
}

function _togglePassphrase() {
  _showPassphrase = !_showPassphrase;
  _render();
}

async function _doSaveProfile() {
  const name = (document.getElementById('edit-name')?.value || '').trim();
  const email = (document.getElementById('edit-email')?.value || '').trim();
  const contact = (document.getElementById('edit-contact')?.value || '').trim();
  _errorMsg = '';
  try {
    const updated = await _apiPut('', { name, email, contact }, _jwt);
    _profile = { ..._profile, ...updated };
    _saveSession();
    const btn = document.getElementById('save-profile-btn');
    if (btn) {
      btn.textContent = '✓ ' + t('txt_player_save_btn');
      btn.classList.add('btn-save-success');
      setTimeout(() => btn.classList.add('fade-out'), 1200);
      setTimeout(() => {
        btn.textContent = t('txt_player_save_btn');
        btn.classList.remove('btn-save-success', 'fade-out');
      }, 1800);
    }
  } catch (err) {
    _errorMsg = err.message;
    _render();
  }
}

function _openLinkModal() {
  _showLinkModal = true;
  _errorMsg = '';
  _successMsg = '';
  _render();
}

async function _doUnlink(entityType, entityId, isFinished) {
  const msg = isFinished
    ? t('txt_player_unlink_confirm_finished')
    : t('txt_player_unlink_confirm_active');
  if (!confirm(msg)) return;
  try {
    await _apiDelete('/unlink', { entity_type: entityType, entity_id: entityId }, _jwt);
    await _fetchSpace();
    _render();
  } catch (err) {
    alert(err.message);
  }
}

function _closeLinkModal(event) {
  if (event && event.type === 'click' && event.target !== event.currentTarget) return;
  _showLinkModal = false;
  _errorMsg = '';
  _successMsg = '';
  _render();
}

async function _doLink() {
  const entityType = document.getElementById('link-type')?.value || 'tournament';
  const entityId = (document.getElementById('link-entity-id')?.value || '').trim();
  const passphrase = (document.getElementById('link-passphrase')?.value || '').trim();
  _errorMsg = '';
  _successMsg = '';
  if (!entityId || !passphrase) return;
  try {
    const entry = await _apiPost('/link', { entity_type: entityType, entity_id: entityId, passphrase }, _jwt);
    _entries = [..._entries.filter(e => !(e.entity_type === entry.entity_type && e.entity_id === entry.entity_id)), entry];
    _successMsg = t('txt_player_link_success');
    _saveSession();
    _render();
  } catch (err) {
    _errorMsg = err.message;
    _render();
  }
}

// ── Keyboard support ──────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _showLinkModal) {
    _closeLinkModal(null);
  }
  if (e.key === 'Enter') {
    if (_showLinkModal) { _doLink(); return; }
    if (!_jwt && _authStep === 'passphrase') { _doResolve(); return; }
    if (!_jwt && _authStep === 'create') { _doCreate(); }
  }
});

// ── Bootstrap ─────────────────────────────────────────────
_init();
