function _renderRegCollaboratorsSection(rid, collaborators) {
  const r = _regDetails[rid];
  if (!r) return '';
  const isOwner = r.owner === getAuthUsername();
  if (!isOwner && !isAdmin()) return '';

  const list = collaborators || [];

  let html = `<div style="margin-top:0.9rem;padding-top:0.75rem;border-top:1px solid var(--border)">`;
  html += `<div style="font-weight:700;display:flex;align-items:center;gap:0.45rem;margin-bottom:0.55rem">`;
  html += `👥 ${t('txt_txt_collaborators')}`;
  if (list.length > 0) html += ` <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">(${list.length})</span>`;
  html += `</div>`;
  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.75rem">${t('txt_txt_collaborators_help')}</p>`;

  // Add co-editor input row
  html += `<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">`;
  html += `<input type="text" id="reg-collab-username-input-${esc(rid)}" placeholder="${t('txt_txt_add_collaborator_placeholder')}"`;
  html += ` list="reg-collab-username-suggestions-${esc(rid)}" autocomplete="off"`;
  html += ` style="flex:1;min-width:180px;font-size:0.85rem"`;
  html += ` oninput="_onRegCollabInput('${esc(rid)}', this.value)" onkeydown="if(event.key==='Enter')_addRegCollaborator('${esc(rid)}')">`;
  html += `<datalist id="reg-collab-username-suggestions-${esc(rid)}"></datalist>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_addRegCollaborator('${esc(rid)}')">+ ${t('txt_txt_add_collaborator_btn')}</button>`;
  html += `</div>`;
  html += `<div id="reg-collab-error-${esc(rid)}" style="color:var(--danger,#ef4444);font-size:0.82rem;margin-bottom:0.5rem;display:none"></div>`;

  // Current co-editors list
  html += `<div id="reg-collab-list-${esc(rid)}">`;
  if (list.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_txt_no_collaborators')}</p>`;
  } else {
    for (const username of list) {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border)">`;
      html += `<span style="font-size:0.9rem">👤 ${esc(username)}</span>`;
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem"`;
      html += ` onclick="_removeRegCollaborator('${esc(rid)}', '${escAttr(username)}')">✕ ${t('txt_txt_remove')}</button>`;
      html += `</div>`;
    }
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}

const _regCollabSearchTimers = {};
function _onRegCollabInput(rid, value) {
  clearTimeout(_regCollabSearchTimers[rid]);
  const dl = document.getElementById(`reg-collab-username-suggestions-${rid}`);
  if (!dl) return;
  if (value.length < 2) { dl.innerHTML = ''; return; }
  _regCollabSearchTimers[rid] = setTimeout(async () => {
    try {
      const results = await api(`/api/auth/users/search?q=${encodeURIComponent(value)}`);
      dl.innerHTML = results.map(u => `<option value="${u.replace(/"/g, '&quot;')}">`).join('');
    } catch (_) { /* silently ignore search errors */ }
  }, 200);
}

async function _addRegCollaborator(rid) {
  const input = document.getElementById(`reg-collab-username-input-${rid}`);
  const errEl = document.getElementById(`reg-collab-error-${rid}`);
  if (!input) return;
  const username = input.value.trim();
  if (!username) return;
  if (errEl) errEl.style.display = 'none';
  try {
    const result = await api(`/api/registrations/${rid}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    input.value = '';
    _regCollaborators[rid] = result.collaborators || [];
    _renderRegDetailInline(rid);
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    else alert(e.message);
  }
}

async function _removeRegCollaborator(rid, username) {
  if (!confirm(t('txt_txt_confirm_remove_collab', { username }))) return;
  try {
    const result = await api(`/api/registrations/${rid}/collaborators/${encodeURIComponent(username)}`, { method: 'DELETE' });
    _regCollaborators[rid] = result.collaborators || [];
    _renderRegDetailInline(rid);
  } catch (e) {
    alert(e.message);
  }
}

// ─── Collaborators / Sharing ─────────────────────────────

/**
 * Render the Collaborators management card.
 * Only visible to the tournament owner and site admins — co-editors cannot
 * modify the share list.
 */
function _renderCollaboratorsSection(collaborators) {
  if (!currentTid) return '';
  const isOwner = _tournamentMeta[currentTid]?.owner === getAuthUsername();
  if (!isOwner && !isAdmin()) return '';

  const list = collaborators || [];

  let html = `<details class="card" id="collaborators-panel">`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem">`;
  html += `<span class="tv-chevron" style="display:inline-block;transition:transform 0.18s;font-size:0.7em;color:var(--text-muted)">▸</span>`;
  html += ` 👥 ${t('txt_txt_collaborators')}`;
  if (list.length > 0) html += ` <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">(${list.length})</span>`;
  html += `</span></summary>`;
  html += `<div style="margin-top:0.65rem">`;
  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.75rem">${t('txt_txt_collaborators_help')}</p>`;

  // Add co-editor input row
  html += `<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">`;
  html += `<input type="text" id="collab-username-input" placeholder="${t('txt_txt_add_collaborator_placeholder')}"`;
  html += ` list="collab-username-suggestions" autocomplete="off"`;
  html += ` style="flex:1;min-width:180px;font-size:0.85rem"`;
  html += ` oninput="_onCollabInput(this.value)" onkeydown="if(event.key==='Enter')_addCollaborator()">`;
  html += `<datalist id="collab-username-suggestions"></datalist>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_addCollaborator()">+ ${t('txt_txt_add_collaborator_btn')}</button>`;
  html += `</div>`;
  html += `<div id="collab-error" style="color:var(--danger,#ef4444);font-size:0.82rem;margin-bottom:0.5rem;display:none"></div>`;

  // Current co-editors list
  html += `<div id="collaborators-list">`;
  if (list.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_txt_no_collaborators')}</p>`;
  } else {
    for (const username of list) {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border)">`;
      html += `<span style="font-size:0.9rem">👤 ${esc(username)}</span>`;
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem"`;
      html += ` onclick="_removeCollaborator('${escAttr(username)}')">✕ ${t('txt_txt_remove')}</button>`;
      html += `</div>`;
    }
  }
  html += `</div>`;
  html += `</div></details>`;
  return html;
}

let _collabSearchTimer = null;
function _onCollabInput(value) {
  clearTimeout(_collabSearchTimer);
  const dl = document.getElementById('collab-username-suggestions');
  if (!dl) return;
  if (value.length < 2) { dl.innerHTML = ''; return; }
  _collabSearchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/auth/users/search?q=${encodeURIComponent(value)}`);
      dl.innerHTML = results.map(u => `<option value="${u.replace(/"/g, '&quot;')}">`).join('');
    } catch (_) { /* silently ignore search errors */ }
  }, 200);
}

async function _addCollaborator() {
  const input = document.getElementById('collab-username-input');
  const errEl = document.getElementById('collab-error');
  if (!input || !currentTid) return;
  const username = input.value.trim();
  if (!username) return;
  if (errEl) errEl.style.display = 'none';
  try {
    await api(`/api/tournaments/${currentTid}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    input.value = '';
    _refreshCurrentView();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    else alert(e.message);
  }
}

async function _removeCollaborator(username) {
  if (!confirm(t('txt_txt_confirm_remove_collab', { username }))) return;
  try {
    await api(`/api/tournaments/${currentTid}/collaborators/${encodeURIComponent(username)}`, { method: 'DELETE' });
    _refreshCurrentView();
  } catch (e) {
    alert(e.message);
  }
}

// ── Event delegation for static HTML actions ────────────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'toggleLanguage': toggleLanguage(); break;
    case 'togglePageSelector': togglePageSelector(); break;
    case 'toggleHomePin': _toggleAdminHomePin(); break;
    case 'toggleTheme': toggleTheme(); break;
    case 'refreshCurrentView': _refreshCurrentView(); break;
    case 'openFormatInfo': openFormatInfo(); break;
    case 'setSport': setSport(el.dataset.sport); break;
    case 'setCreateMode': setCreateMode(el.dataset.tab); break;
    case 'setEntryMode': setEntryMode(el.dataset.entryCtx, el.dataset.entryMode); break;
    case 'clearParticipants': clearParticipants(el.dataset.ctx); break;
    case 'togglePasteMode': togglePasteMode(el.dataset.ctx); break;
    case 'addParticipantField': addParticipantField(el.dataset.ctx); break;
    case 'withLoading': withLoading(el, window[el.dataset.handler]); break;
    case 'setMexRoundsMode': _setMexRoundsMode(el.dataset.roundsMode); break;
    case 'applySchemaPreset': _applySchemaPreset(el.dataset.preset); break;
    case 'generatePoPreviewSchema': generatePoPreviewSchema(); break;
    case 'generateSchema': generateSchema(); break;
    case 'closeFormatInfo': closeFormatInfo(); break;
    case 'closeBracketLightbox': _closeBracketLightbox(e); break;
    case 'stopPropagation': e.stopPropagation(); break;
    case 'bracketLightboxZoomOut': _bracketLightboxZoomOut(); break;
    case 'bracketLightboxZoomReset': _bracketLightboxZoomReset(); break;
    case 'bracketLightboxZoomIn': _bracketLightboxZoomIn(); break;
    case 'bracketLightboxOpenFull': _bracketLightboxOpenFull(); break;
    case 'bracketLightboxDownload': _bracketLightboxDownload(); break;
    case 'hideLoginDialog': hideLoginDialog(); break;
    case 'hideChangePasswordDialog': hideChangePasswordDialog(); break;
    case 'hideForgotPasswordDialog': hideForgotPasswordDialog(); break;
  }
});
