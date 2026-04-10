let _playerSecrets = {};

/** Fetch player secrets from the API and cache them */
async function _loadPlayerSecrets() {
  if (!currentTid) return {};
  try {
    const data = await api(`/api/tournaments/${currentTid}/player-secrets`);
    _playerSecrets = data.players || {};
    return _playerSecrets;
  } catch { _playerSecrets = {}; return {}; }
}

/**
 * Render the collapsible Player Codes panel for the admin view.
 * secrets is { player_id: { name, passphrase, token } }
 */
function _renderPlayerCodes(secrets) {
  if (!currentTid) return '';
  const entries = Object.entries(secrets || {});
  const _showEmail = window._emailConfigured;

  let html = `<details class="card" id="player-codes-panel">`;
  html += `<summary class="player-codes-summary">`;
  html += `<span class="player-codes-title"><span class="tv-chevron player-codes-chevron">▸</span> 🔑 ${t('txt_txt_player_codes')}</span>`;
  const _isMex = currentType === 'mexicano';
  const _isGP = currentType === 'group_playoff';
  if (entries.length > 0) {
    html += `<span class="player-codes-actions">`;
    html += `<button type="button" class="btn btn-sm player-codes-btn" onclick="event.preventDefault();_copyAllPlayerCodes()">📋 ${t('txt_txt_copy_all_codes')}</button>`;
    html += `<button type="button" class="btn btn-sm player-codes-btn" onclick="event.preventDefault();_printPlayerCodes()">🖨 ${t('txt_txt_print_all_codes')}</button>`;
    if (_showEmail) {
      html += `<button type="button" class="btn btn-sm player-codes-btn" onclick="event.preventDefault();_sendAllTournamentEmails()">📧 ${t('txt_email_send_all')}</button>`;
    }
    html += `</span>`;
  }
  html += `</summary>`;
  html += `<div class="player-codes-body">`;
  html += `<p class="player-codes-help">${t('txt_txt_player_codes_help')}</p>`;

  if (entries.length === 0) {
    html += `<p class="player-codes-empty">${t('txt_txt_no_player_codes')}</p>`;
  } else {
    html += `<div class="player-codes-table-wrap">`;
    html += `<table class="player-codes-table">`;
    html += `<thead><tr class="player-codes-head-row">`;
    html += `<th class="player-codes-th">${t('txt_txt_player')}</th>`;
    html += `<th class="player-codes-th">${t('txt_txt_passphrase')}</th>`;
    html += `<th class="player-codes-th">${t('txt_txt_contact')}</th>`;
    if (_showEmail) html += `<th class="player-codes-th">${t('txt_email')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_txt_qr_code')}</th>`;
    html += `<th class="player-codes-th-center"></th>`;
    html += `<th class="player-codes-th-center"></th>`;
    html += `</tr></thead><tbody>`;
    for (const [pid, info] of entries) {
      html += `<tr class="player-codes-row" id="pc-row-${pid}">`;
      html += `<td class="player-codes-name" id="pc-name-${pid}">${esc(info.name)}</td>`;
      html += `<td class="player-codes-cell"><code id="pc-pass-${pid}" class="player-codes-passphrase" onclick="navigator.clipboard.writeText(this.textContent)" title="Click to copy">${esc(info.passphrase)}</code></td>`;
      html += `<td class="player-codes-cell"><span class="player-codes-edit-wrap"><input type="text" id="pc-contact-${pid}" value="${escAttr(info.contact || '')}" placeholder="${t('txt_reg_contact_placeholder')}" class="player-codes-input"><button type="button" class="btn btn-sm player-codes-action-btn" onclick="_savePlayerContact('${pid}')" id="pc-contact-save-${pid}">${t('txt_txt_save_contact')}</button></span></td>`;
      if (_showEmail) {
        const _isLinked = Boolean(info.profile_id);
        html += `<td class="player-codes-cell"><span class="player-codes-edit-wrap"><input type="email" id="pc-email-${pid}" value="${escAttr(info.email || '')}" placeholder="${t('txt_email_placeholder')}" class="player-codes-input player-codes-input-email"><button type="button" class="btn btn-sm player-codes-action-btn" onclick="_savePlayerEmail('${pid}')" id="pc-email-save-${pid}">${t('txt_email_save_email')}</button>`;
        if (info.email) html += `<button type="button" class="btn btn-sm player-codes-icon-btn" onclick="_sendPlayerEmail('${pid}')" title="${t('txt_email_send')}">✉️</button>`;
        html += `<span id="pc-linked-${pid}" class="player-codes-linked-badge" title="${t('txt_email_profile_linked')}" ${_isLinked ? '' : 'hidden'}>🔗</span>`;
        html += `</span></td>`;
      }
      html += `<td class="player-codes-cell-center"><button type="button" class="btn btn-sm player-codes-action-btn" onclick="_showPlayerQr('${escAttr(pid)}','${escAttr(info.name)}')">📱 ${t('txt_txt_qr_code')}</button></td>`;
      html += `<td class="player-codes-cell-center"><button type="button" class="btn btn-sm btn-muted player-codes-action-btn" onclick="_regeneratePlayerCode('${pid}')">🔄 ${t('txt_txt_regenerate')}</button></td>`;
      html += `<td class="player-codes-cell-center">${_isMex ? `<button type="button" class="btn btn-danger btn-sm player-codes-icon-btn" onclick="_removeTournamentPlayer('${pid}','${escAttr(info.name)}')" title="${t('txt_txt_remove_player')}">🗑</button>` : ''}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;
  }

  if (_isMex || (_isGP && _gpCurrentPhase === 'groups')) {
    html += `<div class="player-codes-add-row"><button type="button" class="add-participant-btn" onclick="_addTournamentPlayer()">＋ ${t('txt_txt_add_player')}</button></div>`;
  }

  // Organizer message section (email only)
  if (_showEmail && entries.length > 0) {
    html += `<details class="player-codes-organizer">`;
    html += `<summary class="player-codes-organizer-summary"><span class="tv-chevron player-codes-organizer-chevron">▸</span> 📧 ${t('txt_email_organizer_message')}</summary>`;
    html += `<div class="player-codes-organizer-body">`;
    html += `<textarea id="pc-organizer-message" class="reg-desc-textarea player-codes-organizer-textarea" rows="3" placeholder="${t('txt_email_message_placeholder')}" oninput="_autoResizeTextarea(this)"></textarea>`;
    html += `<div class="player-codes-organizer-actions">`;
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendTournamentMessageEmails())">📧 ${t('txt_email_send_message')}</button>`;
    html += `</div></div></details>`;
  }

  html += `</div></details>`;
  return html;
}

/** Show a QR code in a modal dialog */
async function _showPlayerQr(playerId, playerName) {
  const imgUrl = `/api/tournaments/${currentTid}/player-secrets/qr/${playerId}?origin=${encodeURIComponent(window.location.origin)}`;
  // Fetch with auth
  try {
    const resp = await fetch(API + imgUrl, {
      headers: { 'Authorization': 'Bearer ' + getAuthToken() }
    });
    if (!resp.ok) throw new Error('Failed to load QR code');
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Build modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
    modal.onclick = (e) => { if (e.target === modal) { modal.remove(); URL.revokeObjectURL(objectUrl); } };
    modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;text-align:center;max-width:340px;width:100%">
      <h3 style="margin:0 0 0.5rem;font-size:1rem">${esc(playerName)}</h3>
      <img src="${objectUrl}" alt="QR" style="width:100%;max-width:260px;image-rendering:pixelated;border-radius:4px;background:#fff;padding:0.5rem">
      <p style="margin:0.75rem 0 0;color:var(--text-muted);font-size:0.8rem">${t('txt_txt_player_codes_help')}</p>
      <button type="button" class="btn btn-primary btn-sm" style="margin-top:0.75rem" onclick="this.closest('div[style*=fixed]').remove()">✕ ${t('txt_txt_close')}</button>
    </div>`;
    document.body.appendChild(modal);
  } catch (e) {
    alert(e.message);
  }
}

/** Refresh the current tournament view after player roster changes */
async function _refreshCurrentView() {
  const drafts = _captureViewDrafts();
  if (currentType === 'group_playoff') await renderGP();
  else if (currentType === 'playoff') await renderPO();
  else if (currentType === 'mexicano') await renderMex();
  _restoreViewDrafts(drafts);
}

/** Open an inline add-player form inside the specific group card. */
function _addPlayerToGroup(groupName) {
  const areaId = `gp-add-player-area-${groupName}`;
  const inputId = `gp-add-name-${groupName}`;
  const area = document.getElementById(areaId);
  if (!area) return;

  // Already open — just focus.
  if (document.getElementById(inputId)) {
    document.getElementById(inputId).focus();
    return;
  }

  // Replace the button with an inline input row.
  area.innerHTML = `
    <span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;margin-top:0.1rem">
      <input type="text" id="${escAttr(inputId)}"
        placeholder="${escAttr(t('txt_txt_add_player_prompt'))}"
        style="flex:1;min-width:150px;font-size:0.88rem;padding:0.3rem 0.5rem;border:2px solid var(--accent);border-radius:4px;background:var(--surface);color:var(--text)"
        maxlength="128">
      <button type="button" class="btn btn-primary btn-sm"
        style="font-size:0.78rem;padding:0.25rem 0.6rem;white-space:nowrap"
        onclick="_submitPlayerToGroup(${JSON.stringify(groupName)})">✓</button>
      <button type="button" class="btn btn-sm"
        style="font-size:0.78rem;padding:0.25rem 0.5rem"
        onclick="_cancelAddPlayerToGroup(${JSON.stringify(groupName)})">✕</button>
    </span>`;

  const input = document.getElementById(inputId);
  if (input) {
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitPlayerToGroup(groupName);
      else if (e.key === 'Escape') _cancelAddPlayerToGroup(groupName);
    });
  }
}

/** Restore the add-player button after cancelling. */
function _cancelAddPlayerToGroup(groupName) {
  const area = document.getElementById(`gp-add-player-area-${groupName}`);
  if (!area) return;
  area.innerHTML = `<button type="button" class="add-participant-btn" onclick="_addPlayerToGroup(${JSON.stringify(groupName)})">＋ ${t('txt_txt_add_player')}</button>`;
}

/** Submit a new player directly to a specific group. */
async function _submitPlayerToGroup(groupName) {
  const inputId = `gp-add-name-${groupName}`;
  const input = document.getElementById(inputId);
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  input.disabled = true;
  const area = document.getElementById(`gp-add-player-area-${groupName}`);
  if (area) area.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    await api(`/api/tournaments/${currentTid}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, group_name: groupName }),
    });
    const drafts = _captureViewDrafts();
    drafts['details:player-codes-panel'] = true;
    await renderGP();
    _restoreViewDrafts(drafts);
  } catch (e) {
    alert(e.message || t('txt_reg_error'));
    if (input) input.disabled = false;
    if (area) area.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

/** Add a new player to the running tournament — inline (no prompt) */
function _addTournamentPlayer() {
  const panel = document.getElementById('player-codes-panel');
  if (panel && !panel.open) panel.open = true;

  // If there's already a pending add row, just focus it
  if (document.getElementById('pc-new-row')) {
    document.getElementById('pc-new-name')?.focus();
    return;
  }

  let tbody = panel?.querySelector('table tbody');

  // If no table exists yet (0 players), create one
  if (!tbody) {
    const noMsg = panel?.querySelector('div > p');
    if (noMsg) noMsg.remove();
    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.84rem"><thead><tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_player')}</th><th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_passphrase')}</th><th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_contact')}</th><th style="text-align:center;padding:0.4rem 0.6rem">${t('txt_txt_qr_code')}</th><th></th><th></th></tr></thead><tbody></tbody></table>`;
    const addBtnDiv = panel?.querySelector('.add-participant-btn')?.parentElement;
    if (addBtnDiv) addBtnDiv.before(wrapper);
    else panel?.querySelector('div')?.appendChild(wrapper);
    tbody = wrapper.querySelector('tbody');
  }

  const isGP = currentType === 'group_playoff';
  const groupSelectHtml = isGP && _gpGroupNames.length
    ? `<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.82rem;white-space:nowrap;color:var(--text-muted)">${t('txt_txt_select_group')}
        <select id="pc-new-group" style="font-size:0.88rem;padding:0.28rem 0.4rem;border:2px solid var(--accent);border-radius:4px;background:var(--surface);color:var(--text)">
          ${_gpGroupNames.map(g => `<option value="${escAttr(g)}">${esc(g)}</option>`).join('')}
        </select></label>`
    : '';

  const newRow = document.createElement('tr');
  newRow.id = 'pc-new-row';
  newRow.style.borderBottom = '1px solid var(--border)';
  newRow.innerHTML = `<td style="padding:0.4rem 0.6rem" colspan="6">
    <span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
      <input type="text" id="pc-new-name" placeholder="${escAttr(t('txt_txt_add_player_prompt'))}" style="flex:1;min-width:150px;font-size:0.88rem;padding:0.3rem 0.5rem;border:2px solid var(--accent);border-radius:4px;background:var(--surface);color:var(--text)" maxlength="128">
      ${groupSelectHtml}
      <button type="button" class="btn btn-primary btn-sm" style="font-size:0.78rem;padding:0.25rem 0.6rem;white-space:nowrap" onclick="_submitNewPlayer()">✓</button>
      <button type="button" class="btn btn-sm" style="font-size:0.78rem;padding:0.25rem 0.5rem" onclick="document.getElementById('pc-new-row')?.remove()">✕</button>
    </span></td>`;
  tbody.appendChild(newRow);

  const input = document.getElementById('pc-new-name');
  if (input) {
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitNewPlayer();
      else if (e.key === 'Escape') newRow.remove();
    });
  }
}

/** Submit the inline new-player row */
async function _submitNewPlayer() {
  const input = document.getElementById('pc-new-name');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  // Disable to prevent double submit
  input.disabled = true;
  document.querySelectorAll('#pc-new-row button').forEach(b => b.disabled = true);

  try {
    const body = { name };
    if (currentType === 'group_playoff') {
      const groupSelect = document.getElementById('pc-new-group');
      if (groupSelect) body.group_name = groupSelect.value;
    }
    await api(`/api/tournaments/${currentTid}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Refresh view, keeping the player-codes panel open
    const drafts = _captureViewDrafts();
    drafts['details:player-codes-panel'] = true;
    if (currentType === 'group_playoff') await renderGP();
    else if (currentType === 'playoff') await renderPO();
    else if (currentType === 'mexicano') await renderMex();
    _restoreViewDrafts(drafts);
  } catch (e) {
    alert(e.message || t('txt_reg_error'));
    input.disabled = false;
    document.querySelectorAll('#pc-new-row button').forEach(b => b.disabled = false);
  }
}

/** Remove a player from the running tournament */
async function _removeTournamentPlayer(playerId, playerName) {
  if (!confirm(t('txt_txt_remove_player_confirm', { name: playerName }))) return;
  try {
    await api(`/api/tournaments/${currentTid}/players/${playerId}`, { method: 'DELETE' });
    _refreshCurrentView();
  } catch (e) { alert(e.message || t('txt_reg_error')); }
}

/** Regenerate a single player's passphrase & token */
async function _regeneratePlayerCode(playerId) {
  if (!confirm(t('txt_txt_regenerate_confirm'))) return;
  try {
    const data = await api(`/api/tournaments/${currentTid}/player-secrets/regenerate/${playerId}`, { method: 'POST' });
    // Update inline display
    const passEl = document.getElementById(`pc-pass-${playerId}`);
    if (passEl) passEl.textContent = data.passphrase;
    // Update cache
    if (_playerSecrets[playerId]) {
      _playerSecrets[playerId].passphrase = data.passphrase;
      _playerSecrets[playerId].token = data.token;
    }
  } catch (e) { alert(e.message); }
}

/** Copy all player + passphrase pairs to clipboard */
async function _copyAllPlayerCodes() {
  const lines = Object.values(_playerSecrets)
    .map(p => `${p.name}: ${p.passphrase}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(lines);
    alert(t('txt_txt_codes_copied'));
  } catch { /* ignore */ }
}

/** Save the contact string for a single player */
async function _savePlayerContact(playerId) {
  const input = document.getElementById(`pc-contact-${playerId}`);
  const saveBtn = document.getElementById(`pc-contact-save-${playerId}`);
  if (!input) return;
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
    await api(`/api/tournaments/${currentTid}/player-secrets/${playerId}/contact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: input.value }),
    });
    if (_playerSecrets[playerId]) _playerSecrets[playerId].contact = input.value;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_txt_contact_saved'); }
    setTimeout(() => { if (saveBtn) saveBtn.textContent = t('txt_txt_save_contact'); }, 1500);
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_txt_save_contact'); }
    alert(e.message);
  }
}

/** Save the email address for a single player */
async function _savePlayerEmail(playerId) {
  const input = document.getElementById(`pc-email-${playerId}`);
  const saveBtn = document.getElementById(`pc-email-save-${playerId}`);
  const badge = document.getElementById(`pc-linked-${playerId}`);
  if (!input) return;
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
    const result = await api(`/api/tournaments/${currentTid}/player-secrets/${playerId}/email`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.value }),
    });
    if (_playerSecrets[playerId]) {
      _playerSecrets[playerId].email = input.value;
      _playerSecrets[playerId].profile_id = result.profile_linked ? 'linked' : null;
      if (result.profile_linked) {
        if (result.player_name != null) _playerSecrets[playerId].name = result.player_name;
        if (result.contact != null) _playerSecrets[playerId].contact = result.contact;
      }
    }
    if (result.profile_linked) {
      const nameCell = document.getElementById(`pc-name-${playerId}`);
      if (nameCell && result.player_name != null) nameCell.textContent = result.player_name;
      const contactInput = document.getElementById(`pc-contact-${playerId}`);
      if (contactInput && result.contact != null) contactInput.value = result.contact;
    }
    if (badge) badge.hidden = !result.profile_linked;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = result.profile_linked ? t('txt_email_profile_linked') : t('txt_email_email_saved');
    }
    setTimeout(() => { if (saveBtn) saveBtn.textContent = t('txt_email_save_email'); }, 2000);
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_email_save_email'); }
    alert(e.message);
  }
}

/** Send credentials email to a single tournament player */
async function _sendPlayerEmail(playerId) {
  try {
    await api(`/api/tournaments/${currentTid}/send-email/${playerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    alert(t('txt_email_sent'));
  } catch (e) {
    alert(t('txt_email_failed') + ': ' + e.message);
  }
}

/** Send credentials email to all tournament players with email addresses */
async function _sendAllTournamentEmails() {
  if (!confirm(t('txt_email_confirm_send_all'))) return;
  try {
    const data = await api(`/api/tournaments/${currentTid}/send-all-emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    alert(t('txt_email_sent_count', { sent: data.sent, skipped: data.skipped }));
  } catch (e) {
    alert(t('txt_email_failed') + ': ' + e.message);
  }
}

/** Send an organizer message email to all tournament players */
async function _sendTournamentMessageEmails() {
  const textarea = document.getElementById('pc-organizer-message');
  if (!textarea) return;
  const message = textarea.value.trim();
  if (!message) { textarea.focus(); return; }
  if (!confirm(t('txt_email_confirm_send_message'))) return;
  try {
    const data = await api(`/api/tournaments/${currentTid}/send-message-emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    alert(t('txt_email_message_sent_count', { sent: data.sent, skipped: data.skipped }));
    textarea.value = '';
  } catch (e) {
    alert(t('txt_email_failed') + ': ' + e.message);
  }
}

/** Toggle the contact question in the new-registration form */
function _toggleNewRegContact(checked) {
  const containerId = 'reg-new-questions';
  const container = document.getElementById(containerId);
  if (!container) return;
  if (checked) {
    const existing = container.querySelector('[data-original-key="contact"]');
    if (!existing) {
      _addRegQuestion(containerId, true);
      const cards = container.querySelectorAll('.reg-q-card');
      const card = cards[cards.length - 1];
      if (card) {
        card.dataset.originalKey = 'contact';
        const labelInput = card.querySelector('.reg-q-label');
        if (labelInput) labelInput.value = t('txt_reg_contact');
        // Move to top so it appears first
        container.prepend(card);
        _updateRegQNumbers(containerId);
      }
    }
  } else {
    const existing = container.querySelector('[data-original-key="contact"]');
    if (existing) existing.remove();
    _updateRegQNumbers(containerId);
  }
}

/** Toggle the contact question in an existing registration's questions editor */
async function _toggleRegContactQuestion(rid, checked, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (checked) {
    const existing = container.querySelector('[data-original-key="contact"]');
    if (!existing) {
      _addRegQuestion(containerId, true);
      const cards = container.querySelectorAll('.reg-q-card');
      const card = cards[cards.length - 1];
      if (card) {
        card.dataset.originalKey = 'contact';
        const labelInput = card.querySelector('.reg-q-label');
        if (labelInput) labelInput.value = t('txt_reg_contact');
        container.prepend(card);
        _updateRegQNumbers(containerId);
      }
    }
  } else {
    const existing = container.querySelector('[data-original-key="contact"]');
    if (existing) existing.remove();
    _updateRegQNumbers(containerId);
  }
}

/** Fetch a QR code PNG as a base64 data URL (with auth) */
async function _fetchQrBase64(playerId) {
  try {
    const url = `${API}/api/tournaments/${currentTid}/player-secrets/qr/${playerId}?origin=${encodeURIComponent(window.location.origin)}`;
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/** Open a printable page with all player codes as cards */
async function _printPlayerCodes() {
  const entries = Object.entries(_playerSecrets);
  if (!entries.length) return;

  const tournamentName = _tournamentMeta[currentTid]?.name || '';

  // Fetch all QR codes in parallel
  const qrResults = await Promise.all(
    entries.map(([pid]) => _fetchQrBase64(pid))
  );

  let cards = '';
  entries.forEach(([pid, info], i) => {
    const qrDataUrl = qrResults[i];
    const qrHtml = qrDataUrl
      ? `<img src="${qrDataUrl}" alt="QR" class="code-qr">`
      : '';
    cards += `
      <div class="code-card">
        <div class="code-name">${_escHtml(info.name)}</div>
        ${qrHtml}
        <div class="code-label">Passphrase</div>
        <div class="code-passphrase">${_escHtml(info.passphrase)}</div>
      </div>`;
  });

  const htmlDoc = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Player Codes — ${_escHtml(tournamentName)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, -apple-system, sans-serif; padding: 1rem; }
      h1 { font-size: 1.3rem; text-align: center; margin-bottom: 1rem; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
      .code-card { border: 2px solid #333; border-radius: 8px; padding: 1rem; text-align: center; break-inside: avoid; }
      .code-name { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem; }
      .code-qr { width: 140px; height: 140px; image-rendering: pixelated; margin: 0.4rem auto; display: block; }
      .code-label { font-size: 0.7rem; text-transform: uppercase; color: #666; letter-spacing: 0.05em; margin-top: 0.4rem; }
      .code-passphrase { font-size: 1.2rem; font-weight: 600; font-family: monospace; color: #2563eb; margin-top: 0.2rem; }
      @media print { body { padding: 0; } .grid { gap: 0.5rem; } }
    </style>
  </head><body>
    <h1>${_escHtml(tournamentName)} — Player Codes</h1>
    <div class="grid">${cards}</div>
  </body></html>`;

  _open_printable_pdf(htmlDoc);
}

/** Simple HTML escape for print templates */
function _escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}


