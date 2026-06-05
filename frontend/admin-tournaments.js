async function api(path, opts = {}) {
  return apiAuth(API + path, opts);
}

// ─── Button loading state helper ──────────────────────────
async function withLoading(btn, asyncFn) {
  if (!btn || btn.classList.contains('loading')) return;
  const origText = btn.textContent;
  btn.classList.add('loading');
  try { await asyncFn(); }
  finally { btn.classList.remove('loading'); }
}

// ─── Home: list tournaments ───────────────────────────────
function _phaseLabel(phase) {
  const map = {
    setup: t('txt_txt_setup'), groups: t('txt_txt_group_stage'), playoffs: t('txt_txt_play_offs'),
    finished: t('txt_txt_finished'), mexicano: t('txt_txt_mexicano'),
  };
  return map[phase] || phase;
}

// Three independent filter dimensions for the home admin view.
// Defaults: ownership=mine, status=active, type=all.
const _HOME_FILTER_DIMS = ['ownership', 'status', 'type'];
const _HOME_FILTER_VALUES = {
  ownership: ['mine', 'all'],
  status: ['active', 'all'],
  type: ['all', 'tournament', 'lobby'],
};
const _HOME_FILTER_DEFAULTS = { ownership: 'mine', status: 'active', type: 'all' };
const _HOME_FILTER_KEYS = {
  ownership: 'amistoso-home-filter-ownership',
  status: 'amistoso-home-filter-status',
  type: 'amistoso-home-filter-type',
};
// Ownership filter is admin-only — non-admins already only see their own / shared
// items, so the dimension would be a no-op for them.
const _HOME_ADMIN_ONLY_DIMS = new Set(['ownership']);

let _homeFilters = { ..._HOME_FILTER_DEFAULTS };
let _homeTournamentSearch = '';
const _HOME_TOURN_SEARCH_KEY = 'amistoso-home-tournament-search';

try {
  for (const dim of _HOME_FILTER_DIMS) {
    const saved = localStorage.getItem(_HOME_FILTER_KEYS[dim]);
    if (saved && _HOME_FILTER_VALUES[dim].includes(saved)) _homeFilters[dim] = saved;
  }
} catch (_) {}
try { _homeTournamentSearch = localStorage.getItem(_HOME_TOURN_SEARCH_KEY) || ''; } catch (_) {}

// Counts per (dimension, value). Each count answers: "how many items would I
// see if I picked this value while keeping the other two dimensions as-is?"
let _homeFilterChipCounts = { ownership: {}, status: {}, type: {} };
// Which filter dropdown (if any) is currently open. One of the dim names or null.
let _homeFilterOpenDim = null;

function _persistHomeFilterDim(dim) {
  try { localStorage.setItem(_HOME_FILTER_KEYS[dim], _homeFilters[dim]); } catch (_) {}
}

function _persistHomeTournamentSearch() {
  try { localStorage.setItem(_HOME_TOURN_SEARCH_KEY, _homeTournamentSearch); } catch (_) {}
}

function _resetHomeFiltersToDefault() {
  for (const dim of _HOME_FILTER_DIMS) {
    _homeFilters[dim] = _HOME_FILTER_DEFAULTS[dim];
    _persistHomeFilterDim(dim);
  }
}

function _homeFiltersAtDefault() {
  return _HOME_FILTER_DIMS.every(dim => _homeFilters[dim] === _HOME_FILTER_DEFAULTS[dim]);
}

// Labels shown for each filter value. Kept module-level so both the trigger
// button and the dropdown menu use the same wording.
function _homeFilterLabels() {
  return {
    ownership: { mine: t('txt_txt_mine'), all: t('txt_txt_filter_all') },
    status: { active: t('txt_txt_filter_active'), all: t('txt_txt_filter_all') },
    type: { all: t('txt_txt_filter_all'), tournament: t('txt_txt_tournaments'), lobby: t('txt_reg_lobby') },
  };
}

function _homeFilterDimLabels() {
  return {
    ownership: t('txt_txt_filter_dim_ownership'),
    status: t('txt_txt_filter_dim_status'),
    type: t('txt_txt_filter_dim_type'),
  };
}

function _renderHomeFilterDropdown(dim) {
  if (_HOME_ADMIN_ONLY_DIMS.has(dim) && !isAdmin()) return '';
  const labels = _homeFilterLabels()[dim];
  const dimLabel = _homeFilterDimLabels()[dim];
  const counts = _homeFilterChipCounts[dim] || {};
  const currentValue = _homeFilters[dim];
  const currentLabel = labels[currentValue] ?? currentValue;
  const isOpen = _homeFilterOpenDim === dim;
  const isNonDefault = currentValue !== _HOME_FILTER_DEFAULTS[dim];
  const triggerCls = `home-filter-chip home-filter-dropdown-trigger${isNonDefault ? ' active' : ''}${isOpen ? ' open' : ''}`;
  const triggerLabel = `${dimLabel}: ${currentLabel}`;
  const menuItems = _HOME_FILTER_VALUES[dim].map(value => {
    const isSelected = value === currentValue;
    const n = counts[value] ?? 0;
    const label = labels[value] ?? value;
    return `<button type="button" role="menuitemradio" aria-checked="${isSelected}"
      class="home-filter-dropdown-item${isSelected ? ' selected' : ''}"
      onclick="_setHomeFilter('${dim}','${value}')">
      <span class="home-filter-dropdown-item-check" aria-hidden="true">${isSelected ? '✓' : ''}</span>
      <span class="home-filter-dropdown-item-label">${label}</span>
      <span class="home-filter-chip-count" aria-hidden="true">${n}</span>
    </button>`;
  }).join('');
  const menu = isOpen ? `
    <div class="home-filter-dropdown-menu" role="menu" aria-label="${escAttr(dimLabel)}">
      ${menuItems}
    </div>` : '';
  return `
    <div class="home-filter-dropdown" data-dim="${dim}">
      <button type="button" class="${triggerCls}"
        aria-haspopup="menu" aria-expanded="${isOpen}"
        aria-label="${escAttr(triggerLabel)}"
        onclick="_toggleHomeFilterDropdown('${dim}')">
        <span class="home-filter-dropdown-dim">${dimLabel}:</span>
        <span class="home-filter-dropdown-value">${currentLabel}</span>
        <span class="home-filter-dropdown-caret" aria-hidden="true">▾</span>
      </button>
      ${menu}
    </div>
  `;
}

function _renderHomeTournamentToolbar() {
  const toolbar = document.getElementById('home-tournament-toolbar');
  if (!toolbar) return;
  const dropdowns = _HOME_FILTER_DIMS.map(_renderHomeFilterDropdown).join('');
  toolbar.innerHTML = `
    <div class="home-search-row">
      <input
        id="home-tournament-search"
        class="home-search-input"
        type="search"
        value="${escAttr(_homeTournamentSearch)}"
        placeholder="${escAttr(t('txt_txt_search_tournaments_placeholder'))}"
        onkeydown="if(event.key==='Enter')_submitHomeTournamentSearch()"
      >
      <button type="button" class="btn btn-sm" onclick="_submitHomeTournamentSearch()">${t('txt_txt_go')}</button>
      <button type="button" class="btn btn-sm btn-muted" onclick="_clearHomeTournamentSearch()">${t('txt_txt_clear')}</button>
    </div>
    <div class="home-filter-row" role="toolbar" aria-label="Home filters">
      ${dropdowns}
    </div>
  `;
  _ensureHomeFilterOutsideClick();
}

// Close any open filter dropdown when the user clicks outside the toolbar.
let _homeFilterOutsideClickBound = false;
function _ensureHomeFilterOutsideClick() {
  if (_homeFilterOutsideClickBound) return;
  document.addEventListener('click', (ev) => {
    if (_homeFilterOpenDim === null) return;
    const wrap = ev.target.closest('.home-filter-dropdown');
    if (wrap && wrap.dataset.dim === _homeFilterOpenDim) return;
    _homeFilterOpenDim = null;
    _renderHomeTournamentToolbar();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && _homeFilterOpenDim !== null) {
      _homeFilterOpenDim = null;
      _renderHomeTournamentToolbar();
    }
  });
  _homeFilterOutsideClickBound = true;
}

function _toggleHomeFilterDropdown(dim) {
  _homeFilterOpenDim = _homeFilterOpenDim === dim ? null : dim;
  _renderHomeTournamentToolbar();
}

function _setHomeFilter(dim, value) {
  if (!_HOME_FILTER_VALUES[dim] || !_HOME_FILTER_VALUES[dim].includes(value)) return;
  _homeFilters[dim] = value;
  _persistHomeFilterDim(dim);
  _homeFilterOpenDim = null;
  loadTournaments();
}

function _submitHomeTournamentSearch() {
  const input = document.getElementById('home-tournament-search');
  _homeTournamentSearch = (input?.value || '').trim();
  _persistHomeTournamentSearch();
  loadTournaments();
}

function _clearHomeTournamentSearch() {
  _homeTournamentSearch = '';
  _persistHomeTournamentSearch();
  const input = document.getElementById('home-tournament-search');
  if (input) input.value = '';
  loadTournaments();
}

function _clearHomeFiltersAndSearch() {
  // Widen all dimensions to "all" so the user sees every available item.
  for (const dim of _HOME_FILTER_DIMS) {
    _homeFilters[dim] = 'all';
    _persistHomeFilterDim(dim);
  }
  _homeTournamentSearch = '';
  _persistHomeTournamentSearch();
  const input = document.getElementById('home-tournament-search');
  if (input) input.value = '';
  loadTournaments();
}

async function loadTournaments() {
  try {
    const registrationsPath = '/api/registrations?include_archived=1';
    // Resolve subdomain context in parallel with data fetches so it adds no
    // extra RTT on club subdomains.
    const subdomainPromise = (typeof resolveClubSubdomainContext === 'function')
      ? resolveClubSubdomainContext().catch(() => null)
      : Promise.resolve(null);
    const [subdomainCtx, list, regList, commList, clubsList] = await Promise.all([
      subdomainPromise,
      api('/api/tournaments'),
      isAuthenticated() ? api(registrationsPath).catch(() => []) : Promise.resolve([]),
      isAuthenticated() ? api('/api/communities').catch(() => []) : Promise.resolve([]),
      isAuthenticated() ? api('/api/clubs').catch(() => []) : Promise.resolve([]),
    ]);
    if (subdomainCtx && subdomainCtx.club_id) window.__ADMIN_SUBDOMAIN_CLUB__ = subdomainCtx;
    _adminCommunities = commList;
    _adminClubs = clubsList;
    const nonArchivedRegList = regList.filter(r => !r.archived);
    const archivedRegList = regList.filter(r => r.archived);
    let visibleArchivedRegList = archivedRegList;
    _tournamentMeta = {};
    for (const tournament of list) _tournamentMeta[tournament.id] = tournament;
    _registrations = nonArchivedRegList;
    const el = document.getElementById('tournament-list');
    let active = list.filter(tr => tr.phase !== 'finished');
    let finished = list.filter(tr => tr.phase === 'finished');
    // Active section: open lobbies only.
    // Finished section: all non-archived closed lobbies (converted or not).
    let activeLobbies = nonArchivedRegList.filter(r => r.open);
    let finishedLobbies = nonArchivedRegList.filter(r => !r.open);

    const searchNeedle = (_homeTournamentSearch || '').trim().toLowerCase();
    const ownsTournament = (tournament) => {
      const username = getAuthUsername();
      if (!username) return false;
      return tournament.owner === username || tournament.shared === true;
    };
    const ownsLobby = (registration) => {
      const username = getAuthUsername();
      if (!username) return false;
      return registration.owner === username || registration.shared === true;
    };
    const matchesSearch = (item) => {
      if (!searchNeedle) return true;
      const hay = [
        item.name,
        item.club_name,
        item.community_name,
        item.owner,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchNeedle);
    };

    active = active.filter(matchesSearch);
    finished = finished.filter(matchesSearch);
    activeLobbies = activeLobbies.filter(matchesSearch);
    finishedLobbies = finishedLobbies.filter(matchesSearch);
    visibleArchivedRegList = visibleArchivedRegList.filter(matchesSearch);

    // When the admin SPA is opened on a club subdomain we hide everything that
    // doesn't belong to that club so the operator only sees relevant items.
    // The dismiss button on the subdomain banner clears this global, so the
    // user can opt back into the full list without leaving the subdomain.
    const subdomainClub = (typeof window !== 'undefined' && window.__ADMIN_SUBDOMAIN_CLUB__) || null;
    if (subdomainClub && subdomainClub.club_id) {
      // Filter by both club_id AND community_id so cross-community legacy assignments
      // (e.g. a tournament with club_id set to this club but a different community_id)
      // are excluded.
      const matchesSubdomainClub = (item) => item
        && item.club_id === subdomainClub.club_id
        && item.community_id === subdomainClub.community_id;
      active = active.filter(matchesSubdomainClub);
      finished = finished.filter(matchesSubdomainClub);
      activeLobbies = activeLobbies.filter(matchesSubdomainClub);
      finishedLobbies = finishedLobbies.filter(matchesSubdomainClub);
      visibleArchivedRegList = visibleArchivedRegList.filter(matchesSubdomainClub);
    }

    // Drop admin-only filter dimensions when caller is not an admin (the server
    // already restricts non-admins to their own / shared items).
    if (!isAdmin()) {
      for (const dim of _HOME_ADMIN_ONLY_DIMS) {
        if (_homeFilters[dim] !== _HOME_FILTER_DEFAULTS[dim]) {
          _homeFilters[dim] = _HOME_FILTER_DEFAULTS[dim];
          _persistHomeFilterDim(dim);
        }
      }
    }

    // Universe of items after search + subdomain filters but BEFORE the user's
    // chip selections. Used as the input for both rendering and chip counts.
    const universe = {
      activeT: active,
      finishedT: finished,
      activeL: activeLobbies,
      finishedL: finishedLobbies,
      archivedL: visibleArchivedRegList,
    };

    const applyHomeFilters = (state) => {
      const ownsT = (tournament) => state.ownership === 'all' || ownsTournament(tournament);
      const ownsL = (registration) => state.ownership === 'all' || ownsLobby(registration);
      let aT = universe.activeT.filter(ownsT);
      let fT = universe.finishedT.filter(ownsT);
      let aL = universe.activeL.filter(ownsL);
      let fL = universe.finishedL.filter(ownsL);
      let arL = universe.archivedL.filter(ownsL);
      if (state.status === 'active') {
        fT = []; fL = []; arL = [];
      }
      if (state.type === 'tournament') {
        aL = []; fL = []; arL = [];
      } else if (state.type === 'lobby') {
        aT = []; fT = [];
      }
      return { activeT: aT, finishedT: fT, activeL: aL, finishedL: fL, archivedL: arL };
    };
    const totalCount = (r) =>
      r.activeT.length + r.finishedT.length + r.activeL.length + r.finishedL.length + r.archivedL.length;

    // Chip counts: per (dim, value), holding the other dims at their current value.
    _homeFilterChipCounts = { ownership: {}, status: {}, type: {} };
    for (const dim of _HOME_FILTER_DIMS) {
      for (const value of _HOME_FILTER_VALUES[dim]) {
        const probe = { ..._homeFilters, [dim]: value };
        _homeFilterChipCounts[dim][value] = totalCount(applyHomeFilters(probe));
      }
    }

    const filtered = applyHomeFilters(_homeFilters);
    active = filtered.activeT;
    finished = filtered.finishedT;
    activeLobbies = filtered.activeL;
    finishedLobbies = filtered.finishedL;
    visibleArchivedRegList = filtered.archivedL;

    _renderHomeTournamentToolbar();
    const archivedLobbiesCount = archivedRegList.length;
    const showArchivedToggle = isAuthenticated() && archivedLobbiesCount > 0;
    const renderTournamentCard = (tournament) => {
      const canEdit = isAdmin() || getAuthUsername() === tournament.owner || tournament.shared === true;
      const canDelete = isAdmin() || getAuthUsername() === tournament.owner;
      const isPublic = tournament.public !== false;
      const visBtn = canEdit
        ? `<button type="button" class="btn btn-sm btn-visibility" title="${t('txt_txt_visibility')}" onclick="togglePublic('${tournament.id}',${isPublic})">${isPublic ? _ic('globe') + ' ' + t('txt_txt_public') : _ic('lock') + ' ' + t('txt_txt_private')}</button>`
        : '';
      const deleteBtn = canDelete
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteTournament('${tournament.id}')">✕</button>`
        : '';
      const actionBtns = (canEdit || canDelete) ? `${visBtn}${deleteBtn}` : '';
      const isTennis = tournament.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const sharedBadge = tournament.shared ? `<span class="badge badge-shared">${t('txt_badge_shared')}</span>` : '';
      const communityData = _adminCommunities.find(c => c.id === tournament.community_id);
      const identityLabel = tournament.club_name
        || tournament.community_name
        || ((communityData && !communityData.is_builtin) ? communityData.name : '');
      const identityBadge = identityLabel
        ? `<span class="badge" style="background:var(--bg-alt,#eee);color:var(--text-muted);font-size:0.72rem;border:1px solid var(--border);font-weight:500">${esc(identityLabel)}</span>`
        : '';
      return `
      <div class="match-card tournament-list-card${tournament.id === currentTid ? ' active-tournament' : ''}">
        <div class="match-teams">
          <a class="tournament-name-link" href="#" onclick="openTournament('${tournament.id}','${tournament.type}');return false">${esc(tournament.name)}</a>
          <span class="badge badge-sport">${esc(sportLabel)}</span>
          <span class="badge badge-type">${tournament.has_team_roster ? t('txt_txt_team_mode_short') : t('txt_txt_individual_mode')}</span>
          <span class="badge badge-phase">${_phaseLabel(tournament.phase)}</span>
          ${sharedBadge}
          ${identityBadge}
        </div>
        <div class="tournament-actions">${actionBtns}</div>
      </div>
    `;
    };
    // Render lobby cards in the same list style
    const _renderLobbyCard = (r) => {
      const rid = r.id;
      const isOpen = r.open;
      const count = r.registrant_count || 0;
      const isTennis = (r.sport || 'padel') === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const regCommunity = _adminCommunities.find(c => c.id === (r.community_id || 'open'));
      const identityLabel = r.club_name
        || r.community_name
        || ((regCommunity && !regCommunity.is_builtin) ? regCommunity.name : '');
      const identityBadge = identityLabel
        ? `<span class="badge" style="background:var(--bg-alt,#eee);color:var(--text-muted);font-size:0.72rem;border:1px solid var(--border);font-weight:500">${esc(identityLabel)}</span>`
        : '';
      const phaseBadge = isOpen
        ? `<span class="badge badge-lobby-open">${t('txt_reg_registration_open')}</span>`
        : `<span class="badge badge-lobby-closed">${r.archived ? t('txt_reg_registration_archived') : t('txt_reg_registration_closed')}</span>`;
      const countLabel = `<span class="reg-lobby-count">(${count})</span>`;
      const isListed = r.listed !== false && r.listed !== 0;
      const visBtn = `<button type="button" class="btn btn-sm btn-visibility" title="${t('txt_txt_visibility')}" onclick="_toggleRegListed('${esc(rid)}',${isListed})">${isListed ? _ic('globe') + ' ' + t('txt_txt_public') : _ic('lock') + ' ' + t('txt_txt_private')}</button>`;
      const actionBtns = `
        ${visBtn}
        <button type="button" class="btn btn-danger btn-sm" onclick="_deleteRegistration('${esc(rid)}')" title="${t('txt_reg_delete')}">✕</button>
      `;
      return `
      <div class="match-card tournament-list-card reg-lobby-card">
        <div class="match-teams">
          <a class="tournament-name-link" href="#" onclick="openRegistration('${escAttr(rid)}','${escAttr(r.name)}');return false">${esc(r.name)}</a>
          <span class="badge badge-sport">${esc(sportLabel)}</span>
          ${identityBadge}
          ${phaseBadge} ${countLabel}
        </div>
        <div class="tournament-actions">
          ${actionBtns}
        </div>
      </div>
    `;
    };
    const _renderFinishedSection = () => {
      const finishedTournamentsHtml = finished.map(renderTournamentCard).join('');
      const finishedLobbiesHtml = finishedLobbies.map(_renderLobbyCard).join('');
      const archivedCount = visibleArchivedRegList.length;
      const archivedTabHtml = archivedCount > 0
        ? `<details class="card archived-lobbies-panel">
            <summary class="archived-lobbies-summary">${t('txt_reg_show_archived')} (${archivedCount})</summary>
            <div class="archived-lobbies-body">${visibleArchivedRegList.map(_renderLobbyCard).join('')}</div>
          </details>`
        : '';
      return {
        hasContent: Boolean(finishedTournamentsHtml || finishedLobbiesHtml || archivedTabHtml),
        html: `${finishedTournamentsHtml}${finishedLobbiesHtml}${archivedTabHtml}`,
      };
    };
    const finishedSection = _renderFinishedSection();
    const hasAnyItems = active.length || activeLobbies.length || finishedSection.hasContent;

    if (!hasAnyItems) {
      const hasFilter = Boolean((_homeTournamentSearch || '').trim()) || !_homeFiltersAtDefault();
      const emptyTitle = hasFilter ? t('txt_txt_no_home_items_match') : t('txt_txt_no_tournaments_yet');
      const emptyHint = hasFilter ? t('txt_txt_try_adjusting_filters') : t('txt_txt_no_tournaments_hint');
      const actionBtn = hasFilter
        ? `<button type="button" class="btn btn-primary btn-sm" onclick="_clearHomeFiltersAndSearch()">${t('txt_txt_clear')}</button>`
        : `<button type="button" class="btn btn-primary btn-sm" onclick="setActiveTab('create')">${t('txt_txt_create_first')}</button>`;
      el.innerHTML = `<div class="tournaments-empty-state"><div class="tournaments-empty-icon">🏆</div><div class="tournaments-empty-title">${emptyTitle}</div><div class="tournaments-empty-hint">${emptyHint}</div>${actionBtn}</div>`;
      return;
    }

    // Open lobbies first, then active tournaments, then finished section with a divider
    let html = activeLobbies.map(_renderLobbyCard).join('');
    html += active.map(renderTournamentCard).join('');
    html += finishedSection.html;
    el.innerHTML = html;
  } catch (e) { console.error(e); }
}

async function deleteTournament(id) {
  let ghosts = [];
  try {
    const info = await api(`/api/tournaments/${id}/ghost-profiles`);
    ghosts = (info && Array.isArray(info.profiles)) ? info.profiles : [];
  } catch (e) {
    console.warn('Could not list ghost profiles before delete', e);
  }
  const decision = await _confirmDeleteTournament(ghosts);
  if (!decision.confirmed) return;
  const url = `/api/tournaments/${id}` + (decision.purgeGhosts ? '?purge_ghosts=true' : '');
  await api(url, { method: 'DELETE' });
  _openTournaments = _openTournaments.filter(tournament => tournament.id !== id);
  if (id === currentTid) {
    _stopAdminVersionPoll();
    currentTid = null;
    currentType = null;
    currentTournamentName = null;
    updateActiveTournamentUI();
    setActiveTab('home');
  } else {
    updateActiveTournamentUI();
  }
  loadTournaments();
}

/** Show the delete-tournament confirmation modal.
 * Resolves to { confirmed: boolean, purgeGhosts: boolean }.
 */
function _confirmDeleteTournament(ghosts) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-md delete-tourn-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'delete-tourn-title');

    const ghostCount = ghosts.length;
    const visibleGhosts = ghosts.slice(0, 5);
    const remaining = ghostCount - visibleGhosts.length;
    const chipsHtml = visibleGhosts
      .map(g => `<span class="delete-tourn-ghost-chip">${esc(g.name || g.id)}</span>`)
      .join('') + (remaining > 0
        ? `<span class="delete-tourn-ghost-chip delete-tourn-ghost-chip-more">+${remaining}</span>`
        : '');
    const ghostBlockHtml = ghostCount > 0 ? `
      <label class="delete-tourn-ghost-card" for="delete-tourn-purge-ghosts">
        <input type="checkbox" id="delete-tourn-purge-ghosts" class="delete-tourn-ghost-check">
        <div class="delete-tourn-ghost-body">
          <div class="delete-tourn-ghost-title">
            ${esc(t('txt_txt_purge_ghost_profiles_label').replace('{count}', ghostCount))}
          </div>
          <p class="delete-tourn-ghost-help">${esc(t('txt_txt_purge_ghost_profiles_help'))}</p>
          <div class="delete-tourn-ghost-chips">${chipsHtml}</div>
        </div>
      </label>` : '';

    dialog.innerHTML = `
      <div class="modal-header delete-tourn-header">
        <h2 class="modal-title delete-tourn-title" id="delete-tourn-title">
          <span class="delete-tourn-title-icon" aria-hidden="true">${_antIc('warning')}</span>
          ${esc(t('txt_txt_delete_this_tournament'))}
        </h2>
        <button type="button" class="modal-close-btn" data-action="cancel" aria-label="${esc(t('txt_txt_close'))}">✕</button>
      </div>
      <p class="delete-tourn-warning">${esc(t('txt_txt_delete_tournament_warning'))}</p>
      ${ghostBlockHtml}
      <div class="modal-actions">
        <button type="button" class="btn btn-muted" data-action="cancel">${esc(t('txt_txt_cancel'))}</button>
        <button type="button" class="btn btn-danger" data-action="confirm">${esc(t('txt_txt_delete'))}</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let resolved = false;
    function finish(result) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') finish({ confirmed: false, purgeGhosts: false });
    }
    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) finish({ confirmed: false, purgeGhosts: false });
    });
    dialog.querySelectorAll('[data-action="cancel"]').forEach(btn => {
      btn.addEventListener('click', () => finish({ confirmed: false, purgeGhosts: false }));
    });
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      const cb = dialog.querySelector('#delete-tourn-purge-ghosts');
      finish({ confirmed: true, purgeGhosts: !!(cb && cb.checked) });
    });
    // Reflect checked state on the wrapping card for visual feedback.
    const card = dialog.querySelector('.delete-tourn-ghost-card');
    const checkbox = dialog.querySelector('#delete-tourn-purge-ghosts');
    if (card && checkbox) {
      const sync = () => card.classList.toggle('is-checked', checkbox.checked);
      checkbox.addEventListener('change', sync);
      sync();
    }
    document.addEventListener('keydown', onKey);
    // Focus the destructive button so Enter confirms.
    setTimeout(() => dialog.querySelector('[data-action="confirm"]').focus(), 0);
  });
}

async function togglePublic(id, currentlyPublic) {
  try {
    await api(`/api/tournaments/${id}/public`, {
      method: 'PATCH',
      body: JSON.stringify({ public: !currentlyPublic }),
    });
    loadTournaments();
  } catch (e) { console.error('togglePublic failed:', e); }
}

// ─── Open a tournament ────────────────────────────────────
let currentTid = null, currentType = null;
let currentTournamentName = null;
let _tournamentMeta = {};
let _adminCommunities = [];  // cached communities list for badge display in tournament cards
let _adminClubs = [];         // cached clubs list for club-attachment control in TV panel
let _openTournaments = [];  // [{id, type, name}] for quick-switch chips
let _totalPts = 0;  // set per Mexicano tournament for auto-fill
let _gpScoreMode = { 'gp-group': 'points', 'gp-playoff': 'points', 'mex-playoff': 'points', 'po-playoff': 'points' };
let _scoreConfirmationMode = 'immediate';  // mirrors tvSettings.score_confirmation for matchRow badge display
let _mexPlayers = [];  // [{id, name}] for manual editor
let _mexBreakdowns = {};  // {match_id: {player_id: {raw, strength_mult, loss_disc, win_bonus, final}}}
let _mexStrengthWeight = 0;
let _mexPlayerMap = {};  // {player_id: player_name}
let _mexTeamMode = false;  // true when each participant is a pre-formed pair
let _mexSortCol = null;      // null = server default order; otherwise a leaderboard field key
let _mexSortDir = 'desc';    // 'asc' | 'desc'

// ─── Admin live-refresh (SSE with polling fallback) ──────────
let _adminVersionStream = null;
let _adminLastKnownVersion = null;
let _adminPendingReload = false;
let _adminSafetyPollTimer = null;
let _adminSafetyFetching = false;
const _ADMIN_POLL_INTERVAL_MS = 30000;
const _ADMIN_SAFETY_POLL_MS = 20000;

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !currentTid) return;
  if (_adminPendingReload) {
    _adminPendingReload = false;
    _rerenderCurrentViewPreserveDrafts();
  }
});

/** Handle a version change detected by SSE or the safety poll. */
async function _adminHandleVersionChange(version) {
  const changed = _adminLastKnownVersion !== null && version !== _adminLastKnownVersion;
  _adminLastKnownVersion = version;
  if (changed) {
    if (document.hidden) {
      _adminPendingReload = true;
    } else {
      await _rerenderCurrentViewPreserveDrafts();
    }
  }
}

function _startAdminVersionPoll() {
  _stopAdminVersionPoll();
  if (!currentTid) return;
  // Primary: SSE stream (instant updates when it works)
  _adminVersionStream = createVersionStream({
    url: `/api/tournaments/${currentTid}/events`,
    pollUrl: `/api/tournaments/${currentTid}/version`,
    pollIntervalMs: _ADMIN_POLL_INTERVAL_MS,
    async onVersion(data) {
      await _adminHandleVersionChange(data.version);
    },
  });
  // Safety net: independent poll every 5 s catches changes that SSE may
  // silently drop (browser connection limits, proxy buffering, etc.).
  _adminSafetyPollTimer = setInterval(async () => {
    if (!currentTid || _adminSafetyFetching) return;
    _adminSafetyFetching = true;
    try {
      const r = await fetch(`/api/tournaments/${currentTid}/version`);
      if (!r.ok) return;
      const d = await r.json();
      await _adminHandleVersionChange(d.version);
    } catch (_) {}
    finally { _adminSafetyFetching = false; }
  }, _ADMIN_SAFETY_POLL_MS);
}

function _stopAdminVersionPoll() {
  if (_adminVersionStream) { _adminVersionStream.close(); _adminVersionStream = null; }
  if (_adminSafetyPollTimer) { clearInterval(_adminSafetyPollTimer); _adminSafetyPollTimer = null; }
  _adminLastKnownVersion = null;
  _adminPendingReload = false;
  _adminSafetyFetching = false;
}

function _refreshCurrentView() {
  if (!currentTid) return;
  if (currentType === 'registration') renderRegistration();
  else if (currentType === 'group_playoff') renderGP();
  else if (currentType === 'playoff') renderPO();
  else renderMex();
}

function updateActiveTournamentUI() {
  const indicator = document.getElementById('active-tournament-indicator');
  const hasActive = Boolean(currentTid);
  const refreshBtn = document.getElementById('admin-refresh-btn');
  if (refreshBtn) refreshBtn.style.display = hasActive ? '' : 'none';
  if (hasActive) {
    const shownName = currentTournamentName || `#${String(currentTid).slice(0, 8)}`;
    indicator.innerHTML = `${t('txt_txt_active_tournament')} <strong>${esc(shownName)}</strong>`;
    indicator.style.display = '';
  } else {
    indicator.innerHTML = `${t('txt_txt_active_tournament')} <strong>${t('txt_txt_none_selected')}</strong>`;
    indicator.style.display = 'none';
  }
  _renderTournamentChips();
}

function _renderTournamentChips() {
  const container = document.getElementById('tournament-chips');
  if (!container) return;
  container.innerHTML = _openTournaments.map(tournament =>
    `<button type="button" class="tab-btn tournament-chip${tournament.id === currentTid ? ' active' : ''}" data-tid="${tournament.id}" data-type="${tournament.type}" title="${esc(tournament.name)}">
      <span class="chip-check">✓</span>${esc(tournament.name)}
      <span class="chip-close" data-close-tid="${tournament.id}" title="${t('txt_txt_remove')}">×</span>
    </button>`
  ).join('');
  container.querySelectorAll('.tournament-chip').forEach(btn => {
    btn.addEventListener('click', e => {
      const closeTid = e.target.closest('[data-close-tid]')?.dataset.closeTid;
      if (closeTid) { _unpinTournament(closeTid); return; }
      const tournament = _openTournaments.find(entry => entry.id === btn.dataset.tid);
      if (!tournament) return;
      if (tournament.type === 'registration') openRegistration(tournament.id, tournament.name);
      else openTournament(tournament.id, tournament.type, tournament.name);
    });
  });
}

function _unpinTournament(id) {
  _openTournaments = _openTournaments.filter(tournament => tournament.id !== id);
  if (id === currentTid) {
    if (_openTournaments.length > 0) {
      const next = _openTournaments[_openTournaments.length - 1];
      if (next.type === 'registration') openRegistration(next.id, next.name);
      else openTournament(next.id, next.type, next.name);
    } else {
      _stopAdminVersionPoll();
      currentTid = null; currentType = null; currentTournamentName = null;
      updateActiveTournamentUI();
      setActiveTab('home');
    }
  } else {
    _renderTournamentChips();
  }
}

function _isNotFoundError(error) {
  const msg = String(error?.message || '');
  return /not\s*found/i.test(msg);
}

function _recoverFromMissingOpenTournament(renderTid, error) {
  if (!_isNotFoundError(error)) return false;
  _openTournaments = _openTournaments.filter(tournament => tournament.id !== renderTid);
  if (currentTid !== renderTid) {
    _renderTournamentChips();
    return true;
  }

  _stopAdminVersionPoll();
  _stopRegDetailPoll();
  currentTid = null;
  currentType = null;
  currentTournamentName = null;
  updateActiveTournamentUI();

  if (_openTournaments.length > 0) {
    const next = _openTournaments[_openTournaments.length - 1];
    if (next.type === 'registration') openRegistration(next.id, next.name);
    else openTournament(next.id, next.type, next.name);
  } else {
    setActiveTab('home');
  }
  return true;
}

function _autoFillScore(matchId, total) {
  const s1El = document.getElementById('s1-' + matchId);
  const s2El = document.getElementById('s2-' + matchId);
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

/** Auto-fill complementary score in the dispute resolution custom inputs (Mexicano). */
function _autoFillDisputeCustom(matchId, total) {
  const s1El = document.getElementById('drs1-' + matchId);
  const s2El = document.getElementById('drs2-' + matchId);
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

function openTournament(id, type, name = null) {
  if (id !== currentTid) {
    _playoffTeams = [];
    _mexPlayoffTeamCount = 4;
    _savedPlayoffTeams = {};
    _mexExternalParticipants = [];
    _mexExtCounter = 0;
    _playoffScoreMap = {};
  }
  currentTid = id;
  currentType = type;
  currentTournamentName = name || _tournamentMeta[id]?.name || null;
  // Track in the open-tournament list for quick-switch chips
  const existing = _openTournaments.find(t => t.id === id);
  if (existing) {
    existing.name = currentTournamentName || existing.name;
  } else {
    _openTournaments.push({ id, type, name: currentTournamentName || id });
  }
  updateActiveTournamentUI();
  setActiveTab('view');
  if (type === 'group_playoff') renderGP();
  else if (type === 'playoff') renderPO();
  else renderMex();
  _stopRegDetailPoll();
  _startAdminVersionPoll();
}

function openRegistration(rid, name) {
  currentTid = rid;
  currentType = 'registration';
  currentTournamentName = name || rid;
  const existing = _openTournaments.find(t => t.id === rid);
  if (existing) {
    existing.name = name || existing.name;
  } else {
    _openTournaments.push({ id: rid, type: 'registration', name: name || rid });
  }
  updateActiveTournamentUI();
  setActiveTab('view');
  renderRegistration();
  _stopAdminVersionPoll();
  _startRegDetailPoll();
}

async function renderRegistration() {
  const el = document.getElementById('view-content');
  if (!el || !currentTid) return;
  const _renderTid = currentTid;
  el.innerHTML = `<div class="card"><em>${t('txt_txt_loading')}</em></div>`;
  try {
    const [data, collabResult, emailSettingsResult] = await Promise.all([
      api(`/api/registrations/${_renderTid}`),
      getAuthUsername()
        ? api(`/api/registrations/${_renderTid}/collaborators`).catch(() => null)
        : Promise.resolve(null),
      window._emailConfigured && getAuthUsername()
        ? api(`/api/registrations/${_renderTid}/email-settings`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (currentTid !== _renderTid) return;
    _regDetails[_renderTid] = data;
    _currentRegDetail = data;
    if (collabResult) _regCollaborators[_renderTid] = collabResult.collaborators || [];
    if (emailSettingsResult) _regEmailSettings[_renderTid] = emailSettingsResult;
    _renderRegDetailInline(_renderTid);
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`;
  }
}

// ─── Sport selector ──────────────────────────────────────
