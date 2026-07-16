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

// ─── Home: list tournaments (Petite-Vue island) ───────────
// The home toolbar + card list under `#home-island` (index.html) are bound to
// `_homeStore`. `loadTournaments()` fetches and assigns raw data into the
// store; filtering, chip counts and the card entries are reactive getters, so
// filter/search changes re-render client-side without a refetch.

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
const _HOME_TOURN_SEARCH_KEY = 'amistoso-home-tournament-search';

function _persistHomeFilterDim(dim) {
  try { localStorage.setItem(_HOME_FILTER_KEYS[dim], _homeStore.filters[dim]); } catch (_) {}
}

function _persistHomeTournamentSearch() {
  try { localStorage.setItem(_HOME_TOURN_SEARCH_KEY, _homeStore.search); } catch (_) {}
}

function _savedHomeFilters() {
  const filters = { ..._HOME_FILTER_DEFAULTS };
  try {
    for (const dim of _HOME_FILTER_DIMS) {
      const saved = localStorage.getItem(_HOME_FILTER_KEYS[dim]);
      if (saved && _HOME_FILTER_VALUES[dim].includes(saved)) filters[dim] = saved;
    }
  } catch (_) {}
  return filters;
}

function _savedHomeSearch() {
  try { return localStorage.getItem(_HOME_TOURN_SEARCH_KEY) || ''; } catch (_) { return ''; }
}

const _homeStore = reactiveStore({
  // Raw data, assigned by loadTournaments(); everything below derives from it.
  loading: true,
  tournaments: [],
  registrations: [],
  communities: [],
  // Auth/context snapshot taken at load time (auth changes re-run loadTournaments).
  admin: false,
  authUser: null,
  subdomainClub: null,
  // UI state
  filters: _savedHomeFilters(),
  defaults: _HOME_FILTER_DEFAULTS,
  search: _savedHomeSearch(),
  searchDraft: _savedHomeSearch(),
  openDim: null,
  lang: 'en',

  // Shadows the injected global t() with a lang-tracking wrapper so every text
  // binding in the island re-renders when the app language changes.
  t(key) { void this.lang; return window.t(key); },

  // ── Toolbar ──
  get visibleDims() {
    return this.admin
      ? _HOME_FILTER_DIMS
      : _HOME_FILTER_DIMS.filter(dim => !_HOME_ADMIN_ONLY_DIMS.has(dim));
  },
  dimValues(dim) { return _HOME_FILTER_VALUES[dim]; },
  dimLabel(dim) {
    return {
      ownership: this.t('txt_txt_filter_dim_ownership'),
      status: this.t('txt_txt_filter_dim_status'),
      type: this.t('txt_txt_filter_dim_type'),
    }[dim] || dim;
  },
  valueLabel(dim, value) {
    const labels = {
      ownership: { mine: this.t('txt_txt_mine'), all: this.t('txt_txt_filter_all') },
      status: { active: this.t('txt_txt_filter_active'), all: this.t('txt_txt_filter_all') },
      type: { all: this.t('txt_txt_filter_all'), tournament: this.t('txt_txt_tournaments'), lobby: this.t('txt_reg_lobby') },
    }[dim] || {};
    return labels[value] ?? value;
  },
  toggleDropdown(dim) { this.openDim = this.openDim === dim ? null : dim; },
  setFilter(dim, value) {
    if (!_HOME_FILTER_VALUES[dim] || !_HOME_FILTER_VALUES[dim].includes(value)) return;
    this.filters[dim] = value;
    _persistHomeFilterDim(dim);
    this.openDim = null;
  },
  submitSearch() {
    this.search = (this.searchDraft || '').trim();
    _persistHomeTournamentSearch();
  },
  clearSearch() {
    this.searchDraft = '';
    this.search = '';
    _persistHomeTournamentSearch();
  },
  clearAll() {
    // Widen all dimensions to "all" so the user sees every available item.
    for (const dim of _HOME_FILTER_DIMS) {
      this.filters[dim] = 'all';
      _persistHomeFilterDim(dim);
    }
    this.clearSearch();
  },

  // ── Filtering pipeline ──
  _matchesSearch(item) {
    const needle = (this.search || '').trim().toLowerCase();
    if (!needle) return true;
    const hay = [item.name, item.club_name, item.community_name, item.owner]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(needle);
  },
  // When the admin SPA is opened on a club subdomain we hide everything that
  // doesn't belong to that club so the operator only sees relevant items
  // (the subdomain banner's dismiss button clears the context). Filter by
  // both club_id AND community_id so cross-community legacy assignments
  // (e.g. a tournament with club_id set to this club but a different
  // community_id) are excluded.
  _matchesSubdomainClub(item) {
    const sub = this.subdomainClub;
    if (!sub) return true;
    return item && item.club_id === sub.club_id && item.community_id === sub.community_id;
  },
  _owns(item) {
    if (!this.authUser) return false;
    return item.owner === this.authUser || item.shared === true;
  },
  // Universe of items after search + subdomain filters but BEFORE the user's
  // chip selections. Input for both the rendered view and the chip counts.
  get universe() {
    const visible = (item) => this._matchesSearch(item) && this._matchesSubdomainClub(item);
    const tournaments = this.tournaments.filter(visible);
    const lobbies = this.registrations.filter(visible);
    const nonArchived = lobbies.filter(r => !r.archived);
    return {
      activeT: tournaments.filter(tr => tr.phase !== 'finished'),
      finishedT: tournaments.filter(tr => tr.phase === 'finished'),
      // Active section: open lobbies only. Finished section: all non-archived
      // closed lobbies (converted or not).
      activeL: nonArchived.filter(r => r.open),
      finishedL: nonArchived.filter(r => !r.open),
      archivedL: lobbies.filter(r => r.archived),
    };
  },
  _applyFilters(state) {
    const u = this.universe;
    const owns = (item) => state.ownership === 'all' || this._owns(item);
    let activeT = u.activeT.filter(owns);
    let finishedT = u.finishedT.filter(owns);
    let activeL = u.activeL.filter(owns);
    let finishedL = u.finishedL.filter(owns);
    let archivedL = u.archivedL.filter(owns);
    if (state.status === 'active') { finishedT = []; finishedL = []; archivedL = []; }
    if (state.type === 'tournament') { activeL = []; finishedL = []; archivedL = []; }
    else if (state.type === 'lobby') { activeT = []; finishedT = []; }
    return { activeT, finishedT, activeL, finishedL, archivedL };
  },
  get view() { return this._applyFilters(this.filters); },
  // Chip count per (dim, value): "how many items would I see if I picked this
  // value while keeping the other two dimensions as-is?"
  chipCount(dim, value) {
    const r = this._applyFilters({ ...this.filters, [dim]: value });
    return r.activeT.length + r.finishedT.length + r.activeL.length
      + r.finishedL.length + r.archivedL.length;
  },

  // ── Cards ──
  get mainCards() {
    const v = this.view;
    const lobby = (r) => ({ key: 'lobby:' + r.id, kind: 'lobby', item: r });
    const tourn = (tr) => ({ key: 'tourn:' + tr.id, kind: 'tournament', item: tr });
    // Open lobbies first, then active tournaments, then the finished section.
    return [
      ...v.activeL.map(lobby),
      ...v.activeT.map(tourn),
      ...v.finishedT.map(tourn),
      ...v.finishedL.map(lobby),
    ];
  },
  get archivedEntries() {
    return this.view.archivedL.map(r => ({ key: 'lobby:' + r.id, kind: 'lobby', item: r }));
  },
  get hasAnyItems() { return this.mainCards.length > 0 || this.archivedEntries.length > 0; },
  get hasFilter() {
    return Boolean((this.search || '').trim())
      || _HOME_FILTER_DIMS.some(dim => this.filters[dim] !== _HOME_FILTER_DEFAULTS[dim]);
  },
  cardTemplate(entry) {
    return { $template: entry.kind === 'tournament' ? '#tpl-home-tourn-card' : '#tpl-home-lobby-card' };
  },
  phaseLabel(phase) {
    const map = {
      setup: this.t('txt_txt_setup'), groups: this.t('txt_txt_group_stage'), playoffs: this.t('txt_txt_play_offs'),
      finished: this.t('txt_txt_finished'), mexicano: this.t('txt_txt_mexicano'),
    };
    return map[phase] || phase;
  },
  sportLabel(item) {
    return (item.sport || 'padel') === 'tennis'
      ? this.t('txt_txt_sport_tennis')
      : this.t('txt_txt_sport_padel');
  },
  identityLabel(item) {
    const community = this.communities.find(c => c.id === (item.community_id || 'open'));
    return item.club_name
      || item.community_name
      || ((community && !community.is_builtin) ? community.name : '');
  },
  isListed(r) { return r.listed !== false && r.listed !== 0; },
  canEditTournament(tr) { return this.admin || this.authUser === tr.owner || tr.shared === true; },
  canDeleteTournament(tr) { return this.admin || this.authUser === tr.owner; },
});

// Close any open filter dropdown when the user clicks outside it / hits Escape.
document.addEventListener('click', (ev) => {
  if (_homeStore.openDim === null) return;
  const wrap = ev.target.closest('.home-filter-dropdown');
  if (wrap && wrap.dataset.dim === _homeStore.openDim) return;
  _homeStore.openDim = null;
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') _homeStore.openDim = null;
});
// Language switches re-render all island text via the store's t() wrapper.
document.addEventListener('app-language-changed', (ev) => {
  _homeStore.lang = (ev.detail && ev.detail.lang) || getAppLanguage();
});

mountIsland('#home-island', _homeStore);

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
    _tournamentMeta = {};
    for (const tournament of list) _tournamentMeta[tournament.id] = tournament;
    _registrations = regList.filter(r => !r.archived);

    // Drop admin-only filter dimensions when caller is not an admin (the server
    // already restricts non-admins to their own / shared items).
    if (!isAdmin()) {
      for (const dim of _HOME_ADMIN_ONLY_DIMS) {
        if (_homeStore.filters[dim] !== _HOME_FILTER_DEFAULTS[dim]) {
          _homeStore.filters[dim] = _HOME_FILTER_DEFAULTS[dim];
          _persistHomeFilterDim(dim);
        }
      }
    }

    // Assign the fetched data into the reactive store — Petite-Vue re-renders
    // the toolbar chip counts and the card list from the store's getters.
    // The dismiss button on the subdomain banner clears the global, so the
    // user can opt back into the full list without leaving the subdomain.
    const subdomainClub = (typeof window !== 'undefined' && window.__ADMIN_SUBDOMAIN_CLUB__) || null;
    _homeStore.lang = getAppLanguage();
    _homeStore.admin = isAdmin();
    _homeStore.authUser = getAuthUsername();
    _homeStore.subdomainClub = (subdomainClub && subdomainClub.club_id) ? subdomainClub : null;
    _homeStore.tournaments = list;
    _homeStore.registrations = regList;
    _homeStore.communities = commList;
    _homeStore.loading = false;
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
let _gpScoreMode = { 'gp-group': 'points', 'gp-playoff': 'points', 'mex-playoff': 'points', 'po-playoff': 'points', 'po-espejo-losers': 'points', 'po-espejo-super-final': 'points' };
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
  // Fresh open always starts on the lobby overview with a draft synced to the
  // saved participant filter (not a stale one from a previous visit).
  if (typeof _lobbySettingsPageRids !== 'undefined') _lobbySettingsPageRids.delete(rid);
  if (typeof _regFilterDraft !== 'undefined') delete _regFilterDraft[rid];
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
    // Pending participation claims (name-based recovery awaiting approval) — the
    // open path must fetch these too, otherwise the claims section only ever
    // populates after a mutation-triggered _loadRegDetail refresh.
    try {
      _regClaims[_renderTid] = await api(`/api/registrations/${_renderTid}/claims`);
    } catch (_) { _regClaims[_renderTid] = []; }
    if (currentTid !== _renderTid) return;
    _renderRegDetailInline(_renderTid);
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`;
  }
}

// ─── Sport selector ──────────────────────────────────────
