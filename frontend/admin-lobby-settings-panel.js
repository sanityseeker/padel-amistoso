// ─── Unified per-lobby (registration) Settings card ───────────────────────
//
// Mirrors the per-tournament Settings card (admin-settings-panel.js):
// renders all per-lobby configuration into a single collapsible card with
// four sub-tabs: Details (incl. public alias), Questions, Communications
// (incl. organizer message), Access. Active sub-tab persists per-rid in
// `adminLobbySettingsSubtab:<rid>`, open/closed state in
// `adminLobbySettingsOpen:<rid>`.

const LOBBY_SUBTAB_DEFAULT = 'details';
const LOBBY_SUBTABS = ['details', 'questions', 'comms', 'access'];

function _lobbySubtabStorageKey(rid) {
  return `adminLobbySettingsSubtab:${rid}`;
}

function _lobbyOpenStorageKey(rid) {
  return `adminLobbySettingsOpen:${rid}`;
}

function _getLobbySettingsOpen(rid) {
  try {
    return localStorage.getItem(_lobbyOpenStorageKey(rid)) === '1';
  } catch (_) {
    return false;
  }
}

function _setLobbySettingsOpen(rid, open) {
  try { localStorage.setItem(_lobbyOpenStorageKey(rid), open ? '1' : '0'); } catch (_) { /* ignore */ }
}

function _getLobbySubtab(rid) {
  try {
    const v = localStorage.getItem(_lobbySubtabStorageKey(rid));
    return LOBBY_SUBTABS.includes(v) ? v : LOBBY_SUBTAB_DEFAULT;
  } catch (_) {
    return LOBBY_SUBTAB_DEFAULT;
  }
}

/**
 * Switch active sub-tab inside the lobby Settings card and persist.
 */
function setLobbySubtab(rid, key) {
  if (!LOBBY_SUBTABS.includes(key)) return;
  try { localStorage.setItem(_lobbySubtabStorageKey(rid), key); } catch (_) { /* ignore */ }
  const root = document.getElementById('lobby-settings-card');
  if (!root) return;
  root.querySelectorAll('.settings-subtab-btn').forEach(btn => {
    const isActive = btn.dataset.subtab === key;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
  });
  root.querySelectorAll('.settings-subpanel').forEach(panel => {
    const isActive = panel.dataset.subtab === key;
    panel.classList.toggle('hidden', !isActive);
  });
}

/**
 * Open the lobby Settings card (if collapsed) and jump to a sub-tab.
 * Used by the lobby status-bar shortcut button.
 */
function _jumpToLobbySettings(rid, subtab) {
  const card = document.getElementById('lobby-settings-card');
  if (!card) return;
  const details = card.querySelector('details.admin-settings-details');
  if (details && !details.open) {
    details.open = true;
    if (rid) _setLobbySettingsOpen(rid, true);
  }
  if (subtab && rid) setLobbySubtab(rid, subtab);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Open the read-only Answers panel (rendered below the Settings card) and
 * scroll it into view. Called from the Questions sub-tab "View answers"
 * shortcut.
 */
function _jumpToLobbyAnswers(rid) {
  const panel = document.getElementById(`reg-answers-panel-${rid}`);
  if (!panel) return;
  if (panel.tagName === 'DETAILS' && !panel.open) panel.open = true;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Count registrants who provided at least one non-empty answer.
 * Used by the status bar answer-count badge.
 */
function _countLobbyAnswered(r) {
  const regs = r?.registrants || [];
  let n = 0;
  for (const reg of regs) {
    const a = reg.answers || {};
    for (const k in a) {
      const v = a[k];
      if (v !== null && v !== undefined && String(v).trim() !== '' && String(v) !== '[]') {
        n += 1;
        break;
      }
    }
  }
  return n;
}

// ─── Status bar ───────────────────────────────────────────────────────────

/**
 * Render the lobby status bar: name, status pill, count, primary actions.
 */
function _renderLobbyStatusBar(rid, r) {
  const open = !!r.open;
  const archived = !!r.archived;
  const converted = (r.converted_to_tids?.length || 0) > 0 || !!r.converted_to_tid;
  const count = r.registrants?.length ?? r.registrant_count ?? 0;
  const hasQuestions = (r.questions?.length || 0) > 0;
  const answeredCount = hasQuestions ? _countLobbyAnswered(r) : 0;

  let statusPill;
  if (archived) {
    statusPill = `<span class="badge badge-archived">${t('txt_reg_archived')}</span>`;
  } else if (open) {
    statusPill = `<span class="badge badge-lobby-open">${t('txt_reg_status_open')}</span>`;
  } else if (converted) {
    statusPill = `<span class="badge badge-converted">${t('txt_reg_converted')}</span>`;
  } else {
    statusPill = `<span class="badge badge-lobby-closed">${t('txt_reg_status_closed')}</span>`;
  }

  let actions = '';
  if (archived) {
    actions += `<button type="button" class="btn btn-sm btn-secondary" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',false))">${t('txt_reg_unarchive')}</button>`;
  } else if (open) {
    actions += `<button type="button" class="btn btn-sm" style="background:var(--red);color:#fff" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',true))">${t('txt_reg_close_registration')}</button>`;
  } else {
    actions += `<button type="button" class="btn btn-sm btn-primary" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',false))">${t('txt_reg_open_registration')}</button>`;
    actions += `<button type="button" class="btn btn-sm btn-secondary" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',true))">${t('txt_reg_archive')}</button>`;
  }
  actions += `<button type="button" class="btn btn-sm" onclick="_copyRegLink('${esc(rid)}')">${t('txt_reg_copy_link')}</button>`;
  actions += `<button type="button" class="btn btn-sm btn-muted status-bar-settings-btn" onclick="_jumpToLobbySettings('${esc(rid)}','details')" title="${escAttr(t('txt_admin_status_jump_settings'))}">⚙ ${t('txt_admin_status_jump_settings')}</button>`;

  return `
    <div class="card lobby-status-bar tournament-status-bar" id="lobby-status-bar-${esc(rid)}">
      <div class="gp-ops-header-top">
        <h3 style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
          <span>${esc(r.name || rid)}</span>
          ${statusPill}
          <span class="badge badge-count">${count} ${t(count === 1 ? 'txt_reg_player_singular' : 'txt_reg_players_plural')}</span>
          ${hasQuestions && answeredCount > 0 ? `<span class="badge badge-count" title="${escAttr(t('txt_reg_answers_title'))}" style="cursor:pointer" onclick="_jumpToLobbyAnswers('${esc(rid)}')">${answeredCount} ${t('txt_reg_answers_badge')}</span>` : ''}
        </h3>
        <div class="gp-ops-next-action">
          ${actions}
        </div>
      </div>
    </div>
  `;
}

// ─── Body renderers (one per sub-tab) ─────────────────────────────────────

/**
 * Details sub-tab body: public alias + name, description, email requirement,
 * join code, listed flag, auto-email flag, save button. Alias was previously
 * a separate "Share" sub-tab.
 */
function _renderLobbyDetailsBody(rid, r) {
  const regAlias = r.alias || '';
  const regUrl = regAlias
    ? `${window.location.origin}/register/${regAlias}`
    : `${window.location.origin}/register/${esc(r.id)}`;

  let html = `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_reg_registration_alias')}</label>`;
  html += `<p class="settings-help">${t('txt_reg_alias_help')}</p>`;
  html += `<div class="settings-inline-row">`;
  html += `<input type="text" id="reg-alias-input-${esc(rid)}" placeholder="${t('txt_tv_alias_placeholder')}" value="${escAttr(regAlias)}" pattern="[a-zA-Z0-9_-]+" maxlength="64" style="flex:1;min-width:180px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_setRegAlias('${esc(rid)}'))">${t('txt_txt_set_alias')}</button>`;
  if (regAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="withLoading(this,()=>_deleteRegAlias('${esc(rid)}'))">${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `<div class="settings-url-preview">`;
  html += `<div class="settings-url-preview-row">`;
  html += `<span class="settings-url-preview-hint">${t('txt_reg_public_url')}</span>`;
  html += `<a href="${regUrl}" target="_blank" rel="noopener" style="color:var(--accent);font-size:0.85rem;word-break:break-all;flex:1;min-width:200px">${regUrl}</a>`;
  html += `<button type="button" class="settings-url-copy-btn" onclick="_copyRegLink('${esc(rid)}')">${t('txt_reg_copy_link')}</button>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<div class="form-group"><label class="settings-label">${t('txt_reg_tournament_name')}</label>`;
  html += `<input type="text" id="reg-edit-name-${esc(rid)}" value="${escAttr(r.name)}"></div>`;

  html += `<div class="form-group"><label class="settings-label">${t('txt_reg_description')}</label>`;
  html += `<textarea id="reg-edit-desc-${esc(rid)}" class="reg-desc-textarea" rows="3" oninput="_autoResizeTextarea(this)">${esc(r.description || '')}</textarea>`;
  html += `<div id="reg-desc-preview-${esc(rid)}" style="display:none;margin-top:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"></div>`;
  html += `<button type="button" class="btn btn-sm" style="margin-top:0.3rem;font-size:0.75rem" onclick="_toggleRegDescPreview('${esc(rid)}')">${t('txt_reg_preview')}</button>`;
  html += `</div>`;

  html += `<div class="form-group"><label class="settings-label">${t('txt_email_requirement')}</label>`;
  html += `<select id="reg-edit-emailreq-${esc(rid)}">`;
  const er = r.email_requirement || 'optional';
  html += `<option value="required" ${er === 'required' ? 'selected' : ''}>${t('txt_email_mode_required')}</option>`;
  html += `<option value="optional" ${er === 'optional' ? 'selected' : ''}>${t('txt_email_mode_optional')}</option>`;
  html += `<option value="disabled" ${er === 'disabled' ? 'selected' : ''}>${t('txt_email_mode_disabled')}</option>`;
  html += `</select></div>`;

  html += `<div class="form-group"><label class="settings-label">${t('txt_reg_join_code')}</label>`;
  html += `<input type="text" id="reg-edit-joincode-${esc(rid)}" value="${escAttr(r.join_code || '')}" placeholder="${t('txt_reg_join_code_placeholder')}"></div>`;

  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.5rem">`;
  html += `<input type="checkbox" id="reg-edit-listed-${esc(rid)}" ${r.listed ? 'checked' : ''} style="width:1rem;height:1rem;cursor:pointer">`;
  html += `<label for="reg-edit-listed-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_listed')}</label></div>`;

  if (window._emailConfigured) {
    html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.5rem">`;
    html += `<input type="checkbox" id="reg-edit-autoemail-${esc(rid)}" ${r.auto_send_email ? 'checked' : ''} style="width:1rem;height:1rem;cursor:pointer">`;
    html += `<label for="reg-edit-autoemail-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_email_auto_send')}</label></div>`;
  }

  html += `<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegSettings('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

/**
 * Questions sub-tab body: contact toggle + dynamic editor + save.
 */
function _renderLobbyQuestionsBody(rid, r) {
  const editQContainer = `reg-edit-questions-${rid}`;
  const hasContactQ = (r.questions || []).some(q => q.key === 'contact');
  const hasQuestions = (r.questions?.length || 0) > 0;
  const hasRegistrants = (r.registrants?.length || 0) > 0;
  let html = `<div class="settings-block">`;
  if (hasQuestions && hasRegistrants) {
    const answered = _countLobbyAnswered(r);
    html += `<div class="reg-questions-jump-row" style="display:flex;justify-content:flex-end;margin-bottom:0.45rem">`;
    html += `<button type="button" class="btn btn-sm btn-muted" onclick="_jumpToLobbyAnswers('${esc(rid)}')">${t('txt_reg_view_answers')} (${answered})</button>`;
    html += `</div>`;
  }
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.55rem">`;
  html += `<input type="checkbox" id="reg-contact-toggle-${esc(rid)}" style="width:1rem;height:1rem;cursor:pointer" ${hasContactQ ? 'checked' : ''} onchange="_toggleRegContactQuestion('${esc(rid)}', this.checked, '${editQContainer}')">`;
  html += `<label for="reg-contact-toggle-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_request_contact')}</label>`;
  html += `</div>`;
  html += `<div id="${editQContainer}"><div class="reg-q-empty" id="${editQContainer}-empty">${t('txt_reg_q_no_questions')}</div></div>`;
  html += `<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">`;
  html += `<button type="button" class="add-participant-btn" onclick="_addRegQuestion('${editQContainer}')" style="flex:1">${t('txt_reg_add_question')}</button>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegQuestions('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

/**
 * Comms sub-tab body: organizer message + (when email is configured) per-lobby
 * email sender_name + reply_to. The organizer message block always renders so
 * organizers can edit/save it even without email integration. Was previously
 * split between a dedicated "Message" sub-tab and this one.
 */
function _renderLobbyCommsBody(rid, r, emailSettings) {
  let html = `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_reg_admin_message')}</label>`;
  html += `<p class="settings-help">${t('txt_reg_message_placeholder')}</p>`;
  html += `<textarea id="reg-edit-message-${esc(rid)}" class="reg-desc-textarea" rows="3" placeholder="${t('txt_reg_message_placeholder')}" oninput="_autoResizeTextarea(this)">${esc(r.message || '')}</textarea>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.5rem">`;
  if (window._emailConfigured) {
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendRegMessageEmails('${esc(rid)}'))" title="${t('txt_email_confirm_send_message_all')}">📧 ${t('txt_email_send_message_all')}</button>`;
  }
  html += `<button type="button" class="btn btn-primary btn-sm" style="margin-left:auto" onclick="withLoading(this,()=>_saveRegMessage('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div>`;
  html += `</div>`;

  if (!window._emailConfigured) return html;

  const s = emailSettings || {};
  const senderName = s.sender_name || '';
  const replyTo = s.reply_to || '';

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_email_sender_name')}</label>`;
  html += `<p class="settings-help">${t('txt_email_sender_name_help')}</p>`;
  html += `<input type="text" id="reg-email-settings-sender-name-${esc(rid)}" value="${escAttr(senderName)}" maxlength="100" placeholder="${t('txt_email_sender_placeholder')}" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_email_reply_to')}</label>`;
  html += `<p class="settings-help">${t('txt_email_reply_to_help')}</p>`;
  html += `<input type="email" id="reg-email-settings-reply-to-${esc(rid)}" value="${escAttr(replyTo)}" placeholder="${t('txt_email_reply_to_placeholder')}" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  html += `<div class="settings-section-actions" style="justify-content:flex-end;gap:0.5rem;align-items:center">`;
  html += `<span id="reg-email-settings-saved-msg-${esc(rid)}" style="color:var(--success,#22c55e);font-size:0.82rem;display:none">${t('txt_email_settings_saved')}</span>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegEmailSettings('${esc(rid)}'))">${t('txt_email_save_email')}</button>`;
  html += `</div>`;
  return html;
}

/**
 * Access sub-tab body: collaborators (lifted out of the old Settings details).
 * Returns the collaborators section unchanged — visibility is gated by the
 * existing owner/admin check inside `_renderRegCollaboratorsSection`.
 */
function _renderLobbyAccessBody(rid) {
  const list = (typeof _regCollaborators === 'object' && _regCollaborators) ? (_regCollaborators[rid] || []) : [];
  return _renderRegCollaboratorsSection(rid, list);
}

// ─── Card orchestrator ────────────────────────────────────────────────────

/**
 * Render the unified per-lobby Settings card.
 *
 * ctx fields:
 *   - regDetail:     object from _regDetails[rid]
 *   - emailSettings: object from _regEmailSettings[rid] (may be null)
 */
function _renderLobbySettingsCard(rid, ctx) {
  const r = (ctx && ctx.regDetail) || (typeof _regDetails === 'object' ? _regDetails[rid] : null);
  if (!r) return '';
  const emailSettings = (ctx && ctx.emailSettings) || null;

  const active = _getLobbySubtab(rid);
  const accessBody = _renderLobbyAccessBody(rid);
  const commsBody = _renderLobbyCommsBody(rid, r, emailSettings);

  const subtabs = [
    { key: 'details',   label: t('txt_lobby_settings_tab_details'),   icon: '⚙',  body: _renderLobbyDetailsBody(rid, r) },
    { key: 'questions', label: t('txt_lobby_settings_tab_questions'), icon: '❓', body: _renderLobbyQuestionsBody(rid, r) },
    { key: 'comms',     label: t('txt_lobby_settings_tab_comms'),     icon: '📧', body: commsBody },
    { key: 'access',    label: t('txt_lobby_settings_tab_access'),    icon: '🛡', body: accessBody },
  ].filter(st => st.body && st.body.trim());

  if (subtabs.length === 0) return '';
  const activeKey = subtabs.some(st => st.key === active) ? active : subtabs[0].key;

  let html = `<div class="card admin-settings-card lobby-settings-card" id="lobby-settings-card">`;
  const isOpen = _getLobbySettingsOpen(rid);
  html += `<details class="admin-settings-details"${isOpen ? ' open' : ''} ontoggle="_setLobbySettingsOpen('${esc(rid)}', this.open)">`;
  html += `<summary class="admin-settings-summary">`;
  html += `<span class="admin-settings-title"><span class="tv-chevron admin-settings-chevron">▸</span> ⚙ ${t('txt_lobby_settings_title')}</span>`;
  html += `</summary>`;

  html += `<div class="admin-settings-body">`;
  html += `<div class="settings-subtabs" role="tablist" aria-label="${escAttr(t('txt_lobby_settings_title'))}">`;
  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<button type="button" class="settings-subtab-btn${isActive ? ' active' : ''}" role="tab"`;
    html += ` aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? 0 : -1}"`;
    html += ` data-subtab="${escAttr(st.key)}"`;
    html += ` onclick="setLobbySubtab('${esc(rid)}','${escAttr(st.key)}')">`;
    html += `<span class="settings-subtab-icon" aria-hidden="true">${st.icon}</span>`;
    html += `<span class="settings-subtab-label">${esc(st.label)}</span>`;
    html += `</button>`;
  }
  html += `</div>`;

  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<div class="settings-subpanel${isActive ? '' : ' hidden'}" role="tabpanel" data-subtab="${escAttr(st.key)}">`;
    html += st.body;
    html += `</div>`;
  }

  html += `</div>`;   // body
  html += `</details>`;
  html += `</div>`;   // card
  return html;
}
