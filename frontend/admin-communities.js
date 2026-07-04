/**
 * admin-communities.js — Community management panel (Petite-Vue island).
 *
 * Handles:
 *  - Listing, creating, renaming, and deleting communities
 *  - Setting the current user's default community
 *  - Reassigning tournaments and registration lobbies to communities
 *
 * Converted to a reactive island (`_commStore`) mounted on `#panel-communities`
 * — one store replaces the scattered `let`s + manual `_commRenderX()` re-render
 * calls. loadCommunitiesPanel() now only fetches and assigns into the store; the
 * bound markup (index.html) re-renders reactively. See shared.js mountIsland()
 * and the frontend-dev skill's "Reactive views with Petite-Vue" recipe.
 */

// ─── Reactive store ───────────────────────────────────────

const _commStore = reactiveStore({
  // Raw data, assigned by loadCommunitiesPanel(); everything else derives.
  communities: [],        // { id, name, is_builtin }
  tournaments: [],        // from GET /api/tournaments
  registrations: [],      // from GET /api/registrations
  loaded: false,
  // UI state
  newName: '',            // create-community input (v-model)
  renamingId: null,       // id of the community being inline-renamed, or null
  renameDraft: '',        // v-model for the inline rename input
  msg: '',                // create/rename/delete status line
  msgOk: false,           // true = success (green), false = error (red)
  defaultMsg: '',         // "my default" save status line
  defaultMsgOk: false,
  defaultSelection: 'open', // v-model for the "my default" select
  lang: 'en',             // tracked so t() bindings re-render on language switch

  // Lang-tracking t() wrapper (petite-vue only re-renders on reactive reads).
  t(key) { void this.lang; return window.t(key); },

  // ── Derived ──
  get global() { return this.communities.find(c => c.is_builtin) || null; },
  get specialized() { return this.communities.filter(c => !c.is_builtin); },
  get hasSpecialized() { return this.specialized.length > 0; },
  get sortedTournaments() {
    return [...this.tournaments].sort((a, b) => a.name.localeCompare(b.name));
  },
  get sortedRegistrations() {
    return [...this.registrations].sort((a, b) => a.name.localeCompare(b.name));
  },
  // Option list for the per-row assignment selects (builtin shown as "Global default").
  communityOptions() {
    void this.lang;
    return this.communities.map(c => ({
      id: c.id,
      label: c.is_builtin ? window.t('txt_comm_global_default') : c.name,
    }));
  },
  optionLabel(c) {
    void this.lang;
    return c.is_builtin ? window.t('txt_comm_global_default') : c.name;
  },

  // ── My default community ──
  async saveMyDefault() {
    const community_id = this.defaultSelection;
    try {
      const result = await apiAuth('/api/auth/me/settings', {
        method: 'PATCH',
        body: JSON.stringify({ default_community_id: community_id }),
      });
      try { localStorage.setItem('padel-auth-default-community', result.default_community_id); } catch (_) {}
      _refreshCreateCommunityDropdown(community_id);
      this._flashDefault(true, `✓ ${window.t('txt_comm_saved')}`);
    } catch (e) {
      this._flashDefault(false, e.message);
    }
  },
  _flashDefault(ok, text) {
    this.defaultMsgOk = ok;
    this.defaultMsg = text;
    if (ok) setTimeout(() => { this.defaultMsg = ''; }, 2500);
  },

  // ── Community CRUD ──
  async create() {
    const name = (this.newName || '').trim();
    if (!name) { this._flash(false, window.t('txt_comm_name_required')); return; }
    try {
      await apiAuth('/api/communities', { method: 'POST', body: JSON.stringify({ name }) });
      this.newName = '';
      this._flash(true, `✓ ${window.t('txt_comm_created').replace('{name}', name)}`);
      await _commLoadCommunities();
      if (typeof _loadCommunities === 'function') _loadCommunities();
    } catch (e) {
      this._flash(false, e.message);
    }
  },
  startRename(id) {
    const community = this.communities.find(c => c.id === id);
    if (!community) return;
    this.renamingId = id;
    this.renameDraft = community.name;
  },
  cancelRename() { this.renamingId = null; this.renameDraft = ''; },
  async confirmRename(id) {
    const newName = (this.renameDraft || '').trim();
    const community = this.communities.find(c => c.id === id);
    if (!newName || newName === community?.name) { this.cancelRename(); return; }
    try {
      await apiAuth(`/api/communities/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify({ name: newName }),
      });
      this._flash(true, `✓ ${window.t('txt_comm_renamed').replace('{name}', newName)}`);
      this.cancelRename();
      await _commLoadCommunities();
      if (typeof _loadCommunities === 'function') _loadCommunities();
    } catch (e) {
      this._flash(false, e.message);
      this.cancelRename();
    }
  },
  async remove(id) {
    const community = this.communities.find(c => c.id === id);
    if (!community) return;
    if (!confirm(window.t('txt_comm_delete_confirm').replace('{name}', community.name))) return;
    try {
      await apiAuth(`/api/communities/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this._flash(true, `✓ ${window.t('txt_comm_deleted')}`);
      await Promise.all([_commLoadCommunities(), _commLoadTournaments(), _commLoadRegistrations()]);
      if (typeof _loadCommunities === 'function') _loadCommunities();
    } catch (e) {
      this._flash(false, e.message);
    }
  },
  _flash(ok, text) {
    this.msgOk = ok;
    this.msg = text;
    if (ok) setTimeout(() => { this.msg = ''; }, 2500);
  },

  // ── Assignment (tournaments + lobbies) ──
  async assignTournament(tid, community_id) {
    const item = this.tournaments.find(x => x.id === tid);
    try {
      const res = await apiAuth(`/api/tournaments/${encodeURIComponent(tid)}/community`, {
        method: 'PATCH', body: JSON.stringify({ community_id }),
      });
      if (item) {
        item.community_id = res?.community_id ?? community_id;
        if (res && 'club_id' in res) item.club_id = res.club_id;
        if (res && 'season_id' in res) item.season_id = res.season_id;
      }
      this._flashRow('t', tid, true, '✓');
    } catch (e) {
      this._flashRow('t', tid, false, e.message);
    }
  },
  async assignRegistration(rid, community_id) {
    const item = this.registrations.find(x => x.id === rid);
    try {
      const res = await apiAuth(`/api/registrations/${encodeURIComponent(rid)}/community`, {
        method: 'PATCH', body: JSON.stringify({ community_id }),
      });
      if (item) {
        item.community_id = res?.community_id ?? community_id;
        if (res && 'club_id' in res) item.club_id = res.club_id;
        if (res && 'season_id' in res) item.season_id = res.season_id;
      }
      this._flashRow('r', rid, true, '✓');
    } catch (e) {
      this._flashRow('r', rid, false, e.message);
    }
  },
  // Per-row assignment status (keyed "t:<id>" / "r:<id>"), reactive so the
  // "✓" / error text next to a select re-renders.
  rowMsgs: {},
  rowMsg(kind, id) { return this.rowMsgs[`${kind}:${id}`] || null; },
  _flashRow(kind, id, ok, text) {
    this.rowMsgs[`${kind}:${id}`] = { ok, text };
    if (ok) setTimeout(() => { delete this.rowMsgs[`${kind}:${id}`]; }, 2000);
  },

  // Icon SVG strings (static, rendered via v-html on the rename/delete buttons).
  icEdit() { return _ic('edit'); },
  icTrash() { return _ic('trash'); },
  icInfo() { return _antIc('info-circle'); },
  openInfo() { openContextInfo('communities'); },
});

// ─── Entry point ─────────────────────────────────────────

/**
 * Load (or reload) all data for the communities panel and assign it into the
 * reactive store; the bound markup re-renders automatically.
 * Called when the user navigates to the communities tab.
 */
async function loadCommunitiesPanel() {
  await Promise.all([
    _commLoadCommunities(),
    _commLoadTournaments(),
    _commLoadRegistrations(),
  ]);
  _commStore.lang = getAppLanguage();
  _commStore.defaultSelection = (typeof getAuthDefaultCommunity === 'function')
    ? getAuthDefaultCommunity() : 'open';
  _commStore.loaded = true;
}

// ─── Data loaders (assign into the store) ────────────────

async function _commLoadCommunities() {
  try {
    _commStore.communities = await apiAuth('/api/communities');
  } catch (e) {
    console.warn('Failed to load communities:', e);
    _commStore.communities = [];
  }
}

async function _commLoadTournaments() {
  try {
    _commStore.tournaments = await apiAuth('/api/tournaments');
  } catch (e) {
    console.warn('Failed to load tournaments:', e);
    _commStore.tournaments = [];
  }
}

async function _commLoadRegistrations() {
  try {
    _commStore.registrations = await apiAuth('/api/registrations');
  } catch (e) {
    console.warn('Failed to load registrations:', e);
    _commStore.registrations = [];
  }
}

/** Sync the community selector on the create panel to the new default. */
function _refreshCreateCommunityDropdown(community_id) {
  const el = document.getElementById('create-community');
  if (el && [...el.options].some(o => o.value === community_id)) {
    el.value = community_id;
    try { localStorage.setItem('amistoso-community', community_id); } catch (_) {}
  }
}

// Keep the island's language in sync when the app language changes.
document.addEventListener('app-language-changed', (ev) => {
  _commStore.lang = (ev.detail && ev.detail.lang) || getAppLanguage();
});

// Mount the island once at load; loadCommunitiesPanel() feeds it data on demand.
mountIsland('#panel-communities', _commStore);
