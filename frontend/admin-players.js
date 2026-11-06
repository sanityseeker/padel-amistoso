// ─── Players Hub Admin ────────────────────────────────────
// Admin interface for managing Player Hub profiles.
// Uses the same api() helper and auth token as the rest of the admin.
//
// The search box + results list + selection/merge action bar are a Petite-Vue
// island (`_phStore`, mounted on #ph-search-island). The single-profile detail
// view (phLoadProfile → _phRenderDetail and the #ph-detail sub-panels) is still
// legacy innerHTML: it renders into a separate container, has no shared nodes
// with the island, and is a deeper nested-builder rewrite left for later. The
// island's "Manage"/"Convert ghost" buttons call those legacy globals directly.

// ─── Reactive store (search + results + merge bar) ────────

const _phStore = reactiveStore({
  query: '',                 // search box (v-model)
  profiles: [],              // raw results from the last search
  searched: false,           // a search has run at least once
  searching: false,
  error: '',                 // search error text
  // Ghosts are hidden until the admin opts in (persisted per browser).
  showGhosts: (typeof localStorage !== 'undefined' && localStorage.getItem('ph-show-ghosts') === '1'),
  profilesOpen: (typeof localStorage !== 'undefined' && localStorage.getItem('ph-profiles-open') === '1'),
  // Selection state (id→true maps; petite-vue tracks plain objects, not Sets).
  selectedGhosts: {},        // ghost profiles picked for consolidation
  selectedHub: null,         // one non-ghost profile as merge target
  selectedHub2: null,        // a second Hub profile: merged into selectedHub (Hub+Hub merge)
  hubMergePreview: null,     // GET merge-hub/preview result for the selected pair
  hubMergeLoading: false,
  mergeName: '',             // v-model for the consolidate-name input
  mergeMsg: '',              // merge/consolidate status (alert text)
  mergeMsgError: false,
  merging: false,
  // Past participants (played but never got a profile) — selectable as merge
  // sources; player_id → display name.
  pastQuery: '',
  pastResults: [],
  pastSearching: false,
  pastSearched: false,
  pastOpen: false,
  selectedPast: {},          // player_id → name
  suggesting: false,
  lang: 'en',                // tracked so t() bindings re-render on language switch

  // Lang-tracking t() wrapper (petite-vue only re-renders on reactive reads).
  t(key, params) { void this.lang; return window.t(key, params); },

  // ── Derived ──
  get ghostCount() { return this.profiles.filter(p => p.is_ghost).length; },
  get visibleProfiles() {
    return this.showGhosts ? this.profiles : this.profiles.filter(p => !p.is_ghost);
  },
  get selectedGhostIds() { return Object.keys(this.selectedGhosts).filter(id => this.selectedGhosts[id]); },
  get selectedGhostCount() { return this.selectedGhostIds.length; },
  get hubProfile() { return this.selectedHub ? this.profiles.find(p => p.id === this.selectedHub) : null; },
  get hubProfile2() { return this.selectedHub2 ? this.profiles.find(p => p.id === this.selectedHub2) : null; },
  get hubName() { return this.hubProfile?.name || this.selectedHub; },
  get hubName2() { return this.hubProfile2?.name || this.selectedHub2; },
  get hubSharedNames() {
    return (this.hubMergePreview?.shared_tournaments || []).map(s => s.tournament_name).join(', ');
  },
  get selectedGhostNames() {
    return this.selectedGhostIds.map(id => this.profiles.find(p => p.id === id)?.name || id);
  },
  get selectedPastIds() { return Object.keys(this.selectedPast); },
  get selectedPastCount() { return this.selectedPastIds.length; },
  get selectedPastNames() { return this.selectedPastIds.map(id => this.selectedPast[id]); },
  // Ghosts + past participants both count as merge sources.
  get sourceCount() { return this.selectedGhostCount + this.selectedPastCount; },
  get allSourceNames() { return [...this.selectedGhostNames, ...this.selectedPastNames]; },
  // Which merge-bar variant to show.
  get mergeMode() {
    if (this.merging || this.mergeMsg) return this.mergeMsg ? 'msg' : 'busy';
    if (this.selectedHub && this.selectedHub2) return 'hub-hub';
    if (this.selectedHub) return this.sourceCount > 0 ? 'hub-ghosts' : 'hub';
    if (this.sourceCount >= 2) return 'ghosts';
    return 'none';
  },

  // ── Formatting helpers (used in templates) ──
  padelElo(p) {
    return p.elo_padel_matches > 0 ? `${Math.round(p.elo_padel)}` : '—';
  },
  padelEloMatches(p) { return p.elo_padel_matches > 0 ? p.elo_padel_matches : null; },
  tennisElo(p) {
    return p.elo_tennis_matches > 0 ? `${Math.round(p.elo_tennis)}` : '—';
  },
  tennisEloMatches(p) { return p.elo_tennis_matches > 0 ? p.elo_tennis_matches : null; },
  fmtDate(iso) { return _phFormatDate(iso); },
  copyText(ev) { try { navigator.clipboard.writeText(ev.target.textContent); } catch (_) {} },

  // ── Actions ──
  async search() {
    const q = (this.query || '').trim();
    this.selectedGhosts = {};
    this.selectedHub = null;
    this.selectedHub2 = null;
    this.hubMergePreview = null;
    this.selectedPast = {};
    this.mergeMsg = '';
    this.error = '';
    this.searching = true;
    try {
      this.profiles = await api(`/api/admin/player-profiles?q=${encodeURIComponent(q)}`);
      this.searched = true;
    } catch (e) {
      this.profiles = [];
      this.error = e.message;
    } finally {
      this.searching = false;
    }
  },
  toggleShowGhosts() {
    this.showGhosts = !this.showGhosts;
    try { localStorage.setItem('ph-show-ghosts', this.showGhosts ? '1' : '0'); } catch (_) {}
    this.selectedGhosts = {};
    this.selectedHub = null;
    this.selectedHub2 = null;
    this.hubMergePreview = null;
  },
  persistOpen(ev) {
    this.profilesOpen = ev.target.open;
    try { localStorage.setItem('ph-profiles-open', this.profilesOpen ? '1' : '0'); } catch (_) {}
  },
  toggleGhost(id, checked) {
    if (checked) {
      this.selectedGhosts[id] = true;
      // Suggest the first selected ghost's name as the consolidated name
      // (only when the user hasn't typed one) — mirrors the legacy default.
      if (!this.mergeName) {
        this.mergeName = this.profiles.find(p => p.id === id)?.name || '';
      }
    } else {
      delete this.selectedGhosts[id];
    }
  },
  // The first checked Hub profile is the merge target; a second one is merged into it.
  toggleHub(id, checked) {
    if (checked) {
      if (!this.selectedHub) this.selectedHub = id;
      else if (this.selectedHub !== id) this.selectedHub2 = id;
    } else if (this.selectedHub === id) {
      this.selectedHub = this.selectedHub2;
      this.selectedHub2 = null;
    } else if (this.selectedHub2 === id) {
      this.selectedHub2 = null;
    }
    this.loadHubMergePreview();
  },
  swapHubs() {
    [this.selectedHub, this.selectedHub2] = [this.selectedHub2, this.selectedHub];
    this.loadHubMergePreview();
  },
  async loadHubMergePreview() {
    this.hubMergePreview = null;
    if (!this.selectedHub || !this.selectedHub2) return;
    const pair = [this.selectedHub, this.selectedHub2];
    this.hubMergeLoading = true;
    try {
      const params = new URLSearchParams({ primary_id: pair[0], secondary_id: pair[1] });
      const preview = await api(`/api/admin/player-profiles/merge-hub/preview?${params}`);
      // Ignore a stale answer if the selection changed meanwhile.
      if (this.selectedHub === pair[0] && this.selectedHub2 === pair[1]) this.hubMergePreview = preview;
    } catch (e) {
      this._flashMerge(true, e.message);
    } finally {
      this.hubMergeLoading = false;
    }
  },
  async mergeHubs() {
    const preview = this.hubMergePreview;
    if (!preview || !preview.can_merge) return;
    if (!confirm(this.t('txt_ph_merge_hub_confirm', { keep: this.hubName, remove: this.hubName2 }))) return;
    this.merging = true;
    this.mergeMsg = '';
    try {
      const result = await api('/api/admin/player-profiles/merge-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_id: preview.primary.id, secondary_id: preview.secondary.id }),
      });
      this.merging = false;
      await this.search();
      this._flashMerge(false, this.t('txt_ph_merge_hub_ok', { name: result.name }));
    } catch (e) {
      this.merging = false;
      this._flashMerge(true, e.message);
    }
  },
  clearSelection() {
    this.selectedGhosts = {};
    this.selectedHub = null;
    this.selectedHub2 = null;
    this.hubMergePreview = null;
    this.selectedPast = {};
    this.mergeName = '';
    this.mergeMsg = '';
  },
  // ── Past-participant search (raw participants with no profile) ──
  togglePast(id, name, checked) {
    if (checked) {
      this.selectedPast[id] = name || id;
      if (!this.mergeName) this.mergeName = name || '';
    } else {
      delete this.selectedPast[id];
    }
  },
  async searchPast() {
    const q = (this.pastQuery || '').trim();
    this.pastSearching = true;
    try {
      this.pastResults = await api(`/api/admin/player-profiles/past-participants?q=${encodeURIComponent(q)}`);
      this.pastSearched = true;
    } catch (e) {
      this.pastResults = [];
      this._flashMerge(true, e.message);
    } finally {
      this.pastSearching = false;
    }
  },
  // Auto-select ghost profiles that likely match the chosen Hub target.
  async suggestForHub() {
    if (!this.selectedHub) return;
    this.suggesting = true;
    try {
      const cands = await api(`/api/admin/player-profiles/${encodeURIComponent(this.selectedHub)}/merge-candidates`);
      let added = 0;
      for (const c of cands) {
        // Surface the candidate in the list so it renders checked, then select it.
        if (!this.profiles.some(p => p.id === c.id)) this.profiles.push(c);
        if (!this.selectedGhosts[c.id]) { this.selectedGhosts[c.id] = true; added++; }
      }
      this._flashMerge(false, this.t('txt_ph_suggest_result', { n: added }));
    } catch (e) {
      this._flashMerge(true, e.message);
    } finally {
      this.suggesting = false;
    }
  },
  async consolidate(intoHub) {
    const ghostIds = [...this.selectedGhostIds];
    const pastIds = [...this.selectedPastIds];
    const names = this.allSourceNames.join(', ');
    if (intoHub) {
      if (!this.selectedHub || this.sourceCount < 1) return;
      const hubName = this.hubProfile?.name || this.selectedHub;
      if (!confirm(this.t('txt_ph_merge_into_hub_confirm', { hub: hubName, names }))) return;
    } else {
      if (this.sourceCount < 2) return;
      if (!confirm(this.t('txt_ph_consolidate_confirm', { names }))) return;
    }
    const ids = intoHub ? [this.selectedHub, ...ghostIds] : [...ghostIds];
    const name = intoHub ? null : (this.mergeName || '').trim() || null;
    this.merging = true;
    this.mergeMsg = '';
    try {
      const result = await api('/api/admin/player-profiles/consolidate-ghosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_ids: ids, source_player_ids: pastIds, name }),
      });
      this.selectedGhosts = {};
      this.selectedHub = null;
      this.selectedPast = {};
      this.pastResults = [];
      this.pastQuery = '';
      this.mergeName = '';
      this.merging = false;
      await this.search();
      this._flashMerge(false, this.t(intoHub ? 'txt_ph_merge_into_hub_ok' : 'txt_ph_consolidate_ok', { name: result.name }));
    } catch (e) {
      this.merging = false;
      this._flashMerge(true, e.message);
    }
  },
  _flashMerge(isError, text) {
    this.mergeMsgError = isError;
    this.mergeMsg = text;
    if (!isError) setTimeout(() => { this.mergeMsg = ''; }, 4000);
  },

  // Delegate to the legacy detail-view / convert-form globals.
  manage(id) { phLoadProfile(id); },
  showConvert(id) { phShowConvertForm(id); },
});

/** Search profiles by name or email (kept as a global for legacy callers). */
async function phSearch() {
  return _phStore.search();
}

/** Load and render a single profile detail view (legacy innerHTML) */
async function phLoadProfile(profileId) {
  const detail = document.getElementById('ph-detail');
  if (!detail) return;
  _phCurrentProfileId = profileId;
  detail.style.display = '';
  detail.innerHTML = `<div class="card"><em>${t('txt_ph_loading_profile')}</em></div>`;
  try {
    const data = await api(`/api/admin/player-profiles/${profileId}`);
    _phRenderDetail(data);
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    detail.innerHTML = `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`;
  }
}

// Detail-view state (legacy).
let _phCurrentProfileId = null;

/** Render the full profile detail card (legacy innerHTML) */
function _phRenderDetail(data) {
  const detail = document.getElementById('ph-detail');
  if (!detail) return;
  const active = data.participations.filter(p => p.status === 'active');
  const finished = data.participations.filter(p => p.status === 'finished');

  let html = '<div class="card">';
  html += '<div class="d-flex items-center justify-between mb-3 flex-wrap gap-2">';
  html += `<h2 class="m-0">${_ic('user')} ${esc(data.name || t('txt_ph_unnamed_profile'))}</h2>`;
  html += '<div class="d-flex items-center gap-1-5 flex-wrap">';
  html += `<button type="button" class="btn btn-danger btn-sm" onclick="phDeleteProfile('${escAttr(data.id)}')">${t('txt_ph_delete_profile')}</button>`;
  html += `<button type="button" class="btn btn-sm" onclick="phCloseDetail()">${_ic('x')} ${t('txt_txt_close')}</button>`;
  html += '</div>';
  html += '</div>';

  // Profile info
  html += '<div class="ph-detail-grid">';
  const passDisplay = data.is_ghost
    ? `<span class="text-muted" title="${t('txt_ph_ghost_no_passphrase')}">—</span>`
    : `<code class="player-codes-passphrase" onclick="const c=this;navigator.clipboard.writeText(c.textContent).then(()=>flashSuccess(c,'${escAttr(t('txt_txt_copied'))}'))" title="${t('txt_txt_click_to_copy')}">${esc(data.passphrase)}</code> <button type="button" class="btn btn-sm btn-muted btn-chip fs-xs" onclick="phResetPassphrase('${escAttr(data.id)}')">${_ic('reset')} ${t('txt_ph_reset')}</button>`;
  html += `<strong>${t('txt_txt_passphrase')}:</strong><span>${passDisplay}</span>`;
  html += `<strong>${t('txt_ph_name')}:</strong><span class="d-flex gap-1-5 items-center flex-wrap"><input type="text" id="ph-name-input" value="${escAttr(data.name || '')}" class="hub-input hub-input--grow"><button type="button" class="btn btn-sm" onclick="phUpdateName('${escAttr(data.id)}')" id="ph-name-save-btn">${t('txt_txt_save')}</button></span>`;
  html += `<strong>${t('txt_txt_email')}:</strong><span class="d-flex gap-1-5 items-center flex-wrap"><input type="email" id="ph-email-input" value="${escAttr(data.email || '')}" class="hub-input hub-input--grow"><button type="button" class="btn btn-sm" onclick="phUpdateEmail('${escAttr(data.id)}')" id="ph-email-save-btn">${t('txt_txt_save')}</button></span>`;
  html += `<strong>${t('txt_txt_contact')}:</strong><span>${esc(data.contact || t('txt_txt_contact_not_set'))}</span>`;
  html += `<strong>${t('txt_ph_created')}:</strong><span>${_phFormatDate(data.created_at)}</span>`;
  html += '</div>';

  // ELO ratings
  html += '<div class="d-flex gap-6 flex-wrap mb-4">';
  if (data.elo_padel_matches > 0) {
    html += `<div class="ph-detail-box">`;
    html += `<strong>${t('txt_ph_padel_elo')}:</strong> ${Math.round(data.elo_padel)} <span class="text-muted">(${data.elo_padel_matches} ${t('txt_txt_matches').toLowerCase()})</span></div>`;
  }
  if (data.elo_tennis_matches > 0) {
    html += `<div class="ph-detail-box">`;
    html += `<strong>${t('txt_ph_tennis_elo')}:</strong> ${Math.round(data.elo_tennis)} <span class="text-muted">(${data.elo_tennis_matches} ${t('txt_txt_matches').toLowerCase()})</span></div>`;
  }
  if (data.elo_padel_matches === 0 && data.elo_tennis_matches === 0) {
    html += `<span class="text-muted fs-md">${t('txt_ph_no_elo')}</span>`;
  }
  html += '</div>';

  // K-factor override
  const kVal = data.k_factor_override != null ? data.k_factor_override : '';
  html += '<div class="d-flex items-center gap-2 mb-4 fs-lg">';
  html += `<strong>${t('txt_ph_kfactor_override')}:</strong>`;
  html += `<input type="number" id="ph-kfactor-input" value="${escAttr(String(kVal))}" placeholder="${t('txt_ph_auto')}" min="1" max="200" class="hub-input hub-input--kfactor">`;
  html += `<button type="button" class="btn btn-sm" onclick="phUpdateKFactor('${escAttr(data.id)}')" id="ph-kfactor-save-btn">${t('txt_txt_save')}</button>`;
  html += `<span class="text-muted fs-sm">${t('txt_ph_kfactor_auto_help')}</span>`;
  html += '</div>';

  // New passphrase result area
  html += '<div id="ph-passphrase-result"></div>';
  html += '<div id="ph-inline-msg"></div>';

  // Active participations
  html += `<h3 class="m-0 mt-4 mb-2 fs-lg">${t('txt_ph_active_participations_n', { n: active.length })}</h3>`;
  if (active.length === 0) {
    html += `<p class="text-muted fs-md">${t('txt_ph_no_active_links')}</p>`;
  } else {
    html += _phParticipationTable(active, data.id, false);
  }

  // Finished participations
  html += `<h3 class="m-0 mt-4 mb-2 fs-lg">${t('txt_ph_finished_participations_n', { n: finished.length })}</h3>`;
  if (finished.length === 0) {
    html += `<p class="text-muted fs-md">${t('txt_ph_no_finished_history')}</p>`;
  } else {
    html += _phParticipationTable(finished, data.id, true);
  }

  // Link new participation
  html += '<div class="mt-4">';
  html += `<button type="button" class="add-participant-btn" onclick="phStartLink('${escAttr(data.id)}')">＋ ${t('txt_ph_link_participation')}</button>`;
  html += '</div>';
  html += '<div id="ph-link-area"></div>';

  html += '</div>';
  detail.innerHTML = html;
}

/** Render a table of participations */
function _phParticipationTable(participations, profileId, isFinished) {
  let html = '<div class="player-codes-table-wrap"><table class="player-codes-table">';
  html += '<thead><tr class="player-codes-head-row">';
  html += `<th class="player-codes-th">${t('txt_txt_tournament_name')}</th>`;
  html += `<th class="player-codes-th">${t('txt_ph_player_name')}</th>`;
  if (isFinished) {
    html += `<th class="player-codes-th-center">${t('txt_ph_rank')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_ph_wld')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_ph_pf_pa')}</th>`;
  }
  html += '<th class="player-codes-th-center"></th>';
  html += '</tr></thead><tbody>';
  for (const p of participations) {
    html += '<tr class="player-codes-row">';
    html += `<td class="player-codes-name">${esc(p.tournament_name || p.tournament_id)}</td>`;
    html += `<td class="player-codes-cell">${esc(p.player_name)}</td>`;
    if (isFinished) {
      const rankStr = p.rank != null ? `#${p.rank}/${p.total_players || '?'}` : '—';
      html += `<td class="player-codes-cell-center">${rankStr}</td>`;
      html += `<td class="player-codes-cell-center">${p.wins}/${p.losses}</td>`;
      html += `<td class="player-codes-cell-center">${p.points_for}/${p.points_against}</td>`;
    }
    const unlinkLabel = isFinished ? `${_ic('alert')} ${t('txt_ph_unlink')}` : t('txt_ph_unlink');
    const btnClass = isFinished ? 'btn btn-danger btn-sm' : 'btn btn-sm btn-muted';
    html += `<td class="player-codes-cell-center"><button type="button" class="${btnClass} fs-sm" onclick="phUnlink('${escAttr(p.tournament_id)}','${escAttr(p.player_id)}',${isFinished})">${unlinkLabel}</button></td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

/** Show inline convert-ghost form for a single ghost profile (legacy, into #ph-detail) */
function phShowConvertForm(profileId) {
  const profile = _phStore.profiles.find(p => p.id === profileId);
  const detail = document.getElementById('ph-detail');
  if (!detail) return;
  const suggestedName = profile?.name || '';
  detail.style.display = '';
  detail.innerHTML = `
    <div class="card" id="ph-convert-form">
      <p class="m-0 mb-2 fs-lg fw-600">${t('txt_ph_convert_ghost_title')}</p>
      <p class="m-0 mb-2-5 fs-sm text-muted">${t('txt_ph_convert_ghost_help')}</p>
      <div class="d-flex gap-2 flex-wrap items-end">
        <label class="ghost-field ghost-field--hub">
          ${t('txt_txt_name')}
          <input type="text" id="ph-convert-name" value="${escAttr(suggestedName)}"
            class="hub-input"
            aria-label="${t('txt_txt_name')}">
        </label>
        <label class="ghost-field ghost-field--wide ghost-field--hub">
          ${t('txt_txt_email')} <span class="fw-normal text-muted">(${t('txt_txt_optional')})</span>
          <input type="email" id="ph-convert-email" placeholder="${t('txt_ph_convert_email_placeholder')}"
            class="hub-input"
            aria-label="${t('txt_txt_email')}">
        </label>
        <button type="button" class="btn btn-success btn-sm" onclick="phConvertGhost('${escAttr(profileId)}')">${t('txt_ph_convert_confirm')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="phCloseDetail()">${t('txt_txt_cancel')}</button>
      </div>
      <div id="ph-convert-msg" class="mt-2 fs-sm"></div>
    </div>`;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Execute the ghost-to-Hub-profile conversion */
async function phConvertGhost(profileId) {
  const nameInput = document.getElementById('ph-convert-name');
  const emailInput = document.getElementById('ph-convert-email');
  const msgEl = document.getElementById('ph-convert-msg');
  const name = nameInput?.value?.trim() || null;
  const email = emailInput?.value?.trim() || null;

  if (msgEl) msgEl.innerHTML = `<em>${t('txt_ph_converting')}</em>`;

  try {
    const result = await api(`/api/admin/player-profiles/${encodeURIComponent(profileId)}/convert-ghost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    // Reload list and show the new passphrase
    await phSearch();
    const detail = document.getElementById('ph-detail');
    if (detail) {
      detail.innerHTML = `
        <div class="card alert alert-info mt-2">
          <strong>${t('txt_ph_convert_ok', { name: esc(result.name) })}</strong><br>
          <span class="fs-md">${t('txt_ph_convert_passphrase_label')}: </span>
          <code class="player-codes-passphrase" onclick="const c=this;navigator.clipboard.writeText(c.textContent).then(()=>flashSuccess(c,'${escAttr(t('txt_txt_copied'))}'))" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code>
          ${result.email ? `<br><span class="fs-sm text-muted">${t('txt_ph_convert_email_sent', { email: esc(result.email) })}</span>` : ''}
        </div>`;
      setTimeout(() => { const d = document.getElementById('ph-detail'); if (d) { d.style.display = 'none'; d.innerHTML = ''; } }, 12000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span class="text-error">${esc(e.message)}</span>`;
  }
}

/** Close the detail panel */
function phCloseDetail() {
  const detail = document.getElementById('ph-detail');
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  _phCurrentProfileId = null;
}

/** Show a non-blocking notice inside the profile detail panel */
function phShowInlineNotice(message, isError = false) {
  const area = document.getElementById('ph-inline-msg') || document.getElementById('ph-passphrase-result');
  if (!area) return;
  area.innerHTML = `<div class="alert ${isError ? 'alert-error' : 'alert-info'} mb-3">${esc(message)}</div>`;
}

/** Reset a profile's passphrase */
async function phResetPassphrase(profileId) {
  if (!confirm(t('txt_ph_reset_passphrase_confirm'))) return;
  try {
    const result = await api(`/api/admin/player-profiles/${profileId}/reset-passphrase`, { method: 'POST' });
    const area = document.getElementById('ph-passphrase-result');
    if (area) {
      area.innerHTML = `<div class="alert alert-info mb-3">${t('txt_ph_new_passphrase')}: <code class="player-codes-passphrase player-codes-passphrase--lg" onclick="const c=this;navigator.clipboard.writeText(c.textContent).then(()=>flashSuccess(c,'${escAttr(t('txt_txt_copied'))}'))" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code></div>`;
    }
    // Refresh the detail to show updated passphrase
    phLoadProfile(profileId);
  } catch (e) {
    phShowInlineNotice(t('txt_ph_failed_reset_passphrase_value', { value: e.message }), true);
  }
}

/** Rename a profile */
async function phUpdateName(profileId) {
  const input = document.getElementById('ph-name-input');
  const btn = document.getElementById('ph-name-save-btn');
  if (!input) return;
  const newName = input.value.trim();
  if (!newName) {
    phShowInlineNotice(t('txt_ph_name_empty'), true);
    input.focus();
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    await api(`/api/admin/player-profiles/${profileId}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); flashSuccess(btn, t('txt_txt_saved')); }
    // Refresh list so the updated name shows there too
    phSearch();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); }
    phShowInlineNotice(t('txt_ph_failed_update_name_value', { value: e.message }), true);
  }
}

/** Update a profile's email */
async function phUpdateEmail(profileId) {
  const input = document.getElementById('ph-email-input');
  const btn = document.getElementById('ph-email-save-btn');
  if (!input) return;
  try {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    await api(`/api/admin/player-profiles/${profileId}/email`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.value }),
    });
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); flashSuccess(btn, t('txt_txt_saved')); }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); }
    phShowInlineNotice(t('txt_ph_failed_update_email_value', { value: e.message }), true);
  }
}

/** Update a profile's K-factor override */
async function phUpdateKFactor(profileId) {
  const input = document.getElementById('ph-kfactor-input');
  const btn = document.getElementById('ph-kfactor-save-btn');
  if (!input) return;
  const raw = input.value.trim();
  const kValue = raw === '' ? null : parseInt(raw, 10);
  if (kValue !== null && (isNaN(kValue) || kValue < 1 || kValue > 200)) {
    phShowInlineNotice(t('txt_ph_kfactor_validation'), true);
    input.focus();
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    await api(`/api/admin/player-profiles/${profileId}/k-factor`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k_factor_override: kValue }),
    });
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); flashSuccess(btn, t('txt_txt_saved')); }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); }
    phShowInlineNotice(t('txt_ph_failed_update_kfactor_value', { value: e.message }), true);
  }
}

/** Permanently delete a profile from the database */
async function phDeleteProfile(profileId) {
  if (!confirm(t('txt_ph_delete_profile_confirm'))) return;
  try {
    await api(`/api/admin/player-profiles/${profileId}`, { method: 'DELETE' });
    phCloseDetail();
    await phSearch();
  } catch (e) {
    phShowInlineNotice(t('txt_ph_failed_delete_profile_value', { value: e.message }), true);
  }
}

/** Unlink a participation */
async function phUnlink(tid, playerId, isFinished) {
  if (isFinished) {
    if (!confirm(t('txt_ph_unlink_finished_confirm'))) return;
  } else {
    if (!confirm(t('txt_ph_unlink_active_confirm'))) return;
  }
  try {
    await api(`/api/admin/player-profiles/link/${tid}/${playerId}`, { method: 'DELETE' });
    if (_phCurrentProfileId) phLoadProfile(_phCurrentProfileId);
  } catch (e) {
    phShowInlineNotice(t('txt_ph_failed_unlink_value', { value: e.message }), true);
  }
}

/** Start the link flow — pick a tournament, then a player */
async function phStartLink(profileId) {
  const area = document.getElementById('ph-link-area');
  if (!area) return;
  area.innerHTML = `<div class="mt-3"><em>${t('txt_ph_loading_tournaments')}</em></div>`;
  try {
    const tournaments = await api('/api/tournaments');
    if (tournaments.length === 0) {
      area.innerHTML = `<div class="mt-3"><p class="text-muted">${t('txt_txt_no_tournaments_available')}.</p></div>`;
      return;
    }
    let html = '<div class="ghost-convert-form">';
    html += `<div class="d-flex items-center justify-between mb-2"><strong class="fs-lg">${t('txt_ph_link_participation')}</strong>`;
    html += `<button type="button" class="btn btn-sm" onclick="document.getElementById('ph-link-area').innerHTML=''" aria-label="${escAttr(t('txt_txt_close'))}" title="${escAttr(t('txt_txt_close'))}">${_ic('x')}</button></div>`;
    html += '<div class="mb-2">';
    html += `<label class="fs-md text-muted">${t('txt_ph_select_tournament')}</label>`;
    html += `<select id="ph-link-tid" class="ph-link-select mt-1" onchange="phLoadLinkCandidates('${escAttr(profileId)}')">`;
    html += `<option value="">${t('txt_ph_choose')}</option>`;
    for (const tour of tournaments) {
      html += `<option value="${escAttr(tour.id)}">${esc(tour.name)} (${esc(tour.phase || tour.type)})</option>`;
    }
    html += '</select></div>';
    html += '<div id="ph-link-players"></div>';
    html += '</div>';
    area.innerHTML = html;
  } catch (e) {
    area.innerHTML = `<div class="alert alert-error mt-3">${esc(e.message)}</div>`;
  }
}

/** Participants of the tournament picked in the link form, keyed by player_id */
let _phLinkCandidates = {};
/** The participant of that tournament already linked to the open profile, if any */
let _phLinkOwnParticipant = null;

/** Load a tournament's participants (linked ones included, so they can be re-linked) */
async function phLoadLinkCandidates(profileId) {
  const select = document.getElementById('ph-link-tid');
  const container = document.getElementById('ph-link-players');
  if (!select || !container) return;
  const tid = select.value;
  _phLinkCandidates = {};
  _phLinkOwnParticipant = null;
  if (!tid) { container.innerHTML = ''; return; }
  container.innerHTML = `<em>${t('txt_ph_loading_players')}</em>`;
  try {
    const participants = await api(`/api/admin/player-profiles/participants/${tid}`);
    _phLinkOwnParticipant = participants.find(p => p.profile_id === profileId) || null;
    const players = participants.filter(p => p.profile_id !== profileId);
    if (players.length === 0) {
      container.innerHTML = `<p class="text-muted fs-md">${t('txt_ph_no_players_to_link')}</p>`;
      return;
    }
    let html = `<label class="fs-md text-muted">${t('txt_ph_select_player')}</label>`;
    html += `<select id="ph-link-pid" class="ph-link-select m-0 mt-1 mb-2">`;
    for (const p of players) {
      _phLinkCandidates[p.player_id] = p;
      let label = `${p.player_name} (${p.player_id.slice(0, 6)}…)`;
      if (p.profile_id) {
        const key = p.is_ghost ? 'txt_ph_linked_to_ghost_value' : 'txt_ph_linked_to_value';
        label += ` — ${t(key, { value: p.profile_name || p.profile_id })}`;
      }
      html += `<option value="${escAttr(p.player_id)}">${esc(label)}</option>`;
    }
    html += '</select>';
    html += `<button type="button" class="btn btn-primary btn-sm" onclick="phSubmitLink('${escAttr(profileId)}')">${t('txt_ph_link')}</button>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

/** Submit the link; a participant linked elsewhere is moved after confirmation */
async function phSubmitLink(profileId) {
  const tidSelect = document.getElementById('ph-link-tid');
  const pidSelect = document.getElementById('ph-link-pid');
  if (!tidSelect || !pidSelect) return;
  const tid = tidSelect.value;
  const pid = pidSelect.value;
  if (!tid || !pid) return;
  const current = _phLinkCandidates[pid];
  if (current && current.profile_id && !current.is_ghost
      && !confirm(t('txt_ph_relink_confirm', { value: current.profile_name || current.profile_id }))) return;
  // A profile is one participant per tournament: its existing link here gets removed.
  if (_phLinkOwnParticipant
      && !confirm(t('txt_hub_profile_moves_confirm', { value: _phLinkOwnParticipant.player_name }))) return;
  try {
    await api(`/api/admin/player-profiles/${profileId}/link/${tid}/${pid}`, { method: 'POST' });
    document.getElementById('ph-link-area').innerHTML = '';
    phLoadProfile(profileId);
  } catch (e) {
    phShowInlineNotice(t('txt_ph_failed_link_value', { value: e.message }), true);
  }
}

/** Format an ISO date string for display */
function _phFormatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return isoStr; }
}

// Keep the island's language in sync when the app language changes.
document.addEventListener('app-language-changed', (ev) => {
  _phStore.lang = (ev.detail && ev.detail.lang) || getAppLanguage();
});

// Mount the search/results island once at load.
mountIsland('#ph-search-island', _phStore);
