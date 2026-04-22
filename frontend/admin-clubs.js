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
let _clubsMessagingTab = 'lobby'; // 'lobby' | 'announce'
let _clubsPlayerSearchTimer = null;
let _clubsPlayerSearchSelected = null;
let _clubsCollabSearchTimer = null;
let _clubsAttachSearch = '';
let _clubsPlayerFilter = '';
let _clubsEloDebounceTimers = {}; // keyed by `${profileId}-${sport}`
let _clubsLeaderboardSort = { col: 'elo', dir: 'desc' };
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
    html += `<div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_clubs_name')}</th>
          <th class="player-codes-th" style="color:var(--text-muted)">${t('txt_clubs_community')}</th>
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
            <td class="player-codes-cell" style="color:var(--text-muted);font-size:0.82rem">${comm ? esc(comm.name) : esc(cl.community_id)}</td>
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
  // Update only the global header sport pills (not the standings-specific ones)
  document.querySelectorAll('.clubs-sport-bar .clubs-sport-pill').forEach(btn => {
    btn.classList.toggle('clubs-sport-pill--active', btn.dataset.sport === sport);
  });
  // Sync standings view sport if it is currently open
  if (window._clubsStandingsData) {
    const sData = window._clubsStandingsData;
    const hasSport = (sData[sport] || []).length > 0;
    const fallback = sport === 'padel' ? 'tennis' : 'padel';
    const hasFallback = (sData[fallback] || []).length > 0;
    _clubsUpdateStandingsSport(hasSport ? sport : (hasFallback ? fallback : sport), sData);
  }
  // Re-render sport-dependent sections
  _clubsRenderTiers();
  _clubsRenderPlayers();
}

function _clubsRenderDetail() {
  const detail = document.getElementById('clubs-detail');
  if (!detail || !_activeClubId) return;

  const club = _clubsList.find(c => c.id === _activeClubId);
  if (!club) { clubsBackToOverview(); return; }

  const comm = _clubsCommunities.find(c => c.id === club.community_id);

  let html = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="clubsBackToOverview()" style="padding:0.2rem 0.5rem" aria-label="${t('txt_txt_back')}">← ${t('txt_txt_back')}</button>
        <h2 style="margin:0;flex:1">
          ${club.has_logo ? `<img src="/api/clubs/${esc(club.id)}/logo?_=${Date.now()}" alt="" style="height:24px;width:24px;object-fit:cover;border-radius:4px;margin-right:0.4rem;vertical-align:middle">` : ''}
          ${esc(club.name)}
        </h2>
        <span class="muted-note">${comm ? esc(comm.name) : ''}</span>
      </div>

      <!-- Rename -->
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.75rem">
        <input type="text" id="clubs-rename-input" value="${esc(club.name)}" placeholder="${t('txt_clubs_name')}" style="flex:1;min-width:140px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
        <button class="btn btn-sm btn-primary" onclick="clubsRename()">${t('txt_txt_save')}</button>
        <span id="clubs-rename-msg" style="font-size:0.84rem"></span>
      </div>

      <!-- Logo -->
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.85rem">
        <label class="btn btn-sm" style="cursor:pointer;margin:0">
          📷 ${t('txt_clubs_upload_logo')}
          <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="clubsUploadLogo(this)">
        </label>
        ${club.has_logo ? `<button class="btn btn-sm btn-danger" onclick="clubsDeleteLogo()">🗑 ${t('txt_clubs_remove_logo')}</button>` : ''}
        <span id="clubs-logo-msg" style="font-size:0.84rem"></span>
        <span class="muted-note" style="font-size:0.78rem">${t('txt_clubs_logo_max_size_hint')}</span>
      </div>
    </div>

    <!-- Sticky sport bar + jump nav -->
    <div class="clubs-sticky-header">
      <div class="clubs-sport-bar">
        <span class="clubs-sport-bar-label">${t('txt_txt_sport')}</span>
        <div class="clubs-sport-toggle" role="group" aria-label="${t('txt_txt_sport')}">
          <button type="button" class="clubs-sport-pill${_clubsSport === 'padel' ? ' clubs-sport-pill--active' : ''}" data-sport="padel" onclick="setClubsSport('padel')">${t('txt_txt_sport_padel')}</button>
          <button type="button" class="clubs-sport-pill${_clubsSport === 'tennis' ? ' clubs-sport-pill--active' : ''}" data-sport="tennis" onclick="setClubsSport('tennis')">${t('txt_txt_sport_tennis')}</button>
        </div>
      </div>
      <nav class="clubs-jump-nav" aria-label="${t('txt_txt_nav') || 'Navigation'}">
      <a href="#clubs-players-card" class="clubs-jump-link">\ud83d\udc65 ${t('txt_clubs_players')}</a>
      <a href="#clubs-leaderboard-card" class="clubs-jump-link">\ud83d\udcca ${t('txt_clubs_leaderboard')}</a>
      <a href="#clubs-seasons-card" class="clubs-jump-link">\ud83d\udcc5 ${t('txt_clubs_seasons')}</a>
      <a href="#clubs-tiers-card" class="clubs-jump-link">${t('txt_clubs_tiers')}</a>
      ${(isAdmin() || club.created_by === getAuthUsername()) ? `<a href="#clubs-collabs-card" class="clubs-jump-link">\ud83e\udd1d ${t('txt_clubs_collaborators')}</a>` : ''}
      </nav>
    </div>

    <!-- Tiers -->
    <details class="card" id="clubs-tiers-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> ${t('txt_clubs_tiers')}</span>
        <span class="muted-note" style="font-size:0.8rem;margin-left:0.5rem">${t('txt_clubs_tiers_help')}</span>
      </summary>
      <div class="player-codes-body">
        <div id="clubs-tiers-list"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">
          <input type="text" id="clubs-tier-name" placeholder="${t('txt_clubs_tier_name_placeholder')}" style="flex:1;min-width:120px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off">
          <label style="font-size:0.82rem;display:flex;align-items:center;gap:0.25rem">${t('txt_clubs_tier_base_elo')}<input type="number" id="clubs-tier-elo" value="1000" min="0" max="3000" step="50" style="width:70px;padding:0.35rem 0.4rem;font-size:0.85rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);text-align:center"></label>
          <button class="btn btn-sm btn-success" onclick="clubsCreateTier()">+ ${t('txt_txt_add')}</button>
        </div>
        <div id="clubs-tiers-msg" style="margin-top:0.4rem;font-size:0.84rem"></div>
      </div>
    </details>

    <!-- Seasons & Season assignment (combined) -->
    <details class="card" id="clubs-seasons-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> 📅 ${t('txt_clubs_seasons')}</span>
        ${(() => { const active = _clubSeasons.find(s => s.active); return active ? `<span class="clubs-card-badge clubs-card-badge--active">${esc(active.name)}</span>` : (_clubSeasons.length ? `<span class="clubs-card-badge">${_clubSeasons.length}</span>` : ''); })()}
      </summary>
      <div class="player-codes-body">
        <div id="clubs-seasons-list"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">
          <input type="text" id="clubs-season-name" placeholder="${t('txt_clubs_season_name_placeholder')}" style="flex:1;min-width:180px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off">
          <button class="btn btn-sm btn-success" onclick="clubsCreateSeason()">+ ${t('txt_txt_add')}</button>
        </div>
        <div id="clubs-seasons-msg" style="margin-top:0.4rem;font-size:0.84rem"></div>
        <hr style="margin:0.85rem 0;border:none;border-top:1px solid var(--border)">
        <div id="clubs-season-assign"></div>
      </div>
    </details>

    <!-- Players -->
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

    <!-- Club leaderboard -->
    <details class="card" open id="clubs-leaderboard-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> 📊 ${t('txt_clubs_leaderboard')}</span>
        ${(() => { const ranked = _clubPlayers.filter(p => (_clubsSport === 'padel' ? p.elo_padel : p.elo_tennis) != null); return ranked.length ? `<span class="clubs-card-badge">${ranked.length}</span>` : ''; })()}
      </summary>
      <div class="player-codes-body">
        <div id="clubs-leaderboard"></div>
      </div>
    </details>

    <!-- Collaborators (owner or admin only) -->
    ${(isAdmin() || club.created_by === getAuthUsername()) ? `
    <details class="card" id="clubs-collabs-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> 🤝 ${t('txt_clubs_collaborators')}</span>
      </summary>
      <div class="player-codes-body">
        <p class="player-codes-help">${t('txt_clubs_collaborators_help')}</p>
        <div id="clubs-collabs-list"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center">
          <input type="text" id="clubs-collab-input" placeholder="${t('txt_clubs_add_collab_placeholder')}" style="flex:1;min-width:160px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off"
            oninput="_clubsCollabInputChange(this.value)" list="clubs-collab-suggestions">
          <datalist id="clubs-collab-suggestions"></datalist>
          <button class="btn btn-sm btn-primary" onclick="clubsAddCollaborator()">${t('txt_clubs_add_collab_btn')}</button>
        </div>
        <div id="clubs-collab-msg" style="margin-top:0.4rem;font-size:0.84rem"></div>
      </div>
    </details>
    ` : ''}

    <!-- Email settings (owner or admin only) -->
    ${(isAdmin() || club.created_by === getAuthUsername()) ? `
    <details class="card" id="clubs-email-settings-card">
      <summary class="player-codes-summary">
        <span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> ✉️ ${t('txt_clubs_email_settings')}</span>
      </summary>
      <div class="player-codes-body">
        <p class="player-codes-help">${t('txt_clubs_email_settings_help')}</p>
        <div style="display:flex;flex-direction:column;gap:0.6rem;max-width:420px">
          <label style="font-size:0.88rem">${t('txt_clubs_email_reply_to')}
            <input type="email" id="clubs-email-reply-to" value="${esc((club.email_settings && club.email_settings.reply_to) || '')}" placeholder="${t('txt_clubs_email_reply_to_placeholder')}" style="display:block;width:100%;margin-top:0.2rem;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
          </label>
          <label style="font-size:0.88rem">${t('txt_clubs_email_sender_name')}
            <input type="text" id="clubs-email-sender-name" value="${esc((club.email_settings && club.email_settings.sender_name) || '')}" placeholder="${esc(club.name)}" style="display:block;width:100%;margin-top:0.2rem;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
          </label>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <button class="btn btn-sm btn-primary" onclick="clubsSaveEmailSettings()">${t('txt_txt_save')}</button>
            <span id="clubs-email-settings-msg" style="font-size:0.84rem"></span>
          </div>
        </div>
      </div>
    </details>
    ` : ''}
  `;

  detail.innerHTML = html;

  // Restore + persist collapsible card open/closed state via sessionStorage
  const _collapsibleCardIds = ['clubs-players-card', 'clubs-tiers-card', 'clubs-seasons-card', 'clubs-leaderboard-card', 'clubs-collabs-card', 'clubs-email-settings-card'];
  _collapsibleCardIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const stored = sessionStorage.getItem(`clubs-card-open:${id}`);
    if (stored !== null) el.open = stored === '1';
    el.addEventListener('toggle', () => {
      try { sessionStorage.setItem(`clubs-card-open:${id}`, el.open ? '1' : '0'); } catch (_) {}
    }, { once: false });
  });

  // Render sub-sections
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
    container.innerHTML = `<p class="muted-note">${t('txt_clubs_no_tiers')}</p>`;
    return;
  }
  container.innerHTML = `
    <div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_clubs_tier_name')}</th>
          <th style="text-align:right;padding:0.3rem 0.5rem">${t('txt_clubs_tier_base_elo')}</th>
          <th class="player-codes-th-center">${t('txt_clubs_tier_position')}</th>
          <th class="player-codes-th"></th>
        </tr>
      </thead>
      <tbody>
        ${tiersForSport.map(tier => `
          <tr class="player-codes-row">
            <td class="player-codes-name">${esc(tier.name)}</td>
            <td class="player-codes-cell-center">${tier.base_elo}</td>
            <td class="player-codes-cell-center">${tier.position}</td>
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
    container.innerHTML = `<p class="muted-note">${t('txt_clubs_no_seasons')}</p>`;
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
              <button class="btn btn-sm player-codes-icon-btn" onclick="clubsViewStandings('${esc(s.id)}')" title="${t('txt_clubs_season_standings')}" aria-label="${t('txt_clubs_season_standings')} ${esc(s.name)}">📊</button>
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
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubsRenderSeasonAssignment();
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
    _clubSeasons = await apiAuth(`/api/clubs/${encodeURIComponent(_activeClubId)}/seasons`).catch(() => []);
    _clubsRenderSeasons();
    _clubsRenderSeasonAssignment();
  } catch (e) {
    _clubsMsg(msgEl, e.message, true);
  }
}

// ─── Season standings ────────────────────────────────────

let _standingsSport = 'padel';

function _renderStandingsTable(standings) {
  if (!standings || !standings.length) {
    return `<p class="muted-note">${t('txt_clubs_season_no_standings')}</p>`;
  }
  return `<div class="player-codes-table-wrap">
    <table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th-center">#</th>
          <th class="player-codes-th">${t('txt_player_leaderboard_name')}</th>
          <th class="player-codes-th-center">${t('txt_player_elo_rating')}</th>
          <th class="player-codes-th-center">${t('txt_clubs_season_elo_change')}</th>
          <th class="player-codes-th-center">${t('txt_player_leaderboard_matches')}</th>
          <th class="player-codes-th-center">${t('txt_clubs_season_best_rank')}</th>
          <th class="player-codes-th-center">${t('txt_clubs_season_events')}</th>
        </tr>
      </thead>
      <tbody>
        ${standings.map((s, i) => `
          <tr class="player-codes-row">
            <td class="player-codes-cell-center" style="color:var(--text-muted)">${i + 1}</td>
            <td class="player-codes-name">${esc(s.player_name)}</td>
            <td class="player-codes-cell-center">${s.elo_end != null ? Math.round(s.elo_end) : '—'}</td>
            <td class="player-codes-cell-center" style="color:${s.elo_change > 0 ? 'var(--green)' : s.elo_change < 0 ? 'var(--red)' : 'var(--text-muted)'}">${s.elo_change != null ? (s.elo_change > 0 ? '+' : '') + s.elo_change.toFixed(1) : '—'}</td>
            <td class="player-codes-cell-center">${s.matches_played}</td>
            <td class="player-codes-cell-center">${s.best_rank != null ? '#' + s.best_rank + (s.best_rank_tournament_name ? ` <span class="muted-tiny">(${esc(s.best_rank_tournament_name)})</span>` : '') : '—'}</td>
            <td class="player-codes-cell-center">${s.tournaments_played}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`;
}

function _clubsUpdateStandingsSport(sport, data) {
  _standingsSport = sport;
  // Update pill active state (using same clubs-sport-pill--active class as the global toggle)
  document.querySelectorAll('#clubs-standings-sport-toggle .clubs-sport-pill').forEach(btn => {
    btn.classList.toggle('clubs-sport-pill--active', btn.dataset.sport === sport);
  });
  // Re-render table
  const tableEl = document.getElementById('clubs-standings-table');
  if (tableEl) tableEl.innerHTML = _renderStandingsTable(data[sport] || []);
}

async function clubsViewStandings(seasonId) {
  const season = _clubSeasons.find(s => s.id === seasonId);
  if (!season) return;

  const container = document.getElementById('clubs-seasons-msg');
  if (!container) return;
  container.innerHTML = `<div class="skeleton-loader"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>`;

  try {
    const data = await apiAuth(`/api/seasons/${encodeURIComponent(seasonId)}/standings`);
    const hasPadel = data.padel && data.padel.length > 0;
    const hasTennis = data.tennis && data.tennis.length > 0;
    const hasAny = hasPadel || hasTennis;

    // Sync initial standings sport with global club sport, falling back gracefully
    _standingsSport = hasPadel && _clubsSport === 'padel' ? 'padel'
      : hasTennis && _clubsSport === 'tennis' ? 'tennis'
      : hasPadel ? 'padel' : 'tennis';
    const multisport = hasPadel && hasTennis;

    const sportToggleHtml = multisport
      ? `<div class="clubs-sport-toggle" id="clubs-standings-sport-toggle">
           <button type="button" class="clubs-sport-pill${_standingsSport === 'padel' ? ' clubs-sport-pill--active' : ''}" data-sport="padel" onclick="_clubsUpdateStandingsSport('padel', window._clubsStandingsData)">${t('txt_txt_sport_padel')}</button>
           <button type="button" class="clubs-sport-pill${_standingsSport === 'tennis' ? ' clubs-sport-pill--active' : ''}" data-sport="tennis" onclick="_clubsUpdateStandingsSport('tennis', window._clubsStandingsData)">${t('txt_txt_sport_tennis')}</button>
         </div>`
      : hasPadel
        ? `<span class="badge" style="font-size:0.8rem">${t('txt_txt_sport_padel')}</span>`
        : hasTennis
          ? `<span class="badge" style="font-size:0.8rem">${t('txt_txt_sport_tennis')}</span>`
          : '';

    window._clubsStandingsData = data;

    container.innerHTML = `<div class="card" style="margin-top:0.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
        <h3 style="margin:0">📊 ${esc(season.name)} — ${t('txt_clubs_season_standings')}</h3>
        <div style="display:flex;align-items:center;gap:0.5rem">
          ${sportToggleHtml}
          <button class="btn btn-sm" onclick="document.getElementById('clubs-seasons-msg').innerHTML='';window._clubsStandingsData=null" style="padding:0.2rem 0.5rem">✕</button>
        </div>
      </div>
      <div id="clubs-standings-table">${hasAny ? _renderStandingsTable(data[_standingsSport] || []) : `<p class="muted-note">${t('txt_clubs_season_no_standings')}</p>`}</div>
    </div>`;
  } catch (e) {
    container.innerHTML = `<span style="color:var(--red);font-size:0.84rem">${esc(e.message)}</span>`;
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

  // Attach section — only shown when there are candidates
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

    html += `<details style="margin-bottom:0.75rem">
      <summary style="cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--text-muted);user-select:none">➕ ${t('txt_clubs_attach_tournaments')}</summary>
      <p class="player-codes-help" style="margin:0.35rem 0 0.5rem">${t('txt_clubs_attach_tournaments_help')}</p>
      <div style="margin-top:0.5rem">
        <input type="text" id="clubs-attach-search" value="${escAttr(_clubsAttachSearch)}"
          placeholder="${escAttr(t('txt_clubs_attach_search_placeholder'))}"
          oninput="clubsSetAttachTournamentSearch(this.value)"
          style="width:100%;max-width:320px;margin-bottom:0.4rem;padding:0.35rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
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
      </div>
    </details>`;
  }

  if (!hasSeasons) {
    html += `<p class="muted-note">${t('txt_clubs_create_season_first')}</p>`;
    container.innerHTML = html;
    return;
  }

  // Tournaments
  if (matchingT.length) {
    html += `<div class="player-codes-table-wrap" style="margin-bottom:0.75rem"><table class="player-codes-table">
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
    </table></div>`;
  } else {
    html += `<p class="muted-note">${t('txt_clubs_no_matching_tournaments')}</p>`;
  }

  // Registrations
  if (matchingR.length) {
    html += `<div class="player-codes-table-wrap"><table class="player-codes-table">
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
    </table></div>`;
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
  const selectableInSportIds = new Set(
    _clubPlayers
      .filter(p => !_clubsIsHiddenInCurrentSport(p))
      .map(p => p.profile_id)
  );
  _clubsInviteSelectedIds = new Set(
    Array.from(_clubsInviteSelectedIds).filter(
      profileId => visiblePlayerIds.has(profileId) && selectableInSportIds.has(profileId)
    )
  );

  const sport = _clubsSport;
  const tierOptions = _clubTiers
    .filter(tier => tier.sport === sport)
    .map(tier => `<option value="${esc(tier.id)}">${esc(tier.name)} (${tier.base_elo})</option>`)
    .join('');

  const eloInputStyle = 'width:4.5rem;padding:0.15rem 0.3rem;font-size:0.82rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);text-align:right';
  const selStyle = 'padding:0.2rem 0.3rem;font-size:0.82rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);max-width:120px';
  const sportLabel = sport === 'padel' ? t('txt_txt_sport_padel') : t('txt_txt_sport_tennis');
  const selectedCount = _clubsInviteSelectedIds.size;
  const selectedWithEmailCount = _clubPlayers.filter(
    p => _clubsInviteSelectedIds.has(p.profile_id) && p.email
  ).length;

  // Filtered players for the table (applied to both visible and hidden-from-sport sections)
  const filteredPlayers = _clubsGetFilteredPlayers();

  const visibleForSport = filteredPlayers.filter(p => sport === 'padel' ? !p.hidden_padel : !p.hidden_tennis);
  const hiddenFromSport = filteredPlayers.filter(p => sport === 'padel' ? p.hidden_padel : p.hidden_tennis);
  const selectedVisibleCount = visibleForSport.filter(p => _clubsInviteSelectedIds.has(p.profile_id)).length;
  const allVisibleSelected = visibleForSport.length > 0 && selectedVisibleCount === visibleForSport.length;

  // Add player form
  let html = `
    <div class="card" style="margin-bottom:0.75rem;padding:0.6rem 0.85rem">
      <p class="muted-note" style="margin:0 0 0.45rem 0;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.04em">${t('txt_clubs_add_player')}</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
        <input type="text" id="clubs-add-player-input" placeholder="${t('txt_clubs_add_player_placeholder')}" style="flex:1;min-width:160px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off"
          oninput="_clubsPlayerSearchInput(this.value)" onchange="_clubsPlayerSuggestionChosen(this.value)" list="clubs-add-player-suggestions">
        <datalist id="clubs-add-player-suggestions"></datalist>
        <button class="btn btn-sm btn-success" id="clubs-add-player-btn" onclick="clubsAddPlayer()" disabled>+ ${t('txt_clubs_add_player')}</button>
        <span id="clubs-add-player-msg" style="font-size:0.84rem"></span>
      </div>
    </div>
    <div class="clubs-players-toolbar">
      <div class="clubs-players-filter-wrap">
        <input type="search" id="clubs-player-filter-input" value="${esc(_clubsPlayerFilter)}" placeholder="${t('txt_clubs_player_filter_placeholder')}"
          style="flex:1;min-width:180px;padding:0.3rem 0.5rem;font-size:0.88rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"
          oninput="clubsSetPlayerFilter(this.value)">
        ${_clubsPlayerFilter ? `<button class="btn btn-sm btn-muted" type="button" onclick="clubsSetPlayerFilter('')">${t('txt_txt_clear')}</button>` : ''}
      </div>
      <div class="clubs-players-actions">
        <button class="btn btn-sm" type="button" onclick="clubsSelectPlayersWithEmail()">${t('txt_clubs_select_with_email')}</button>
        <button class="btn btn-sm btn-muted" type="button" onclick="clubsClearPlayerSelection()">${t('txt_clubs_clear_selection')}</button>
      </div>
      <span class="muted-note clubs-players-selection-status">${t('txt_clubs_selection_status').replace('{selected}', String(selectedCount)).replace('{emailable}', String(selectedWithEmailCount))}</span>
    </div>
    ${_clubsRosterNoticeText ? `<div class="alert ${_clubsRosterNoticeError ? 'alert-error' : 'alert-success'} clubs-roster-notice" role="status" aria-live="polite">${esc(_clubsRosterNoticeText)}</div>` : ''}
    ${_clubsRenderMessagingPanel(selectedWithEmailCount)}`;

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
            <th class="player-codes-th-center" style="width:34px">
              <input type="checkbox" id="clubs-players-select-all" onchange="clubsToggleAllPlayersSelection(this.checked)" ${allVisibleSelected ? 'checked' : ''}>
            </th>
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
              <td class="player-codes-cell-center">
                <input type="checkbox" ${_clubsInviteSelectedIds.has(p.profile_id) ? 'checked' : ''} onchange="clubsTogglePlayerSelection('${esc(p.profile_id)}', this.checked)">
              </td>
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

  // Capture messaging form values before re-rendering
  const _savedSubject = document.getElementById('clubs-messaging-subject')?.value ?? '';
  const _savedMessage = document.getElementById('clubs-messaging-message')?.value ?? '';

  container.innerHTML = html;

  // Restore filter input value (re-rendered so cursor is lost, but value is preserved)
  const filterInput = document.getElementById('clubs-player-filter-input');
  if (filterInput && filterInput.value !== _clubsPlayerFilter) filterInput.value = _clubsPlayerFilter;

  // Restore messaging form values so player selection doesn't clear them
  const subjectEl = document.getElementById('clubs-messaging-subject');
  const messageEl = document.getElementById('clubs-messaging-message');
  if (subjectEl && _savedSubject) subjectEl.value = _savedSubject;
  if (messageEl && _savedMessage) messageEl.value = _savedMessage;

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
    <details id="clubs-possible-members-details"${_clubsPossibleMembersOpen ? ' open' : ''} style="margin-top:1rem;border:1px solid var(--border);border-radius:6px;padding:0 0.75rem">
      <summary style="cursor:pointer;user-select:none;padding:0.55rem 0;font-size:0.88rem;font-weight:600;list-style:none;display:flex;align-items:center;gap:0.4rem"
        onclick="_clubsPossibleMembersOpen = document.getElementById('clubs-possible-members-details')?.open ?? false">
        <span class="tv-chevron" style="font-size:0.65em;color:var(--text-muted)">&#9658;</span>
        ${t('txt_clubs_possible_members_title', { n: members.length })}
        <span style="font-size:0.76rem;font-weight:400;color:var(--text-muted)">${t('txt_clubs_possible_members_hint')}</span>
      </summary>
      <div style="padding:0.5rem 0 0.75rem">
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.5rem">
          <input type="text" id="clubs-ghost-search-input" value="${escAttr(_clubsGhostSearch)}"
            oninput="clubsSetGhostSearch(this.value)"
            placeholder="${t('txt_clubs_possible_members_search_placeholder')}"
            style="flex:1;min-width:200px;padding:0.35rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"
            aria-label="${t('txt_clubs_possible_members_search_placeholder')}">
          ${ghostFilter ? `<button type="button" class="btn btn-sm btn-muted" onclick="clubsSetGhostSearch('')">${t('txt_txt_clear')}</button>` : ''}
          <span style="font-size:0.76rem;color:var(--text-muted)">${filteredMembers.length}/${members.length}</span>
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
      <div style="margin-top:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <span style="font-size:0.88rem">${t('txt_ph_ghosts_selected', { n: _clubsSelectedGhostProfiles.size })}</span>
        <input type="text" id="clubs-ghost-manual-name" value="${escAttr(suggestedName)}"
          placeholder="${t('txt_ph_consolidate_name_placeholder')}"
          style="flex:1;min-width:160px;padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"
          aria-label="${t('txt_ph_consolidate_name_label')}">
        <button type="button" class="btn btn-primary btn-sm" onclick="clubsConsolidateSelectedGhosts()">${t('txt_ph_consolidate_ghosts')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="clubsClearGhostMergeSelection()">${t('txt_txt_clear')}</button>
      </div>
      <div id="clubs-ghost-manual-msg" style="margin-top:0.35rem;font-size:0.82rem"></div>`;
  }

  // Duplicate-group merge section (if any)
  if (_clubsGhostGroups.length) {
    html += `
      <details id="clubs-ghost-dup-details"${_clubsGhostMergeOpen ? ' open' : ''} style="margin-top:0.75rem;border:1px solid var(--border);border-radius:6px;padding:0 0.75rem">
        <summary style="cursor:pointer;user-select:none;padding:0.45rem 0;font-size:0.84rem;font-weight:600;list-style:none;display:flex;align-items:center;gap:0.4rem"
          onclick="_clubsGhostMergeOpen = document.getElementById('clubs-ghost-dup-details')?.open ?? false">
          <span class="tv-chevron" style="font-size:0.65em;color:var(--text-muted)">&#9658;</span>
          ${t('txt_clubs_ghost_dup_title', { n: _clubsGhostGroups.length })}
          <span style="font-size:0.72rem;font-weight:400;color:var(--text-muted)">${t('txt_clubs_ghost_dup_hint')}</span>
        </summary>
        <div style="padding:0.4rem 0 0.6rem">`;

    for (const [gi, group] of _clubsGhostGroups.entries()) {
      html += `
        <div style="margin-bottom:0.75rem;padding:0.5rem;background:var(--surface);border:1px solid var(--border);border-radius:6px">
          <div style="font-size:0.84rem;font-weight:600;margin-bottom:0.35rem">${esc(group.name)}</div>
          <div class="player-codes-table-wrap" style="margin-bottom:0.4rem">
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
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
            <label style="font-size:0.82rem">${t('txt_ph_consolidate_name_label')}:
              <input type="text" id="clubs-ghost-name-${gi}" value="${escAttr(group.name)}"
                style="margin-left:0.3rem;padding:0.2rem 0.35rem;font-size:0.82rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);min-width:130px"
                aria-label="${t('txt_ph_consolidate_name_label')}">
            </label>
            <button type="button" class="btn btn-sm btn-primary" onclick="clubsConsolidateGhostGroup(${gi})">${t('txt_ph_consolidate_ghosts')}</button>
          </div>
          <div id="clubs-ghost-msg-${gi}" style="margin-top:0.3rem;font-size:0.82rem"></div>
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

function _clubsRenderLeaderboard() {
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

function clubsTogglePlayerSelection(profileId, selected) {
  if (selected) {
    _clubsInviteSelectedIds.add(profileId);
  } else {
    _clubsInviteSelectedIds.delete(profileId);
  }
  _clubsRenderPlayers();
}

function clubsToggleAllPlayersSelection(selected) {
  const filteredPlayers = _clubsGetFilteredPlayers();
  const visibleForSport = filteredPlayers.filter(p => !_clubsIsHiddenInCurrentSport(p));
  const visibleForSportIds = new Set(visibleForSport.map(p => p.profile_id));
  if (selected) {
    visibleForSport.forEach(p => _clubsInviteSelectedIds.add(p.profile_id));
  } else {
    visibleForSportIds.forEach(profileId => _clubsInviteSelectedIds.delete(profileId));
  }
  _clubsRenderPlayers();
}

function clubsSelectPlayersWithEmail() {
  const filteredPlayers = _clubsGetFilteredPlayers();
  const visibleForSport = filteredPlayers.filter(p => !_clubsIsHiddenInCurrentSport(p));
  visibleForSport.forEach(p => {
    if (p.email) {
      _clubsInviteSelectedIds.add(p.profile_id);
    }
  });
  _clubsRenderPlayers();
}

function clubsClearPlayerSelection() {
  _clubsInviteSelectedIds.clear();
  _clubsRenderPlayers();
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

function _clubsRenderMessagingPanel(selectedWithEmailCount) {
  const activeClub = _clubsList.find(c => c.id === _activeClubId);
  const communityLobbies = activeClub
    ? _clubsRegistrations.filter(r => r.community_id === activeClub.community_id)
    : [];
  const selectedCount = _clubsInviteSelectedIds.size;
  const noEmailCount = selectedCount - selectedWithEmailCount;

  const tabBtnStyle = (active) =>
    `btn btn-sm${active ? ' btn-primary' : ''}`;

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

  return `<div class="card" style="margin-bottom:0.75rem;padding:0.75rem 1rem">
    <div style="display:flex;gap:0.5rem;margin-bottom:0.65rem">
      <button class="${tabBtnStyle(_clubsMessagingTab === 'lobby')}" type="button"
        onclick="clubsMessagingTab('lobby')">${t('txt_clubs_messaging_tab_lobby')}</button>
      <button class="${tabBtnStyle(_clubsMessagingTab === 'announce')}" type="button"
        onclick="clubsMessagingTab('announce')">${t('txt_clubs_messaging_tab_announce')}</button>
    </div>
    <span id="clubs-messaging-msg" style="font-size:0.84rem;display:block;margin-bottom:0.4rem"></span>
    ${_clubsMessagingTab === 'lobby' ? lobbyContent : announceContent}
  </div>`;
}

function clubsMessagingTab(tab) {
  _clubsMessagingTab = tab;
  _clubsRenderPlayers();
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
