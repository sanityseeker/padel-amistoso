/**
 * club.js — Per-club public landing page.
 *
 * Reads the club slug from window.location.hostname (via shared.js
 * getClubSubdomain()), then fetches:
 *   - GET /api/clubs/by-slug/{slug}             → club name + logo
 *   - GET /api/clubs/{id}/public-tournaments    → contextual action buttons
 *   - GET /api/clubs/{id}/public-leaderboard    → ELO leaderboard (per sport)
 *
 * No authentication is required.
 */

// ── Theme + language (mirrors tv.js / player.js pattern) ──────────────────
let _clubTheme = _loadSavedTheme();
_applyTheme(_clubTheme);
let _clubLang = _loadSavedLanguage();
setAppLanguage(_clubLang);

function _clubRefreshTopbarButtons() {
  const themeBtn = document.getElementById('club-theme-btn');
  if (themeBtn) themeBtn.textContent = _clubTheme === 'dark' ? '🌙' : '☀️';
  const langBtn = document.getElementById('club-lang-btn');
  if (langBtn) langBtn.textContent = _clubLang === 'es' ? '🇪🇸' : '🇬🇧';
}

function _clubToggleTheme() {
  _clubTheme = _clubTheme === 'dark' ? 'light' : 'dark';
  _applyTheme(_clubTheme);
  _saveTheme(_clubTheme);
  _clubRefreshTopbarButtons();
}

function _clubToggleLanguage() {
  _clubLang = _clubLang === 'es' ? 'en' : 'es';
  setAppLanguage(_clubLang);
  _clubRefreshTopbarButtons();
}

const _CLUB_LB_SPORT_KEY = 'amistoso-club-landing-sport';
const _CLUB_LB_SCOPE_KEY = 'amistoso-club-landing-scope';
let _clubData = null;
let _clubLeaderboardCache = {};         // sport -> rows (global scope) or 'all' -> {padel,tennis}
let _clubSeasonStandingsCache = {};     // seasonId -> { padel, tennis }
let _clubSeasons = [];                  // SeasonOut[]
let _clubLeaderboardScope = 'global';   // 'global' | season id
let _clubCurrentSport = null;           // null = both, 'padel', or 'tennis'

async function _clubFetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function _clubShow(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function _clubHide(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function _clubRenderHeader(club) {
  document.getElementById('club-name').textContent = club.name;
  document.title = `${club.name}`;
  if (club.logo_url) {
    const img = document.getElementById('club-logo');
    img.src = club.logo_url;
    img.alt = club.name;
    img.hidden = false;
  }
  const descEl = document.getElementById('club-description');
  if (descEl) {
    if (club.description) {
      descEl.textContent = club.description;
      descEl.hidden = false;
    } else {
      descEl.hidden = true;
    }
  }
  _clubShow('club-header');
}

const _CLUB_STATUS_ORDER = ['in_progress', 'open_registration', 'upcoming', 'finished'];
const _CLUB_STATUS_LABEL_KEY = {
  in_progress: 'txt_club_status_live',
  open_registration: 'txt_club_status_open_registration',
  upcoming: 'txt_club_status_upcoming',
  finished: 'txt_club_status_finished',
};
const _CLUB_STATUS_FALLBACK = {
  in_progress: 'Live',
  open_registration: 'Sign up',
  upcoming: 'Upcoming',
  finished: 'Finished',
};
const _CLUB_ITEMS_TAB_KEY = 'amistoso-club-landing-items-tab';
const _CLUB_ITEMS_LIVE_STATUSES = new Set(['in_progress', 'open_registration', 'upcoming']);
let _clubItems = [];
let _clubItemsTab = 'live';

function _clubResolveInitialItemsTab() {
  try {
    const saved = localStorage.getItem(_CLUB_ITEMS_TAB_KEY);
    if (saved === 'live' || saved === 'finished') return saved;
  } catch (_) {}
  return 'live';
}

function _clubItemsForTab(tab) {
  return (_clubItems || []).filter(it => {
    const isLive = _CLUB_ITEMS_LIVE_STATUSES.has(it.status);
    const tabMatch = tab === 'live' ? isLive : !isLive;
    const sportMatch = !_clubCurrentSport || !it.sport || it.sport === _clubCurrentSport;
    return tabMatch && sportMatch;
  });
}

function _clubUpdateItemsTabUI() {
  document.querySelectorAll('[data-items-tab]').forEach(btn => {
    const active = btn.dataset.itemsTab === _clubItemsTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const liveCount = _clubItemsForTab('live').length;
  const finishedCount = _clubItemsForTab('finished').length;
  const liveEl = document.getElementById('club-items-tab-count-live');
  const finishedEl = document.getElementById('club-items-tab-count-finished');
  if (liveEl) liveEl.textContent = liveCount ? String(liveCount) : '';
  if (finishedEl) finishedEl.textContent = finishedCount ? String(finishedCount) : '';
}

// ── Item badges: sport + type ─────────────────────────────────────────────
const _CLUB_TYPE_LABEL_KEY = {
  group_playoff: 'txt_club_type_gp',
  mexicano: 'txt_club_type_mex',
  playoff: 'txt_club_type_po',
  registration: 'txt_club_type_registration',
};
const _CLUB_TYPE_FALLBACK = {
  group_playoff: 'GP',
  mexicano: 'Mex',
  playoff: 'PO',
  registration: 'Reg',
};
const _CLUB_SPORT_LABEL_KEY = {
  padel: 'txt_txt_sport_padel',
  tennis: 'txt_txt_sport_tennis',
};

function _clubItemBadges(it) {
  const parts = [];
  // Sport badge — suppress when a sport is already selected (it's implied)
  if (it.sport && !_clubCurrentSport) {
    const sLabel = t(_CLUB_SPORT_LABEL_KEY[it.sport] || '', {}) || it.sport;
    parts.push(`<span class="club-item-badge club-item-badge--sport club-item-badge--${esc(it.sport)}">${esc(sLabel)}</span>`);
  }
  // Type badge
  if (it.type) {
    const tLabel = t(_CLUB_TYPE_LABEL_KEY[it.type] || '', {}) || _CLUB_TYPE_FALLBACK[it.type] || it.type;
    parts.push(`<span class="club-item-badge club-item-badge--type">${esc(tLabel)}</span>`);
  }
  return parts.join('');
}

function _clubRenderItemsBody() {
  const body = document.getElementById('club-items-body');
  if (!body) return;
  const visible = _clubItemsForTab(_clubItemsTab);
  if (visible.length === 0) {
    const emptyKey = _clubItemsTab === 'live' ? 'txt_club_items_empty_live' : 'txt_club_items_empty_finished';
    const fallback = _clubItemsTab === 'live' ? 'No live activity right now.' : 'No finished events yet.';
    body.innerHTML = `<div class="club-items-empty">${esc(t(emptyKey, {}) || fallback)}</div>`;
    return;
  }
  // Sort by status priority, then keep server order within each group.
  const sorted = visible.slice().sort((a, b) => {
    const ai = _CLUB_STATUS_ORDER.indexOf(a.status);
    const bi = _CLUB_STATUS_ORDER.indexOf(b.status);
    if (ai === bi) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  body.innerHTML = sorted.map(it => {
    const slug = it.alias || it.id;
    const path = it.kind === 'registration'
      ? `/register/${encodeURIComponent(slug)}`
      : `/tv/${encodeURIComponent(slug)}`;
    const badgesHtml = _clubItemBadges(it);
    return `
      <a class="club-item-card club-item-card--${esc(it.status)}${it.pinned ? ' club-item-card--pinned' : ''}" href="${esc(path)}">
        <span class="club-item-name">${esc(it.name || '')}</span>
        <span class="club-item-badges">${badgesHtml}</span>
      </a>`;
  }).join('');
}

function _clubSetItemsTab(tab) {
  if (tab !== 'live' && tab !== 'finished') return;
  _clubItemsTab = tab;
  try { localStorage.setItem(_CLUB_ITEMS_TAB_KEY, tab); } catch (_) {}
  _clubUpdateItemsTabUI();
  _clubRenderItemsBody();
}

function _clubRenderItems(items) {
  _clubItems = Array.isArray(items) ? items : [];
  if (_clubItems.length === 0) {
    _clubHide('club-items');
    return;
  }
  // If the persisted tab is empty and the other has items, switch to it so we
  // never land on a misleading empty state.
  const liveCount = _clubItemsForTab('live').length;
  const finishedCount = _clubItemsForTab('finished').length;
  if (_clubItemsTab === 'live' && liveCount === 0 && finishedCount > 0) {
    _clubItemsTab = 'finished';
  } else if (_clubItemsTab === 'finished' && finishedCount === 0 && liveCount > 0) {
    _clubItemsTab = 'live';
  }
  _clubUpdateItemsTabUI();
  _clubRenderItemsBody();
  _clubShow('club-items');
}

function _clubRenderLeaderboardSkeleton(dual) {
  const body = document.getElementById('club-leaderboard-body');
  if (!body) return;
  const lines = `
    <div class="club-skeleton-loader" aria-hidden="true">
      <div class="club-skeleton-line"></div>
      <div class="club-skeleton-line"></div>
      <div class="club-skeleton-line"></div>
      <div class="club-skeleton-line"></div>
      <div class="club-skeleton-line"></div>
    </div>`;
  if (dual) {
    body.innerHTML = `
      <div class="club-lb-dual">
        <div class="club-lb-sport-col">
          <div class="club-lb-sport-heading">${esc(t('txt_txt_sport_padel', {}) || 'Padel')}</div>
          ${lines}
        </div>
        <div class="club-lb-sport-col">
          <div class="club-lb-sport-heading">${esc(t('txt_txt_sport_tennis', {}) || 'Tennis')}</div>
          ${lines}
        </div>
      </div>`;
  } else {
    body.innerHTML = lines;
  }
}

function _clubRenderGlobalLeaderboard(rows, containerId) {
  const body = document.getElementById(containerId || 'club-leaderboard-body');
  if (!body) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    body.innerHTML = `<div class="club-leaderboard-empty">${esc(t('txt_club_leaderboard_empty', {}) || 'No players yet.')}</div>`;
    return;
  }
  const headers = `
    <tr>
      <th class="col-rank">#</th>
      <th class="col-name">${esc(t('txt_txt_player', {}) || 'Player')}</th>
      <th class="col-tier">${esc(t('txt_clubs_tier_name', {}) || 'Tier')}</th>
      <th class="col-elo">${esc(t('txt_player_elo_label', {}) || 'ELO')}</th>
      <th class="col-matches">${esc(t('txt_txt_matches', {}) || 'Matches')}</th>
    </tr>`;
  const tierLabel = esc(t('txt_clubs_tier_name', {}) || 'Tier');
  const matchesLabel = esc(t('txt_txt_matches', {}) || 'Matches');
  const rowsHtml = rows.map(r => `
    <tr>
      <td class="col-rank">${esc(r.rank)}</td>
      <td class="col-name">${_clubNameCell(r)}</td>
      <td class="col-tier" data-label="${tierLabel}">${esc(r.tier_name || '')}</td>
      <td class="col-elo">${r.elo == null ? '' : esc(r.elo.toFixed(1))}</td>
      <td class="col-matches" data-label="${matchesLabel}">${esc(r.matches)}</td>
    </tr>`).join('');
  body.innerHTML = `<table class="club-leaderboard-table"><thead>${headers}</thead><tbody>${rowsHtml}</tbody></table>`;
}

function _clubRenderDualLeaderboard(padelRows, tennisRows) {
  const body = document.getElementById('club-leaderboard-body');
  if (!body) return;
  const hasPadel = Array.isArray(padelRows) && padelRows.length > 0;
  const hasTennis = Array.isArray(tennisRows) && tennisRows.length > 0;
  if (!hasPadel && !hasTennis) {
    body.innerHTML = `<div class="club-leaderboard-empty">${esc(t('txt_club_leaderboard_empty', {}) || 'No players yet.')}</div>`;
    return;
  }
  const buildTable = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return `<div class="club-leaderboard-empty">${esc(t('txt_club_leaderboard_empty', {}) || 'No players yet.')}</div>`;
    const headers = `<tr>
      <th class="col-rank">#</th>
      <th class="col-name">${esc(t('txt_txt_player', {}) || 'Player')}</th>
      <th class="col-tier">${esc(t('txt_clubs_tier_name', {}) || 'Tier')}</th>
      <th class="col-elo">${esc(t('txt_player_elo_label', {}) || 'ELO')}</th>
      <th class="col-matches">${esc(t('txt_txt_matches', {}) || 'Matches')}</th>
    </tr>`;
    const tierLabel = esc(t('txt_clubs_tier_name', {}) || 'Tier');
    const matchesLabel = esc(t('txt_txt_matches', {}) || 'Matches');
    const rowsHtml = rows.map(r => `<tr>
      <td class="col-rank">${esc(r.rank)}</td>
      <td class="col-name">${_clubNameCell(r)}</td>
      <td class="col-tier" data-label="${tierLabel}">${esc(r.tier_name || '')}</td>
      <td class="col-elo">${r.elo == null ? '' : esc(r.elo.toFixed(1))}</td>
      <td class="col-matches" data-label="${matchesLabel}">${esc(r.matches)}</td>
    </tr>`).join('');
    return `<table class="club-leaderboard-table"><thead>${headers}</thead><tbody>${rowsHtml}</tbody></table>`;
  };
  body.innerHTML = `
    <div class="club-lb-dual">
      <div class="club-lb-sport-col">
        <div class="club-lb-sport-heading">${esc(t('txt_txt_sport_padel', {}) || 'Padel')}</div>
        ${buildTable(padelRows)}
      </div>
      <div class="club-lb-sport-col">
        <div class="club-lb-sport-heading">${esc(t('txt_txt_sport_tennis', {}) || 'Tennis')}</div>
        ${buildTable(tennisRows)}
      </div>
    </div>`;
}

function _buildSeasonLeaderboardTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<div class="club-leaderboard-empty">${esc(t('txt_club_leaderboard_empty', {}) || 'No players yet.')}</div>`;
  }
  const headers = `
    <tr>
      <th class="col-rank">#</th>
      <th class="col-name">${esc(t('txt_txt_player', {}) || 'Player')}</th>
      <th class="col-elo">${esc(t('txt_player_elo_label', {}) || 'ELO')}</th>
      <th class="col-elo">${esc(t('txt_clubs_season_elo_change', {}) || 'Δ')}</th>
      <th class="col-matches">${esc(t('txt_txt_matches', {}) || 'Matches')}</th>
    </tr>`;
  const sorted = [...rows].sort((a, b) => (b.elo_end ?? 0) - (a.elo_end ?? 0));
  const matchesLabel = esc(t('txt_txt_matches', {}) || 'Matches');
  const changeLabel = esc(t('txt_clubs_season_elo_change', {}) || 'Δ');
  const rowsHtml = sorted.map((s, i) => {
    const change = s.elo_change;
    const changeColor = change > 0 ? 'var(--green)' : change < 0 ? 'var(--red)' : 'var(--text-muted)';
    const changeStr = change == null ? '—' : ((change > 0 ? '+' : '') + change.toFixed(1));
    return `
    <tr>
      <td class="col-rank">${i + 1}</td>
      <td class="col-name">${esc(s.player_name)}</td>
      <td class="col-elo">${s.elo_end == null ? '—' : Math.round(s.elo_end)}</td>
      <td class="col-elo" data-label="${changeLabel}" style="color:${changeColor}">${changeStr}</td>
      <td class="col-matches" data-label="${matchesLabel}">${s.matches_played != null ? s.matches_played : '—'}</td>
    </tr>`;
  }).join('');
  return `<table class="club-leaderboard-table"><thead>${headers}</thead><tbody>${rowsHtml}</tbody></table>`;
}

function _clubRenderSeasonLeaderboard(rows) {
  const body = document.getElementById('club-leaderboard-body');
  if (!body) return;
  body.innerHTML = _buildSeasonLeaderboardTable(rows);
}

function _clubRenderDualSeasonLeaderboard(padelRows, tennisRows) {
  const body = document.getElementById('club-leaderboard-body');
  if (!body) return;
  const hasPadel = Array.isArray(padelRows) && padelRows.length > 0;
  const hasTennis = Array.isArray(tennisRows) && tennisRows.length > 0;
  if (!hasPadel && !hasTennis) {
    body.innerHTML = `<div class="club-leaderboard-empty">${esc(t('txt_club_leaderboard_empty', {}) || 'No players yet.')}</div>`;
    return;
  }
  body.innerHTML = `
    <div class="club-lb-dual">
      <div class="club-lb-sport-col">
        <div class="club-lb-sport-heading">${esc(t('txt_txt_sport_padel', {}) || 'Padel')}</div>
        ${_buildSeasonLeaderboardTable(padelRows)}
      </div>
      <div class="club-lb-sport-col">
        <div class="club-lb-sport-heading">${esc(t('txt_txt_sport_tennis', {}) || 'Tennis')}</div>
        ${_buildSeasonLeaderboardTable(tennisRows)}
      </div>
    </div>`;
}

function _clubRenderScopeBar() {
  const bar = document.getElementById('club-leaderboard-scope-bar');
  if (!bar) return;
  const seasons = Array.isArray(_clubSeasons) ? _clubSeasons : [];
  if (!seasons.length) {
    bar.innerHTML = '';
    bar.hidden = true;
    return;
  }
  const opts = [
    `<option value="global"${_clubLeaderboardScope === 'global' ? ' selected' : ''}>${esc(t('txt_clubs_leaderboard_scope_global', {}) || 'All-time')}</option>`,
    ...seasons.map(s => {
      const archived = !s.active ? ` (${esc(t('txt_clubs_season_archived', {}) || 'archived')})` : '';
      return `<option value="${esc(s.id)}"${_clubLeaderboardScope === s.id ? ' selected' : ''}>${esc(s.name)}${archived}</option>`;
    }),
  ].join('');
  bar.innerHTML = `
    <label class="club-leaderboard-scope-label" for="club-lb-scope-sel">${esc(t('txt_clubs_leaderboard_scope_label', {}) || 'Scope')}</label>
    <select id="club-lb-scope-sel" class="club-leaderboard-scope-select" onchange="_clubSetLeaderboardScope(this.value)">${opts}</select>`;
  bar.hidden = false;
}

async function _clubLoadLeaderboard(sport) {
  if (!_clubData) return;
  if (_clubLeaderboardScope === 'global') {
    if (sport === null) {
      // Both sports — use cached 'all' entry or fetch
      if (_clubLeaderboardCache['all']) {
        _clubRenderDualLeaderboard(_clubLeaderboardCache['all'].padel, _clubLeaderboardCache['all'].tennis);
        return;
      }
      _clubRenderLeaderboardSkeleton(true);
      try {
        const data = await _clubFetchJson(`/api/clubs/${encodeURIComponent(_clubData.club_id)}/public-leaderboard?sport=all`);
        _clubLeaderboardCache['all'] = data;
        _clubRenderDualLeaderboard(data.padel, data.tennis);
      } catch (_) {
        _clubRenderDualLeaderboard([], []);
      }
    } else {
      if (_clubLeaderboardCache[sport]) {
        _clubRenderGlobalLeaderboard(_clubLeaderboardCache[sport]);
        return;
      }
      _clubRenderLeaderboardSkeleton(false);
      try {
        const data = await _clubFetchJson(`/api/clubs/${encodeURIComponent(_clubData.club_id)}/public-leaderboard?sport=${encodeURIComponent(sport)}`);
        _clubLeaderboardCache[sport] = data;
        _clubRenderGlobalLeaderboard(data);
      } catch (_) {
        _clubRenderGlobalLeaderboard([]);
      }
    }
    return;
  }
  // Season scope
  const seasonId = _clubLeaderboardScope;
  const season = _clubSeasons.find(s => s.id === seasonId);
  let data = _clubSeasonStandingsCache[seasonId];
  if (!data || (season && season.active)) {
    _clubRenderLeaderboardSkeleton(sport === null);
    try {
      data = await _clubFetchJson(`/api/seasons/${encodeURIComponent(seasonId)}/standings`);
      _clubSeasonStandingsCache[seasonId] = data;
    } catch (_) {
      if (sport === null) {
        _clubRenderDualSeasonLeaderboard([], []);
      } else {
        _clubRenderSeasonLeaderboard([]);
      }
      return;
    }
  }
  if (sport === null) {
    _clubRenderDualSeasonLeaderboard(
      (data && data.padel) || [],
      (data && data.tennis) || [],
    );
  } else {
    _clubRenderSeasonLeaderboard((data && data[sport]) || []);
  }
}

function _clubSetLeaderboardScope(scope) {
  _clubLeaderboardScope = scope || 'global';
  // Fall back to global if a stale season id is passed in.
  if (_clubLeaderboardScope !== 'global'
      && !_clubSeasons.some(s => s.id === _clubLeaderboardScope)) {
    _clubLeaderboardScope = 'global';
  }
  try { localStorage.setItem(_CLUB_LB_SCOPE_KEY, _clubLeaderboardScope); } catch (_) {}
  _clubRenderScopeBar();
  _clubLoadLeaderboard(_clubCurrentSport);
}

function _clubResolveInitialScope() {
  try {
    const saved = localStorage.getItem(_CLUB_LB_SCOPE_KEY);
    if (saved === 'global') return 'global';
    if (saved && _clubSeasons.some(s => s.id === saved)) return saved;
  } catch (_) {}
  return 'global';
}

// Sport pills — null means both sports, toggling the same pill clears it
function _clubToggleSportPill(sport) {
  _clubCurrentSport = (_clubCurrentSport === sport) ? null : sport;
  try {
    if (_clubCurrentSport) localStorage.setItem(_CLUB_LB_SPORT_KEY, _clubCurrentSport);
    else localStorage.removeItem(_CLUB_LB_SPORT_KEY);
  } catch (_) {}
  _clubRefreshSportPills();
  _clubUpdateItemsTabUI();
  _clubRenderItemsBody();
  _clubLoadLeaderboard(_clubCurrentSport);
}

function _clubRefreshSportPills() {
  document.querySelectorAll('.club-sport-pill').forEach(btn => {
    const active = _clubCurrentSport === btn.dataset.sport;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function _clubResolveInitialSport() {
  try {
    const saved = localStorage.getItem(_CLUB_LB_SPORT_KEY);
    if (saved === 'padel' || saved === 'tennis') return saved;
  } catch (_) {}
  return null;  // default: show both
}

// ── Passcode / ID search ─────────────────────────────────────────────────
async function _clubSearchSubmit(e) {
  e.preventDefault();
  const raw = (document.getElementById('club-search-input')?.value || '').trim();
  if (!raw) return;
  const resultEl = document.getElementById('club-search-result');
  // Try matching in local items list first (by id or alias)
  const match = (_clubItems || []).find(it => it.id === raw || (it.alias && it.alias === raw));
  if (match) {
    const slug = match.alias || match.id;
    const path = match.kind === 'registration'
      ? `/register/${encodeURIComponent(slug)}`
      : `/tv/${encodeURIComponent(slug)}`;
    window.location.href = path;
    return;
  }
  // Unknown — ask the backend whether it's a registration or a tournament
  if (resultEl) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<span class="club-search-hint">${esc(t('txt_club_search_trying', {}) || 'Looking up…')}</span>`;
  }
  try {
    const res = await fetch(`/api/registrations/public/${encodeURIComponent(raw)}`);
    if (res.ok) {
      window.location.href = `/register/${encodeURIComponent(raw)}`;
      return;
    }
  } catch (_) { /* network error — fall through */ }
  // Check if it's a tournament on the TV page
  try {
    const res = await fetch(`/api/tournaments/${encodeURIComponent(raw)}/meta`);
    if (res.ok) {
      window.location.href = `/tv/${encodeURIComponent(raw)}`;
      return;
    }
  } catch (_) { /* fall through */ }
  if (resultEl) {
    resultEl.innerHTML = `<span class="club-search-hint">${esc(t('txt_club_search_no_results', {}) || 'No results found.')}</span>`;
  }
}

async function _clubInit() {
  if (typeof initLanguage === 'function') initLanguage();
  _clubLang = getAppLanguage();
  _clubRefreshTopbarButtons();
  const slug = (typeof getClubSubdomain === 'function') ? getClubSubdomain() : null;
  if (!slug) {
    document.getElementById('club-loading').textContent = t('txt_club_not_found', {}) || 'Club not found.';
    return;
  }
  try {
    _clubData = await _clubFetchJson(`/api/clubs/by-slug/${encodeURIComponent(slug)}`);
  } catch (_) {
    document.getElementById('club-loading').textContent = t('txt_club_not_found', {}) || 'Club not found.';
    return;
  }
  _clubHide('club-loading');
  _clubRenderHeader(_clubData);

  // Fetch items and seasons in parallel — both depend only on club_id.
  const cid = encodeURIComponent(_clubData.club_id);
  const [actions, seasons] = await Promise.all([
    _clubFetchJson(`/api/clubs/${cid}/public-tournaments`).catch(() => []),
    _clubFetchJson(`/api/clubs/${cid}/seasons`).catch(() => []),
  ]);
  _clubRenderItems(actions || []);
  _clubSeasons = Array.isArray(seasons) ? seasons : [];

  _clubLeaderboardScope = _clubResolveInitialScope();
  _clubCurrentSport = _clubResolveInitialSport();

  // Show the unified sport selector
  _clubRefreshSportPills();
  _clubShow('club-sport-selector');

  // Re-render items now that sport is known (applies sport filter + hides redundant badges)
  if (_clubItems.length > 0) {
    _clubUpdateItemsTabUI();
    _clubRenderItemsBody();
  }

  _clubShow('club-leaderboard');
  _clubRenderScopeBar();
  _clubLoadLeaderboard(_clubCurrentSport);

  // Always show search and login sections
  _clubShow('club-search');
  _clubShow('club-login');

  if (typeof applyI18n === 'function') applyI18n(document);
}

document.addEventListener('app-language-changed', () => {
  _clubLang = getAppLanguage();
  _clubRefreshTopbarButtons();
});

// ---------------------------------------------------------------------------
// Player mini-card (clickable name on leaderboards)
// ---------------------------------------------------------------------------

function _clubNameCell(r) {
  // Wrap the player name in a button when we have a profile_id so it can open
  // the public mini-card. Falls back to plain text otherwise.
  const name = esc(r.name || '');
  if (!r || !r.profile_id) return name;
  const pid = esc(r.profile_id);
  const aria = esc(t('txt_club_open_player_card', { name: r.name || '' }) || `Open profile for ${r.name}`);
  return `<button type="button" class="club-name-btn" aria-label="${aria}" `
    + `onclick="_clubOpenMiniCard('${pid}')" `
    + `onmouseenter="_clubPrefetchMiniCard('${pid}')" `
    + `onfocus="_clubPrefetchMiniCard('${pid}')">${name}</button>`;
}

const _CLUB_MINI_CARD_PREFETCH = new Map();

function _clubPrefetchMiniCard(profileId) {
  if (!profileId || !_clubData || !_clubData.club_id) return;
  const key = `${_clubData.club_id}:${profileId}`;
  if (_CLUB_MINI_CARD_PREFETCH.has(key)) return;
  const url = `/api/clubs/${encodeURIComponent(_clubData.club_id)}/players/${encodeURIComponent(profileId)}/public-card`;
  const promise = _clubFetchJson(url).catch(() => null);
  _CLUB_MINI_CARD_PREFETCH.set(key, promise);
  // Drop the prefetch entry shortly after it lands so a stale snapshot
  // can't outlive the server-side TTL (~30s).
  setTimeout(() => _CLUB_MINI_CARD_PREFETCH.delete(key), 25_000);
}

function _clubMiniCardEnsureOverlay() {
  return ensureMiniCardOverlay({
    id: 'club-mini-card-overlay',
    className: 'club-mini-card-overlay',
    onClose: _clubCloseMiniCard,
  });
}

function _clubCloseMiniCard() {
  hideMiniCardOverlay(document.getElementById('club-mini-card-overlay'));
}

async function _clubOpenMiniCard(profileId) {
  if (!profileId || !_clubData || !_clubData.club_id) return;
  const overlay = _clubMiniCardEnsureOverlay();
  const loadingLabel = esc(t('txt_txt_loading', {}) || 'Loading…');
  const closeLabel = esc(t('txt_txt_close', {}) || 'Close');
  overlay.innerHTML = `
    <div class="club-mini-card" role="document">
      <button type="button" class="club-mini-card-close" aria-label="${closeLabel}" onclick="_clubCloseMiniCard()">×</button>
      <div class="club-mini-card-loading">${loadingLabel}</div>
    </div>`;
  showMiniCardOverlay(overlay);
  let card;
  try {
    const key = `${_clubData.club_id}:${profileId}`;
    const prefetched = _CLUB_MINI_CARD_PREFETCH.get(key);
    if (prefetched) {
      card = await prefetched;
      _CLUB_MINI_CARD_PREFETCH.delete(key);
    }
    if (!card) {
      card = await _clubFetchJson(
        `/api/clubs/${encodeURIComponent(_clubData.club_id)}/players/${encodeURIComponent(profileId)}/public-card`
      );
    }
  } catch (e) {
    overlay.querySelector('.club-mini-card').innerHTML = `
      <button type="button" class="club-mini-card-close" aria-label="${closeLabel}" onclick="_clubCloseMiniCard()">×</button>
      <div class="club-mini-card-error">${esc(t('txt_club_mini_card_error', {}) || 'Could not load player.')}</div>`;
    return;
  }
  _clubRenderMiniCard(overlay, card);
  if (typeof applyI18n === 'function') applyI18n(overlay);
  // Focus the close button now that the card is rendered.
  const closeBtn = overlay.querySelector('.club-mini-card-close');
  if (closeBtn) closeBtn.focus();
}

function _clubRenderMiniCard(overlay, card) {
  const closeLabel = esc(t('txt_txt_close', {}) || 'Close');
  const tierLabel = esc(t('txt_clubs_tier_name', {}) || 'Tier');
  const eloLabel = esc(t('txt_player_elo_label', {}) || 'ELO');
  const matchesLabel = esc(t('txt_txt_matches', {}) || 'Matches');
  const rankLabel = esc(t('txt_txt_rank', {}) || 'Rank');
  const padelLabel = esc(t('txt_txt_sport_padel', {}) || 'Padel');
  const tennisLabel = esc(t('txt_txt_sport_tennis', {}) || 'Tennis');
  const recentLabel = esc(t('txt_club_mini_card_recent', {}) || 'Recent matches');
  const emptyRecentLabel = esc(t('txt_club_mini_card_no_recent', {}) || 'No matches yet.');

  const sportPanel = (sport, label) => {
    const elo = card[`elo_${sport}`];
    const matches = card[`matches_${sport}`] || 0;
    const tier = card[`tier_name_${sport}`];
    const rank = card[`rank_${sport}`];
    if (elo == null) {
      return `
        <div class="club-mini-sport club-mini-sport-empty">
          <div class="club-mini-sport-heading">${label}</div>
          <div class="club-mini-sport-empty-text">${esc(t('txt_club_mini_card_no_sport', {}) || '—')}</div>
        </div>`;
    }
    return `
      <div class="club-mini-sport">
        <div class="club-mini-sport-heading">${label}</div>
        <div class="club-mini-sport-grid">
          <div class="club-mini-stat"><div class="club-mini-stat-label">${eloLabel}</div><div class="club-mini-stat-value">${esc(Number(elo).toFixed(1))}</div></div>
          <div class="club-mini-stat"><div class="club-mini-stat-label">${rankLabel}</div><div class="club-mini-stat-value">${rank == null ? '—' : '#' + esc(rank)}</div></div>
          <div class="club-mini-stat"><div class="club-mini-stat-label">${matchesLabel}</div><div class="club-mini-stat-value">${esc(matches)}</div></div>
          <div class="club-mini-stat"><div class="club-mini-stat-label">${tierLabel}</div><div class="club-mini-stat-value">${esc(tier || '—')}</div></div>
        </div>
      </div>`;
  };

  const recent = Array.isArray(card.recent_matches) ? card.recent_matches : [];
  const filteredRecent = _clubCurrentSport
    ? recent.filter(m => m.sport === _clubCurrentSport)
    : recent;
  const recentHtml = filteredRecent.length === 0
    ? `<div class="club-mini-recent-empty">${emptyRecentLabel}</div>`
    : `<div class="elo-log">${filteredRecent.map(m => {
        const delta = m.elo_delta;
        const deltaClass = delta > 0 ? 'elo-transition--gain' : delta < 0 ? 'elo-transition--loss' : 'elo-transition--neutral';
        const deltaStr = delta == null ? '' : (delta > 0 ? '+' : '') + Number(delta).toFixed(1);
        const hasSets = Array.isArray(m.sets) && m.sets.length > 0;
        const score = hasSets
          ? m.sets.map(s => `${s[0]}-${s[1]}`).join(' · ')
          : (Array.isArray(m.score) && m.score.length >= 2 ? `${m.score[0]} – ${m.score[1]}` : '');
        const team1 = Array.isArray(m.team1) ? m.team1.join(' / ') : '';
        const team2 = Array.isArray(m.team2) ? m.team2.join(' / ') : '';
        const sportTag = m.sport === 'tennis' ? tennisLabel : padelLabel;
        const tname = m.tournament_alias || m.tournament_name || '';
        const roundTxt = m.round_label || (m.round_number ? `R${m.round_number}` : '');
        const tnameWithRound = roundTxt
          ? `${esc(tname)}<span class="elo-log-sub">· ${esc(roundTxt)}</span>`
          : esc(tname);
        const mid = score
          ? `<span class="elo-score-sep">${esc(score)}</span>`
          : `<span class="elo-vs-sep">vs</span>`;
        return `<div class="elo-log-row">
          <div class="elo-log-main">
            <span class="elo-log-name">${tnameWithRound}</span>
            <span class="elo-log-dim">${sportTag}</span>
            <span class="elo-transition ${deltaClass}">${esc(deltaStr)}</span>
          </div>
          <div class="elo-log-row elo-log-row--inline elo-log-row--nested">
            <div class="elo-log-teams">
              <span class="elo-team elo-team--a">${esc(team1)}</span>
              ${mid}
              <span class="elo-team elo-team--b">${esc(team2)}</span>
            </div>
          </div>
        </div>`;
      }).join('')}</div>`;

  const sportsToShow = _clubCurrentSport ? [_clubCurrentSport] : ['padel', 'tennis'];
  const sportPanels = sportsToShow.map(s => sportPanel(s, s === 'tennis' ? tennisLabel : padelLabel)).join('');

  const profileIdAttr = esc(card.profile_id || '');
  overlay.innerHTML = `
    <div class="club-mini-card" role="document">
      <button type="button" class="club-mini-card-close" aria-label="${closeLabel}" onclick="_clubCloseMiniCard()">×</button>
      <div class="club-mini-card-name">${esc(card.name)}</div>
      <div class="club-mini-sports${_clubCurrentSport ? ' club-mini-sports--single' : ''}">
        ${sportPanels}
      </div>
      <div class="club-mini-recent">
        <div class="club-mini-recent-heading">${recentLabel}</div>
        ${recentHtml}
      </div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', _clubInit);
