/* ── Player Space page ──────────────────────────────────── */
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

let _jwt = null;
let _profile = null;
let _entries = [];
let _authTab = 'login'; // 'login' | 'create'
try { _authTab = localStorage.getItem('amistoso-player-auth-tab') || 'login'; } catch (_) {}
let _editMode = false;
let _showLinkModal = false;
let _showPassphrase = false;
let _recoverSent = false;
let _errorMsg = '';
let _successMsg = '';
let _spacePollTimer = null;
let _spacePollInFlight = false;
const SPACE_POLL_MS = 30000;

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

// ── Init ─────────────────────────────────────────────────

function _init() {
  // Check for JWT autologin via URL fragment (#token=<jwt>)
  // This is used by the welcome email's "Open Player Space" link.
  const _hashParams = new URLSearchParams(location.hash.slice(1));
  const _tokenFromHash = _hashParams.get('token');
  if (_tokenFromHash) {
    // Clear the fragment so the token isn't visible in the address bar
    history.replaceState(null, '', location.pathname + location.search);
    _jwt = _tokenFromHash;
    _fetchSpace()
      .then(() => _render())
      .catch(() => {
        _jwt = null;
        _profile = null;
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
    await _fetchSpace();
    const nextProfile = JSON.stringify(_profile || {});
    const nextEntries = JSON.stringify(_entries || []);
    if (prevProfile !== nextProfile || prevEntries !== nextEntries) {
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

async function _fetchSpace() {
  const data = await _apiGet('/space', _jwt);
  _jwt = data.access_token;
  _profile = data.profile;
  _entries = data.entries || [];
  _saveSession();
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

  // Tabs
  html += `<div class="auth-tabs">`;
  html += `<button type="button" class="auth-tab${_authTab === 'login' ? ' active' : ''}" onclick="_setAuthTab('login')">${esc(t('txt_player_login'))}</button>`;
  html += `<button type="button" class="auth-tab${_authTab === 'create' ? ' active' : ''}" onclick="_setAuthTab('create')">${esc(t('txt_player_create'))}</button>`;
  html += `</div>`;

  if (_authTab === 'login') {
    html += `<div class="form-group">
      <label>${esc(t('txt_player_passphrase_label'))}</label>
      <input type="text" id="ps-passphrase" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false">
    </div>`;
    if (_errorMsg) html += `<div class="error-msg">${esc(_errorMsg)}</div>`;
    html += `<button type="button" class="btn btn-primary btn-block" onclick="_doLogin()">${esc(t('txt_player_login_btn'))}</button>`;

    // Passphrase recovery
    html += `<details class="player-recover">`;
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
  } else {
    html += `<p class="player-auth-create-help">${esc(t('txt_player_participant_pp_help'))}</p>`;
    html += `<div class="form-group">
      <label>${esc(t('txt_player_participant_pp_label'))} <span class="required-mark">*</span></label>
      <input type="text" id="ps-participant-pp" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false">
    </div>`;
    html += `<div class="form-group">
      <label>${esc(t('txt_player_name_label'))}</label>
      <input type="text" id="ps-name" placeholder="" autocomplete="name">
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

function _buildDashboard() {
  const active = _entries.filter(e => e.status === 'active');
  const history = _entries.filter(e => e.status === 'finished');

  let html = ``;

  // Profile bar
  html += `<div class="profile-bar">`;
  html += `<div>`;
  const name = _profile.name || `ID: ${_profile.id.slice(0, 8)}`;
  html += `<div class="profile-bar-name">${esc(name)}</div>`;
  if (_profile.email) html += `<div class="profile-bar-meta">${esc(_profile.email)}</div>`;
  html += `</div>`;
  html += `<div class="player-profile-actions">`;
  html += `<button type="button" class="btn btn-sm btn-secondary" onclick="_toggleEditProfile()">${esc(t('txt_player_edit_btn'))}</button>`;
  html += `<button type="button" class="btn btn-sm btn-danger-outline" onclick="_doLogout()">${esc(t('txt_player_logout_btn'))}</button>`;
  html += `</div>`;
  html += `</div>`;

  // Compact passphrase strip (always visible)
  html += `<div class="passphrase-strip">`;
  html += `<span class="passphrase-strip-label">${esc(t('txt_player_your_passphrase'))}</span>`;
  html += `<span id="ps-phrase-text" class="passphrase-strip-text${_showPassphrase ? '' : ' passphrase-hidden'}">${esc(_profile.passphrase || '***')}</span>`;
  html += `<button type="button" class="btn btn-sm btn-secondary" onclick="_togglePassphrase()">${esc(_showPassphrase ? t('txt_player_hide_passphrase') : t('txt_player_reveal_passphrase'))}</button>`;
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
    if (_successMsg) html += `<div class="success-msg">${esc(_successMsg)}</div>`;
    html += `<div class="player-edit-actions">`;
    html += `<button type="button" class="btn btn-primary btn-sm" onclick="_doSaveProfile()">${esc(t('txt_player_save_btn'))}</button>`;
    html += `<button type="button" class="btn btn-secondary btn-sm" onclick="_toggleEditProfile()">✕</button>`;
    html += `</div></div>`;
  }

  // New passphrase reveal after create (only shown immediately post-create)
  if (_successMsg && !_editMode) {
    html += `<div class="card">`;
    html += `<div class="form-group"><label>${esc(t('txt_player_your_passphrase'))}</label>`;
    html += `<div class="passphrase-reveal-box">`;
    html += `<span class="passphrase-text">${esc(_profile.passphrase || '')}</span>`;
    html += `</div></div>`;
    html += `<div class="success-msg">${esc(_successMsg)}</div>`;
    html += `</div>`;
  }

  // Career stats card — shown only when there is finished history
  html += _buildGlobalStatsCard();

  // Active section
  html += `<div class="section-heading">${esc(t('txt_player_active'))}</div>`;
  if (active.length === 0) {
    html += `<div class="empty-state">${esc(t('txt_player_no_active'))}</div>`;
  } else {
    for (const entry of active) {
      html += _buildEntryCard(entry);
    }
  }

  // Link + history (collapsed by default, persisted)
  const historyOpenAttr = _isHistoryPanelOpen() ? ' open' : '';
  html += `<details class="player-history-panel" ontoggle="_rememberHistoryPanelOpen(this)"${historyOpenAttr}>`;
  html += `<summary class="player-history-summary"><span class="player-history-chevron">▶</span><span class="section-heading section-heading-inline">${esc(t('txt_player_finished'))}</span></summary>`;
  html += `<div class="player-history-body">`;
  html += `<div class="player-history-header">`;
  html += `<button type="button" class="btn btn-sm btn-secondary" onclick="_openLinkModal()">+ ${esc(t('txt_player_link_btn'))}</button>`;
  html += `</div>`;

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

function _buildStatsCardForEntries(entries, heading) {
  let totalTournaments = 0, totalWins = 0, totalLosses = 0, totalDraws = 0;
  let bestRank = null;
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
    if (e.rank && e.rank > 0 && (bestRank === null || e.rank < bestRank)) bestRank = e.rank;
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
  const rankLabel = bestRank === 1 ? '🥇' : bestRank === 2 ? '🥈' : bestRank === 3 ? '🥉' : bestRank ? `#${bestRank}` : null;

  let html = `<div class="card global-stats-card">`;
  html += `<div class="section-heading section-heading-card">${esc(heading)}</div>`;
  html += `<div class="global-stats-grid">`;
  html += `<div class="global-stats-cell"><div class="global-stats-value">${totalTournaments}</div><div class="global-stats-label">${esc(t('txt_player_career_played'))}</div></div>`;
  html += `<div class="global-stats-cell"><div class="global-stats-value">${totalWins}</div><div class="global-stats-label">${esc(t('txt_player_career_wins'))}</div></div>`;
  html += `<div class="global-stats-cell"><div class="global-stats-value">${totalLosses}</div><div class="global-stats-label">${esc(t('txt_player_career_losses'))}</div></div>`;
  if (winRate !== null) html += `<div class="global-stats-cell"><div class="global-stats-value">${winRate}%</div><div class="global-stats-label">${esc(t('txt_player_career_win_rate'))}</div></div>`;
  if (rankLabel)       html += `<div class="global-stats-cell"><div class="global-stats-value">${rankLabel}</div><div class="global-stats-label">${esc(t('txt_player_career_best_rank'))}</div></div>`;
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
    html += `<span>${esc(_formatParticipantStat(row.together_games, row.together_wins))}</span>`;
    html += `<span>${esc(_formatParticipantStat(row.against_games, row.against_wins))}</span>`;
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
  const finished = _entries.filter(e => e.status === 'finished');
  if (finished.length === 0) return '';

  // Group finished entries by sport
  const bySport = {};
  for (const e of finished) {
    const sport = e.sport || 'padel';
    if (!bySport[sport]) bySport[sport] = [];
    bySport[sport].push(e);
  }

  const sports = Object.keys(bySport);
  let html = '';

  if (sports.length === 1) {
    // Single sport — use generic heading
    html += _buildStatsCardForEntries(finished, t('txt_player_career_stats'));
  } else {
    // Multiple sports — one card per sport with sport-qualified heading
    for (const sport of sports) {
      const heading = t('txt_player_career_stats_sport').replace('{sport}', _sportLabel(sport));
      html += _buildStatsCardForEntries(bySport[sport], heading);
    }
  }

  return html;
}

function _buildEntryCard(entry) {
  const url = _entityUrl(entry);
  const isFinished = entry.status === 'finished';
  const canViewFinishedTournament = !(isFinished && entry.entity_type === 'tournament' && entry.entity_deleted);
  const btnLabel = isFinished ? t('txt_player_results_btn') : t('txt_player_open_btn');
  let html = `<div class="entry-card${isFinished ? ' finished' : ''}">`;
  html += `<div class="entry-card-info">`;
  html += `<div class="entry-card-name">${esc(entry.entity_name)}</div>`;
  html += `<div class="entry-card-badges">`;
  html += `<span class="badge badge-sport">${esc(_sportLabel(entry.sport))}</span>`;
  html += `<span class="badge badge-type">${esc(_typeLabel(entry.tournament_type))}</span>`;
  if (isFinished && entry.finished_at) {
    const d = new Date(entry.finished_at);
    html += `<span class="badge badge-finished">${esc(d.toLocaleDateString())}</span>`;
  }
  html += `</div>`;
  if (entry.player_name) html += `<div class="entry-card-meta">${esc(entry.player_name)}</div>`;
  if (isFinished) {
    const statsLine = _buildStatsLine(entry);
    if (statsLine) html += `<div class="entry-card-stats">${statsLine}</div>`;
    const social = _buildPartnerRivalSection(entry);
    if (social) html += social;
  }
  html += `</div>`;
  if (canViewFinishedTournament) {
    html += `<a href="${esc(url)}" class="btn btn-sm btn-primary">${esc(btnLabel)}</a>`;
  }
  html += `</div>`;
  return html;
}

function _buildStatsLine(entry) {
  const hasRank = entry.rank != null && entry.rank > 0;
  const hasWL = (entry.wins || 0) + (entry.losses || 0) + (entry.draws || 0) > 0;
  const parts = [];
  if (hasRank) {
    const suffix = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`;
    const of = entry.total_players ? ` ${t('txt_player_stats_of')} ${entry.total_players}` : '';
    parts.push(`${suffix}${of}`);
  }
  if (hasWL) {
    let wl = `${entry.wins || 0}W`;
    if (entry.losses) wl += ` ${entry.losses}L`;
    if (entry.draws) wl += ` ${entry.draws}D`;
    parts.push(wl);
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
  html += `<input type="text" id="link-entity-id" placeholder="e.g. t5 or r3" autocomplete="off"></div>`;
  html += `<div class="form-group"><label>${esc(t('txt_player_link_passphrase'))}</label>`;
  html += `<input type="text" id="link-passphrase" placeholder="${esc(t('txt_player_passphrase_placeholder'))}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>`;
  if (_errorMsg) html += `<div class="error-msg">${esc(_errorMsg)}</div>`;
  if (_successMsg) html += `<div class="success-msg">${esc(_successMsg)}</div>`;
  html += `<div class="player-link-modal-actions">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_doLink()">${esc(t('txt_player_link_submit'))}</button>`;
  html += `<button type="button" class="btn btn-secondary btn-sm" onclick="_closeLinkModal(null)">✕</button>`;
  html += `</div>`;
  html += `</div></div>`;
  return html;
}

// ── Actions ───────────────────────────────────────────────

function _setAuthTab(tab) {
  _authTab = tab;
  try { localStorage.setItem('amistoso-player-auth-tab', tab); } catch (_) {}
  _errorMsg = '';
  _recoverSent = false;
  _render();
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

async function _doCreate() {
  const participantPp = (document.getElementById('ps-participant-pp')?.value || '').trim();
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
    _successMsg = t('txt_player_passphrase_emailed', { email: data.profile.email });
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
    _successMsg = t('txt_player_save_btn') + ' ✓';
    _saveSession();
    _render();
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
    if (_authTab === 'login' && !_jwt) { _doLogin(); return; }
    if (_authTab === 'create' && !_jwt) { _doCreate(); }
  }
});

// ── Bootstrap ─────────────────────────────────────────────
_init();
