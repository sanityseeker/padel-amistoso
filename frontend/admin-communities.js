/**
 * admin-communities.js — Community management panel.
 *
 * Handles:
 *  - Listing, creating, renaming, and deleting communities
 *  - Setting the current user's default community
 *  - Reassigning tournaments and registration lobbies to communities
 */

// ─── State ────────────────────────────────────────────────

let _communities = [];        // { id, name }
let _allTournaments = [];     // from GET /api/tournaments
let _allRegistrations = [];   // from GET /api/registrations

// ─── Entry point ─────────────────────────────────────────

/**
 * Load (or reload) all data for the communities panel.
 * Called automatically when the user navigates to the communities tab.
 */
async function loadCommunitiesPanel() {
  await Promise.all([
    _commLoadCommunities(),
    _commLoadTournaments(),
    _commLoadRegistrations(),
  ]);
  _commRenderMyDefault();
  _commRenderList();
  _commRenderTournaments();
  _commRenderRegistrations();
}

// ─── Data loaders ────────────────────────────────────────

async function _commLoadCommunities() {
  try {
    _communities = await apiAuth('/api/communities');
  } catch (e) {
    console.warn('Failed to load communities:', e);
    _communities = [];
  }
}

async function _commLoadTournaments() {
  try {
    _allTournaments = await apiAuth('/api/tournaments');
  } catch (e) {
    console.warn('Failed to load tournaments:', e);
    _allTournaments = [];
  }
}

async function _commLoadRegistrations() {
  try {
    _allRegistrations = await apiAuth('/api/registrations');
  } catch (e) {
    console.warn('Failed to load registrations:', e);
    _allRegistrations = [];
  }
}

// ─── My default community ─────────────────────────────────

function _commRenderMyDefault() {
  const card = document.getElementById('comm-my-default-card');
  const sel = document.getElementById('comm-my-default-select');
  if (!sel) return;
  // Step 2: hide the entire card when no specialized communities exist
  const specialized = _communities.filter(c => !c.is_builtin);
  if (!specialized.length) {
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';
  const current = getAuthDefaultCommunity ? getAuthDefaultCommunity() : 'open';
  sel.innerHTML = specialized.map(c =>
    `<option value="${esc(c.id)}" ${c.id === current ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
}

async function commSaveMyDefault() {
  const sel = document.getElementById('comm-my-default-select');
  const msgEl = document.getElementById('comm-my-default-msg');
  if (!sel) return;
  const community_id = sel.value;
  try {
    const result = await apiAuth('/api/auth/me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ default_community_id: community_id }),
    });
    // Update cached default
    try { localStorage.setItem('padel-auth-default-community', result.default_community_id); } catch (_) {}
    // Also update the community creation dropdown to reflect the new default
    _refreshCreateCommunityDropdown(community_id);
    if (msgEl) { msgEl.style.color = 'var(--green)'; msgEl.textContent = `\u2713 ${t('txt_comm_saved')}`; setTimeout(() => { msgEl.textContent = ''; }, 2500); }
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = e.message; }
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

// ─── Community CRUD ───────────────────────────────────────

function _commRenderList() {
  const container = document.getElementById('comm-list');
  if (!container) return;

  const global = _communities.find(c => c.is_builtin);
  const specialized = _communities.filter(c => !c.is_builtin);

  let html = '';

  // Global default — always shown as a distinct read-only card.
  if (global) {
    html += `
      <div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.6rem;margin-bottom:0.75rem;
                  background:var(--bg-alt,#f5f5f5);border:1px solid var(--border);border-radius:6px">
        <span style="font-weight:600;font-size:0.9rem">🌐 ${t('txt_comm_global')}</span>
        <span style="font-size:0.78rem;color:var(--text-muted)">— ${t('txt_comm_global_desc')}</span>
        <span style="margin-left:auto;font-size:0.72rem;color:var(--text-muted);padding:0.15rem 0.4rem;
                    border:1px solid var(--border);border-radius:4px;white-space:nowrap">${t('txt_comm_builtin_badge')}</span>
      </div>`;
  }

  if (!specialized.length) {
    html += `<p class="muted-note" style="margin-top:0.25rem">${t('txt_comm_no_communities')}</p>`;
  } else {
    html += `
      <div class="player-codes-table-wrap"><table class="player-codes-table">
        <thead>
          <tr class="player-codes-head-row">
            <th class="player-codes-th">${t('txt_comm_col_name')}</th>
            <th class="player-codes-th" style="color:var(--text-muted)">${t('txt_comm_col_id')}</th>
            <th class="player-codes-th"></th>
          </tr>
        </thead>
        <tbody>
          ${specialized.map(c => `
            <tr id="comm-row-${esc(c.id)}" class="player-codes-row">
              <td class="player-codes-name" style="font-weight:normal">
                <span id="comm-name-${esc(c.id)}">${esc(c.name)}</span>
              </td>
              <td class="player-codes-cell" style="color:var(--text-muted);font-size:0.8rem;font-family:monospace">${esc(c.id)}</td>
              <td id="comm-actions-${esc(c.id)}" class="player-codes-cell-center" style="white-space:nowrap">
                <button class="btn btn-sm player-codes-icon-btn" onclick="commStartRename('${esc(c.id)}')" style="margin-right:0.25rem" title="${t('txt_comm_rename')}">✏️</button>
                <button class="btn btn-sm btn-danger player-codes-icon-btn" onclick="commDelete('${esc(c.id)}')" title="${t('txt_txt_remove')}">🗑</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>`;
  }

  container.innerHTML = html;
}

async function commCreate() {
  const input = document.getElementById('comm-new-name');
  const msgEl = document.getElementById('comm-msg');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = t('txt_comm_name_required'); } return; }
  try {
    await apiAuth('/api/communities', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    input.value = '';
    if (msgEl) { msgEl.style.color = 'var(--green)'; msgEl.textContent = `\u2713 ${t('txt_comm_created').replace('{name}', name)}`; setTimeout(() => { msgEl.textContent = ''; }, 2500); }
    await _commLoadCommunities();
    _commRenderList();
    _commRenderMyDefault();
    // Re-render assignment tables with fresh community options
    _commRenderTournaments();
    _commRenderRegistrations();
    // Refresh the create panel dropdown
    if (typeof _loadCommunities === 'function') _loadCommunities();
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = e.message; }
  }
}

// Step 5: Inline rename — replaces the name span with an input field in-place.
function commStartRename(id) {
  const community = _communities.find(c => c.id === id);
  if (!community) return;
  const nameEl = document.getElementById(`comm-name-${id}`);
  const actionsEl = document.getElementById(`comm-actions-${id}`);
  if (!nameEl || !actionsEl) return;
  nameEl.outerHTML = `<input id="comm-rename-input-${esc(id)}" type="text" value="${esc(community.name)}"
    style="padding:0.2rem 0.4rem;font-size:0.88rem;border:1px solid var(--border);border-radius:4px;
           background:var(--surface);color:var(--text);width:100%;max-width:200px"
    onkeydown="if(event.key==='Enter')commConfirmRename('${esc(id)}');if(event.key==='Escape')_commRenderList()">`;
  actionsEl.innerHTML = `
    <button class="btn btn-sm btn-primary" onclick="commConfirmRename('${esc(id)}')" style="padding:0.2rem 0.5rem;margin-right:0.25rem" title="${t('txt_txt_save')}">✓</button>
    <button class="btn btn-sm" onclick="_commRenderList()" style="padding:0.2rem 0.5rem" title="${t('txt_txt_cancel')}">✕</button>`;
  document.getElementById(`comm-rename-input-${id}`)?.focus();
}

async function commConfirmRename(id) {
  const input = document.getElementById(`comm-rename-input-${id}`);
  if (!input) return;
  const newName = input.value.trim();
  const community = _communities.find(c => c.id === id);
  if (!newName || newName === community?.name) { _commRenderList(); return; }
  const msgEl = document.getElementById('comm-msg');
  try {
    await apiAuth(`/api/communities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });
    if (msgEl) { msgEl.style.color = 'var(--green)'; msgEl.textContent = `\u2713 ${t('txt_comm_renamed').replace('{name}', newName)}`; setTimeout(() => { msgEl.textContent = ''; }, 2500); }
    await _commLoadCommunities();
    _commRenderList();
    _commRenderMyDefault();
    _commRenderTournaments();
    _commRenderRegistrations();
    if (typeof _loadCommunities === 'function') _loadCommunities();
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = e.message; }
    _commRenderList();
  }
}

async function commDelete(id) {
  const community = _communities.find(c => c.id === id);
  if (!community) return;
  if (!confirm(t('txt_comm_delete_confirm').replace('{name}', community.name))) return;
  const msgEl = document.getElementById('comm-msg');
  try {
    await apiAuth(`/api/communities/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (msgEl) { msgEl.style.color = 'var(--green)'; msgEl.textContent = `\u2713 ${t('txt_comm_deleted')}`; setTimeout(() => { msgEl.textContent = ''; }, 2500); }
    await Promise.all([_commLoadCommunities(), _commLoadTournaments(), _commLoadRegistrations()]);
    _commRenderList();
    _commRenderMyDefault();
    _commRenderTournaments();
    _commRenderRegistrations();
    if (typeof _loadCommunities === 'function') _loadCommunities();
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = e.message; }
  }
}

// ─── Tournament assignment ────────────────────────────────

function _commRenderTournaments() {
  const container = document.getElementById('comm-tournament-list');
  if (!container) return;
  if (!_allTournaments.length) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem">${t('txt_comm_no_tournaments')}</p>`;
    return;
  }
  // Step 6: sort alphabetically by name
  const sorted = [..._allTournaments].sort((a, b) => a.name.localeCompare(b.name));
  container.innerHTML = `
    <div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_comm_col_tournament')}</th>
          <th class="player-codes-th">${t('txt_comm_col_community')}</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(tournament => `
          <tr class="player-codes-row">
            <td class="player-codes-name" style="font-weight:normal">
              <strong>${esc(tournament.name)}</strong>
              <span style="font-size:0.78rem;color:var(--text-muted);margin-left:0.4rem">${esc(tournament.type)}</span>
            </td>
            <td class="player-codes-cell">
              <select id="comm-t-sel-${esc(tournament.id)}" class="admin-sel"
                onchange="commAssignTournament('${esc(tournament.id)}')">
                ${_communities.map(c => `<option value="${esc(c.id)}" ${c.id === (tournament.community_id || 'open') ? 'selected' : ''}>${c.is_builtin ? t('txt_comm_global_default') : esc(c.name)}</option>`).join('')}
              </select>
              <span id="comm-t-msg-${esc(tournament.id)}" style="font-size:0.78rem;margin-left:0.3rem"></span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
}

async function commAssignTournament(tid) {
  const sel = document.getElementById(`comm-t-sel-${tid}`);
  const msgEl = document.getElementById(`comm-t-msg-${tid}`);
  if (!sel) return;
  try {
    const res = await apiAuth(`/api/tournaments/${encodeURIComponent(tid)}/community`, {
      method: 'PATCH',
      body: JSON.stringify({ community_id: sel.value }),
    });
    // Update local state
    const t = _allTournaments.find(t => t.id === tid);
    if (t) {
      t.community_id = res?.community_id ?? sel.value;
      if (res && 'club_id' in res) t.club_id = res.club_id;
      if (res && 'season_id' in res) t.season_id = res.season_id;
    }
    if (msgEl) { msgEl.style.color = 'var(--green)'; msgEl.textContent = '✓'; setTimeout(() => { msgEl.textContent = ''; }, 2000); }
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = e.message; }
  }
}

// ─── Registration assignment ──────────────────────────────

function _commRenderRegistrations() {
  const container = document.getElementById('comm-registration-list');
  if (!container) return;
  if (!_allRegistrations.length) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem">${t('txt_comm_no_registrations')}</p>`;
    return;
  }
  // Step 6: sort alphabetically by name
  const sortedR = [..._allRegistrations].sort((a, b) => a.name.localeCompare(b.name));
  container.innerHTML = `
    <div class="player-codes-table-wrap"><table class="player-codes-table">
      <thead>
        <tr class="player-codes-head-row">
          <th class="player-codes-th">${t('txt_comm_col_lobby')}</th>
          <th class="player-codes-th">${t('txt_comm_col_community')}</th>
        </tr>
      </thead>
      <tbody>
        ${sortedR.map(r => `
          <tr class="player-codes-row">
            <td class="player-codes-name" style="font-weight:normal">
              <strong>${esc(r.name)}</strong>
              ${r.archived ? `<span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.3rem">${t('txt_comm_archived')}</span>` : ''}
            </td>
            <td class="player-codes-cell">
              <select id="comm-r-sel-${esc(r.id)}" class="admin-sel"
                onchange="commAssignRegistration('${esc(r.id)}')">
                ${_communities.map(c => `<option value="${esc(c.id)}" ${c.id === (r.community_id || 'open') ? 'selected' : ''}>${c.is_builtin ? t('txt_comm_global_default') : esc(c.name)}</option>`).join('')}
              </select>
              <span id="comm-r-msg-${esc(r.id)}" style="font-size:0.78rem;margin-left:0.3rem"></span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
}

async function commAssignRegistration(rid) {
  const sel = document.getElementById(`comm-r-sel-${rid}`);
  const msgEl = document.getElementById(`comm-r-msg-${rid}`);
  if (!sel) return;
  try {
    const res = await apiAuth(`/api/registrations/${encodeURIComponent(rid)}/community`, {
      method: 'PATCH',
      body: JSON.stringify({ community_id: sel.value }),
    });
    // Update local state
    const r = _allRegistrations.find(r => r.id === rid);
    if (r) {
      r.community_id = res?.community_id ?? sel.value;
      if (res && 'club_id' in res) r.club_id = res.club_id;
      if (res && 'season_id' in res) r.season_id = res.season_id;
    }
    if (msgEl) { msgEl.style.color = 'var(--green)'; msgEl.textContent = '✓'; setTimeout(() => { msgEl.textContent = ''; }, 2000); }
  } catch (e) {
    if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = e.message; }
  }
}
