function _renderRegCollaboratorsSection(rid, collaborators) {
  const r = _regDetails[rid];
  if (!r) return '';
  const isOwner = r.owner === getAuthUsername();
  if (!isOwner && !isAdmin()) return '';

  const list = collaborators || [];

  let html = `<div class="collab-add-section">`;
  html += `<div class="fw-700 d-flex items-center gap-2 mb-2">`;
  html += `${_ic('users')} ${t('txt_txt_collaborators')}`;
  if (list.length > 0) html += ` <span class="fs-xs fw-normal text-muted">(${list.length})</span>`;
  html += `</div>`;
  html += `<p class="text-muted fs-sm mb-3">${t('txt_txt_collaborators_help')}</p>`;

  // Add co-editor input row
  html += `<div class="d-flex gap-2 mb-3 flex-wrap">`;
  html += `<input type="text" id="reg-collab-username-input-${esc(rid)}" placeholder="${t('txt_txt_add_collaborator_placeholder')}"`;
  html += ` list="reg-collab-username-suggestions-${esc(rid)}" autocomplete="off"`;
  html += ` class="collab-add-input"`;
  html += ` oninput="_onRegCollabInput('${esc(rid)}', this.value)" onkeydown="if(event.key==='Enter')_addRegCollaborator('${esc(rid)}')">`;
  html += `<datalist id="reg-collab-username-suggestions-${esc(rid)}"></datalist>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_addRegCollaborator('${esc(rid)}')">+ ${t('txt_txt_add_collaborator_btn')}</button>`;
  html += `</div>`;
  html += `<div id="reg-collab-error-${esc(rid)}" class="text-error fs-sm mb-2" style="display:none"></div>`;

  // Current co-editors list
  html += `<div id="reg-collab-list-${esc(rid)}">`;
  if (list.length === 0) {
    html += `<p class="empty-list-note">${t('txt_txt_no_collaborators')}</p>`;
  } else {
    for (const username of list) {
      html += `<div class="collab-row">`;
      html += `<span class="fs-lg">${_ic('user')} ${esc(username)}</span>`;
      html += `<button type="button" class="btn btn-danger btn-sm btn-compact fs-2xs"`;
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
 * Body-only collaborators panel for the unified Settings card.
 * Returns the help text + add row + list without the outer
 * `<details class="card">` wrapper. Returns '' for non-owners / non-admins.
 */
function _renderCollaboratorsBody(collaborators) {
  if (!currentTid) return '';
  const isOwner = _tournamentMeta[currentTid]?.owner === getAuthUsername();
  if (!isOwner && !isAdmin()) return '';

  const list = collaborators || [];
  let html = '';
  html += `<p class="settings-help settings-help--explain mt-0">${t('txt_txt_collaborators_help')}</p>`;

  html += `<div class="settings-inline-row mb-2">`;
  html += `<input type="text" id="collab-username-input" placeholder="${t('txt_txt_add_collaborator_placeholder')}"`;
  html += ` list="collab-username-suggestions" autocomplete="off"`;
  html += ` class="collab-add-input"`;
  html += ` oninput="_onCollabInput(this.value)" onkeydown="if(event.key==='Enter')_addCollaborator()">`;
  html += `<datalist id="collab-username-suggestions"></datalist>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_addCollaborator()">+ ${t('txt_txt_add_collaborator_btn')}</button>`;
  html += `</div>`;
  html += `<div id="collab-error" class="text-error fs-sm mb-2" style="display:none"></div>`;

  html += `<div id="collaborators-list">`;
  if (list.length === 0) {
    html += `<p class="empty-list-note empty-list-note--tight">${t('txt_txt_no_collaborators')}</p>`;
  } else {
    for (const username of list) {
      html += `<div class="collab-row">`;
      html += `<span class="fs-lg">${_ic('user')} ${esc(username)}</span>`;
      html += `<button type="button" class="btn btn-danger btn-sm btn-compact fs-2xs"`;
      html += ` onclick="_removeCollaborator('${escAttr(username)}')">✕ ${t('txt_txt_remove')}</button>`;
      html += `</div>`;
    }
  }
  html += `</div>`;
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
    case 'refreshCurrentView': _refreshCurrentView(); break;
    case 'openFormatInfo': openFormatInfo(); break;
    case 'openContextInfo': openContextInfo(el.dataset.context); break;
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
    case 'hideAcceptInviteDialog': hideAcceptInviteDialog(); break;
    case 'hideResetPasswordDialog': hideResetPasswordDialog(); break;
  }
});
