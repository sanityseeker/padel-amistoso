/**
 * admin-clubs.js — Club & Season management panel.
 *
 * Handles:
 *  - Listing, creating, renaming, and deleting clubs (many clubs can share one community)
 *  - Club logo upload/delete
 *  - Player tiers CRUD (per club)
 *  - Season CRUD (per club)
 *  - Tournament/registration season assignment
 *  - Season standings view
 *  - Club player list with ELO & tier management
 */

// ─── State ────────────────────────────────────────────────

let _clubsList = [];         // ClubOut[]
let _clubsCommunities = [];  // from GET /api/communities
let _clubsTournaments = [];  // from GET /api/tournaments
let _clubsRegistrations = []; // from GET /api/registrations
let _activeClubId = null;    // currently selected club
let _clubTiers = [];         // TierOut[] for active club
let _clubSeasons = [];       // SeasonOut[] for active club
let _clubPlayers = [];       // ClubPlayerOut[] for active club
let _clubCollaborators = []; // collaborators for active club
let _clubsInviteSelectedIds = new Set();
let _clubsRecipientFilter = '';
let _clubsMessagingTab = 'lobby'; // 'lobby' | 'announce'
let _clubsPlayerSearchTimer = null;
let _clubsPlayerSearchSelected = null;
let _clubsCollabSearchTimer = null;
let _clubsAttachSearch = '';
let _clubsPlayerFilter = '';
let _clubsEloDebounceTimers = {}; // keyed by `${profileId}-${sport}`
let _clubsLeaderboardSort = { col: 'elo', dir: 'desc' };
let _clubsLeaderboardScope = 'global'; // 'global' | season id
let _clubsSeasonStandingsCache = {}; // seasonId -> { padel: [...], tennis: [...] }
const _CLUBS_LB_SCOPE_KEY = 'amistoso-clubs-leaderboard-scope';
try { _clubsLeaderboardScope = sessionStorage.getItem(_CLUBS_LB_SCOPE_KEY) || 'global'; } catch (_) {}
let _clubsRosterNoticeText = '';
let _clubsRosterNoticeError = false;
let _clubsRosterNoticeTimer = null;
const _CLUBS_SPORT_KEY = 'amistoso-clubs-sport';
const _CLUBS_GHOST_SEARCH_KEY = 'amistoso-clubs-ghost-search';
let _clubsSport = 'padel';
try { _clubsSport = localStorage.getItem(_CLUBS_SPORT_KEY) || 'padel'; } catch (_) {}
let _clubsGhostSearch = '';
try { _clubsGhostSearch = localStorage.getItem(_CLUBS_GHOST_SEARCH_KEY) || ''; } catch (_) {}
// ─── Entry point ─────────────────────────────────────────

/**
 * Load (or reload) all data for the clubs panel.
 * Called automatically when the user navigates to the clubs tab.
 */
async function loadClubsPanel() {
  await Promise.all([
    _clubsLoadClubs(),
    _clubsLoadCommunities(),
    _clubsLoadTournaments(),
    _clubsLoadRegistrations(),
  ]);
  _clubsRenderOverview();
}

function rerenderClubsPanelOnLanguageChange() {
  const panel = document.getElementById('panel-clubs');
  if (!panel || !panel.classList.contains('active')) return;

  if (_activeClubId) {
    _clubsRenderDetail();
    return;
  }
  _clubsRenderOverview();
}

// ─── Data loaders ────────────────────────────────────────

async function _clubsLoadClubs() {
  try {
    _clubsList = await apiAuth('/api/clubs');
  } catch (e) {
    console.warn('Failed to load clubs:', e);
    _clubsList = [];
  }
}

async function _clubsLoadCommunities() {
  try {
    _clubsCommunities = await apiAuth('/api/communities');
  } catch (e) {
    _clubsCommunities = [];
  }
}

async function _clubsLoadTournaments() {
  try {
    _clubsTournaments = await apiAuth('/api/tournaments');
  } catch (e) {
    _clubsTournaments = [];
  }
}

async function _clubsLoadRegistrations() {
  try {
    _clubsRegistrations = await apiAuth('/api/registrations');
  } catch (e) {
    _clubsRegistrations = [];
  }
}

async function _clubsLoadClubDetail(clubId) {
  const [tiers, seasons, players, collaborators] = await Promise.all([
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/tiers`).catch(() => []),
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/seasons`).catch(() => []),
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/players`).catch(() => []),
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/collaborators`).catch(() => ({ collaborators: [] })),
  ]);
  _clubTiers = tiers;
  _clubSeasons = seasons;
  _clubPlayers = players;
  _clubCollaborators = collaborators?.collaborators ?? [];
}

// ─── Overview (club list + create) ────────────────────────

function _clubsRenderOverview() {
  const container = document.getElementById('clubs-overview');
  if (!container) return;

  // All non-builtin communities are eligible — multiple clubs per community are allowed
  const eligible = _clubsCommunities.filter(c => !c.is_builtin);

  let html = '';

  // Club list
  if (!_clubsList.length) {
    html += `<p class="muted-note">${t('txt_clubs_no_clubs')}</p>`;
  } else {
    // Hide the Community column when every club lives in the same community
    // (the most common single-community deployment) — it's pure noise then.
    const usedCommunityIds = new Set(_clubsList.map(cl => cl.community_id));
    const showCommColumn = usedCommunityIds.size > 1;
    html += `<div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_clubs_name')}</th>
          ${showCommColumn ? `<th class="player-codes-th" style="color:var(--text-muted)">${t('txt_clubs_community')}</th>` : ''}
          <th class="player-codes-th"></th>
        </tr>
      </thead>
      <tbody>
        ${_clubsList.map(cl => {
          const comm = _clubsCommunities.find(c => c.id === cl.community_id);
          return `
          <tr class="player-codes-row">
            <td class="player-codes-name" style="font-weight:normal">
              ${cl.has_logo ? `<img src="/api/clubs/${esc(cl.id)}/logo" alt="" style="height:20px;width:20px;object-fit:cover;border-radius:3px;margin-right:0.35rem;vertical-align:middle">` : ''}
              <strong style="cursor:pointer;color:var(--accent)" onclick="clubsOpenDetail('${esc(cl.id)}')">${esc(cl.name)}</strong>
              ${cl.shared ? `<span class="badge badge-shared" style="margin-left:0.35rem">${t('txt_clubs_badge_shared')}</span>` : ''}
            </td>
            ${showCommColumn ? `<td class="player-codes-cell" style="color:var(--text-muted);font-size:0.82rem">${comm ? esc(comm.name) : esc(cl.community_id)}</td>` : ''}
            <td class="player-codes-cell-center" style="white-space:nowrap">
              ${!cl.shared || isAdmin() ? `<button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsDelete('${esc(cl.id)}')" title="${t('txt_txt_remove')}" aria-label="${t('txt_txt_remove')} ${esc(cl.name)}">🗑</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  // Create form
  html += `<div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">`;
  const canCreate = isAdmin() || (typeof canCreateClubs === 'function' && canCreateClubs());
  if (!canCreate) {
    html += `<p class="muted-note">${t('txt_clubs_creation_disabled_for_user')}</p>`;
  } else if (eligible.length) {
    html += `
      <select id="clubs-create-community" style="padding:0.4rem 0.6rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);min-width:160px">
        ${eligible.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
      </select>
      <input type="text" id="clubs-create-name" placeholder="${t('txt_clubs_name_placeholder')}" style="flex:1;min-width:140px;padding:0.4rem 0.6rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off">
      <button type="button" class="btn btn-success btn-sm" onclick="clubsCreate()">+ ${t('txt_clubs_create')}</button>`;
  } else {
    html += `<p class="muted-note">${t('txt_clubs_no_eligible')}</p>`;
  }
  html += `</div>
    <div id="clubs-msg" style="margin-top:0.5rem;font-size:0.84rem"></div>`;

  container.innerHTML = html;

  // Hide detail panel, show overview
  const detail = document.getElementById('clubs-detail');
  if (detail) detail.style.display = 'none';
  const overview = document.getElementById('clubs-overview-card');
  if (overview) overview.style.display = '';
}

async function clubsCreate() {
  const canCreate = isAdmin() || (typeof canCreateClubs === 'function' && canCreateClubs());
  if (!canCreate) return;
  const communitySelect = document.getElementById('clubs-create-community');
  const nameInput = document.getElementById('clubs-create-name');
  const msgEl = document.getElementById('clubs-msg');
  if (!communitySelect || !nameInput) return;
  const name = nameInput.value.trim();
  const community_id = communitySelect.value;
  if (!name) { _clubsMsg(msgEl, t('txt_clubs_name_required'), true); return; }
  try {
    await apiAuth('/api/clubs', {
      method: 'POST',
      body: JSON.stringify({ community_id, name }),
    });
    nameInput.value = '';
    _clubsMsg(msgEl, `✓ ${t('txt_clubs_created')}`, false);
    await _clubsLoadClubs();
    _clubsRenderOverview();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDelete(clubId) {
  const club = _clubsList.find(c => c.id === clubId);
  if (!club) return;
  if (!confirm(t('txt_clubs_delete_confirm').replace('{name}', club.name))) return;
  const msgEl = document.getElementById('clubs-msg');
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(clubId)}`, { method: 'DELETE' });
    _clubsMsg(msgEl, `✓ ${t('txt_clubs_deleted')}`, false);
    _activeClubId = null;
    await _clubsLoadClubs();
    _clubsRenderOverview();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Club detail view ────────────────────────────────────

async function clubsOpenDetail(clubId) {
  _activeClubId = clubId;
  _clubsPlayerFilter = '';  // reset filter when switching clubs
  _clubsAttachSearch = '';  // reset attach search when switching clubs
  const overviewCard = document.getElementById('clubs-overview-card');
  const detail = document.getElementById('clubs-detail');
  if (overviewCard) overviewCard.style.display = 'none';
  if (detail) detail.style.display = '';

  // Show loading
  if (detail) detail.innerHTML = '<div class="skeleton-loader"><div class="skeleton-line skeleton-line-lg"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';

  await _clubsLoadClubDetail(clubId);
  _clubsRenderDetail();
}

function clubsBackToOverview() {
  _activeClubId = null;
  _clubsRenderOverview();
}

function setClubsSport(sport) {
  _clubsSport = sport;
  try { localStorage.setItem(_CLUBS_SPORT_KEY, sport); } catch (_) {}
  // Update the global header sport pills (now in the status bar) without
  // needing a full re-render. Standings view pills have their own toggle.
  document.querySelectorAll('.clubs-sport-toggle--inline .clubs-sport-pill').forEach(btn => {
    btn.classList.toggle('clubs-sport-pill--active', btn.dataset.sport === sport);
  });
  // Re-render sport-dependent sections
  _clubsRenderTiers();
  _clubsRenderPlayers();
  _clubsRenderLeaderboard();
}

function _clubsRenderDetail() {
  const detail = document.getElementById('clubs-detail');
  if (!detail || !_activeClubId) return;

  const club = _clubsList.find(c => c.id === _activeClubId);
  if (!club) { clubsBackToOverview(); return; }

  const comm = _clubsCommunities.find(c => c.id === club.community_id);

  let html = '';
  // Status bar (back, name + logo, sport toggle, settings shortcut).
  html += _renderClubStatusBar(club, comm);

  html += `
    <!-- Players (primary content) -->
    <details class="card" open id="clubs-players-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> 👥 ${t('txt_clubs_players')}</span>
        <span class="clubs-card-badge">${_clubPlayers.length}</span>
      </summary>
      <div class="player-codes-body">
        <p class="player-codes-help">${t('txt_clubs_players_help')}</p>
        <div id="clubs-players-list"></div>
        <div id="clubs-ghost-duplicates"></div>
      </div>
    </details>

    <!-- Club leaderboard (primary content) -->
    <details class="card" open id="clubs-leaderboard-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> 📊 ${t('txt_clubs_leaderboard')}</span>
        ${(() => { const ranked = _clubPlayers.filter(p => (_clubsSport === 'padel' ? p.elo_padel : p.elo_tennis) != null); return ranked.length ? `<span class="clubs-card-badge">${ranked.length}</span>` : ''; })()}
      </summary>
      <div class="player-codes-body">
        <div id="clubs-leaderboard-scope-bar"></div>
        <div id="clubs-leaderboard"></div>
      </div>
    </details>
  `;

  // Unified Settings card (general / tiers / seasons / comms / access).
  html += _renderClubSettingsCard(club);

  detail.innerHTML = html;

  // Restore + persist collapsible state for the two primary cards.
  ['clubs-players-card', 'clubs-leaderboard-card'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const stored = sessionStorage.getItem(`clubs-card-open:${id}`);
    if (stored !== null) el.open = stored === '1';
    el.addEventListener('toggle', () => {
      try { sessionStorage.setItem(`clubs-card-open:${id}`, el.open ? '1' : '0'); } catch (_) {}
    }, { once: false });
  });

  // Render sub-sections (containers live inside Settings sub-panels + main cards).
  _clubsRenderTiers();
  _clubsRenderSeasons();
  _clubsRenderSeasonAssignment();
  _clubsRenderPlayers();  // also calls _clubsRenderLeaderboard
  _clubsRenderCollaborators();
}

// ─── Club rename ─────────────────────────────────────────

async function clubsRename() {
  const input = document.getElementById('clubs-rename-input');
  const msgEl = document.getElementById('clubs-rename-msg');
  if (!input || !_activeClubId) return;
  const name = input.value.trim();
  if (!name) { _clubsMsg(msgEl, t('txt_clubs_name_required'), true); return; }
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    _clubsMsg(msgEl, '✓', false);
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.name = name;
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Logo upload / delete ────────────────────────────────

async function clubsUploadLogo(fileInput) {
  const msgEl = document.getElementById('clubs-logo-msg');
  if (!fileInput.files.length || !_activeClubId) return;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  try {
    const token = localStorage.getItem('padel-auth-token');
    const resp = await fetch(`/api/clubs/${encodeURIComponent(_activeClubId)}/logo`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.detail || t('txt_clubs_upload_failed')); }
    _clubsMsg(msgEl, '✓', false);
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.has_logo = true;
    _clubsRenderDetail();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDeleteLogo() {
  const msgEl = document.getElementById('clubs-logo-msg');
  if (!_activeClubId) return;
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/logo`, { method: 'DELETE' });
    _clubsMsg(msgEl, '✓', false);
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.has_logo = false;
    _clubsRenderDetail();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Tiers ───────────────────────────────────────────────

function _clubsRenderTiers() {
  const container = document.getElementById('clubs-tiers-list');
  if (!container) return;
  const tiersForSport = _clubTiers.filter(tier => tier.sport === _clubsSport);
  if (!tiersForSport.length) {
    container.innerHTML = `<p class="muted-note clubs-empty-cta">${t('txt_clubs_no_tiers')} <button type="button" class="btn btn-sm btn-link" onclick="document.getElementById('clubs-tier-name')?.focus()">${t('txt_clubs_empty_create_first')}</button></p>`;
    return;
  }
  container.innerHTML = `
    <div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_clubs_tier_name')}</th>
          <th style="text-align:right;padding:0.3rem 0.5rem">${t('txt_clubs_tier_base_elo')}</th>
          <th class="player-codes-th"></th>
        </tr>
      </thead>
      <tbody>
        ${tiersForSport.map(tier => `
          <tr class="player-codes-row">
            <td class="player-codes-name">${esc(tier.name)}</td>
            <td class="player-codes-cell-center">${tier.base_elo}</td>
            <td class="player-codes-cell-center" style="white-space:nowrap">
              <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsDeleteTier('${esc(tier.id)}')" title="${t('txt_txt_remove')}" aria-label="${t('txt_txt_remove')} ${esc(tier.name)}">X</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
}

async function clubsCreateTier() {
  const nameInput = document.getElementById('clubs-tier-name');
  const eloInput = document.getElementById('clubs-tier-elo');
  const msgEl = document.getElementById('clubs-tiers-msg');
  if (!nameInput || !_activeClubId) return;
  const name = nameInput.value.trim();
  if (!name) { _clubsMsg(msgEl, t('txt_clubs_tier_name_required'), true); return; }
  const sport = _clubsSport;
  const base_elo = parseFloat(eloInput?.value) || 1000;
  const position = _clubTiers.length;
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers`, {
      method: 'POST',
      body: JSON.stringify({ name, sport, base_elo, position }),
    });
    nameInput.value = '';
    _clubsMsg(msgEl, '✓', false);
    _clubTiers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers`).catch(() => []);
    _clubsRenderTiers();
    _clubsRenderPlayers(); // refresh tier dropdowns
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDeleteTier(tierId) {
  if (!confirm(t('txt_clubs_tier_delete_confirm'))) return;
  const msgEl = document.getElementById('clubs-tiers-msg');
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers/${encodeURIComponent(tierId)}`, { method: 'DELETE' });
    _clubsMsg(msgEl, '✓', false);
    _clubTiers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers`).catch(() => []);
    _clubsRenderTiers();
    _clubsRenderPlayers();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Seasons ─────────────────────────────────────────────

function _clubsRenderSeasons() {
  const container = document.getElementById('clubs-seasons-list');
  if (!container) return;
  if (!_clubSeasons.length) {
    container.innerHTML = `<p class="muted-note clubs-empty-cta">${t('txt_clubs_no_seasons')} <button type="button" class="btn btn-sm btn-link" onclick="document.getElementById('clubs-season-name')?.focus()">${t('txt_clubs_empty_create_first')}</button></p>`;
    return;
  }
  container.innerHTML = `
    <div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_clubs_season_name')}</th>
          <th class="player-codes-th-center">${t('txt_clubs_season_status')}</th>
          <th class="player-codes-th"></th>
        </tr>
      </thead>
      <tbody>
        ${_clubSeasons.map(s => `
          <tr class="player-codes-row">
            <td class="player-codes-name">${esc(s.name)}</td>
            <td class="player-codes-cell-center">
              ${s.active
                ? `<span class="badge badge-open">${t('txt_clubs_season_active')}</span>`
                : `<span class="badge badge-closed">${t('txt_clubs_season_archived')}</span>`}
            </td>
            <td class="player-codes-cell-center" style="white-space:nowrap">
              <button class="btn btn-sm player-codes-icon-btn" onclick="clubsToggleSeason('${esc(s.id)}', ${!s.active})" title="${s.active ? t('txt_clubs_season_archive') : t('txt_clubs_season_activate')}" aria-label="${s.active ? t('txt_clubs_season_archive') : t('txt_clubs_season_activate')}">
                ${s.active ? '📦' : '✅'}
              </button>
              <button class="btn btn-sm player-codes-icon-btn" onclick="clubsViewSeasonInLeaderboard('${esc(s.id)}')" title="${t('txt_clubs_season_view_in_leaderboard')}" aria-label="${t('txt_clubs_season_view_in_leaderboard')} ${esc(s.name)}">📊</button>
              <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsDeleteSeason('${esc(s.id)}')" title="${t('txt_txt_remove')}" aria-label="${t('txt_txt_remove')} ${esc(s.name)}">🗑</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
}

async function clubsCreateSeason() {
  const nameInput = document.getElementById('clubs-season-name');
  const msgEl = document.getElementById('clubs-seasons-msg');
  if (!nameInput || !_activeClubId) return;
  const name = nameInput.value.trim();
  if (!name) { _clubsMsg(msgEl, t('txt_clubs_season_name_required'), true); return; }
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    nameInput.value = '';
    _clubsMsg(msgEl, '✓', false);
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubsRenderSeasonAssignment();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsToggleSeason(seasonId, active) {
  const msgEl = document.getElementById('clubs-seasons-msg');
  try {
    await apiAuth(`/api/seasons/${encodeURIComponent(seasonId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
    _clubsMsg(msgEl, '✓', false);
    delete _clubsSeasonStandingsCache[seasonId];
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubsRenderSeasonAssignment();
    _clubsRenderLeaderboard();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDeleteSeason(seasonId) {
  if (!confirm(t('txt_clubs_season_delete_confirm'))) return;
  const msgEl = document.getElementById('clubs-seasons-msg');
  try {
    await apiAuth(`/api/seasons/${encodeURIComponent(seasonId)}`, { method: 'DELETE' });
    _clubsMsg(msgEl, '✓', false);
    delete _clubsSeasonStandingsCache[seasonId];
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubsRenderSeasonAssignment();
    _clubsRenderLeaderboard();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Season standings ────────────────────────────────────

/**
 * Switch the leaderboard scope dropdown to a given season and scroll to
 * the leaderboard card. Replaces the old inline standings popover that
 * lived in the seasons-table message slot.
 */
function clubsViewSeasonInLeaderboard(seasonId) {
  const card = document.getElementById('clubs-leaderboard-card');
  if (card && !card.open) card.open = true;
  clubsSetLeaderboardScope(seasonId);
  if (card && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ─── Season assignment ───────────────────────────────────

function _clubsRenderSeasonAssignment() {
  const container = document.getElementById('clubs-season-assign');
  if (!container || !_activeClubId) return;

  const club = _clubsList.find(c => c.id === _activeClubId);
  if (!club) return;

  const clubCommunity = club.community_id;
  const matchingT = _clubsTournaments.filter(t => (t.community_id || 'open') === clubCommunity);
  const attachableT = _clubsTournaments.filter(t => (t.community_id || 'open') !== clubCommunity);
  const matchingR = _clubsRegistrations.filter(r => (r.community_id || 'open') === clubCommunity);

  const allSeasons = _clubSeasons;
  const hasSeasons = allSeasons.length > 0;

  const seasonOptions = allSeasons.map(s =>
    `<option value="${esc(s.id)}">${esc(s.name)}${s.active ? '' : ` (${t('txt_clubs_season_archived')})`}</option>`
  ).join('');

  let html = '';

  // Attach section — only shown when there are candidates. Flat <section>
  // (no nested <details>) so users don't need to expand it to reach the search.
  if (attachableT.length) {
    const attachFilter = _clubsAttachSearch.trim().toLowerCase();
    const filtered = [...attachableT].filter(t_ => {
      if (!attachFilter) return true;
      const comm = _clubsCommunities.find(c => c.id === (t_.community_id || 'open'));
      const haystack = `${t_.name || ''} ${comm ? comm.name : ''} ${_clubsFormatDate(t_.created_at) || ''}`.toLowerCase();
      return haystack.includes(attachFilter);
    }).sort((a, b) => {
      const d = (b.created_at || '').localeCompare(a.created_at || '');
      return d !== 0 ? d : (a.name || '').localeCompare(b.name || '');
    });

    html += `<section class="clubs-assign-section">
      <h4 class="clubs-assign-section-title">➕ ${t('txt_clubs_attach_tournaments')}</h4>
      <p class="player-codes-help" style="margin:0 0 0.5rem">${t('txt_clubs_attach_tournaments_help')}</p>
      <input type="text" id="clubs-attach-search" value="${escAttr(_clubsAttachSearch)}"
        placeholder="${escAttr(t('txt_clubs_attach_search_placeholder'))}"
        oninput="clubsSetAttachTournamentSearch(this.value)"
        class="clubs-assign-search-input">
      ${filtered.length ? `
      <div class="player-codes-table-wrap" style="margin-bottom:0.5rem"><table class="player-codes-table">
        <tbody>
          ${filtered.map(t_ => {
            const comm = _clubsCommunities.find(c => c.id === (t_.community_id || 'open'));
            return `<tr class="player-codes-row">
              <td class="player-codes-name">${esc(t_.name)}<span class="muted-note" style="margin-left:0.4rem;font-size:0.8rem">${comm ? esc(comm.name) : ''}</span></td>
              <td class="player-codes-cell" style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem">${_clubsFormatDate(t_.created_at)}</td>
              <td class="player-codes-cell" style="white-space:nowrap">
                <button type="button" class="btn btn-sm btn-primary" onclick="clubsAttachTournamentToClub('${esc(t_.id)}', this)">${t('txt_clubs_attach_to_club')}</button>
                <span id="clubs-tattach-msg-${esc(t_.id)}" style="font-size:0.78rem;margin-left:0.3rem"></span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : `<p class="muted-note">${t('txt_clubs_no_attachable_tournaments')}</p>`}
    </section>`;
  }

  if (!hasSeasons) {
    html += `<p class="muted-note">${t('txt_clubs_create_season_first')}</p>`;
    container.innerHTML = html;
    return;
  }

  // Tournaments (flat section)
  if (matchingT.length) {
    const inClubCount = matchingT.filter(t_ => t_.club_id === _activeClubId).length;
    html += `<section class="clubs-assign-section" id="clubs-season-assign-tournaments">
      <h4 class="clubs-assign-section-title">🏆 ${t('txt_clubs_tournaments_in_club')} <span class="clubs-card-badge">${inClubCount}/${matchingT.length}</span></h4>
      <div class="player-codes-table-wrap"><table class="player-codes-table">
        <tbody>
          ${matchingT.map(t_ => {
            const inThisClub = t_.club_id === _activeClubId;
            const otherClubLabel = (t_.club_id && !inThisClub) ? (t_.club_name || t_.club_id) : '';
            const clubBtnLabel = inThisClub ? t('txt_clubs_remove_from_club') : t('txt_clubs_attach_to_club');
            const clubBtnClass = inThisClub ? 'btn btn-sm btn-muted' : 'btn btn-sm btn-primary';
            const otherTag = otherClubLabel
              ? `<span class="muted-note" style="margin-left:0.4rem;font-size:0.78rem">${t('txt_clubs_currently_in_club')}: ${esc(otherClubLabel)}</span>`
              : '';
            return `
            <tr class="player-codes-row">
              <td class="player-codes-name">${esc(t_.name)}${otherTag}</td>
              <td class="player-codes-cell" style="white-space:nowrap">
                <button type="button" class="${clubBtnClass}" onclick="clubsToggleTournamentClub('${esc(t_.id)}', this)">${clubBtnLabel}</button>
                <span id="clubs-tclub-msg-${esc(t_.id)}" style="font-size:0.78rem;margin-left:0.3rem"></span>
              </td>
              <td class="player-codes-cell">
                <select id="clubs-tsn-sel-${esc(t_.id)}" class="admin-sel" onchange="clubsAssignTournamentSeason('${esc(t_.id)}')">
                  <option value="">— ${t('txt_txt_none_selected')} —</option>
                  ${seasonOptions}
                </select>
                <span id="clubs-tsn-msg-${esc(t_.id)}" style="font-size:0.78rem;margin-left:0.3rem"></span>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table></div>
    </section>`;
  } else {
    html += `<p class="muted-note">${t('txt_clubs_no_matching_tournaments')}</p>`;
  }

  // Lobbies / Registrations (flat section)
  if (matchingR.length) {
    html += `<section class="clubs-assign-section" id="clubs-season-assign-registrations">
      <h4 class="clubs-assign-section-title">📝 ${t('txt_clubs_lobbies_in_club')} <span class="clubs-card-badge">${matchingR.length}</span></h4>
      <div class="player-codes-table-wrap"><table class="player-codes-table">
        <tbody>
          ${matchingR.map(r_ => `
            <tr class="player-codes-row">
              <td class="player-codes-name">${esc(r_.name)}</td>
              <td class="player-codes-cell">
                <select id="clubs-rsn-sel-${esc(r_.id)}" class="admin-sel" onchange="clubsAssignRegistrationSeason('${esc(r_.id)}')">
                  <option value="">— ${t('txt_txt_none_selected')} —</option>
                  ${seasonOptions}
                </select>
                <span id="clubs-rsn-msg-${esc(r_.id)}" style="font-size:0.78rem;margin-left:0.3rem"></span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    </section>`;
  }

  container.innerHTML = html;

  matchingT.forEach(t_ => {
    const sel = document.getElementById(`clubs-tsn-sel-${t_.id}`);
    if (sel && t_.season_id) sel.value = t_.season_id;
  });
  matchingR.forEach(r_ => {
    const sel = document.getElementById(`clubs-rsn-sel-${r_.id}`);
    if (sel && r_.season_id) sel.value = r_.season_id;
  });
  _clubsMarkScrollableTables(container);
}

async function clubsAttachTournamentToClub(tid, btn) {
  if (!_activeClubId) return;
  const msgEl = document.getElementById(`clubs-tattach-msg-${tid}`);
  const club = _clubsList.find(c => c.id === _activeClubId);
  if (!club) return;
  if (btn) btn.disabled = true;
  _clubsMsg(msgEl, '...', false);
  try {
    const t_ = _clubsTournaments.find(t => t.id === tid);
    const needsCommunityMove = !t_ || (t_.community_id || 'open') !== club.community_id;
    if (needsCommunityMove) {
      const res = await apiAuth(`/api/tournaments/${encodeURIComponent(tid)}/community`, {
        method: 'PATCH',
        body: JSON.stringify({ community_id: club.community_id }),
      });
      if (t_) {
        t_.community_id = res?.community_id ?? club.community_id;
        if (res && 'club_id' in res) t_.club_id = res.club_id;
        if (res && 'season_id' in res) t_.season_id = res.season_id;
      }
    }
    const clubRes = await apiAuth(`/api/tournaments/${encodeURIComponent(tid)}/club`, {
      method: 'PATCH',
      body: JSON.stringify({ club_id: _activeClubId }),
    });
    if (t_) {
      t_.club_id = clubRes?.club_id ?? _activeClubId;
      if (clubRes && 'season_id' in clubRes) t_.season_id = clubRes.season_id;
      t_.club_name = club.name;
    }
    _clubsMsg(msgEl, '✓', false);
    _clubsRenderSeasonAssignment();
    if (typeof loadTournaments === 'function') {
      loadTournaments().catch(() => {});
    }
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

function clubsSetAttachTournamentSearch(query) {
  _clubsAttachSearch = query || '';
  _clubsRenderSeasonAssignment();
}

async function clubsToggleTournamentClub(tid, btn) {
  if (!_activeClubId) return;
  const msgEl = document.getElementById(`clubs-tclub-msg-${tid}`);
  const t_ = _clubsTournaments.find(t => t.id === tid);
  if (!t_) return;
  const attaching = t_.club_id !== _activeClubId;
  const targetClubId = attaching ? _activeClubId : null;
  if (btn) btn.disabled = true;
  _clubsMsg(msgEl, '...', false);
  try {
    const res = await apiAuth(`/api/tournaments/${encodeURIComponent(tid)}/club`, {
      method: 'PATCH',
      body: JSON.stringify({ club_id: targetClubId }),
    });
    t_.club_id = res?.club_id ?? targetClubId;
    if (res && 'season_id' in res) t_.season_id = res.season_id;
    if (attaching) {
      const club = _clubsList.find(c => c.id === _activeClubId);
      t_.club_name = club ? club.name : t_.club_name;
    } else {
      t_.club_name = null;
    }
    _clubsMsg(msgEl, '✓', false);
    _clubsRenderSeasonAssignment();
    if (typeof loadTournaments === 'function') {
      loadTournaments().catch(() => {});
    }
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

function _clubsFormatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

async function clubsAssignTournamentSeason(tid) {
  const sel = document.getElementById(`clubs-tsn-sel-${tid}`);
  const msgEl = document.getElementById(`clubs-tsn-msg-${tid}`);
  if (!sel) return;
  const season_id = sel.value || null;
  try {
    await apiAuth(`/api/tournaments/${encodeURIComponent(tid)}/season`, {
      method: 'PATCH',
      body: JSON.stringify({ season_id }),
    });
    const t_ = _clubsTournaments.find(t => t.id === tid);
    if (t_) t_.season_id = season_id;
    _clubsMsg(msgEl, '✓', false);
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsAssignRegistrationSeason(rid) {
  const sel = document.getElementById(`clubs-rsn-sel-${rid}`);
  const msgEl = document.getElementById(`clubs-rsn-msg-${rid}`);
  if (!sel) return;
  const season_id = sel.value || null;
  try {
    await apiAuth(`/api/registrations/${encodeURIComponent(rid)}/season`, {
      method: 'PATCH',
      body: JSON.stringify({ season_id }),
    });
    const r_ = _clubsRegistrations.find(r => r.id === rid);
    if (r_) r_.season_id = season_id;
    _clubsMsg(msgEl, '✓', false);
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Players ─────────────────────────────────────────────

function clubsSetPlayerFilter(value) {
  _clubsPlayerFilter = value.trim().toLowerCase();
  _clubsRenderPlayers();
}

function _clubsIsHiddenInCurrentSport(player) {
  return _clubsSport === 'padel' ? !!player.hidden_padel : !!player.hidden_tennis;
}

function _clubsGetFilteredPlayers() {
  const filterQ = _clubsPlayerFilter;
  if (!filterQ) return _clubPlayers;
  return _clubPlayers.filter(p =>
    (p.name || '').toLowerCase().includes(filterQ)
    || (p.email || '').toLowerCase().includes(filterQ)
  );
}

function _clubsRenderPlayers() {
  const container = document.getElementById('clubs-players-list');
  if (!container) return;

  const visiblePlayerIds = new Set(_clubPlayers.map(p => p.profile_id));
  // Prune any selected recipients that no longer exist in the current roster.
  // (Sport-visibility pruning is handled when the Comms panel renders.)
  _clubsInviteSelectedIds = new Set(
    Array.from(_clubsInviteSelectedIds).filter(profileId => visiblePlayerIds.has(profileId))
  );

  const sport = _clubsSport;
  const tierOptions = _clubTiers
    .filter(tier => tier.sport === sport)
    .map(tier => `<option value="${esc(tier.id)}">${esc(tier.name)} (${tier.base_elo})</option>`)
    .join('');

  const eloInputStyle = 'width:4.5rem;padding:0.15rem 0.3rem;font-size:0.82rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);text-align:right';
  const selStyle = 'padding:0.2rem 0.3rem;font-size:0.82rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);max-width:120px';
  const sportLabel = sport === 'padel' ? t('txt_txt_sport_padel') : t('txt_txt_sport_tennis');

  // Filtered players for the table (applied to both visible and hidden-from-sport sections)
  const filteredPlayers = _clubsGetFilteredPlayers();

  const visibleForSport = filteredPlayers.filter(p => sport === 'padel' ? !p.hidden_padel : !p.hidden_tennis);
  const hiddenFromSport = filteredPlayers.filter(p => sport === 'padel' ? p.hidden_padel : p.hidden_tennis);

  // Add player form (inline labeled row, no nested card)
  let html = `
    <div class="clubs-add-player-row">
      <label class="clubs-add-player-label" for="clubs-add-player-input">${t('txt_clubs_add_player')}</label>
      <input type="text" id="clubs-add-player-input" placeholder="${t('txt_clubs_add_player_placeholder')}" autocomplete="off"
        oninput="_clubsPlayerSearchInput(this.value)" onchange="_clubsPlayerSuggestionChosen(this.value)" list="clubs-add-player-suggestions">
      <datalist id="clubs-add-player-suggestions"></datalist>
      <button class="btn btn-sm btn-success" id="clubs-add-player-btn" onclick="clubsAddPlayer()" disabled>+ ${t('txt_txt_add')}</button>
      <span id="clubs-add-player-msg" class="clubs-add-player-msg"></span>
    </div>
    <div class="clubs-players-toolbar">
      <div class="clubs-players-filter-wrap">
        <input type="search" id="clubs-player-filter-input" value="${esc(_clubsPlayerFilter)}" placeholder="${t('txt_clubs_player_filter_placeholder')}"
          style="flex:1;min-width:180px;padding:0.3rem 0.5rem;font-size:0.88rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"
          oninput="clubsSetPlayerFilter(this.value)">
        ${_clubsPlayerFilter ? `<button class="btn btn-sm btn-muted" type="button" onclick="clubsSetPlayerFilter('')">${t('txt_txt_clear')}</button>` : ''}
      </div>
    </div>
    ${_clubsRosterNoticeText ? `<div class="alert ${_clubsRosterNoticeError ? 'alert-error' : 'alert-success'} clubs-roster-notice" role="status" aria-live="polite">${esc(_clubsRosterNoticeText)}</div>` : ''}`;

  if (!_clubPlayers.length) {
    html += `<p class="muted-note">${t('txt_clubs_no_players')}</p>`;
  } else if (!filteredPlayers.length) {
    html += `<p class="muted-note">${t('txt_txt_no_results') || 'No players match the filter.'}</p>`;
  } else {
    html += `
    <div class="player-codes-table-wrap">
      <table class="player-codes-table">
        <thead>
          <tr class="player-codes-head-row">
            <th class="player-codes-th">${t('txt_player_leaderboard_name')}</th>
            <th class="player-codes-th">${t('txt_clubs_hub_status')}</th>
            <th class="player-codes-th">${t('txt_txt_email')}</th>
            <th class="player-codes-th-center">${sportLabel} ELO</th>
            <th class="player-codes-th-center">${t('txt_clubs_player_matches')}</th>
            <th class="player-codes-th">${sportLabel} ${t('txt_clubs_tier')}</th>
            <th class="player-codes-th"></th>
          </tr>
        </thead>
        <tbody>
          ${visibleForSport.map(p => {
            const eloVal = sport === 'padel' ? p.elo_padel : p.elo_tennis;
            const matchCount = sport === 'padel' ? p.matches_padel : p.matches_tennis;
            const noGames = matchCount === 0;
            const hasEmail = Boolean(p.email);
            const hasHub = p.has_hub_profile !== false;
            const hideTip = t('txt_clubs_hide_from_sport').replace('{sport}', sportLabel);
            const removeTip = t('txt_clubs_remove_all_sports');
            return `
            <tr class="player-codes-row">
              <td class="player-codes-name">
                ${esc(p.name)}
                ${noGames ? `<span class="muted-tiny" style="margin-left:0.3rem">(${t('txt_txt_no_matches')})</span>` : ''}
              </td>
              <td class="player-codes-cell">${hasHub
                ? `<span class="muted-tiny" style="color:var(--green)">${t('txt_clubs_hub_yes')}</span>`
                : `<span class="muted-tiny" style="color:var(--text-muted)">${t('txt_clubs_hub_no')}</span>`}</td>
              <td class="player-codes-cell">${hasEmail ? esc(p.email) : `<span class="muted-tiny">${t('txt_clubs_player_no_email')}</span>`}</td>
              <td class="player-codes-cell-center">
                <input type="number" id="clubs-elo-${sport}-${esc(p.profile_id)}" min="0" max="4000" step="1"
                  value="${eloVal != null ? eloVal : ''}" placeholder="—"
                  style="${eloInputStyle}"
                  oninput="_clubsDebouncedSaveElo('${esc(p.profile_id)}', '${sport}')">
                <span id="clubs-elo-${sport}-msg-${esc(p.profile_id)}" style="font-size:0.78rem;margin-left:0.15rem"></span>
              </td>
              <td class="player-codes-cell-center">
                <span class="muted-tiny">${matchCount != null ? matchCount : '—'}</span>
              </td>
              <td class="player-codes-cell" style="white-space:nowrap">
                <select id="clubs-ptier-${sport}-${esc(p.profile_id)}" style="${selStyle}"
                  onchange="clubsAssignTier('${esc(p.profile_id)}', '${sport}')">
                  <option value="">— ${t('txt_txt_none_selected')} —</option>
                  ${tierOptions}
                </select>
                <span id="clubs-ptier-${sport}-msg-${esc(p.profile_id)}" style="font-size:0.78rem;margin-left:0.15rem"></span>
              </td>
              <td class="player-codes-cell-center" style="white-space:nowrap">
                <button class="btn btn-sm player-codes-icon-btn" onclick="clubsTogglePlayerSport('${esc(p.profile_id)}', '${sport}', false)" title="${esc(hideTip)}" aria-label="${esc(hideTip)} ${esc(p.name)}" style="color:var(--text-muted)">&#x2296;</button>
                <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsRemovePlayer('${esc(p.profile_id)}', '${esc(p.name)}')" title="${esc(removeTip)}" aria-label="${esc(removeTip)} ${esc(p.name)}">&#x2715;</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

    if (!visibleForSport.length && hiddenFromSport.length) {
      html += `<p class="muted-note" style="margin-top:0.5rem">${t('txt_txt_no_results')}</p>`;
    }

    if (hiddenFromSport.length) {
      html += `
    <details style="margin-top:0.75rem;border:1px solid var(--border);border-radius:6px;padding:0 0.75rem">
      <summary style="cursor:pointer;user-select:none;padding:0.5rem 0;font-size:0.85rem;font-weight:600;list-style:none;display:flex;align-items:center;gap:0.4rem">
        <span class="tv-chevron" style="font-size:0.65em;color:var(--text-muted)">&#9658;</span>
        ${t('txt_clubs_hidden_from_sport_title').replace('{sport}', sportLabel).replace('{n}', String(hiddenFromSport.length))}
      </summary>
      <div style="padding:0.4rem 0 0.75rem">
        <div class="player-codes-table-wrap">
          <table class="player-codes-table">
            <thead><tr class="player-codes-head-row">
              <th class="player-codes-th">${t('txt_player_leaderboard_name')}</th>
              <th class="player-codes-th-center">${sportLabel} ELO</th>
              <th class="player-codes-th-center">${t('txt_clubs_player_matches')}</th>
              <th class="player-codes-th"></th>
            </tr></thead>
            <tbody>
              ${hiddenFromSport.map(p => {
                const eloVal = sport === 'padel' ? p.elo_padel : p.elo_tennis;
                const matchCount = sport === 'padel' ? p.matches_padel : p.matches_tennis;
                const restoreTip = t('txt_clubs_restore_for_sport').replace('{sport}', sportLabel);
                const removeTip = t('txt_clubs_remove_all_sports');
                return `
              <tr class="player-codes-row" style="opacity:0.65">
                <td class="player-codes-name">${esc(p.name)}</td>
                <td class="player-codes-cell-center"><span class="muted-tiny">${eloVal != null ? Math.round(eloVal) : '—'}</span></td>
                <td class="player-codes-cell-center"><span class="muted-tiny">${matchCount != null ? matchCount : '—'}</span></td>
                <td class="player-codes-cell-center" style="white-space:nowrap">
                  <button class="btn btn-sm btn-success player-codes-icon-btn" onclick="clubsTogglePlayerSport('${esc(p.profile_id)}', '${sport}', true)" title="${esc(restoreTip)}" aria-label="${esc(restoreTip)} ${esc(p.name)}">&#x2295;</button>
                  <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsRemovePlayer('${esc(p.profile_id)}', '${esc(p.name)}')" title="${esc(removeTip)}" aria-label="${esc(removeTip)} ${esc(p.name)}">&#x2715;</button>
                </td>
              </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </details>`;
    }
  }

  container.innerHTML = html;

  // Restore filter input value (re-rendered so cursor is lost, but value is preserved)
  const filterInput = document.getElementById('clubs-player-filter-input');
  if (filterInput && filterInput.value !== _clubsPlayerFilter) filterInput.value = _clubsPlayerFilter;

  // Refresh the messaging panel in Comms (kept in sync with the player selection).
  _clubsRenderMessagingPanelInto();

  // Set selected tier for each player
  filteredPlayers.forEach(p => {
    const sel = document.getElementById(`clubs-ptier-${sport}-${p.profile_id}`);
    const tierId = sport === 'padel' ? p.tier_id_padel : p.tier_id_tennis;
    if (sel && tierId) sel.value = tierId;
  });

  _clubsMarkScrollableTables(container);
  _clubsRenderLeaderboard();
  _clubsRenderGhostDuplicates();
}

// ─── Ghost profile → Hub profile conversion ──────────────

function clubsShowConvertGhostForm(profileId, currentName) {
  // Render a small overlay card inside the possible-members container
  const area = document.getElementById('clubs-ghost-duplicates');
  const container = area || document.querySelector('#clubs-players-list');
  if (!container) return;

  const formHtml = `
    <div id="clubs-convert-ghost-form" style="margin-top:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
      <p style="margin:0 0 0.4rem;font-size:0.88rem;font-weight:600">${t('txt_ph_convert_ghost_title')} — <em>${esc(currentName)}</em></p>
      <p style="margin:0 0 0.6rem;font-size:0.82rem;color:var(--text-muted)">${t('txt_ph_convert_ghost_help')}</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:0.84rem;display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:130px">
          ${t('txt_txt_name')}
          <input type="text" id="clubs-convert-name" value="${escAttr(currentName)}"
            style="padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"
            aria-label="${t('txt_txt_name')}">
        </label>
        <label style="font-size:0.84rem;display:flex;flex-direction:column;gap:0.2rem;flex:2;min-width:160px">
          ${t('txt_txt_email')} <span style="font-weight:400;color:var(--text-muted)">(${t('txt_txt_optional')})</span>
          <input type="email" id="clubs-convert-email" placeholder="${t('txt_ph_convert_email_placeholder')}"
            style="padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"
            aria-label="${t('txt_txt_email')}">
        </label>
        <button type="button" class="btn btn-success btn-sm" onclick="clubsConvertGhost('${escAttr(profileId)}')">${t('txt_ph_convert_confirm')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="document.getElementById('clubs-convert-ghost-form')?.remove()">${t('txt_txt_cancel')}</button>
      </div>
      <div id="clubs-convert-msg" style="margin-top:0.4rem;font-size:0.82rem"></div>
    </div>`;

  document.getElementById('clubs-convert-ghost-form')?.remove();
  if (area) {
    area.insertAdjacentHTML('afterbegin', formHtml);
  } else {
    container.insertAdjacentHTML('afterend', formHtml);
  }
}

async function clubsConvertGhost(profileId) {
  const nameInput = document.getElementById('clubs-convert-name');
  const emailInput = document.getElementById('clubs-convert-email');
  const msgEl = document.getElementById('clubs-convert-msg');
  const name = nameInput?.value?.trim() || null;
  const email = emailInput?.value?.trim() || null;

  if (msgEl) msgEl.innerHTML = `<em>${t('txt_ph_converting')}</em>`;

  try {
    const result = await apiAuth(
      `/api/clubs/${encodeURIComponent(_activeClubId)}/players/${encodeURIComponent(profileId)}/convert-ghost`,
      { method: 'POST', body: JSON.stringify({ name, email }) },
    );
    document.getElementById('clubs-convert-ghost-form')?.remove();
    // Reload roster and possible members
    const [players] = await Promise.all([
      apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []),
    ]);
    _clubPlayers = players;
    _clubsRenderPlayers();
    await _clubsRenderPossibleMembers();
    // Show passphrase banner at top of possible-members container
    const area = document.getElementById('clubs-ghost-duplicates');
    if (area) {
      const banner = document.createElement('div');
      banner.className = 'alert alert-info';
      banner.style.marginTop = '0.5rem';
      banner.innerHTML = `<strong>${t('txt_ph_convert_ok', { name: esc(result.name) })}</strong><br>
        <span style="font-size:0.84rem">${t('txt_ph_convert_passphrase_label')}: </span>
        <code class="player-codes-passphrase" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code>
        ${result.email ? `<br><span style="font-size:0.8rem;color:var(--text-muted)">${t('txt_ph_convert_email_sent', { email: esc(result.email) })}</span>` : ''}`;
      area.prepend(banner);
      setTimeout(() => banner.remove(), 14000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--error)">${esc(e.message)}</span>`;
  }
}

async function clubsAddGhostToRoster(profileId) {
  const btnId = `clubs-add-roster-btn-${CSS.escape(profileId)}`;
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = t('txt_clubs_adding_to_roster'); }
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: profileId }),
    });
    const [players] = await Promise.all([
      apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []),
    ]);
    _clubPlayers = players;
    _clubsRenderPlayers();
    await _clubsRenderPossibleMembers();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_clubs_add_to_roster'); }
    const area = document.getElementById('clubs-ghost-duplicates');
    if (area) {
      const err = document.createElement('div');
      err.style.cssText = 'color:var(--error);font-size:0.82rem;margin-top:0.3rem';
      err.textContent = e.message;
      area.prepend(err);
      setTimeout(() => err.remove(), 5000);
    }
  }
}

// ─── Possible members (past participants / ghost profiles) ─

let _clubsGhostGroups = [];
let _clubsGhostMergeOpen = false;
let _clubsPossibleMembersOpen = false;
let _clubsSelectedGhostProfiles = new Set();
let _clubsPossibleGhostMembers = [];


function clubsSetGhostSearch(value) {
  _clubsGhostSearch = String(value || '');
  try { localStorage.setItem(_CLUBS_GHOST_SEARCH_KEY, _clubsGhostSearch); } catch (_) {}
  _clubsRenderPossibleMembers(false);
}


function clubsToggleGhostMergeSelect(profileId, checked) {
  if (checked) {
    _clubsSelectedGhostProfiles.add(profileId);
  } else {
    _clubsSelectedGhostProfiles.delete(profileId);
  }
  _clubsRenderPossibleMembers(false);
}


function clubsClearGhostMergeSelection() {
  _clubsSelectedGhostProfiles = new Set();
  _clubsRenderPossibleMembers(false);
}


async function clubsConsolidateSelectedGhosts() {
  if (!_activeClubId || _clubsSelectedGhostProfiles.size < 2) return;

  const sourceIds = [..._clubsSelectedGhostProfiles];
  const selectedNames = sourceIds
    .map(id => {
      const groupProfile = _clubsGhostGroups.flatMap(g => g.profiles).find(p => p.profile_id === id);
      const rosterProfile = _clubPlayers.find(p => p.profile_id === id);
      return groupProfile?.name || rosterProfile?.name || id;
    })
    .join(', ');

  if (!confirm(t('txt_ph_consolidate_confirm', { names: selectedNames }))) return;

  const msgEl = document.getElementById('clubs-ghost-manual-msg');
  const nameInput = document.getElementById('clubs-ghost-manual-name');
  const name = nameInput?.value?.trim() || null;
  if (msgEl) msgEl.innerHTML = `<em>${t('txt_ph_consolidating')}</em>`;

  try {
    const result = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/consolidate-ghosts`, {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds, name }),
    });
    _clubsSelectedGhostProfiles = new Set();

    const players = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
    _clubPlayers = players;
    _clubsRenderPlayers();

    const area = document.getElementById('clubs-ghost-duplicates');
    if (area) {
      const banner = document.createElement('div');
      banner.className = 'alert alert-info';
      banner.style.marginTop = '0.5rem';
      banner.textContent = t('txt_ph_consolidate_ok', { name: esc(result.name || name || '') });
      area.prepend(banner);
      setTimeout(() => banner.remove(), 4000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--error)">${esc(e.message)}</span>`;
  }
}

async function _clubsRenderPossibleMembers(forceReload = true) {
  const container = document.getElementById('clubs-ghost-duplicates');
  if (!container || !_activeClubId) return;

  let members = _clubsPossibleGhostMembers;
  let groups = _clubsGhostGroups;
  if (forceReload) {
    members = [];
    groups = [];
    try {
      [members, groups] = await Promise.all([
        apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/possible-members`),
        apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/ghost-duplicates`),
      ]);
    } catch (_) {}
    _clubsPossibleGhostMembers = members;
    _clubsGhostGroups = groups;
  }

  const validMemberIds = new Set(members.map(m => m.profile_id));
  _clubsSelectedGhostProfiles = new Set(
    [..._clubsSelectedGhostProfiles].filter(profileId => validMemberIds.has(profileId)),
  );

  if (!members.length) {
    container.innerHTML = '';
    return;
  }

  const ghostFilter = _clubsGhostSearch.trim().toLowerCase();
  const filteredMembers = ghostFilter
    ? members.filter(p =>
      (p.name || '').toLowerCase().includes(ghostFilter) ||
      String(p.profile_id || '').toLowerCase().includes(ghostFilter)
    )
    : members;

  const sport = _clubsSport;
  let html = `
    <details id="clubs-possible-members-details"${_clubsPossibleMembersOpen ? ' open' : ''} class="clubs-ghost-section">
      <summary class="clubs-ghost-section-summary"
        onclick="_clubsPossibleMembersOpen = document.getElementById('clubs-possible-members-details')?.open ?? false">
        <span class="tv-chevron clubs-ghost-section-chevron">&#9658;</span>
        ${t('txt_clubs_possible_members_title', { n: members.length })}
        <span class="muted-tiny clubs-ghost-section-hint">${t('txt_clubs_possible_members_hint')}</span>
      </summary>
      <div class="clubs-ghost-section-body">
        <div class="clubs-ghost-search-row">
          <input type="text" id="clubs-ghost-search-input" value="${escAttr(_clubsGhostSearch)}"
            oninput="clubsSetGhostSearch(this.value)"
            placeholder="${t('txt_clubs_possible_members_search_placeholder')}"
            class="clubs-ghost-search-input"
            aria-label="${t('txt_clubs_possible_members_search_placeholder')}">
          ${ghostFilter ? `<button type="button" class="btn btn-sm btn-muted" onclick="clubsSetGhostSearch('')">${t('txt_txt_clear')}</button>` : ''}
          <span class="muted-tiny">${filteredMembers.length}/${members.length}</span>
        </div>
        <div class="player-codes-table-wrap">
          <table class="player-codes-table">
            <thead><tr class="player-codes-head-row">
              <th class="player-codes-th-center" style="width:2rem"></th>
              <th class="player-codes-th">${t('txt_player_leaderboard_name')}</th>
              <th class="player-codes-th-center">${sport === 'padel' ? t('txt_ph_padel_elo') : t('txt_ph_tennis_elo')}</th>
              <th class="player-codes-th-center">${t('txt_clubs_player_matches')}</th>
              <th class="player-codes-th"></th>
            </tr></thead>
            <tbody>`;

  for (const p of filteredMembers) {
    const elo = sport === 'padel' ? p.elo_padel : p.elo_tennis;
    const matches = sport === 'padel' ? p.matches_padel : p.matches_tennis;
    const isSelected = _clubsSelectedGhostProfiles.has(p.profile_id);
    html += `
      <tr class="player-codes-row">
        <td class="player-codes-cell-center">
          <input type="checkbox" ${isSelected ? 'checked' : ''}
            onchange="clubsToggleGhostMergeSelect('${escAttr(p.profile_id)}', this.checked)"
            aria-label="${t('txt_ph_select_for_merge')} ${escAttr(p.name)}"
            style="cursor:pointer">
        </td>
        <td class="player-codes-name">${esc(p.name)}</td>
        <td class="player-codes-cell-center">${elo != null ? Math.round(elo) : '—'}</td>
        <td class="player-codes-cell-center">${matches != null ? matches : '—'}</td>
        <td class="player-codes-cell-center" style="white-space:nowrap">
          <button class="btn btn-sm btn-success"
            onclick="clubsShowConvertGhostForm('${esc(p.profile_id)}', '${escAttr(p.name)}')"
            title="${t('txt_ph_convert_ghost_hint')}"
            style="font-size:0.78rem">${t('txt_ph_convert_ghost')}</button>
        </td>
      </tr>`;
  }

  html += `</tbody></table></div>`;

  if (!filteredMembers.length) {
    html += `<p class="muted-note" style="margin-top:0.5rem">${t('txt_txt_no_results')}</p>`;
  }

  if (_clubsSelectedGhostProfiles.size >= 2) {
    const selectedNames = [..._clubsSelectedGhostProfiles]
      .map(id => members.find(p => p.profile_id === id)?.name || id)
      .filter(Boolean);
    const suggestedName = selectedNames[0] || '';
    html += `
      <div class="clubs-ghost-merge-bar">
        <span class="clubs-ghost-merge-bar-label">${t('txt_ph_ghosts_selected', { n: _clubsSelectedGhostProfiles.size })}</span>
        <input type="text" id="clubs-ghost-manual-name" value="${escAttr(suggestedName)}"
          placeholder="${t('txt_ph_consolidate_name_placeholder')}"
          class="clubs-ghost-merge-bar-input"
          aria-label="${t('txt_ph_consolidate_name_label')}">
        <button type="button" class="btn btn-primary btn-sm" onclick="clubsConsolidateSelectedGhosts()">${t('txt_ph_consolidate_ghosts')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="clubsClearGhostMergeSelection()">${t('txt_txt_clear')}</button>
      </div>
      <div id="clubs-ghost-manual-msg" class="clubs-ghost-merge-bar-msg"></div>`;
  }

  // Duplicate-group merge section (if any)
  if (_clubsGhostGroups.length) {
    html += `
      <details id="clubs-ghost-dup-details"${_clubsGhostMergeOpen ? ' open' : ''} class="clubs-ghost-section clubs-ghost-section--inner">
        <summary class="clubs-ghost-section-summary"
          onclick="_clubsGhostMergeOpen = document.getElementById('clubs-ghost-dup-details')?.open ?? false">
          <span class="tv-chevron clubs-ghost-section-chevron">&#9658;</span>
          ${t('txt_clubs_ghost_dup_title', { n: _clubsGhostGroups.length })}
          <span class="muted-tiny clubs-ghost-section-hint">${t('txt_clubs_ghost_dup_hint')}</span>
        </summary>
        <div class="clubs-ghost-section-body">`;

    for (const [gi, group] of _clubsGhostGroups.entries()) {
      html += `
        <div class="clubs-ghost-group-card">
          <div class="clubs-ghost-group-name">${esc(group.name)}</div>
          <div class="player-codes-table-wrap clubs-ghost-group-table-wrap">
            <table class="player-codes-table" style="font-size:0.82rem">
              <thead><tr class="player-codes-head-row">
                <th class="player-codes-th-center" style="width:2rem">#</th>
                <th class="player-codes-th">${t('txt_ph_padel_elo')}</th>
                <th class="player-codes-th-center">${t('txt_clubs_player_matches')}</th>
              </tr></thead><tbody>`;
      for (const [pi, p] of group.profiles.entries()) {
        const elo = p.elo_padel != null ? `${Math.round(p.elo_padel)}` : '—';
        const matches = p.matches_padel != null ? p.matches_padel : 0;
        html += `<tr class="player-codes-row">
          <td class="player-codes-cell-center"><span style="font-size:0.76rem;color:var(--text-muted)">${pi + 1}</span></td>
          <td class="player-codes-cell">${elo}</td>
          <td class="player-codes-cell-center">${matches}</td>
        </tr>`;
      }
      html += `</tbody></table></div>
          <div class="clubs-ghost-group-actions">
            <label class="clubs-ghost-group-name-label">${t('txt_ph_consolidate_name_label')}:
              <input type="text" id="clubs-ghost-name-${gi}" value="${escAttr(group.name)}"
                class="clubs-ghost-group-name-input"
                aria-label="${t('txt_ph_consolidate_name_label')}">
            </label>
            <button type="button" class="btn btn-sm btn-primary" onclick="clubsConsolidateGhostGroup(${gi})">${t('txt_ph_consolidate_ghosts')}</button>
          </div>
          <div id="clubs-ghost-msg-${gi}" class="clubs-ghost-group-msg"></div>
        </div>`;
    }
    html += `</div></details>`;
  }

  html += `</div></details>`;
  container.innerHTML = html;
}

// Keep old name as alias so existing callers (e.g. _clubsRenderPlayers) still work
// until all references are updated.
function _clubsRenderGhostDuplicates() {
  return _clubsRenderPossibleMembers();
}

async function clubsConsolidateGhostGroup(groupIndex) {
  const group = _clubsGhostGroups[groupIndex];
  if (!group || !_activeClubId) return;

  const nameInput = document.getElementById(`clubs-ghost-name-${groupIndex}`);
  const msgEl = document.getElementById(`clubs-ghost-msg-${groupIndex}`);
  const name = nameInput?.value?.trim() || group.name;
  const sourceIds = group.profiles.map(p => p.profile_id);

  if (!confirm(t('txt_ph_consolidate_confirm', { names: esc(group.name) }))) return;
  if (msgEl) msgEl.innerHTML = `<em>${t('txt_ph_consolidating')}</em>`;

  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/consolidate-ghosts`, {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds, name }),
    });
    const players = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
    _clubPlayers = players;
    _clubsRenderPlayers();
    // Show brief banner
    const area = document.getElementById('clubs-ghost-duplicates');
    if (area) {
      const banner = document.createElement('div');
      banner.className = 'alert alert-info';
      banner.style.marginTop = '0.5rem';
      banner.textContent = t('txt_ph_consolidate_ok', { name: esc(name) });
      area.prepend(banner);
      setTimeout(() => banner.remove(), 4000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--error)">${esc(e.message)}</span>`;
  }
}

// ─── Club leaderboard (ELO ranking across all members) ───

function clubsSortLeaderboard(col) {
  if (_clubsLeaderboardSort.col === col) {
    _clubsLeaderboardSort.dir = _clubsLeaderboardSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _clubsLeaderboardSort = { col, dir: col === 'name' ? 'asc' : 'desc' };
  }
  _clubsRenderLeaderboard();
}

function clubsSetLeaderboardScope(scope) {
  _clubsLeaderboardScope = scope || 'global';
  try { sessionStorage.setItem(_CLUBS_LB_SCOPE_KEY, _clubsLeaderboardScope); } catch (_) {}
  _clubsRenderLeaderboard();
}

function _clubsRenderLeaderboardScopeBar() {
  const bar = document.getElementById('clubs-leaderboard-scope-bar');
  if (!bar) return;
  const seasons = Array.isArray(_clubSeasons) ? _clubSeasons : [];
  if (!seasons.length) {
    bar.innerHTML = '';
    return;
  }
  const opts = [
    `<option value="global"${_clubsLeaderboardScope === 'global' ? ' selected' : ''}>${esc(t('txt_clubs_leaderboard_scope_global'))}</option>`,
    ...seasons.map(s => {
      const label = s.active ? s.name : `${s.name} (${t('txt_clubs_season_archived')})`;
      return `<option value="${esc(s.id)}"${_clubsLeaderboardScope === s.id ? ' selected' : ''}>${esc(label)}</option>`;
    }),
  ].join('');
  const activeSeason = seasons.find(s => s.id === _clubsLeaderboardScope);
  const archivedBadge = (activeSeason && !activeSeason.active)
    ? `<span class="badge badge-closed clubs-lb-frozen-badge" title="${escAttr(t('txt_clubs_leaderboard_archived_note'))}">📦 ${esc(t('txt_clubs_season_archived'))}</span>`
    : '';
  bar.innerHTML = `
    <div class="clubs-lb-scope-row">
      <label class="clubs-lb-scope-label" for="clubs-lb-scope-sel">${esc(t('txt_clubs_leaderboard_scope_label'))}</label>
      <select id="clubs-lb-scope-sel" class="select" onchange="clubsSetLeaderboardScope(this.value)">${opts}</select>
      ${archivedBadge}
    </div>`;
}

function _clubsRenderLeaderboard() {
  _clubsRenderLeaderboardScopeBar();
  // Auto-fall-back to global if a previously selected season no longer exists.
  if (_clubsLeaderboardScope !== 'global'
      && Array.isArray(_clubSeasons)
      && !_clubSeasons.some(s => s.id === _clubsLeaderboardScope)) {
    _clubsLeaderboardScope = 'global';
  }
  if (_clubsLeaderboardScope === 'global') {
    _clubsRenderGlobalLeaderboard();
  } else {
    _clubsRenderSeasonLeaderboard(_clubsLeaderboardScope);
  }
}

function _clubsRenderGlobalLeaderboard() {
  const container = document.getElementById('clubs-leaderboard');
  if (!container) return;

  const sport = _clubsSport;
  const ranked = [..._clubPlayers]
    .filter(p => sport === 'padel' ? (!p.hidden_padel && p.elo_padel != null) : (!p.hidden_tennis && p.elo_tennis != null));

  if (!ranked.length) {
    container.innerHTML = `<p class="muted-note">${t('txt_clubs_leaderboard_no_players')}</p>`;
    return;
  }

  const { col, dir } = _clubsLeaderboardSort;
  ranked.sort((a, b) => {
    let aVal, bVal;
    if (col === 'elo') {
      aVal = sport === 'padel' ? (a.elo_padel ?? 0) : (a.elo_tennis ?? 0);
      bVal = sport === 'padel' ? (b.elo_padel ?? 0) : (b.elo_tennis ?? 0);
    } else if (col === 'matches') {
      aVal = sport === 'padel' ? (a.matches_padel ?? 0) : (a.matches_tennis ?? 0);
      bVal = sport === 'padel' ? (b.matches_padel ?? 0) : (b.matches_tennis ?? 0);
    } else { // name
      aVal = (a.name || '').toLowerCase();
      bVal = (b.name || '').toLowerCase();
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return dir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const sortIcon = (c) => {
    if (_clubsLeaderboardSort.col !== c) return '<span class="clubs-sort-icon clubs-sort-icon--neutral">⇅</span>';
    return dir === 'asc'
      ? '<span class="clubs-sort-icon clubs-sort-icon--active">▲</span>'
      : '<span class="clubs-sort-icon clubs-sort-icon--active">▼</span>';
  };

  container.innerHTML = `
    <div class="player-codes-table-wrap">
      <table class="player-codes-table">
        <thead>
          <tr class="player-codes-head-row">
            <th class="player-codes-th-center">#</th>
            <th class="player-codes-th clubs-sortable-th" onclick="clubsSortLeaderboard('name')">${t('txt_player_leaderboard_name')} ${sortIcon('name')}</th>
            <th class="player-codes-th-center clubs-sortable-th" onclick="clubsSortLeaderboard('elo')">${t('txt_player_elo_rating')} ${sortIcon('elo')}</th>
            <th class="player-codes-th-center clubs-sortable-th" onclick="clubsSortLeaderboard('matches')">${t('txt_player_leaderboard_matches')} ${sortIcon('matches')}</th>
          </tr>
        </thead>
        <tbody>
          ${ranked.map((p, i) => {
            const elo = sport === 'padel' ? p.elo_padel : p.elo_tennis;
            const matches = sport === 'padel' ? p.matches_padel : p.matches_tennis;
            return `
            <tr class="player-codes-row">
              <td class="player-codes-cell-center" style="color:var(--text-muted)">${i + 1}</td>
              <td class="player-codes-name">${esc(p.name)}</td>
              <td class="player-codes-cell-center">${elo != null ? Math.round(elo) : '—'}</td>
              <td class="player-codes-cell-center">${matches != null ? matches : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  _clubsMarkScrollableTables(container);
}

async function _clubsRenderSeasonLeaderboard(seasonId) {
  const container = document.getElementById('clubs-leaderboard');
  if (!container) return;
  const season = (_clubSeasons || []).find(s => s.id === seasonId);
  const sport = _clubsSport;

  const cached = _clubsSeasonStandingsCache[seasonId];
  // Active seasons may shift with new matches — always refetch on render.
  // Archived seasons are immutable; serve from cache when available.
  if (!cached || (season && season.active)) {
    container.innerHTML = `<div class="skeleton-loader"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>`;
    try {
      const data = await apiAuth(`/api/seasons/${encodeURIComponent(seasonId)}/standings`);
      _clubsSeasonStandingsCache[seasonId] = data;
    } catch (e) {
      container.innerHTML = `<p class="muted-note" style="color:var(--red)">${esc(e.message)}</p>`;
      return;
    }
  }

  const data = _clubsSeasonStandingsCache[seasonId] || { padel: [], tennis: [] };
  const rows = (data[sport] || []).slice();
  if (!rows.length) {
    container.innerHTML = `<p class="muted-note">${t('txt_clubs_season_no_standings')}</p>`;
    return;
  }

  const { col, dir } = _clubsLeaderboardSort;
  rows.sort((a, b) => {
    let aVal, bVal;
    if (col === 'elo') {
      aVal = a.elo_end ?? 0;
      bVal = b.elo_end ?? 0;
    } else if (col === 'matches') {
      aVal = a.matches_played ?? 0;
      bVal = b.matches_played ?? 0;
    } else {
      aVal = (a.player_name || '').toLowerCase();
      bVal = (b.player_name || '').toLowerCase();
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return dir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const sortIcon = (c) => {
    if (_clubsLeaderboardSort.col !== c) return '<span class="clubs-sort-icon clubs-sort-icon--neutral">⇅</span>';
    return dir === 'asc'
      ? '<span class="clubs-sort-icon clubs-sort-icon--active">▲</span>'
      : '<span class="clubs-sort-icon clubs-sort-icon--active">▼</span>';
  };

  container.innerHTML = `
    <div class="player-codes-table-wrap">
      <table class="player-codes-table">
        <thead>
          <tr class="player-codes-head-row">
            <th class="player-codes-th-center">#</th>
            <th class="player-codes-th clubs-sortable-th" onclick="clubsSortLeaderboard('name')">${t('txt_player_leaderboard_name')} ${sortIcon('name')}</th>
            <th class="player-codes-th-center clubs-sortable-th" onclick="clubsSortLeaderboard('elo')">${t('txt_player_elo_rating')} ${sortIcon('elo')}</th>
            <th class="player-codes-th-center">${t('txt_clubs_season_elo_change')}</th>
            <th class="player-codes-th-center clubs-sortable-th" onclick="clubsSortLeaderboard('matches')">${t('txt_player_leaderboard_matches')}<br><span class="muted-tiny">${t('txt_clubs_leaderboard_in_season')}</span> ${sortIcon('matches')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((s, i) => `
            <tr class="player-codes-row">
              <td class="player-codes-cell-center" style="color:var(--text-muted)">${i + 1}</td>
              <td class="player-codes-name">${esc(s.player_name)}</td>
              <td class="player-codes-cell-center">${s.elo_end != null ? Math.round(s.elo_end) : '—'}</td>
              <td class="player-codes-cell-center" style="color:${s.elo_change > 0 ? 'var(--green)' : s.elo_change < 0 ? 'var(--red)' : 'var(--text-muted)'}">${s.elo_change != null ? (s.elo_change > 0 ? '+' : '') + s.elo_change.toFixed(1) : '—'}</td>
              <td class="player-codes-cell-center">${s.matches_played != null ? s.matches_played : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  _clubsMarkScrollableTables(container);
}

function clubsTogglePlayerSelection(profileId, selected) {
  if (selected) {
    _clubsInviteSelectedIds.add(profileId);
  } else {
    _clubsInviteSelectedIds.delete(profileId);
  }
  _clubsRenderMessagingPanelInto();
}

function clubsToggleAllPlayersSelection(selected) {
  const eligible = _clubsMessagingEligiblePlayers();
  if (selected) {
    eligible.forEach(p => _clubsInviteSelectedIds.add(p.profile_id));
  } else {
    eligible.forEach(p => _clubsInviteSelectedIds.delete(p.profile_id));
  }
  _clubsRenderMessagingPanelInto();
}

function clubsSelectPlayersWithEmail() {
  _clubsMessagingEligiblePlayers().forEach(p => {
    if (p.email) _clubsInviteSelectedIds.add(p.profile_id);
  });
  _clubsRenderMessagingPanelInto();
}

function clubsClearPlayerSelection() {
  _clubsInviteSelectedIds.clear();
  _clubsRenderMessagingPanelInto();
}

/** Players eligible to receive messages (visible in current sport, filtered). */
function _clubsMessagingEligiblePlayers() {
  return _clubPlayers.filter(p => {
    if (_clubsIsHiddenInCurrentSport(p)) return false;
    if (!_clubsRecipientFilter) return true;
    const f = _clubsRecipientFilter.toLowerCase();
    return (p.name || '').toLowerCase().includes(f)
        || (p.email || '').toLowerCase().includes(f);
  });
}

async function _clubsPlayerSearchInput(value) {
  const btn = document.getElementById('clubs-add-player-btn');
  _clubsPlayerSearchSelected = null;
  if (btn) btn.disabled = !value || value.trim().length === 0;
  const dl = document.getElementById('clubs-add-player-suggestions');
  clearTimeout(_clubsPlayerSearchTimer);
  if (!value || value.length < 2 || !_activeClubId) { if (dl) dl.innerHTML = ''; return; }
  _clubsPlayerSearchTimer = setTimeout(async () => {
    try {
      const results = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/candidates?q=${encodeURIComponent(value)}`);
      if (dl && Array.isArray(results)) {
        dl.innerHTML = results.slice(0, 12).map(r => {
          const hasHub = r.has_hub_profile !== false;
          if (hasHub) {
            return `<option value="${esc(r.name)}" data-has-hub="1" data-profile-id="${esc(r.profile_id || r.id)}">`;
          }
          const valueWithTag = `${r.name} (${t('txt_clubs_candidate_no_hub')})`;
          return `<option value="${esc(valueWithTag)}" data-has-hub="0" data-past-player-id="${esc(r.past_player_id || '')}" data-display-name="${esc(r.name)}">`;
        }).join('');
      }
    } catch (_) {}
  }, 250);
}

function _clubsPlayerSuggestionChosen(value) {
  const dl = document.getElementById('clubs-add-player-suggestions');
  const input = document.getElementById('clubs-add-player-input');
  _clubsPlayerSearchSelected = null;
  if (!dl) return;
  const opt = Array.from(dl.options).find(o => o.value === value);
  if (!opt) return;
  if (opt.dataset.hasHub === '1') {
    _clubsPlayerSearchSelected = {
      has_hub_profile: true,
      profile_id: opt.dataset.profileId || null,
      past_player_id: null,
      name: value,
    };
    return;
  }
  const displayName = opt.dataset.displayName || value;
  if (input) input.value = displayName;
  _clubsPlayerSearchSelected = {
    has_hub_profile: false,
    profile_id: null,
    past_player_id: opt.dataset.pastPlayerId || null,
    name: displayName,
  };
}

async function clubsAddPlayer() {
  const input = document.getElementById('clubs-add-player-input');
  const msgEl = document.getElementById('clubs-add-player-msg');
  const dl = document.getElementById('clubs-add-player-suggestions');
  if (!input || !_activeClubId) return;
  const name = input.value.trim();
  if (!name) return;
  // Resolve selected candidate from datalist (Hub or past participant)
  let selected = _clubsPlayerSearchSelected;
  if (dl) {
    const opt = Array.from(dl.options).find(o => o.value === name);
    if (opt) {
      if (opt.dataset.hasHub === '1') {
        selected = {
          has_hub_profile: true,
          profile_id: opt.dataset.profileId || null,
          past_player_id: null,
          name,
        };
      } else {
        selected = {
          has_hub_profile: false,
          profile_id: null,
          past_player_id: opt.dataset.pastPlayerId || null,
          name: opt.dataset.displayName || name,
        };
      }
    }
  }
  if (!selected || (!selected.profile_id && !selected.past_player_id)) {
    // Fallback: resolve from club-scoped candidate search
    try {
      const results = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/candidates?q=${encodeURIComponent(name)}`);
      if (Array.isArray(results) && results.length) {
        const r = results[0];
        selected = {
          has_hub_profile: r.has_hub_profile !== false,
          profile_id: r.profile_id || r.id || null,
          past_player_id: r.past_player_id || null,
          name: r.name || name,
        };
      }
    } catch (_) {}
  }
  if (!selected || (!selected.profile_id && !selected.past_player_id)) { _clubsMsg(msgEl, t('txt_clubs_player_not_found'), true); return; }
  try {
    const payload = selected.profile_id
      ? { profile_id: selected.profile_id }
      : { past_player_id: selected.past_player_id };
    const newPlayer = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    input.value = '';
    _clubsPlayerSearchSelected = null;
    _clubsMsg(msgEl, '✓', false);
    _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
    _clubsRenderPlayers();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsRemovePlayer(profileId, name) {
  if (!confirm(t('txt_clubs_remove_player_confirm').replace('{name}', name))) return;
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    _clubPlayers = _clubPlayers.filter(p => p.profile_id !== profileId);
    _clubsSetRosterNotice(t('txt_clubs_player_removed_ok').replace('{name}', name), false);
    _clubsRenderPlayers();
  } catch (e) {
    const msgEl = document.getElementById('clubs-add-player-msg');
    _clubsSetRosterNotice(e.message, true);
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsTogglePlayerSport(profileId, sport, makeVisible) {
  try {
    await apiAuth(
      `/api/clubs/${encodeURIComponent(_activeClubId)}/players/${encodeURIComponent(profileId)}/sport-visibility`,
      { method: 'PATCH', body: JSON.stringify({ sport, hidden: !makeVisible }) },
    );
    const player = _clubPlayers.find(p => p.profile_id === profileId);
    const playerName = player?.name || profileId;
    const sportLabel = sport === 'padel' ? t('txt_txt_sport_padel') : t('txt_txt_sport_tennis');
    if (player) {
      if (sport === 'padel') player.hidden_padel = !makeVisible;
      else player.hidden_tennis = !makeVisible;
    }
    const msg = makeVisible
      ? t('txt_clubs_player_restored_ok').replace('{name}', playerName).replace('{sport}', sportLabel)
      : t('txt_clubs_player_hidden_ok').replace('{name}', playerName).replace('{sport}', sportLabel);
    _clubsSetRosterNotice(msg, false);
    _clubsRenderPlayers();
  } catch (e) {
    const msgEl = document.getElementById('clubs-add-player-msg');
    _clubsSetRosterNotice(e.message, true);
    _clubsMsg(msgEl, e.message, true);
  }
}

function _clubsRenderMessagingPanelInto() {
  const container = document.getElementById('clubs-messaging-panel');
  if (!container) return; // Comms tab not mounted (e.g. user lacks owner/admin perms).

  const activeClub = _clubsList.find(c => c.id === _activeClubId);
  if (!activeClub) { container.innerHTML = ''; return; }

  // Drop selections that are no longer eligible (e.g. player removed or sport switched).
  const eligibleAll = _clubPlayers.filter(p => !_clubsIsHiddenInCurrentSport(p));
  const eligibleAllIds = new Set(eligibleAll.map(p => p.profile_id));
  for (const id of Array.from(_clubsInviteSelectedIds)) {
    if (!eligibleAllIds.has(id)) _clubsInviteSelectedIds.delete(id);
  }

  const filtered = _clubsMessagingEligiblePlayers();
  const filteredIds = new Set(filtered.map(p => p.profile_id));
  const selectedCount = _clubsInviteSelectedIds.size;
  const selectedWithEmailCount = _clubPlayers.filter(
    p => _clubsInviteSelectedIds.has(p.profile_id) && p.email
  ).length;
  const noEmailCount = selectedCount - selectedWithEmailCount;
  const allFilteredSelected = filtered.length > 0 && filtered.every(p => _clubsInviteSelectedIds.has(p.profile_id));
  const sportLabel = _clubsSport === 'padel' ? t('txt_txt_sport_padel') : t('txt_txt_sport_tennis');

  const communityLobbies = _clubsRegistrations.filter(r => r.community_id === activeClub.community_id);

  // Preserve any in-progress text the user typed before re-rendering.
  const _savedSubject = document.getElementById('clubs-messaging-subject')?.value ?? '';
  const _savedMessage = document.getElementById('clubs-messaging-message')?.value ?? '';

  const tabBtnStyle = (active) => `btn btn-sm${active ? ' btn-primary' : ''}`;

  // ── Recipients picker ────────────────────────────────────────────────
  const recipientsHeader = `
    <div class="clubs-recipients-header">
      <span class="clubs-recipients-title">${t('txt_clubs_messaging_recipients')} <span class="muted-tiny">(${sportLabel})</span></span>
      <span class="muted-note clubs-recipients-status">
        ${t('txt_clubs_selection_status').replace('{selected}', String(selectedCount)).replace('{emailable}', String(selectedWithEmailCount))}
      </span>
    </div>`;

  const recipientsToolbar = `
    <div class="clubs-recipients-toolbar">
      <input type="search" id="clubs-recipient-filter" value="${escAttr(_clubsRecipientFilter)}"
        placeholder="${escAttr(t('txt_clubs_player_filter_placeholder'))}"
        oninput="clubsSetRecipientFilter(this.value)"
        class="clubs-recipients-filter-input">
      <button class="btn btn-sm" type="button" onclick="clubsSelectPlayersWithEmail()">${t('txt_clubs_select_with_email')}</button>
      <button class="btn btn-sm btn-muted" type="button" onclick="clubsClearPlayerSelection()">${t('txt_clubs_clear_selection')}</button>
    </div>`;

  let recipientsList;
  if (!eligibleAll.length) {
    recipientsList = `<p class="muted-note">${t('txt_clubs_no_players')}</p>`;
  } else if (!filtered.length) {
    recipientsList = `<p class="muted-note">${t('txt_txt_no_results')}</p>`;
  } else {
    recipientsList = `
      <div class="clubs-recipients-list" role="group" aria-label="${escAttr(t('txt_clubs_messaging_recipients'))}">
        <label class="clubs-recipient-row clubs-recipient-row--all">
          <input type="checkbox" ${allFilteredSelected ? 'checked' : ''}
            onchange="clubsToggleAllPlayersSelection(this.checked)">
          <span class="clubs-recipient-name">${t('txt_clubs_messaging_recipients_select_all')}</span>
        </label>
        ${filtered.map(p => {
          const hasEmail = Boolean(p.email);
          const checked = _clubsInviteSelectedIds.has(p.profile_id);
          return `
            <label class="clubs-recipient-row${hasEmail ? '' : ' clubs-recipient-row--no-email'}">
              <input type="checkbox" ${checked ? 'checked' : ''}
                onchange="clubsTogglePlayerSelection('${esc(p.profile_id)}', this.checked)">
              <span class="clubs-recipient-name">${esc(p.name)}</span>
              <span class="clubs-recipient-email muted-tiny">${hasEmail ? esc(p.email) : `— ${t('txt_clubs_player_no_email')}`}</span>
            </label>`;
        }).join('')}
      </div>`;
  }

  const lobbyContent = `
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
      <select id="clubs-messaging-lobby-select" style="flex:1;min-width:180px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
        ${communityLobbies.length
          ? communityLobbies.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')
          : `<option value="" disabled selected>${t('txt_clubs_messaging_no_lobbies')}</option>`}
      </select>
      <button class="btn btn-sm btn-primary" type="button" onclick="clubsSendLobbyInvite()"
        ${selectedWithEmailCount && communityLobbies.length ? '' : 'disabled'}>${t('txt_clubs_messaging_send_lobby')}</button>
    </div>`;

  const noEmailWarning = (selectedCount > 0 && noEmailCount > 0)
    ? `<p class="clubs-no-email-warning">${t('txt_clubs_messaging_no_email_warning').replace('{count}', String(noEmailCount))}</p>`
    : '';

  const announceContent = `
    <div style="display:flex;flex-direction:column;gap:0.4rem">
      <input type="text" id="clubs-messaging-subject" placeholder="${t('txt_clubs_messaging_subject')}"
        style="padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
      <textarea id="clubs-messaging-message" rows="4" placeholder="${t('txt_clubs_messaging_message')}"
        style="padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);resize:vertical"></textarea>
      ${noEmailWarning}
      <div>
        <button id="clubs-send-announce-btn" class="btn btn-sm btn-primary" type="button" onclick="clubsSendAnnouncement()"
          ${selectedWithEmailCount ? '' : 'disabled'}>${t('txt_clubs_messaging_send_announce')}</button>
      </div>
    </div>`;

  const composeHint = selectedCount === 0
    ? `<p class="muted-tiny" style="margin:0 0 0.4rem 0">${t('txt_clubs_messaging_select_recipients_first')}</p>`
    : '';

  container.innerHTML = `
    <div class="clubs-recipients-block">
      ${recipientsHeader}
      ${recipientsToolbar}
      ${recipientsList}
    </div>
    <div class="clubs-compose-block">
      ${composeHint}
      <div style="display:flex;gap:0.5rem;margin-bottom:0.65rem">
        <button class="${tabBtnStyle(_clubsMessagingTab === 'lobby')}" type="button"
          onclick="clubsMessagingTab('lobby')">${t('txt_clubs_messaging_tab_lobby')}</button>
        <button class="${tabBtnStyle(_clubsMessagingTab === 'announce')}" type="button"
          onclick="clubsMessagingTab('announce')">${t('txt_clubs_messaging_tab_announce')}</button>
      </div>
      <span id="clubs-messaging-msg" style="font-size:0.84rem;display:block;margin-bottom:0.4rem"></span>
      ${_clubsMessagingTab === 'lobby' ? lobbyContent : announceContent}
    </div>`;

  // Restore typed values that survived re-render.
  const subjectEl = document.getElementById('clubs-messaging-subject');
  const messageEl = document.getElementById('clubs-messaging-message');
  if (subjectEl && _savedSubject) subjectEl.value = _savedSubject;
  if (messageEl && _savedMessage) messageEl.value = _savedMessage;

  // Keep filter focus after re-render so typing isn't interrupted.
  const filterEl = document.getElementById('clubs-recipient-filter');
  if (filterEl && document.activeElement !== filterEl && _clubsRecipientFilterFocused) {
    filterEl.focus();
    const v = filterEl.value;
    filterEl.setSelectionRange(v.length, v.length);
  }
}

let _clubsRecipientFilterFocused = false;
function clubsSetRecipientFilter(v) {
  _clubsRecipientFilter = v || '';
  _clubsRecipientFilterFocused = true;
  _clubsRenderMessagingPanelInto();
}

function clubsMessagingTab(tab) {
  _clubsMessagingTab = tab;
  _clubsRenderMessagingPanelInto();
}

async function clubsSendLobbyInvite() {
  const selectEl = document.getElementById('clubs-messaging-lobby-select');
  const registrationId = selectEl?.value;
  if (!registrationId || !_activeClubId) return;

  const profileIds = _clubPlayers
    .filter(p => _clubsInviteSelectedIds.has(p.profile_id) && p.email)
    .map(p => p.profile_id);
  if (!profileIds.length) return;

  const msgEl = document.getElementById('clubs-messaging-msg');
  try {
    const result = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/invite-lobby`, {
      method: 'POST',
      body: JSON.stringify({ profile_ids: profileIds, registration_id: registrationId }),
    });
    const sent = Number(result?.sent || 0);
    const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
    _clubsMsg(msgEl, t('txt_clubs_messaging_result').replace('{sent}', String(sent)).replace('{failed}', String(failed)), failed > 0 && sent === 0);
    if (sent > 0) {
      _clubsInviteSelectedIds.clear();
      _clubsRenderPlayers();
    }
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsSendAnnouncement() {
  const subjectEl = document.getElementById('clubs-messaging-subject');
  const messageEl = document.getElementById('clubs-messaging-message');
  const subject = subjectEl?.value?.trim();
  const message = messageEl?.value?.trim();
  if (!subject || !message || !_activeClubId) return;

  const profileIds = _clubPlayers
    .filter(p => _clubsInviteSelectedIds.has(p.profile_id) && p.email)
    .map(p => p.profile_id);
  if (!profileIds.length) return;

  const msgEl = document.getElementById('clubs-messaging-msg');
  try {
    const result = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/announce`, {
      method: 'POST',
      body: JSON.stringify({ profile_ids: profileIds, subject, message }),
    });
    const sent = Number(result?.sent || 0);
    const failed = Array.isArray(result?.failed) ? result.failed.length : 0;
    _clubsMsg(msgEl, t('txt_clubs_messaging_result').replace('{sent}', String(sent)).replace('{failed}', String(failed)), failed > 0 && sent === 0);
    if (sent > 0) {
      const sendBtn = document.getElementById('clubs-send-announce-btn');
      if (sendBtn) {
        sendBtn.classList.remove('btn-primary');
        sendBtn.classList.add('btn-success');
        sendBtn.textContent = '\u2713 ' + t('txt_clubs_messaging_send_announce');
        sendBtn.disabled = true;
      }
      _clubsInviteSelectedIds.clear();
      setTimeout(() => _clubsRenderPlayers(), 2500);
    }
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}
async function clubsSaveElo(profileId, sport) {
  const input = document.getElementById(`clubs-elo-${sport}-${profileId}`);
  const msgEl = document.getElementById(`clubs-elo-${sport}-msg-${profileId}`);
  if (!input || !_activeClubId) return;
  const val = input.value.trim();
  if (!val) return;
  const elo = parseFloat(val);
  if (isNaN(elo) || elo < 0 || elo > 4000) { _clubsMsg(msgEl, t('txt_clubs_invalid_elo'), true); return; }
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/${encodeURIComponent(profileId)}/elo`, {
      method: 'PATCH',
      body: JSON.stringify({ elo, sport }),
    });
    _clubsMsg(msgEl, '✓', false);
    // Update local cache
    const p = _clubPlayers.find(x => x.profile_id === profileId);
    if (p) {
      if (sport === 'padel') p.elo_padel = elo; else p.elo_tennis = elo;
      _clubsRenderLeaderboard();
    }
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

function _clubsDebouncedSaveElo(profileId, sport) {
  const key = `${profileId}-${sport}`;
  const msgEl = document.getElementById(`clubs-elo-${sport}-msg-${profileId}`);
  if (msgEl) msgEl.textContent = '';
  clearTimeout(_clubsEloDebounceTimers[key]);
  _clubsEloDebounceTimers[key] = setTimeout(() => {
    delete _clubsEloDebounceTimers[key];
    clubsSaveElo(profileId, sport);
  }, 700);
}

async function clubsAssignTier(profileId, sport) {
  const sel = document.getElementById(`clubs-ptier-${sport}-${profileId}`);
  const msgEl = document.getElementById(`clubs-ptier-${sport}-msg-${profileId}`);
  if (!sel || !_activeClubId) return;
  const tier_id = sel.value || null;
  const apply_base_elo = tier_id ? confirm(t('txt_clubs_apply_base_elo_confirm')) : false;
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/${encodeURIComponent(profileId)}/tier`, {
      method: 'PATCH',
      body: JSON.stringify({ sport, tier_id, apply_base_elo }),
    });
    _clubsMsg(msgEl, '✓', false);
    // Refresh player list to show updated ELO
    if (apply_base_elo) {
      _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
      _clubsRenderPlayers();
    }
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}
// ─── Collaborators ────────────────────────────────────────

function _clubsRenderCollaborators() {
  const listEl = document.getElementById('clubs-collabs-list');
  if (!listEl) return;
  if (!_clubCollaborators.length) {
    listEl.innerHTML = `<p class="muted-note">${t('txt_clubs_no_collaborators')}</p>`;
    return;
  }
  listEl.innerHTML = `<ul style="list-style:none;padding:0;margin:0 0 0.25rem">`
    + _clubCollaborators.map(u => `
      <li style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;border-bottom:1px solid var(--border-light,#eee)">
        <span style="flex:1;font-size:0.9rem">${esc(u)}</span>
        <button class="btn btn-sm btn-danger" style="padding:0.15rem 0.4rem" onclick="clubsRemoveCollaborator('${esc(u)}')">${t('txt_txt_remove')}</button>
      </li>`
    ).join('')
    + `</ul>`;
}

async function _clubsCollabInputChange(value) {
  const dl = document.getElementById('clubs-collab-suggestions');
  clearTimeout(_clubsCollabSearchTimer);
  if (!value || value.length < 2) { if (dl) dl.innerHTML = ''; return; }
  _clubsCollabSearchTimer = setTimeout(async () => {
    try {
      const results = await apiAuth(`/api/auth/users/search?q=${encodeURIComponent(value)}`);
      if (dl && Array.isArray(results)) {
        dl.innerHTML = results.slice(0, 8).map(u => `<option value="${esc(u.username || u)}">`)  .join('');
      }
    } catch (_) {}
  }, 200);
}

async function clubsAddCollaborator() {
  const input = document.getElementById('clubs-collab-input');
  const msgEl = document.getElementById('clubs-collab-msg');
  if (!input || !_activeClubId) return;
  const username = input.value.trim();
  if (!username) return;
  try {
    const res = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    input.value = '';
    _clubCollaborators = res.collaborators || [];
    _clubsRenderCollaborators();
    _clubsMsg(msgEl, '✓', false);
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsRemoveCollaborator(username) {
  if (!confirm(t('txt_clubs_collab_confirm_remove').replace('{username}', username))) return;
  const msgEl = document.getElementById('clubs-collab-msg');
  try {
    const res = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/collaborators/${encodeURIComponent(username)}`, { method: 'DELETE' });
    _clubCollaborators = res.collaborators || [];
    _clubsRenderCollaborators();
    _clubsMsg(msgEl, '✓', false);
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Email settings ───────────────────────────────────

async function clubsSaveEmailSettings() {
  const replyTo = document.getElementById('clubs-email-reply-to');
  const senderName = document.getElementById('clubs-email-sender-name');
  const msgEl = document.getElementById('clubs-email-settings-msg');
  if (!_activeClubId) return;
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/email-settings`, {
      method: 'PATCH',
      body: JSON.stringify({
        reply_to: replyTo?.value?.trim() || null,
        sender_name: senderName?.value?.trim() || null,
      }),
    });
    // Update local cache
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) {
      club.email_settings = {
        reply_to: replyTo?.value?.trim() || null,
        sender_name: senderName?.value?.trim() || null,
      };
    }
    _clubsMsg(msgEl, `✓ ${t('txt_clubs_email_saved')}`, false);
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}
// ─── Utilities ────────────────────────────────────────────

function _clubsMsg(el, text, isError) {
  if (!el) return;
  el.style.color = isError ? 'var(--red)' : 'var(--green)';
  el.style.fontSize = isError ? '0.78rem' : '0.72rem';
  el.textContent = text;
  if (!isError) setTimeout(() => { if (el) el.textContent = ''; }, 1800);
}

function _clubsSetRosterNotice(text, isError = false) {
  _clubsRosterNoticeText = text || '';
  _clubsRosterNoticeError = !!isError;
  clearTimeout(_clubsRosterNoticeTimer);
  if (!_clubsRosterNoticeText) return;
  _clubsRosterNoticeTimer = setTimeout(() => {
    _clubsRosterNoticeText = '';
    _clubsRosterNoticeError = false;
    const panel = document.getElementById('clubs-players-list');
    if (panel) _clubsRenderPlayers();
  }, 2500);
}

function _clubsMarkScrollableTables(containerEl) {
  (containerEl || document).querySelectorAll('.player-codes-table-wrap').forEach(wrap => {
    wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth);
  });
}
