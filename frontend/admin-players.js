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
  showGhosts: (typeof localStorage !== 'undefined' && localStorage.getItem('ph-show-ghosts') !== '0'),
  profilesOpen: (typeof localStorage !== 'undefined' && localStorage.getItem('ph-profiles-open') === '1'),
  // Selection state (id→true maps; petite-vue tracks plain objects, not Sets).
  selectedGhosts: {},        // ghost profiles picked for consolidation
  selectedHub: null,         // one non-ghost profile as merge target
  mergeName: '',             // v-model for the consolidate-name input
  mergeMsg: '',              // merge/consolidate status (alert text)
  mergeMsgError: false,
  merging: false,
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
  get selectedGhostNames() {
    return this.selectedGhostIds.map(id => this.profiles.find(p => p.id === id)?.name || id);
  },
  // Which merge-bar variant to show.
  get mergeMode() {
    if (this.merging || this.mergeMsg) return this.mergeMsg ? 'msg' : 'busy';
    if (this.selectedHub) return this.selectedGhostCount > 0 ? 'hub-ghosts' : 'hub';
    if (this.selectedGhostCount >= 2) return 'ghosts';
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
  toggleHub(id, checked) {
    this.selectedHub = checked ? id : (this.selectedHub === id ? null : this.selectedHub);
  },
  clearSelection() {
    this.selectedGhosts = {};
    this.selectedHub = null;
    this.mergeName = '';
    this.mergeMsg = '';
  },
  async consolidate(intoHub) {
    if (intoHub) {
      if (!this.selectedHub || this.selectedGhostCount < 1) return;
      const hubName = this.hubProfile?.name || this.selectedHub;
      const names = this.selectedGhostNames.join(', ');
      if (!confirm(this.t('txt_ph_merge_into_hub_confirm', { hub: hubName, names }))) return;
    } else {
      if (this.selectedGhostCount < 2) return;
      const names = this.selectedGhostNames.join(', ');
      if (!confirm(this.t('txt_ph_consolidate_confirm', { names }))) return;
    }
    const ids = intoHub ? [this.selectedHub, ...this.selectedGhostIds] : [...this.selectedGhostIds];
    const name = intoHub ? null : (this.mergeName || '').trim() || null;
    this.merging = true;
    this.mergeMsg = '';
    try {
      const result = await api('/api/admin/player-profiles/consolidate-ghosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_ids: ids, name }),
      });
      this.selectedGhosts = {};
      this.selectedHub = null;
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
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">';
  html += `<h2 style="margin:0">🎾 ${esc(data.name || t('txt_ph_unnamed_profile'))}</h2>`;
  html += '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">';
  html += `<button type="button" class="btn btn-danger btn-sm" onclick="phDeleteProfile('${escAttr(data.id)}')">${t('txt_ph_delete_profile')}</button>`;
  html += `<button type="button" class="btn btn-sm" onclick="phCloseDetail()">✕ ${t('txt_txt_close')}</button>`;
  html += '</div>';
  html += '</div>';

  // Profile info
  html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:0.3rem 1rem;font-size:0.88rem;margin-bottom:1rem">';
  const passDisplay = data.is_ghost
    ? `<span style="color:var(--text-muted)" title="${t('txt_ph_ghost_no_passphrase')}">—</span>`
    : `<code class="player-codes-passphrase" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(data.passphrase)}</code> <button type="button" class="btn btn-sm btn-muted" onclick="phResetPassphrase('${escAttr(data.id)}')" style="font-size:0.76rem;padding:0.15rem 0.4rem">${_ic('reset')} ${t('txt_ph_reset')}</button>`;
  html += `<strong>${t('txt_txt_passphrase')}:</strong><span>${passDisplay}</span>`;
  html += `<strong>${t('txt_ph_name')}:</strong><span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap"><input type="text" id="ph-name-input" value="${escAttr(data.name || '')}" style="flex:1;min-width:180px;padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"><button type="button" class="btn btn-sm" onclick="phUpdateName('${escAttr(data.id)}')" id="ph-name-save-btn">${t('txt_txt_save')}</button></span>`;
  html += `<strong>${t('txt_txt_email')}:</strong><span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap"><input type="email" id="ph-email-input" value="${escAttr(data.email || '')}" style="flex:1;min-width:180px;padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"><button type="button" class="btn btn-sm" onclick="phUpdateEmail('${escAttr(data.id)}')" id="ph-email-save-btn">${t('txt_txt_save')}</button></span>`;
  html += `<strong>${t('txt_txt_contact')}:</strong><span>${esc(data.contact || t('txt_txt_contact_not_set'))}</span>`;
  html += `<strong>${t('txt_ph_created')}:</strong><span>${_phFormatDate(data.created_at)}</span>`;
  html += '</div>';

  // ELO ratings
  html += '<div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1rem">';
  if (data.elo_padel_matches > 0) {
    html += `<div style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-size:0.88rem">`;
    html += `<strong>${t('txt_ph_padel_elo')}:</strong> ${Math.round(data.elo_padel)} <span style="color:var(--text-muted)">(${data.elo_padel_matches} ${t('txt_txt_matches').toLowerCase()})</span></div>`;
  }
  if (data.elo_tennis_matches > 0) {
    html += `<div style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-size:0.88rem">`;
    html += `<strong>${t('txt_ph_tennis_elo')}:</strong> ${Math.round(data.elo_tennis)} <span style="color:var(--text-muted)">(${data.elo_tennis_matches} ${t('txt_txt_matches').toLowerCase()})</span></div>`;
  }
  if (data.elo_padel_matches === 0 && data.elo_tennis_matches === 0) {
    html += `<span style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_no_elo')}</span>`;
  }
  html += '</div>';

  // K-factor override
  const kVal = data.k_factor_override != null ? data.k_factor_override : '';
  html += '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;font-size:0.88rem">';
  html += `<strong>${t('txt_ph_kfactor_override')}:</strong>`;
  html += `<input type="number" id="ph-kfactor-input" value="${escAttr(String(kVal))}" placeholder="${t('txt_ph_auto')}" min="1" max="200" style="width:80px;padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">`;
  html += `<button type="button" class="btn btn-sm" onclick="phUpdateKFactor('${escAttr(data.id)}')" id="ph-kfactor-save-btn">${t('txt_txt_save')}</button>`;
  html += `<span style="color:var(--text-muted);font-size:0.8rem">${t('txt_ph_kfactor_auto_help')}</span>`;
  html += '</div>';

  // New passphrase result area
  html += '<div id="ph-passphrase-result"></div>';
  html += '<div id="ph-inline-msg"></div>';

  // Active participations
  html += `<h3 style="margin:1rem 0 0.5rem;font-size:0.95rem">${t('txt_ph_active_participations_n', { n: active.length })}</h3>`;
  if (active.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_no_active_links')}</p>`;
  } else {
    html += _phParticipationTable(active, data.id, false);
  }

  // Finished participations
  html += `<h3 style="margin:1rem 0 0.5rem;font-size:0.95rem">${t('txt_ph_finished_participations_n', { n: finished.length })}</h3>`;
  if (finished.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_no_finished_history')}</p>`;
  } else {
    html += _phParticipationTable(finished, data.id, true);
  }

  // Link new participation
  html += '<div style="margin-top:1rem">';
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
      html += `<td class="player-codes-cell-center">${p.wins}/${p.losses}/${p.draws}</td>`;
      html += `<td class="player-codes-cell-center">${p.points_for}/${p.points_against}</td>`;
    }
    const unlinkLabel = isFinished ? `${_antIc('warning')} ${t('txt_ph_unlink')}` : t('txt_ph_unlink');
    const btnClass = isFinished ? 'btn btn-danger btn-sm' : 'btn btn-sm btn-muted';
    html += `<td class="player-codes-cell-center"><button type="button" class="${btnClass}" onclick="phUnlink('${escAttr(p.tournament_id)}','${escAttr(p.player_id)}',${isFinished})" style="font-size:0.78rem">${unlinkLabel}</button></td>`;
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
      <p style="margin:0 0 0.5rem;font-size:0.88rem;font-weight:600">${t('txt_ph_convert_ghost_title')}</p>
      <p style="margin:0 0 0.65rem;font-size:0.82rem;color:var(--text-muted)">${t('txt_ph_convert_ghost_help')}</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:0.84rem;display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:140px">
          ${t('txt_txt_name')}
          <input type="text" id="ph-convert-name" value="${escAttr(suggestedName)}"
            style="padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"
            aria-label="${t('txt_txt_name')}">
        </label>
        <label style="font-size:0.84rem;display:flex;flex-direction:column;gap:0.2rem;flex:2;min-width:180px">
          ${t('txt_txt_email')} <span style="font-weight:400;color:var(--text-muted)">(${t('txt_txt_optional')})</span>
          <input type="email" id="ph-convert-email" placeholder="${t('txt_ph_convert_email_placeholder')}"
            style="padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"
            aria-label="${t('txt_txt_email')}">
        </label>
        <button type="button" class="btn btn-success btn-sm" onclick="phConvertGhost('${escAttr(profileId)}')">${t('txt_ph_convert_confirm')}</button>
        <button type="button" class="btn btn-sm btn-muted" onclick="phCloseDetail()">${t('txt_txt_cancel')}</button>
      </div>
      <div id="ph-convert-msg" style="margin-top:0.5rem;font-size:0.82rem"></div>
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
        <div class="card alert alert-info" style="margin-top:0.5rem">
          <strong>${t('txt_ph_convert_ok', { name: esc(result.name) })}</strong><br>
          <span style="font-size:0.84rem">${t('txt_ph_convert_passphrase_label')}: </span>
          <code class="player-codes-passphrase" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code>
          ${result.email ? `<br><span style="font-size:0.8rem;color:var(--text-muted)">${t('txt_ph_convert_email_sent', { email: esc(result.email) })}</span>` : ''}
        </div>`;
      setTimeout(() => { const d = document.getElementById('ph-detail'); if (d) { d.style.display = 'none'; d.innerHTML = ''; } }, 12000);
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--error)">${esc(e.message)}</span>`;
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
  area.innerHTML = `<div class="alert ${isError ? 'alert-error' : 'alert-info'}" style="margin-bottom:0.75rem">${esc(message)}</div>`;
}

/** Reset a profile's passphrase */
async function phResetPassphrase(profileId) {
  if (!confirm(t('txt_ph_reset_passphrase_confirm'))) return;
  try {
    const result = await api(`/api/admin/player-profiles/${profileId}/reset-passphrase`, { method: 'POST' });
    const area = document.getElementById('ph-passphrase-result');
    if (area) {
      area.innerHTML = `<div class="alert alert-info" style="margin-bottom:0.75rem">${t('txt_ph_new_passphrase')}: <code class="player-codes-passphrase" style="font-size:1.05rem" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code></div>`;
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
    if (btn) { btn.disabled = false; btn.textContent = `${t('txt_txt_saved')} ✓`; }
    setTimeout(() => { if (btn) btn.textContent = t('txt_txt_save'); }, 1500);
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
    if (btn) { btn.disabled = false; btn.textContent = `${t('txt_txt_saved')} ✓`; }
    setTimeout(() => { if (btn) btn.textContent = t('txt_txt_save'); }, 1500);
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
    if (btn) { btn.disabled = false; btn.textContent = `${t('txt_txt_saved')} ✓`; }
    setTimeout(() => { if (btn) btn.textContent = t('txt_txt_save'); }, 1500);
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
  area.innerHTML = `<div style="margin-top:0.75rem"><em>${t('txt_ph_loading_tournaments')}</em></div>`;
  try {
    const tournaments = await api('/api/tournaments');
    if (tournaments.length === 0) {
      area.innerHTML = `<div style="margin-top:0.75rem"><p style="color:var(--text-muted)">${t('txt_txt_no_tournaments_available')}.</p></div>`;
      return;
    }
    let html = '<div style="margin-top:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface)">';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem"><strong style="font-size:0.88rem">${t('txt_ph_link_participation')}</strong>`;
    html += `<button type="button" class="btn btn-sm" onclick="document.getElementById('ph-link-area').innerHTML=''">✕</button></div>`;
    html += '<div style="margin-bottom:0.5rem">';
    html += `<label style="font-size:0.84rem;color:var(--text-muted)">${t('txt_ph_select_tournament')}</label>`;
    html += `<select id="ph-link-tid" style="width:100%;padding:0.35rem 0.5rem;font-size:0.88rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);margin-top:0.25rem" onchange="phLoadUnlinkedPlayers('${escAttr(profileId)}')">`;
    html += `<option value="">${t('txt_ph_choose')}</option>`;
    for (const tour of tournaments) {
      html += `<option value="${escAttr(tour.id)}">${esc(tour.name)} (${esc(tour.phase || tour.type)})</option>`;
    }
    html += '</select></div>';
    html += '<div id="ph-link-players"></div>';
    html += '</div>';
    area.innerHTML = html;
  } catch (e) {
    area.innerHTML = `<div class="alert alert-error" style="margin-top:0.75rem">${esc(e.message)}</div>`;
  }
}

/** Load unlinked players for a tournament */
async function phLoadUnlinkedPlayers(profileId) {
  const select = document.getElementById('ph-link-tid');
  const container = document.getElementById('ph-link-players');
  if (!select || !container) return;
  const tid = select.value;
  if (!tid) { container.innerHTML = ''; return; }
  container.innerHTML = `<em>${t('txt_ph_loading_players')}</em>`;
  try {
    const players = await api(`/api/admin/player-profiles/unlinked/${tid}`);
    if (players.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_all_players_already_linked')}</p>`;
      return;
    }
    let html = `<label style="font-size:0.84rem;color:var(--text-muted)">${t('txt_ph_select_player')}</label>`;
    html += `<select id="ph-link-pid" style="width:100%;padding:0.35rem 0.5rem;font-size:0.88rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);margin:0.25rem 0 0.5rem">`;
    for (const p of players) {
      html += `<option value="${escAttr(p.player_id)}">${esc(p.player_name)} (${esc(p.player_id.slice(0, 6))}…)</option>`;
    }
    html += '</select>';
    html += `<button type="button" class="btn btn-primary btn-sm" onclick="phSubmitLink('${escAttr(profileId)}')">${t('txt_ph_link')}</button>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

/** Submit the link */
async function phSubmitLink(profileId) {
  const tidSelect = document.getElementById('ph-link-tid');
  const pidSelect = document.getElementById('ph-link-pid');
  if (!tidSelect || !pidSelect) return;
  const tid = tidSelect.value;
  const pid = pidSelect.value;
  if (!tid || !pid) return;
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
