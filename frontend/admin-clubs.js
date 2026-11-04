/**
 * admin-clubs.js — Club & Season management panel.
 *
 * Handles:
 *  - Listing, creating, renaming, and deleting clubs (many clubs can share one community)
 *  - Club logo upload/delete
 *  - Player tiers CRUD (per club)
 *  - Season CRUD (per club)
 *  - Events card: every tournament + lobby in the club (pins, seasons, attach)
 *  - Season standings view
 *  - Club player list with ELO & tier management
 */

// ─── State ────────────────────────────────────────────────

let _clubsList = [];         // ClubOut[]
let _clubsCommunities = [];  // from GET /api/communities
let _clubsTournaments = [];  // from GET /api/tournaments
let _clubsRegistrations = []; // from GET /api/registrations?include_archived=1
let _activeClubId = null;    // currently selected club
let _clubTiers = [];         // TierOut[] for active club
let _clubSeasons = [];       // SeasonOut[] for active club
let _clubPlayers = [];       // ClubPlayerOut[] for active club
let _clubCollaborators = []; // collaborators for active club
let _clubPublicTournaments = []; // public-tournaments for active club (read-only rows in the Events card)
let _clubsInviteSelectedIds = new Set();
let _clubsRecipientFilter = '';
let _clubsMessagingTab = 'lobby'; // 'lobby' | 'announce'
let _clubsPlayerSearchTimer = null;
let _clubsPlayerSearchSelected = null;
let _clubsCollabSearchTimer = null;
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
  // Resolve the subdomain club in parallel with data loads. Using the cached
  // promise directly avoids the race where admin-subdomain-context.js sets
  // window.__ADMIN_SUBDOMAIN_CLUB__ after we've already read it.
  const [subdomainClub] = await Promise.all([
    (typeof resolveClubSubdomainContext === 'function' ? resolveClubSubdomainContext() : Promise.resolve(null)),
    _clubsLoadClubs(),
    _clubsLoadCommunities(),
    _clubsLoadTournaments(),
    _clubsLoadRegistrations(),
  ]);
  // Ensure the global is set before any render so _renderClubStatusBar sees it.
  if (subdomainClub && subdomainClub.club_id) {
    window.__ADMIN_SUBDOMAIN_CLUB__ = subdomainClub;
  }
  // Coming back from an event opened from a club's Events card: reopen that
  // club instead of dropping the user on the overview.
  if (_activeClubId && (_clubsList || []).some(c => c && c.id === _activeClubId)) {
    await clubsOpenDetail(_activeClubId);
    return;
  }
  // When opened on a club subdomain, jump straight to that club's detail view
  // (only if the user hasn't already drilled into another club this session).
  if (!_activeClubId && subdomainClub && subdomainClub.club_id
      && (_clubsList || []).some(c => c && c.id === subdomainClub.club_id)) {
    await clubsOpenDetail(subdomainClub.club_id);
    return;
  }
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
    _clubsRegistrations = await apiAuth('/api/registrations?include_archived=1');
  } catch (e) {
    _clubsRegistrations = [];
  }
}

async function _clubsLoadClubDetail(clubId) {
  const [tiers, seasons, players, collaborators, publicTournaments] = await Promise.all([
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/tiers`).catch(() => []),
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/seasons`).catch(() => []),
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/players`).catch(() => []),
    apiAuth(`/api/clubs/${encodeURIComponent(clubId)}/collaborators`).catch(() => ({ collaborators: [] })),
    fetch(`/api/clubs/${encodeURIComponent(clubId)}/public-tournaments`).then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  _clubTiers = tiers;
  _clubSeasons = seasons;
  _clubPlayers = players;
  _clubCollaborators = collaborators?.collaborators ?? [];
  _clubPublicTournaments = Array.isArray(publicTournaments) ? publicTournaments : [];
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
    html += `<p class="muted-note">${t('txt_clubs_no_clubs')} <button type="button" class="btn btn-sm btn-link btn-link--inline" onclick="openContextInfo('clubs')">${_ic('info')} ${esc(t('txt_txt_learn_more'))}</button></p>`;
  } else {
    // Hide the Community column when every club lives in the same community
    // (the most common single-community deployment) — it's pure noise then.
    const usedCommunityIds = new Set(_clubsList.map(cl => cl.community_id));
    const showCommColumn = usedCommunityIds.size > 1;
    html += `<div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_clubs_name')}</th>
          ${showCommColumn ? `<th class="player-codes-th text-muted">${t('txt_clubs_community')}</th>` : ''}
          <th class="player-codes-th"></th>
        </tr>
      </thead>
      <tbody>
        ${_clubsList.map(cl => {
          const comm = _clubsCommunities.find(c => c.id === cl.community_id);
          return `
          <tr class="player-codes-row">
            <td class="player-codes-name fw-normal">
              ${cl.has_logo ? `<img src="/api/clubs/${esc(cl.id)}/logo" alt="" class="clubs-row-logo">` : ''}
              <strong class="clubs-row-name" onclick="clubsOpenDetail('${esc(cl.id)}')">${esc(cl.name)}</strong>
              ${cl.shared ? `<span class="badge badge-shared ml-1-5">${t('txt_clubs_badge_shared')}</span>` : ''}
            </td>
            ${showCommColumn ? `<td class="player-codes-cell text-muted fs-sm">${comm ? esc(comm.name) : esc(cl.community_id)}</td>` : ''}
            <td class="player-codes-cell-center nowrap">
              ${!cl.shared || isAdmin() ? `<button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsDelete('${esc(cl.id)}')" title="${t('txt_txt_remove')}" aria-label="${t('txt_txt_remove')} ${esc(cl.name)}">${_ic('trash')}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  // Create form
  html += `<div class="d-flex gap-2 mt-3 flex-wrap items-center">`;
  const canCreate = isAdmin() || (typeof canCreateClubs === 'function' && canCreateClubs());
  if (!canCreate) {
    html += `<p class="muted-note">${t('txt_clubs_creation_disabled_for_user')}</p>`;
  } else if (eligible.length) {
    html += `
      <select id="clubs-create-community" class="clubs-create-community-select">
        ${eligible.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
      </select>
      <input type="text" id="clubs-create-name" placeholder="${t('txt_clubs_name_placeholder')}" class="clubs-create-name-input" autocomplete="off">
      <button type="button" id="clubs-create-btn" class="btn btn-success btn-sm" onclick="clubsCreate()">+ ${t('txt_clubs_create')}</button>`;
  } else {
    html += `<p class="muted-note">${t('txt_clubs_no_eligible')}</p>`;
  }
  html += `</div>
    <div id="clubs-msg" class="mt-2 fs-md"></div>`;

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
    await _clubsLoadClubs();
    _clubsRenderOverview();
    _clubsOk(msgEl, 'clubs-create-btn');
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDelete(clubId) {
  const club = _clubsList.find(c => c.id === clubId);
  if (!club) return;
  const expected = (club.name || '').trim();
  const promptMsg = t('txt_clubs_delete_type_to_confirm').replace('{name}', expected);
  const typed = window.prompt(promptMsg, '');
  if (typed == null) return;
  const msgEl = document.getElementById('clubs-msg');
  if (typed.trim() !== expected) {
    _clubsMsg(msgEl, t('txt_clubs_delete_type_mismatch'), true);
    return;
  }
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(clubId)}`, { method: 'DELETE' });
    _clubsOk(msgEl);
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
  _clubEventsStore.attachQuery = '';
  _clubEventsStore.showDismissed = false;
  _clubEventsStore.attachNoneMsg = false;
  _clubEventsStore.menuKey = null;
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
  // On a club subdomain, the overview list is hidden — stay on the detail view.
  const subdomainClub = (typeof window !== 'undefined' && window.__ADMIN_SUBDOMAIN_CLUB__) || null;
  if (subdomainClub && subdomainClub.club_id) return;
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

  // Events (primary content, Petite-Vue island mounted after injection).
  html += `<div id="club-events-slot"></div>`;

  html += `
    <!-- Players (collapsed by default; sessionStorage restores the last choice) -->
    <details class="card" id="clubs-players-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> ${_ic('users')} ${t('txt_clubs_players')}</span>
        <span class="clubs-card-badge">${_clubPlayers.length}</span>
      </summary>
      <div class="player-codes-body">
        <p class="player-codes-help">${t('txt_clubs_players_help')}</p>
        <div id="clubs-players-list"></div>
        <div id="clubs-ghost-duplicates"></div>
        <div id="clubs-hub-merge"></div>
      </div>
    </details>

    <!-- Club leaderboard (primary content) -->
    <details class="card" open id="clubs-leaderboard-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> ${_ic('chart')} ${t('txt_clubs_leaderboard')}</span>
        ${(() => { const ranked = _clubPlayers.filter(p => (_clubsSport === 'padel' ? p.elo_padel : p.elo_tennis) != null); return ranked.length ? `<span class="clubs-card-badge">${ranked.length}</span>` : ''; })()}
      </summary>
      <div class="player-codes-body">
        <div id="clubs-leaderboard-scope-bar"></div>
        <div id="clubs-leaderboard"></div>
        <div class="clubs-lb-recalc">
          <p class="muted-note">${t('txt_clubs_recalc_elo_help')}</p>
          <button type="button" id="clubs-recalc-elo-btn" class="btn btn-warning btn-sm" onclick="withLoading(this, clubsRecalculateElo)">${_ic('refresh')} ${t('txt_clubs_recalc_elo')}</button>
        </div>
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
  _clubsMountEventsIsland();
  _clubsRenderTiers();
  _clubsRenderSeasons();
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
    _clubsOk(msgEl, 'clubs-rename-btn');
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.name = name;
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Landing page (description) ──────────────────────────

async function clubsSaveLandingDescription() {
  const input = document.getElementById('clubs-landing-desc-input');
  const msgEl = document.getElementById('clubs-landing-desc-msg');
  if (!input || !_activeClubId) return;
  const description = input.value.trim() || null;
  try {
    const updated = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/landing`, {
      method: 'PATCH',
      body: JSON.stringify({ description }),
    });
    _clubsOk(msgEl, 'clubs-landing-desc-btn');
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.description = updated.description;
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Slug (subdomain) management ─────────────────────────

async function _clubsSetSlug(rawSlug) {
  const msgEl = document.getElementById('clubs-slug-msg');
  if (!_activeClubId) return;
  try {
    const updated = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/slug`, {
      method: 'PATCH',
      body: JSON.stringify({ slug: rawSlug }),
    });
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.slug = updated.slug;
    _clubsRenderDetail();
    _clubsOk(msgEl, 'clubs-slug-save-btn');
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsSaveSlug() {
  const input = document.getElementById('clubs-slug-input');
  if (!input) return;
  const candidate = (input.value || '').trim().toLowerCase();
  if (!candidate) {
    return _clubsSetSlug(null);
  }
  if (!/^[a-z0-9-]{2,30}$/.test(candidate)) {
    const msgEl = document.getElementById('clubs-slug-msg');
    _clubsMsg(msgEl, t('txt_clubs_slug_invalid'), true);
    return;
  }
  return _clubsSetSlug(candidate);
}

async function clubsClearSlug() {
  return _clubsSetSlug(null);
}

async function clubsCopySlugUrl(url) {
  const msgEl = document.getElementById('clubs-slug-msg');
  try {
    await navigator.clipboard.writeText(url);
    _clubsOk(msgEl, 'clubs-slug-copy-btn');
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
    const club = _clubsList.find(c => c.id === _activeClubId);
    if (club) club.has_logo = true;
    _clubsRenderDetail();
    _clubsOk(msgEl, 'clubs-logo-upload-label');
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDeleteLogo() {
  const msgEl = document.getElementById('clubs-logo-msg');
  if (!_activeClubId) return;
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/logo`, { method: 'DELETE' });
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
          <th class="clubs-th-elo">${t('txt_clubs_tier_base_elo')}</th>
          <th class="player-codes-th"></th>
        </tr>
      </thead>
      <tbody>
        ${tiersForSport.map(tier => `
          <tr class="player-codes-row">
            <td class="player-codes-name">${esc(tier.name)}</td>
            <td class="player-codes-cell-center">${tier.base_elo}</td>
            <td class="player-codes-cell-center nowrap">
              <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsDeleteTier('${esc(tier.id)}')" title="${t('txt_txt_remove')}" aria-label="${t('txt_txt_remove')} ${esc(tier.name)}">${_ic('trash')}</button>
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
        _clubTiers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers`).catch(() => []);
    _clubsRenderTiers();
    _clubsRenderPlayers(); // refresh tier dropdowns
    _clubsOk(msgEl, 'clubs-tier-add-btn');
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDeleteTier(tierId) {
  if (!confirm(t('txt_clubs_tier_delete_confirm'))) return;
  const msgEl = document.getElementById('clubs-tiers-msg');
  try {
    await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers/${encodeURIComponent(tierId)}`, { method: 'DELETE' });
    
    _clubTiers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/tiers`).catch(() => []);
    _clubsRenderTiers();
    _clubsRenderPlayers();
    _clubsOk(msgEl);
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
            <td class="player-codes-cell-center nowrap">
              <button id="clubs-season-toggle-${esc(s.id)}" class="btn btn-sm player-codes-icon-btn" onclick="clubsToggleSeason('${esc(s.id)}', ${!s.active})" title="${s.active ? t('txt_clubs_season_archive') : t('txt_clubs_season_activate')}" aria-label="${s.active ? t('txt_clubs_season_archive') : t('txt_clubs_season_activate')}">
                ${s.active ? _ic('lock') : _ic('unlock')}
              </button>
              <button class="btn btn-sm player-codes-icon-btn" onclick="clubsViewSeasonInLeaderboard('${esc(s.id)}')" title="${t('txt_clubs_season_view_in_leaderboard')}" aria-label="${t('txt_clubs_season_view_in_leaderboard')} ${esc(s.name)}">${_ic('chart')}</button>
              <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="clubsDeleteSeason('${esc(s.id)}')" title="${t('txt_txt_remove')}" aria-label="${t('txt_txt_remove')} ${esc(s.name)}">${_ic('trash')}</button>
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
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubEventsRefresh();
    _clubsOk(msgEl, 'clubs-season-add-btn');
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
    delete _clubsSeasonStandingsCache[seasonId];
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubEventsRefresh();
    _clubsRenderLeaderboard();
    _clubsOk(msgEl, `clubs-season-toggle-${seasonId}`);
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

async function clubsDeleteSeason(seasonId) {
  if (!(await uiConfirm(t('txt_clubs_season_delete_confirm'), { danger: true }))) return;
  const msgEl = document.getElementById('clubs-seasons-msg');
  try {
    await apiAuth(`/api/seasons/${encodeURIComponent(seasonId)}`, { method: 'DELETE' });
    delete _clubsSeasonStandingsCache[seasonId];
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubEventsRefresh();
    _clubsRenderLeaderboard();
    _clubsOk(msgEl);
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

// ─── Attach a tournament to the active club ──────────────

/**
 * Attach a tournament the user edits to the active club, moving it to the
 * club's community first when needed. Throws on failure (callers surface
 * the message); the Events card calls this from its Attach panel.
 */
async function clubsAttachTournamentToClub(tid) {
  if (!_activeClubId) return;
  const club = _clubsList.find(c => c.id === _activeClubId);
  if (!club) return;
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
  if (typeof loadTournaments === 'function') {
    loadTournaments().catch(() => {});
  }
}

// ─── Events card (Petite-Vue island) ─────────────────────
//
// One list of every event in this club (tournaments + sign-up lobbies) with
// lifecycle states, pins (orderable, saved one id at a time against the stored
// `pinned_tournament_ids`), season assignment, attach/detach and the main
// action per state. Rows are derived by the pure `deriveEventRows`
// (admin-utils.js); this store only holds UI state and the mutations.
//
// The island shell is re-injected into #clubs-detail on each
// `_clubsRenderDetail()` and mounted via mountIsland() — same pattern as the
// TV picker: fresh element each render, persistent store.

const _CLUB_EVENTS_TAB_KEY = 'amistoso-club-events-tab';
const _CLUB_EVENTS_TABS = ['active', 'finished', 'archived'];
const _CLUB_EVENTS_ATTACH_OPEN_KEY = 'amistoso-club-attach-open';
const _CLUB_EVENTS_DISMISSED_KEY = 'amistoso-club-attach-dismissed';

/** Club id to return to from the event view ("← Back to {club}"), see _renderViewClubReturn. */
let _clubsReturnTo = null;
let _clubsReturnToPending = null;

function _savedClubEventsTab() {
  try {
    const v = sessionStorage.getItem(_CLUB_EVENTS_TAB_KEY);
    if (_CLUB_EVENTS_TABS.includes(v)) return v;
  } catch (_) {}
  return 'active';
}

const _clubEventsStore = reactiveStore({
  clubId: null,
  rows: [],
  seasons: [],
  pinnedIds: [],        // club.pinned_tournament_ids (stored order)
  tab: _savedClubEventsTab(),
  menuKey: null,        // row key whose overflow menu is open
  attachOpen: false,     // collapsible suggestions section (remembered per club in sessionStorage)
  attachQuery: '',
  dismissedKeys: [],     // suggestion keys hidden for this club (localStorage per club)
  showDismissed: false,
  attachNoneMsg: false,  // "nothing to attach" notice after pressing Attach existing with no suggestions
  busyKey: null,
  msgKey: null,
  msgText: '',
  msgError: false,
  lang: 'en',

  t(key, params) { void this.lang; return window.t(key, params); },

  // ── Derived lists ──
  rowsForTab(tab) { return this.rows.filter(r => r.tab === tab); },
  tabCount(tab) { return this.rowsForTab(tab).length; },
  get tabRows() { return this.rowsForTab(this.tab); },
  get hasEditable() { return this.rows.some(r => r.canEdit); },
  get hasAnyRows() { return this.rows.length > 0; },
  pinIndex(row) {
    const i = this.pinnedIds.indexOf(row.key);
    return i >= 0 ? i : this.pinnedIds.indexOf(row.id);
  },
  isPinned(row) { return this.pinIndex(row) >= 0; },
  /** Active-tab rows that are pinned, in stored pin order. */
  get pinnedRows() {
    return this.rowsForTab('active')
      .filter(r => this.isPinned(r))
      .sort((a, b) => this.pinIndex(a) - this.pinIndex(b));
  },
  get unpinnedActive() { return this.rowsForTab('active').filter(r => !this.isPinned(r)); },
  get editableSeasonsMissing() { return this.seasons.length === 0; },

  // ── Labels ──
  sportLabel(row) {
    return (row.sport || 'padel') === 'tennis' ? this.t('txt_txt_sport_tennis') : this.t('txt_txt_sport_padel');
  },
  stateLabel(row) {
    const keys = {
      live: 'txt_club_events_state_live',
      ready_to_convert: 'txt_club_events_state_ready',
      open_registration: 'txt_club_events_state_open',
      upcoming: 'txt_club_status_not_started',
      finished: 'txt_txt_finished',
      closed: 'txt_club_events_state_closed',
      archived: 'txt_club_events_tab_archived',
    };
    return this.t(keys[row.state] || 'txt_club_events_state_live');
  },
  stateBadgeClass(row) {
    return {
      live: 'badge-lobby-open',
      ready_to_convert: 'badge-type',
      open_registration: 'badge-lobby-open',
      upcoming: 'badge-phase',
      finished: 'badge-closed',
      closed: 'badge-lobby-closed',
      archived: 'badge-lobby-closed',
    }[row.state] || 'badge-phase';
  },
  publicHref(row) {
    const slug = encodeURIComponent(row.alias || row.id);
    return row.kind === 'lobby' ? `/register/${slug}` : `/tv/${slug}`;
  },
  canPin(row) {
    return row.canEdit && row.isPublic && row.state !== 'closed' && row.state !== 'archived';
  },
  pinTitle(row) {
    if (this.isPinned(row)) return this.t('txt_club_events_unpin');
    if (!this.canPin(row)) {
      return row.kind === 'lobby' && !row.isPublic && row.state !== 'open_registration'
        ? this.t('txt_club_events_pin_blocked_closed')
        : this.t('txt_club_events_pin_blocked_private');
    }
    return this.t('txt_club_events_pin');
  },
  mainAction(row) {
    const store = this;
    switch (row.state) {
      case 'open_registration':
      case 'closed':
      case 'archived':
        return { label: this.t('txt_club_events_action_manage'), disabled: false, run() { store.openLobby(row); } };
      case 'ready_to_convert':
        return {
          label: this.t('txt_club_events_action_convert'),
          disabled: (row.registrantCount || 0) < 2,
          run() { store.convert(row); },
        };
      case 'finished':
        return { label: this.t('txt_club_events_action_results'), disabled: false, run() { store.openTournamentRow(row); } };
      default:
        return { label: this.t('txt_club_events_action_run'), disabled: false, run() { store.openTournamentRow(row); } };
    }
  },

  // ── UI state ──
  setTab(tab) {
    if (!_CLUB_EVENTS_TABS.includes(tab)) return;
    this.tab = tab;
    this.menuKey = null;
    try { sessionStorage.setItem(_CLUB_EVENTS_TAB_KEY, tab); } catch (_) {}
  },
  toggleMenu(key) { this.menuKey = this.menuKey === key ? null : key; },
  closeMenu() { this.menuKey = null; },
  toggleAttach() {
    this.attachOpen = !this.attachOpen;
    this.attachNoneMsg = false;
    try { sessionStorage.setItem(`${_CLUB_EVENTS_ATTACH_OPEN_KEY}:${this.clubId}`, this.attachOpen ? '1' : '0'); } catch (_) {}
  },
  /** Header "Attach existing": expand the suggestions and focus the search box. */
  openAttach() {
    if (!this.attachSection.length && !this.attachDismissedAll.length) {
      this.attachNoneMsg = true;
      return;
    }
    if (!this.attachOpen) this.toggleAttach();
    requestAnimationFrame(() => {
      const el = document.getElementById('club-events-attach-search');
      if (el) el.focus();
    });
  },
  _flash(row, text, isError) {
    this.msgKey = row ? row.key : null;
    this.msgText = text || '';
    this.msgError = Boolean(isError);
    if (!isError) setTimeout(() => { if (this.msgKey === (row ? row.key : null)) { this.msgKey = null; this.msgText = ''; } }, 1800);
  },

  // ── Navigation ──
  openTournamentRow(row) {
    const meta = _clubsTournaments.find(t_ => t_.id === row.id);
    _clubsReturnToPending = this.clubId;
    openTournament(row.id, meta ? meta.type : row.type, row.name);
  },
  openLobby(rowOrRef) {
    _clubsReturnToPending = this.clubId;
    openRegistration(rowOrRef.id, rowOrRef.name);
  },
  async convert(row) {
    if ((row.registrantCount || 0) < 2) return;
    this.openLobby(row);
    // openRegistration renders the lobby asynchronously; wait for its detail
    // to land so the conversion panel is not overwritten by the lobby view.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (typeof _regDetails !== 'undefined' && _regDetails[row.id] && currentTid === row.id) break;
      await new Promise(r => setTimeout(r, 60));
    }
    if (currentTid === row.id) _startConvertFromReg(row.id);
  },
  newEvent() { clubsNewEventInClub(); },
  createSeason() { _jumpToClubSettings(this.clubId, 'seasons'); },

  // ── Mutations ──
  async togglePin(row) {
    if (!this.clubId) return;
    const pinned = this.isPinned(row);
    if (!pinned && !this.canPin(row)) return;
    const next = pinned
      ? this.pinnedIds.filter(id => id !== row.key && id !== row.id)
      : [...this.pinnedIds, row.key];
    await this._savePins(next, row);
  },
  async movePin(row, delta) {
    const order = this.pinnedRows.map(r => r.key);
    const i = order.indexOf(row.key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    // Keep pinned ids that are not visible in the Active tab (finished) at their relative place after the visible ones.
    const rest = this.pinnedIds.filter(id => !order.includes(id));
    await this._savePins([...order, ...rest], row);
    this.menuKey = null;
  },
  async _savePins(pinned_tournament_ids, row) {
    this.busyKey = row.key;
    try {
      const updated = await apiAuth(`/api/clubs/${encodeURIComponent(this.clubId)}/landing`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned_tournament_ids }),
      });
      const club = _clubsList.find(c => c.id === this.clubId);
      if (club) club.pinned_tournament_ids = updated.pinned_tournament_ids;
      this.pinnedIds = Array.isArray(updated.pinned_tournament_ids) ? updated.pinned_tournament_ids : [];
      this._flash(row, this.t('txt_txt_saved'), false);
    } catch (e) {
      this._flash(row, e.message, true);
    } finally {
      this.busyKey = null;
    }
  },
  async setSeason(row, seasonId) {
    const season_id = seasonId || null;
    const path = row.kind === 'lobby'
      ? `/api/registrations/${encodeURIComponent(row.id)}/season`
      : `/api/tournaments/${encodeURIComponent(row.id)}/season`;
    try {
      await apiAuth(path, { method: 'PATCH', body: JSON.stringify({ season_id }) });
      const item = row.kind === 'lobby'
        ? _clubsRegistrations.find(r => r.id === row.id)
        : _clubsTournaments.find(t_ => t_.id === row.id);
      if (item) item.season_id = season_id;
      row.seasonId = season_id;
      this._flash(row, this.t('txt_txt_saved'), false);
    } catch (e) {
      this._flash(row, e.message, true);
    }
  },
  async copyLink(row) {
    this.menuKey = null;
    const url = `${location.origin}${this.publicHref(row)}`;
    try {
      await navigator.clipboard.writeText(url);
      this._flash(row, this.t('txt_txt_copied'), false);
    } catch (_) {
      this._flash(row, url, false);
    }
  },
  async removeFromClub(row) {
    this.menuKey = null;
    const ok = await uiConfirm(this.t('txt_club_events_remove_confirm', { name: row.name }), {
      danger: true,
      confirmLabel: this.t('txt_clubs_remove_from_club'),
    });
    if (!ok) return;
    this.busyKey = row.key;
    try {
      const path = row.kind === 'lobby'
        ? `/api/registrations/${encodeURIComponent(row.id)}/club`
        : `/api/tournaments/${encodeURIComponent(row.id)}/club`;
      await apiAuth(path, { method: 'PATCH', body: JSON.stringify({ club_id: null }) });
      if (this.isPinned(row)) {
        await this._savePins(this.pinnedIds.filter(id => id !== row.key && id !== row.id), row);
      }
      const item = row.kind === 'lobby'
        ? _clubsRegistrations.find(r => r.id === row.id)
        : _clubsTournaments.find(t_ => t_.id === row.id);
      if (item) {
        item.club_id = null;
        item.season_id = null;
        if ('club_name' in item) item.club_name = null;
      }
      _clubEventsRefresh();
      if (typeof loadTournaments === 'function') loadTournaments().catch(() => {});
    } catch (e) {
      this._flash(row, e.message, true);
    } finally {
      this.busyKey = null;
    }
  },

  // ── Attach existing ──
  _attachDerive(query) {
    const club = _clubsList.find(c => c.id === this.clubId);
    if (!club) return { candidates: [], dismissed: [] };
    return deriveAttachCandidates(_clubsTournaments, _clubsRegistrations, {
      clubId: this.clubId,
      clubCommunityId: club.community_id,
      authUser: getAuthUsername(),
      admin: isAdmin(),
      dismissed: this.dismissedKeys,
      query,
    });
  },
  /** All non-dismissed suggestions (no search filter) — the section count. */
  get attachSection() { return this._attachDerive('').candidates; },
  get attachDismissedAll() { return this._attachDerive('').dismissed; },
  get attachCandidates() { return this._attachDerive(this.attachQuery).candidates.slice(0, 30); },
  get attachDismissed() { return this._attachDerive(this.attachQuery).dismissed; },
  get attachSectionVisible() { return this.attachSection.length > 0 || this.attachDismissedAll.length > 0; },
  _saveDismissed() {
    try { localStorage.setItem(`${_CLUB_EVENTS_DISMISSED_KEY}:${this.clubId}`, JSON.stringify(this.dismissedKeys)); } catch (_) {}
  },
  dismiss(item) {
    if (!this.dismissedKeys.includes(item.key)) this.dismissedKeys = [...this.dismissedKeys, item.key];
    this._saveDismissed();
  },
  restore(item) {
    this.dismissedKeys = this.dismissedKeys.filter(k => k !== item.key);
    this._saveDismissed();
    if (!this.dismissedKeys.length) this.showDismissed = false;
  },
  toggleShowDismissed() { this.showDismissed = !this.showDismissed; },
  async attach(item) {
    this.busyKey = item.key;
    try {
      if (item.kind === 'tournament') {
        await clubsAttachTournamentToClub(item.id);
      } else {
        await _clubsAttachRegistrationToClub(item.id);
      }
      _clubEventsRefresh();
    } catch (e) {
      this._flash({ key: item.key }, e.message, true);
    } finally {
      this.busyKey = null;
    }
  },
});

// Close an open row menu when clicking outside it / pressing Escape.
document.addEventListener('click', (ev) => {
  if (_clubEventsStore.menuKey === null) return;
  if (ev.target.closest('.club-events-menu-wrap')) return;
  _clubEventsStore.menuKey = null;
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') _clubEventsStore.menuKey = null;
});

/** Recompute the Events rows from the module-level data into the store. */
function _clubEventsRefresh() {
  const club = _clubsList.find(c => c.id === _activeClubId);
  _clubEventsStore.clubId = _activeClubId;
  _clubEventsStore.lang = getAppLanguage();
  _clubEventsStore.seasons = Array.isArray(_clubSeasons) ? _clubSeasons : [];
  _clubEventsStore.pinnedIds = (club && Array.isArray(club.pinned_tournament_ids)) ? club.pinned_tournament_ids : [];
  _clubEventsStore.rows = deriveEventRows(_clubsTournaments, _clubsRegistrations, {
    clubId: _activeClubId,
    publicItems: _clubPublicTournaments,
    authUser: getAuthUsername(),
    admin: isAdmin(),
  });
  // Attach suggestions: remembered open state + dismissed keys (pruned to
  // events that still exist so the list never fills with dead ids).
  let open = false;
  try { open = sessionStorage.getItem(`${_CLUB_EVENTS_ATTACH_OPEN_KEY}:${_activeClubId}`) === '1'; } catch (_) {}
  _clubEventsStore.attachOpen = open;
  let dismissed = [];
  try {
    const raw = localStorage.getItem(`${_CLUB_EVENTS_DISMISSED_KEY}:${_activeClubId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) dismissed = parsed.filter(k => typeof k === 'string');
  } catch (_) {}
  const existing = new Set([
    ..._clubsTournaments.map(t_ => 'tn:' + t_.id),
    ..._clubsRegistrations.map(r => 'reg:' + r.id),
  ]);
  const pruned = dismissed.filter(k => existing.has(k));
  _clubEventsStore.dismissedKeys = pruned;
  if (pruned.length !== dismissed.length) _clubEventsStore._saveDismissed();
}

// Static shell for the Events island. Row markup lives in #tpl-club-event-row (index.html).
const _CLUB_EVENTS_ISLAND_HTML = `
<div class="card club-events-card" id="club-events-island" v-scope>
  <div class="club-events-head">
    <h3 class="club-events-title">${_ic('calendar')} {{ t('txt_club_events_title') }}</h3>
    <div class="club-events-head-actions">
      <button type="button" class="btn btn-sm btn-primary" @click="newEvent()">+ {{ t('txt_club_events_new') }}</button>
      <button type="button" class="btn btn-sm" :aria-expanded="attachOpen" aria-controls="club-events-attach-body" @click="openAttach()">{{ t('txt_club_events_attach') }}</button>
    </div>
  </div>
  <p v-if="attachNoneMsg" class="muted-note club-events-attach-none" role="status">{{ t('txt_club_events_attach_none') }}</p>
  <section v-if="attachSectionVisible" class="club-events-attach" :class="{ 'is-open': attachOpen }">
    <button type="button" class="player-codes-summary club-events-attach-summary" :aria-expanded="attachOpen"
            aria-controls="club-events-attach-body" @click="toggleAttach()">
      <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> {{ t('txt_club_events_attach_suggestions', { n: attachSection.length }) }}</span>
    </button>
    <div v-if="attachOpen" id="club-events-attach-body" class="club-events-attach-body">
      <p class="player-codes-help m-0 mb-2">{{ t('txt_club_events_attach_help') }}</p>
      <input type="search" id="club-events-attach-search" class="clubs-assign-search-input" v-model="attachQuery"
             :placeholder="t('txt_club_events_attach_search')" :aria-label="t('txt_club_events_attach_search')" autocomplete="off">
      <ul v-if="attachCandidates.length" class="club-events-attach-list">
        <li v-for="item in attachCandidates" :key="item.key" class="club-events-attach-row">
          <span class="club-events-attach-name">
            {{ item.name }}
            <span class="badge badge-type">{{ item.kind === 'lobby' ? t('txt_reg_lobby') : t('txt_comm_col_tournament') }}</span>
          </span>
          <span class="club-events-attach-actions">
            <button type="button" class="btn btn-sm btn-muted" @click="dismiss(item)">{{ t('txt_club_events_attach_dismiss') }}</button>
            <button type="button" class="btn btn-sm btn-primary" :disabled="busyKey === item.key" @click="attach(item)">{{ t('txt_clubs_attach_to_club') }}</button>
          </span>
          <span v-if="msgKey === item.key" class="fs-sm text-error club-events-attach-msg">{{ msgText }}</span>
        </li>
      </ul>
      <p v-else class="muted-note m-0">{{ t('txt_club_events_attach_none') }}</p>
      <div v-if="attachDismissedAll.length" class="club-events-attach-dismissed">
        <button type="button" class="btn btn-sm btn-muted" :aria-expanded="showDismissed" @click="toggleShowDismissed()">
          {{ showDismissed ? t('txt_club_events_attach_hide_dismissed') : t('txt_club_events_attach_show_dismissed', { n: attachDismissedAll.length }) }}
        </button>
        <ul v-if="showDismissed" class="club-events-attach-list">
          <li v-for="item in attachDismissed" :key="item.key" class="club-events-attach-row club-events-attach-row--dismissed">
            <span class="club-events-attach-name">
              {{ item.name }}
              <span class="badge badge-type">{{ item.kind === 'lobby' ? t('txt_reg_lobby') : t('txt_comm_col_tournament') }}</span>
            </span>
            <span class="club-events-attach-actions">
              <button type="button" class="btn btn-sm" @click="restore(item)">{{ t('txt_club_events_attach_restore') }}</button>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>
  <div class="club-events-toolbar">
    <div class="home-filter-row" role="tablist" :aria-label="t('txt_txt_filter_dim_status')">
      <button type="button" class="home-filter-chip" :class="{ active: tab === 'active' }" role="tab" :aria-selected="tab === 'active'" @click="setTab('active')">
        <span>{{ t('txt_txt_filter_active') }}</span><span class="home-filter-chip-count">{{ tabCount('active') }}</span>
      </button>
      <button type="button" class="home-filter-chip" :class="{ active: tab === 'finished' }" role="tab" :aria-selected="tab === 'finished'" @click="setTab('finished')">
        <span>{{ t('txt_txt_finished') }}</span><span class="home-filter-chip-count">{{ tabCount('finished') }}</span>
      </button>
      <button type="button" class="home-filter-chip" :class="{ active: tab === 'archived' }" role="tab" :aria-selected="tab === 'archived'" @click="setTab('archived')">
        <span>{{ t('txt_club_events_tab_archived') }}</span><span class="home-filter-chip-count">{{ tabCount('archived') }}</span>
      </button>
    </div>
  </div>
  <p v-if="!hasAnyRows && !hasEditable" class="muted-note club-events-empty">{{ t('txt_club_events_empty_readonly') }}</p>
  <div v-else-if="tab === 'active'">
    <div v-if="pinnedRows.length" class="club-events-group">
      <h4 class="club-events-group-title">${_ic('star')} {{ t('txt_club_events_pinned_group') }}</h4>
      <div v-for="row in pinnedRows" :key="row.key" v-scope="{ $template: '#tpl-club-event-row', row }"></div>
    </div>
    <div v-if="unpinnedActive.length" class="club-events-group">
      <div v-for="row in unpinnedActive" :key="row.key" v-scope="{ $template: '#tpl-club-event-row', row }"></div>
    </div>
    <div v-if="!tabRows.length" class="club-events-empty">
      <p class="muted-note m-0">{{ t('txt_club_events_empty_active') }}</p>
      <div class="club-events-head-actions mt-2">
        <button type="button" class="btn btn-sm btn-primary" @click="newEvent()">+ {{ t('txt_club_events_new') }}</button>
        <button type="button" class="btn btn-sm" @click="openAttach()">{{ t('txt_club_events_attach') }}</button>
      </div>
    </div>
  </div>
  <div v-else-if="tab === 'finished'">
    <div v-if="tabRows.length" class="club-events-group">
      <div v-for="row in tabRows" :key="row.key" v-scope="{ $template: '#tpl-club-event-row', row }"></div>
    </div>
    <p v-else class="muted-note club-events-empty">{{ t('txt_club_events_empty_finished') }}</p>
  </div>
  <div v-else>
    <div v-if="tabRows.length" class="club-events-group">
      <div v-for="row in tabRows" :key="row.key" v-scope="{ $template: '#tpl-club-event-row', row }"></div>
    </div>
    <p v-else class="muted-note club-events-empty">{{ t('txt_club_events_empty_archived') }}</p>
  </div>
</div>`;

/** Inject the Events island shell into its slot and mount the store on it. */
function _clubsMountEventsIsland() {
  const slot = document.getElementById('club-events-slot');
  if (!slot) return;
  _clubEventsRefresh();
  slot.innerHTML = _CLUB_EVENTS_ISLAND_HTML;
  mountIsland('#club-events-island', _clubEventsStore);
}

/** "New event in this club": preset the create form to this club, then open it. */
function clubsNewEventInClub() {
  if (!_activeClubId) return;
  if (typeof _applyCreateClubPreset === 'function') _applyCreateClubPreset(_activeClubId, { lock: false });
  setActiveTab('create');
}

/** Attach a lobby the user edits to the active club (moving its community first when needed). */
async function _clubsAttachRegistrationToClub(rid) {
  const club = _clubsList.find(c => c.id === _activeClubId);
  const r_ = _clubsRegistrations.find(r => r.id === rid);
  if (!club || !r_) return;
  if ((r_.community_id || 'open') !== club.community_id) {
    const res = await apiAuth(`/api/registrations/${encodeURIComponent(rid)}/community`, {
      method: 'PATCH',
      body: JSON.stringify({ community_id: club.community_id }),
    });
    r_.community_id = res?.community_id ?? club.community_id;
    if (res && 'club_id' in res) r_.club_id = res.club_id;
    if (res && 'season_id' in res) r_.season_id = res.season_id;
  }
  const clubRes = await apiAuth(`/api/registrations/${encodeURIComponent(rid)}/club`, {
    method: 'PATCH',
    body: JSON.stringify({ club_id: _activeClubId }),
  });
  r_.club_id = clubRes?.club_id ?? _activeClubId;
  if (clubRes && 'season_id' in clubRes) r_.season_id = clubRes.season_id;
  r_.club_name = club.name;
  if (typeof loadTournaments === 'function') loadTournaments().catch(() => {});
}

/**
 * "← Back to {club}" strip above the event view. Consumes the pending club id
 * set by the Events card right before openTournament/openRegistration; any
 * other entry point (home list, chips) clears it.
 */
function _renderViewClubReturn() {
  _clubsReturnTo = _clubsReturnToPending;
  _clubsReturnToPending = null;
  const el = document.getElementById('view-club-return');
  if (!el) return;
  const club = _clubsReturnTo ? (_clubsList || []).find(c => c.id === _clubsReturnTo) : null;
  if (!club) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<button type="button" class="btn btn-sm view-club-return-btn" onclick="clubsReturnToClub()">← ${esc(t('txt_club_events_back_to_club', { club: club.name }))}</button>`;
}

/** Return to the club detail the current event was opened from. */
function clubsReturnToClub() {
  if (_clubsReturnTo) _activeClubId = _clubsReturnTo;
  setActiveTab('clubs');
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
          class="clubs-player-filter"
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
      <table class="player-codes-table table-stack">
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
              <td class="player-codes-name stack-title">
                ${esc(p.name)}
                ${noGames ? `<span class="muted-tiny ml-1">(${t('txt_txt_no_matches')})</span>` : ''}
              </td>
              <td class="player-codes-cell stack-pri" data-label="${escAttr(t('txt_clubs_hub_status'))}">${hasHub
                ? `<span class="muted-tiny text-success">${t('txt_clubs_hub_yes')}</span>`
                : `<span class="muted-tiny text-muted">${t('txt_clubs_hub_no')}</span>`}</td>
              <td class="player-codes-cell stack-full stack-ellipsis" data-label="${escAttr(t('txt_txt_email'))}">${hasEmail ? `<span title="${escAttr(p.email)}">${esc(p.email)}</span>` : `<span class="muted-tiny">${t('txt_clubs_player_no_email')}</span>`}</td>
              <td class="player-codes-cell-center" data-label="${escAttr(`${sportLabel} ELO`)}">
                <input type="number" id="clubs-elo-${sport}-${esc(p.profile_id)}" min="0" max="4000" step="1"
                  value="${eloVal != null ? eloVal : ''}" placeholder="—"
                  class="clubs-elo-input"
                  oninput="_clubsDebouncedSaveElo('${esc(p.profile_id)}', '${sport}')">
                <span id="clubs-elo-${sport}-msg-${esc(p.profile_id)}" class="clubs-inline-msg"></span>
              </td>
              <td class="player-codes-cell-center stack-pri" data-label="${escAttr(t('txt_clubs_player_matches'))}">
                <span class="muted-tiny">${matchCount != null ? matchCount : '—'}</span>
              </td>
              <td class="player-codes-cell nowrap" data-label="${escAttr(`${sportLabel} ${t('txt_clubs_tier')}`)}">
                <select id="clubs-ptier-${sport}-${esc(p.profile_id)}" class="clubs-tier-select"
                  onchange="clubsAssignTier('${esc(p.profile_id)}', '${sport}')">
                  <option value="">— ${t('txt_txt_none_selected')} —</option>
                  ${tierOptions}
                </select>
                <span id="clubs-ptier-${sport}-msg-${esc(p.profile_id)}" class="clubs-inline-msg"></span>
              </td>
              <td class="row-actions stack-actions">
                <button class="btn btn-sm btn-row player-codes-icon-btn" onclick="clubsTogglePlayerSport('${esc(p.profile_id)}', '${sport}', false)" title="${esc(hideTip)}" aria-label="${esc(hideTip)} ${esc(p.name)}">${_ic('eyeoff')}</button>
                <button class="btn btn-sm btn-row btn-row--danger player-codes-icon-btn" onclick="clubsRemovePlayer('${esc(p.profile_id)}', '${esc(p.name)}')" title="${esc(removeTip)}" aria-label="${esc(removeTip)} ${esc(p.name)}">${_ic('trash')}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

    if (!visibleForSport.length && hiddenFromSport.length) {
      html += `<p class="muted-note mt-2">${t('txt_txt_no_results')}</p>`;
    }

    if (hiddenFromSport.length) {
      html += `
    <details class="clubs-collapsible">
      <summary class="summary-toggle summary-toggle--club">
        <span class="tv-chevron">&#9658;</span>
        ${t('txt_clubs_hidden_from_sport_title').replace('{sport}', sportLabel).replace('{n}', String(hiddenFromSport.length))}
      </summary>
      <div class="clubs-collapsible-body">
        <div class="player-codes-table-wrap">
          <table class="player-codes-table table-stack">
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
              <tr class="player-codes-row player-codes-row--dimmed">
                <td class="player-codes-name stack-title">${esc(p.name)}</td>
                <td class="player-codes-cell-center stack-pri" data-label="${escAttr(`${sportLabel} ELO`)}"><span class="muted-tiny">${eloVal != null ? Math.round(eloVal) : '—'}</span></td>
                <td class="player-codes-cell-center stack-pri" data-label="${escAttr(t('txt_clubs_player_matches'))}"><span class="muted-tiny">${matchCount != null ? matchCount : '—'}</span></td>
                <td class="row-actions stack-actions">
                  <button class="btn btn-sm btn-row btn-row--accent player-codes-icon-btn" onclick="clubsTogglePlayerSport('${esc(p.profile_id)}', '${sport}', true)" title="${esc(restoreTip)}" aria-label="${esc(restoreTip)} ${esc(p.name)}">${_ic('eye')}</button>
                  <button class="btn btn-sm btn-row btn-row--danger player-codes-icon-btn" onclick="clubsRemovePlayer('${esc(p.profile_id)}', '${esc(p.name)}')" title="${esc(removeTip)}" aria-label="${esc(removeTip)} ${esc(p.name)}">${_ic('trash')}</button>
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
  _clubsRenderHubMerge();
}

// ─── Ghost profile → Hub profile conversion ──────────────

function clubsShowConvertGhostForm(profileId, currentName) {
  // Render a small overlay card inside the possible-members container
  const area = document.getElementById('clubs-ghost-duplicates');
  const container = area || document.querySelector('#clubs-players-list');
  if (!container) return;

  const formHtml = `
    <div id="clubs-convert-ghost-form" class="ghost-convert-form">
      <p class="m-0 mb-1-5 fs-lg fw-600">${t('txt_ph_convert_ghost_title')} — <em>${esc(currentName)}</em></p>
      <p class="m-0 mb-2-5 fs-sm text-muted">${t('txt_ph_convert_ghost_help')}</p>
      <div class="d-flex gap-2 flex-wrap items-end">
        <label class="ghost-field">
          ${t('txt_txt_name')}
          <input type="text" id="clubs-convert-name" value="${escAttr(currentName)}"
            class="hub-input"
            aria-label="${t('txt_txt_name')}">
        </label>
        <label class="ghost-field ghost-field--wide">
          ${t('txt_txt_email')} <span class="fw-normal text-muted">(${t('txt_txt_optional')})</span>
          <input type="email" id="clubs-convert-email" placeholder="${t('txt_ph_convert_email_placeholder')}"
            class="hub-input"
            aria-label="${t('txt_txt_email')}">
        </label>
        <button type="button" class="btn btn-success btn-sm" onclick="clubsConvertGhost('${escAttr(profileId)}')">${t('txt_ph_convert_confirm')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="document.getElementById('clubs-convert-ghost-form')?.remove()">${t('txt_txt_cancel')}</button>
      </div>
      <div id="clubs-convert-msg" class="mt-1-5 fs-sm"></div>
    </div>`;

  document.getElementById('clubs-convert-ghost-form')?.remove();
  document.getElementById('clubs-merge-ghost-form')?.remove();
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
      banner.classList.add('mt-2');
      banner.innerHTML = `<strong>${t('txt_ph_convert_ok', { name: esc(result.name) })}</strong><br>
        <span class="fs-md">${t('txt_ph_convert_passphrase_label')}: </span>
        <code class="player-codes-passphrase" onclick="const c=this;navigator.clipboard.writeText(c.textContent).then(()=>flashSuccess(c,'${escAttr(t('txt_txt_copied'))}'))" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code>
        ${result.email ? `<br><span class="fs-sm text-muted">${t('txt_ph_convert_email_sent', { email: esc(result.email) })}</span>` : ''}`;
      area.prepend(banner);
      setTimeout(() => banner.remove(), 14000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span class="text-error">${esc(e.message)}</span>`;
  }
}

// ─── Ghost profile → existing Hub profile merge ──────────

let _clubsMergeGhostSearchTimer = null;

function _clubsHubOptionsHtml(rows) {
  return rows.map(r => `<option value="${escAttr(r.name || r.profile_id)}" data-profile-id="${escAttr(r.profile_id)}">`).join('');
}

/** Per-row "Merge into player": fold one ghost into an existing Hub profile. */
function clubsShowMergeGhostForm(profileId, currentName) {
  const area = document.getElementById('clubs-ghost-duplicates');
  if (!area) return;
  // Roster Hub members are offered up front; typing searches the whole community.
  const rosterHubs = _clubPlayers.filter(p => p.has_hub_profile);
  const formHtml = `
    <div id="clubs-merge-ghost-form" class="ghost-convert-form">
      <p class="m-0 mb-1-5 fs-lg fw-600">${t('txt_clubs_merge_ghost_title')} — <em>${esc(currentName)}</em></p>
      <p class="m-0 mb-2-5 fs-sm text-muted">${t('txt_clubs_merge_ghost_help')}</p>
      <div class="d-flex gap-2 flex-wrap items-end">
        <label class="ghost-field ghost-field--wide">
          ${t('txt_clubs_merge_target_label')}
          <input type="search" id="clubs-merge-ghost-target" list="clubs-merge-ghost-options"
            class="hub-input" autocomplete="off"
            placeholder="${escAttr(t('txt_clubs_merge_ghost_search_placeholder'))}"
            oninput="_clubsMergeGhostSearchInput(this.value)"
            aria-label="${escAttr(t('txt_clubs_merge_target_label'))}">
          <datalist id="clubs-merge-ghost-options">${_clubsHubOptionsHtml(rosterHubs)}</datalist>
        </label>
        <button type="button" class="btn btn-primary btn-sm" onclick="clubsMergeGhostIntoHub('${escAttr(profileId)}', '${escAttr(currentName)}')">${t('txt_ph_merge_into_hub')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="document.getElementById('clubs-merge-ghost-form')?.remove()">${t('txt_txt_cancel')}</button>
      </div>
      <div id="clubs-merge-ghost-msg" class="mt-1-5 fs-sm"></div>
    </div>`;

  document.getElementById('clubs-convert-ghost-form')?.remove();
  document.getElementById('clubs-merge-ghost-form')?.remove();
  area.insertAdjacentHTML('afterbegin', formHtml);
  document.getElementById('clubs-merge-ghost-target')?.focus();
}

function _clubsMergeGhostSearchInput(value) {
  clearTimeout(_clubsMergeGhostSearchTimer);
  const q = (value || '').trim();
  if (q.length < 2 || !_activeClubId) return;
  _clubsMergeGhostSearchTimer = setTimeout(async () => {
    try {
      const results = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/candidates?q=${encodeURIComponent(q)}`);
      const dl = document.getElementById('clubs-merge-ghost-options');
      if (!dl || !Array.isArray(results)) return;
      // Past participants have no profile to merge into — Hub profiles only.
      const hubs = results.filter(r => r.has_hub_profile !== false && r.profile_id);
      for (const p of _clubPlayers) {
        if (p.has_hub_profile && (p.name || '').toLowerCase().includes(q.toLowerCase())
            && !hubs.some(h => h.profile_id === p.profile_id)) hubs.push(p);
      }
      dl.innerHTML = _clubsHubOptionsHtml(hubs);
    } catch (_) {}
  }, 250);
}

async function clubsMergeGhostIntoHub(ghostId, ghostName) {
  const input = document.getElementById('clubs-merge-ghost-target');
  const dl = document.getElementById('clubs-merge-ghost-options');
  const msgEl = document.getElementById('clubs-merge-ghost-msg');
  const value = input?.value?.trim() || '';
  const opt = dl ? Array.from(dl.options).find(o => o.value === value) : null;
  const targetId = opt?.dataset.profileId || '';
  if (!targetId) {
    if (msgEl) msgEl.innerHTML = `<span class="text-error">${esc(t('txt_clubs_merge_ghost_pick_target'))}</span>`;
    return;
  }
  if (!confirm(t('txt_ph_merge_into_hub_confirm', { hub: value, names: ghostName }))) return;
  if (msgEl) msgEl.innerHTML = `<em>${t('txt_ph_merging')}</em>`;
  try {
    // The Hub target leads source_ids; the backend keeps it and folds the ghost in.
    const result = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/consolidate-ghosts`, {
      method: 'POST',
      body: JSON.stringify({ source_ids: [targetId, ghostId], name: null }),
    });
    document.getElementById('clubs-merge-ghost-form')?.remove();
    _clubsSelectedGhostProfiles.delete(ghostId);
    _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
    _clubsRenderPlayers();
    await _clubsRenderPossibleMembers();
    const area = document.getElementById('clubs-ghost-duplicates');
    if (area) {
      const banner = document.createElement('div');
      banner.className = 'alert alert-info mt-2';
      banner.textContent = t('txt_ph_merge_into_hub_ok', { name: result.name || value });
      area.prepend(banner);
      setTimeout(() => banner.remove(), 4000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span class="text-error">${esc(e.message)}</span>`;
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
      err.className = 'text-error fs-sm mt-1-5';
      err.textContent = e.message;
      area.prepend(err);
      setTimeout(() => err.remove(), 5000);
    }
  }
}

// ─── Possible members (past participants / ghost profiles) ─

let _clubsGhostGroups = [];
const _CLUBS_POSSIBLE_MEMBERS_OPEN_KEY = 'amistoso-clubs-possible-members-open';
const _CLUBS_GHOST_MERGE_OPEN_KEY = 'amistoso-clubs-ghost-merge-open';
function _clubsReadOpenFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
}
function _clubsWriteOpenFlag(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch (_) {}
}
let _clubsGhostMergeOpen = _clubsReadOpenFlag(_CLUBS_GHOST_MERGE_OPEN_KEY);
let _clubsPossibleMembersOpen = _clubsReadOpenFlag(_CLUBS_POSSIBLE_MEMBERS_OPEN_KEY);
let _clubsSelectedGhostProfiles = new Set();
// Optional registered (Hub) member to merge the selected ghosts into. When set,
// only ≥1 ghost is needed; the ghosts fold into this player instead of a new one.
let _clubsMergeTargetId = '';
let _clubsPossibleGhostMembers = [];

function _clubsSetPossibleMembersOpen(open) {
  _clubsPossibleMembersOpen = !!open;
  _clubsWriteOpenFlag(_CLUBS_POSSIBLE_MEMBERS_OPEN_KEY, _clubsPossibleMembersOpen);
}
function _clubsSetGhostMergeOpen(open) {
  _clubsGhostMergeOpen = !!open;
  _clubsWriteOpenFlag(_CLUBS_GHOST_MERGE_OPEN_KEY, _clubsGhostMergeOpen);
}


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
  _clubsMergeTargetId = '';
  _clubsRenderPossibleMembers(false);
}


function clubsSetMergeTarget(profileId) {
  _clubsMergeTargetId = profileId || '';
  _clubsRenderPossibleMembers(false);
}


async function clubsConsolidateSelectedGhosts() {
  if (!_activeClubId) return;
  const target = _clubsMergeTargetId;
  const ghostIds = [..._clubsSelectedGhostProfiles];
  // Need ≥1 ghost when merging into a registered player, ≥2 otherwise.
  if (target ? ghostIds.length < 1 : ghostIds.length < 2) return;

  const ghostNames = ghostIds
    .map(id => {
      const groupProfile = _clubsGhostGroups.flatMap(g => g.profiles).find(p => p.profile_id === id);
      const rosterProfile = _clubPlayers.find(p => p.profile_id === id);
      return groupProfile?.name || rosterProfile?.name || id;
    })
    .join(', ');

  if (target) {
    const targetName = _clubPlayers.find(p => p.profile_id === target)?.name || target;
    if (!confirm(t('txt_ph_merge_into_hub_confirm', { hub: targetName, names: ghostNames }))) return;
  } else if (!confirm(t('txt_ph_consolidate_confirm', { names: ghostNames }))) {
    return;
  }

  const msgEl = document.getElementById('clubs-ghost-manual-msg');
  const nameInput = document.getElementById('clubs-ghost-manual-name');
  // With a registered target we keep that player's name; otherwise use the input.
  const name = target ? null : (nameInput?.value?.trim() || null);
  // The target (Hub profile) leads source_ids so the backend picks it as target.
  const sourceIds = target ? [target, ...ghostIds] : ghostIds;
  if (msgEl) msgEl.innerHTML = `<em>${t('txt_ph_consolidating')}</em>`;

  try {
    const result = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/consolidate-ghosts`, {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds, name }),
    });
    _clubsSelectedGhostProfiles = new Set();
    _clubsMergeTargetId = '';

    const players = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
    _clubPlayers = players;
    _clubsRenderPlayers();
    _clubsRenderPossibleMembers(true);

    const area = document.getElementById('clubs-ghost-duplicates');
    if (area) {
      const banner = document.createElement('div');
      banner.className = 'alert alert-info';
      banner.classList.add('mt-2');
      banner.textContent = t('txt_ph_consolidate_ok', { name: esc(result.name || name || '') });
      area.prepend(banner);
      setTimeout(() => banner.remove(), 4000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span class="text-error">${esc(e.message)}</span>`;
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
        onclick="_clubsSetPossibleMembersOpen(document.getElementById('clubs-possible-members-details')?.open ?? false)">
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
          <table class="player-codes-table table-stack">
            <thead><tr class="player-codes-head-row">
              <th class="player-codes-th-center player-codes-th-narrow"></th>
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
        <td class="player-codes-cell-center stack-check">
          <input type="checkbox" ${isSelected ? 'checked' : ''}
            onchange="clubsToggleGhostMergeSelect('${escAttr(p.profile_id)}', this.checked)"
            aria-label="${t('txt_ph_select_for_merge')} ${escAttr(p.name)}"
            class="cursor-pointer">
        </td>
        <td class="player-codes-name stack-title">${esc(p.name)}</td>
        <td class="player-codes-cell-center stack-pri" data-label="${escAttr(sport === 'padel' ? t('txt_ph_padel_elo') : t('txt_ph_tennis_elo'))}">${elo != null ? Math.round(elo) : '—'}</td>
        <td class="player-codes-cell-center stack-pri" data-label="${escAttr(t('txt_clubs_player_matches'))}">${matches != null ? matches : '—'}</td>
        <td class="row-actions stack-actions">
          <button type="button" class="btn btn-sm btn-row"
            onclick="clubsShowMergeGhostForm('${escAttr(p.profile_id)}', '${escAttr(p.name)}')"
            title="${t('txt_clubs_merge_ghost_hint')}"
           >${_ic('link')} ${t('txt_clubs_merge_ghost')}</button>
          <button type="button" class="btn btn-sm btn-row btn-row--accent"
            onclick="clubsShowConvertGhostForm('${esc(p.profile_id)}', '${escAttr(p.name)}')"
            title="${t('txt_ph_convert_ghost_hint')}"
           >${_ic('userplus')} ${t('txt_ph_convert_ghost')}</button>
        </td>
      </tr>`;
  }

  html += `</tbody></table></div>`;

  if (!filteredMembers.length) {
    html += `<p class="muted-note mt-2">${t('txt_txt_no_results')}</p>`;
  }

  // Registered (Hub) members that can be a merge target.
  const hubMembers = _clubPlayers.filter(p => p.has_hub_profile);
  const hasTarget = !!_clubsMergeTargetId;
  const selCount = _clubsSelectedGhostProfiles.size;
  // Show the bar when there's something actionable: a registered target with
  // ≥1 ghost, or ≥2 ghosts to consolidate into a new profile.
  if ((hasTarget && selCount >= 1) || selCount >= 2) {
    const selectedNames = [..._clubsSelectedGhostProfiles]
      .map(id => members.find(p => p.profile_id === id)?.name || id)
      .filter(Boolean);
    const suggestedName = selectedNames[0] || '';
    const targetOptions = hubMembers
      .map(p => `<option value="${escAttr(p.profile_id)}"${p.profile_id === _clubsMergeTargetId ? ' selected' : ''}>${esc(p.name || p.profile_id)}</option>`)
      .join('');
    const label = hasTarget
      ? t('txt_clubs_merge_into_member_info', { n: selCount, name: hubMembers.find(p => p.profile_id === _clubsMergeTargetId)?.name || _clubsMergeTargetId })
      : t('txt_ph_ghosts_selected', { n: selCount });
    html += `
      <div class="clubs-ghost-merge-bar">
        <span class="clubs-ghost-merge-bar-label">${label}</span>
        <label class="muted-tiny d-flex items-center gap-1-5">
          ${t('txt_clubs_merge_target_label')}
          <select onchange="clubsSetMergeTarget(this.value)" class="clubs-ghost-merge-bar-input" aria-label="${t('txt_clubs_merge_target_label')}">
            <option value="">${t('txt_clubs_merge_target_none')}</option>
            ${targetOptions}
          </select>
        </label>
        ${hasTarget ? '' : `<input type="text" id="clubs-ghost-manual-name" value="${escAttr(suggestedName)}"
          placeholder="${t('txt_ph_consolidate_name_placeholder')}"
          class="clubs-ghost-merge-bar-input"
          aria-label="${t('txt_ph_consolidate_name_label')}">`}
        <button type="button" class="btn btn-primary btn-sm" onclick="clubsConsolidateSelectedGhosts()">${hasTarget ? t('txt_ph_merge_into_hub') : t('txt_ph_consolidate_ghosts')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="clubsClearGhostMergeSelection()">${t('txt_txt_clear')}</button>
      </div>
      <div id="clubs-ghost-manual-msg" class="clubs-ghost-merge-bar-msg"></div>`;
  }

  // Duplicate-group merge section (if any)
  if (_clubsGhostGroups.length) {
    html += `
      <details id="clubs-ghost-dup-details"${_clubsGhostMergeOpen ? ' open' : ''} class="clubs-ghost-section clubs-ghost-section--inner">
        <summary class="clubs-ghost-section-summary"
          onclick="_clubsSetGhostMergeOpen(document.getElementById('clubs-ghost-dup-details')?.open ?? false)">
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
            <table class="player-codes-table fs-sm">
              <thead><tr class="player-codes-head-row">
                <th class="player-codes-th-center player-codes-th-narrow">#</th>
                <th class="player-codes-th">${t('txt_ph_padel_elo')}</th>
                <th class="player-codes-th-center">${t('txt_clubs_player_matches')}</th>
              </tr></thead><tbody>`;
      for (const [pi, p] of group.profiles.entries()) {
        const elo = p.elo_padel != null ? `${Math.round(p.elo_padel)}` : '—';
        const matches = p.matches_padel != null ? p.matches_padel : 0;
        html += `<tr class="player-codes-row">
          <td class="player-codes-cell-center"><span class="fs-xs text-muted">${pi + 1}</span></td>
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
      banner.classList.add('mt-2');
      banner.textContent = t('txt_ph_consolidate_ok', { name: esc(name) });
      area.prepend(banner);
      setTimeout(() => banner.remove(), 4000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span class="text-error">${esc(e.message)}</span>`;
  }
}

// ─── Merge two registered (Hub) members ──────────────────

let _clubsHubMergeOpen = false;
let _clubsHubMergeKeep = '';
let _clubsHubMergeRemove = '';
let _clubsHubMergePreview = null;
let _clubsHubMergeMsg = '';       // result/error line under the form
let _clubsHubMergeMsgError = false;

/** Collapsible form to merge one registered club member into another. */
function _clubsRenderHubMerge() {
  const container = document.getElementById('clubs-hub-merge');
  if (!container || !_activeClubId) return;
  const hubMembers = _clubPlayers.filter(p => p.has_hub_profile);
  if (hubMembers.length < 2) { container.innerHTML = ''; return; }
  const ids = new Set(hubMembers.map(p => p.profile_id));
  if (!ids.has(_clubsHubMergeKeep)) _clubsHubMergeKeep = '';
  if (!ids.has(_clubsHubMergeRemove)) _clubsHubMergeRemove = '';

  const nameOf = id => hubMembers.find(p => p.profile_id === id)?.name || id;
  const options = selected => `<option value="">${t('txt_ph_choose')}</option>` + hubMembers
    .map(p => `<option value="${escAttr(p.profile_id)}"${p.profile_id === selected ? ' selected' : ''}>${esc(p.name || p.profile_id)}${p.email ? ` (${esc(p.email)})` : ''}</option>`)
    .join('');
  const preview = _clubsHubMergePreview;
  const keepName = nameOf(_clubsHubMergeKeep);
  const removeName = nameOf(_clubsHubMergeRemove);

  let status = '';
  if (_clubsHubMergeMsg) {
    status = `<div class="alert ${_clubsHubMergeMsgError ? 'alert-error' : 'alert-success'} mt-2" role="status">${esc(_clubsHubMergeMsg)}</div>`;
  } else if (preview && !preview.can_merge) {
    const tournaments = preview.shared_tournaments.map(s => s.tournament_name).join(', ');
    status = `<div class="alert alert-error mt-2" role="alert">${esc(t('txt_ph_merge_hub_blocked', { a: keepName, b: removeName, tournaments }))}</div>`;
  } else if (preview) {
    status = `<p class="muted-note mt-2">${esc(t('txt_ph_merge_hub_hint', { keep: keepName, remove: removeName, n: preview.secondary.tournaments }))}</p>`;
  }

  container.innerHTML = `
    <details id="clubs-hub-merge-details"${_clubsHubMergeOpen ? ' open' : ''} class="clubs-ghost-section">
      <summary class="clubs-ghost-section-summary"
        onclick="_clubsHubMergeOpen = !(document.getElementById('clubs-hub-merge-details')?.open ?? false)">
        <span class="tv-chevron clubs-ghost-section-chevron">&#9658;</span>
        ${t('txt_clubs_hub_merge_title')}
        <span class="muted-tiny clubs-ghost-section-hint">${t('txt_clubs_hub_merge_hint')}</span>
      </summary>
      <div class="clubs-ghost-section-body">
        <div class="clubs-ghost-merge-bar">
          <label class="muted-tiny d-flex items-center gap-1-5">${t('txt_clubs_hub_merge_keep')}
            <select class="clubs-ghost-merge-bar-input" onchange="clubsSetHubMerge('keep', this.value)">${options(_clubsHubMergeKeep)}</select>
          </label>
          <label class="muted-tiny d-flex items-center gap-1-5">${t('txt_clubs_hub_merge_remove')}
            <select class="clubs-ghost-merge-bar-input" onchange="clubsSetHubMerge('remove', this.value)">${options(_clubsHubMergeRemove)}</select>
          </label>
          <button type="button" class="btn btn-primary btn-sm" onclick="clubsMergeHubMembers()"${preview && preview.can_merge ? '' : ' disabled'}>${t('txt_ph_merge_hub_btn')}</button>
        </div>
        ${status}
      </div>
    </details>`;
}

/** Pick one side of the Hub merge and refresh the preview. */
async function clubsSetHubMerge(side, profileId) {
  if (side === 'keep') _clubsHubMergeKeep = profileId;
  else _clubsHubMergeRemove = profileId;
  _clubsHubMergePreview = null;
  _clubsHubMergeMsg = '';
  const keep = _clubsHubMergeKeep;
  const remove = _clubsHubMergeRemove;
  if (keep && remove && keep !== remove) {
    try {
      const params = new URLSearchParams({ primary_id: keep, secondary_id: remove });
      const preview = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/merge-hub/preview?${params}`);
      // Ignore a stale answer if the selection changed meanwhile.
      if (keep === _clubsHubMergeKeep && remove === _clubsHubMergeRemove) _clubsHubMergePreview = preview;
    } catch (e) {
      _clubsHubMergeMsg = e.message;
      _clubsHubMergeMsgError = true;
    }
  }
  _clubsRenderHubMerge();
}

async function clubsMergeHubMembers() {
  const preview = _clubsHubMergePreview;
  if (!preview || !preview.can_merge || !_activeClubId) return;
  const keep = preview.primary.name || preview.primary.id;
  const remove = preview.secondary.name || preview.secondary.id;
  if (!confirm(t('txt_ph_merge_hub_confirm', { keep, remove }))) return;
  try {
    const result = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players/merge-hub`, {
      method: 'POST',
      body: JSON.stringify({ primary_id: preview.primary.id, secondary_id: preview.secondary.id }),
    });
    _clubsHubMergeKeep = '';
    _clubsHubMergeRemove = '';
    _clubsHubMergePreview = null;
    _clubsHubMergeMsg = t('txt_ph_merge_hub_ok', { name: result.name });
    _clubsHubMergeMsgError = false;
    _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => _clubPlayers);
    _clubsRenderPlayers();
  } catch (e) {
    _clubsHubMergeMsg = e.message;
    _clubsHubMergeMsgError = true;
    _clubsRenderHubMerge();
  }
}

// ─── Club leaderboard (ELO ranking across all members) ───

/** Recalculate ELO for every tournament of the open club, then reload its ratings. */
async function clubsRecalculateElo() {
  if (!_activeClubId) return;
  if (!confirm(t('txt_clubs_recalc_elo_confirm'))) return;
  try {
    const res = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/elo/recalculate`, { method: 'POST' });
    _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => _clubPlayers);
    _clubsRenderPlayers();
    _clubsRenderLeaderboard();
    flashSuccess('clubs-recalc-elo-btn');
    _showToast(t('txt_clubs_recalc_elo_done', { value: res.recalculated_tournaments }));
  } catch (e) {
    _showToast(t('txt_txt_elo_recalc_failed_value', { value: e.message }), 'error');
  }
}

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
    ? `<span class="badge badge-closed clubs-lb-frozen-badge" title="${escAttr(t('txt_clubs_leaderboard_archived_note'))}">${_ic('lock')} ${esc(t('txt_clubs_season_archived'))}</span>`
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
              <td class="player-codes-cell-center text-muted">${i + 1}</td>
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
      container.innerHTML = `<p class="muted-note text-error">${esc(e.message)}</p>`;
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
              <td class="player-codes-cell-center text-muted">${i + 1}</td>
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
    
    _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
    _clubsRenderPlayers();
    _clubsOk(msgEl, 'clubs-add-player-btn');
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
    <div class="d-flex gap-2 flex-wrap items-center">
      <select id="clubs-messaging-lobby-select" class="clubs-msg-field clubs-msg-field--lobby">
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
    <div class="d-flex flex-col gap-1-5">
      <input type="text" id="clubs-messaging-subject" placeholder="${t('txt_clubs_messaging_subject')}"
        class="clubs-msg-field">
      <textarea id="clubs-messaging-message" rows="4" placeholder="${t('txt_clubs_messaging_message')}"
        class="clubs-msg-field clubs-msg-field--body"></textarea>
      ${noEmailWarning}
      <div>
        <button id="clubs-send-announce-btn" class="btn btn-sm btn-primary" type="button" onclick="clubsSendAnnouncement()"
          ${selectedWithEmailCount ? '' : 'disabled'}>${t('txt_clubs_messaging_send_announce')}</button>
      </div>
    </div>`;

  const composeHint = selectedCount === 0
    ? `<p class="muted-tiny m-0 mb-1-5">${t('txt_clubs_messaging_select_recipients_first')}</p>`
    : '';

  container.innerHTML = `
    <div class="clubs-recipients-block">
      ${recipientsHeader}
      ${recipientsToolbar}
      ${recipientsList}
    </div>
    <div class="clubs-compose-block">
      ${composeHint}
      <div class="d-flex gap-2 mb-2-5">
        <button class="${tabBtnStyle(_clubsMessagingTab === 'lobby')}" type="button"
          onclick="clubsMessagingTab('lobby')">${t('txt_clubs_messaging_tab_lobby')}</button>
        <button class="${tabBtnStyle(_clubsMessagingTab === 'announce')}" type="button"
          onclick="clubsMessagingTab('announce')">${t('txt_clubs_messaging_tab_announce')}</button>
      </div>
      <span id="clubs-messaging-msg" class="clubs-msg-status"></span>
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
      flashSuccess(sendBtn);
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
    _clubsOk(msgEl, input);
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
        // Refresh player list to show updated ELO
    if (apply_base_elo) {
      _clubPlayers = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/players`).catch(() => []);
      _clubsRenderPlayers();
    }
    _clubsOk(msgEl, `clubs-ptier-${sport}-${profileId}`);
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
  listEl.innerHTML = `<ul class="clubs-collab-list">`
    + _clubCollaborators.map(u => `
      <li class="clubs-collab-item">
        <span class="flex-1 fs-lg">${esc(u)}</span>
        <button class="btn btn-sm btn-danger btn-chip" onclick="clubsRemoveCollaborator('${esc(u)}')">${t('txt_txt_remove')}</button>
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
    _clubsOk(msgEl, 'clubs-collab-add-btn');
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
    _clubsOk(msgEl);
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
    _clubsOk(msgEl, 'clubs-email-save-btn');
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}
// ─── Utilities ────────────────────────────────────────────

function _clubsMsg(el, text, isError) {
  if (!el) return;
  el.classList.remove('text-error', 'text-success', 'fs-sm', 'fs-2xs');
  el.classList.add(...(isError ? ['text-error', 'fs-sm'] : ['text-success', 'fs-2xs']));
  el.textContent = text;
  if (!isError) setTimeout(() => { if (el) el.textContent = ''; }, 1800);
}

/**
 * Success feedback for a club action: clear the message line (wipes stale
 * errors and '...' progress) and pulse the control. Call AFTER any re-render;
 * `target` may be an element id (re-queried now) or an element.
 */
function _clubsOk(msgEl, target) {
  if (msgEl) msgEl.textContent = '';
  if (target) flashSuccess(target, t('txt_txt_saved'));
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
