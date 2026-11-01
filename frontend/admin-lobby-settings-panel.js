// ─── Per-lobby (registration) Settings page ────────────────────────────────
//
// All per-lobby configuration (details incl. public alias + description,
// questions editor, communications incl. organizer message, access) lives on
// a dedicated settings page — a separate view of the lobby detail — so the
// overview stays focused on registrants and their answers. The page keeps
// the sub-tab layout of the per-tournament Settings card
// (admin-settings-panel.js); the active sub-tab persists per-rid in
// `adminLobbySettingsSubtab:<rid>`.

const LOBBY_SUBTAB_DEFAULT = 'details';
const LOBBY_SUBTABS = ['details', 'questions', 'comms', 'payments', 'access'];

// rids whose settings page (instead of the lobby overview) is currently shown
const _lobbySettingsPageRids = new Set();

function _isLobbySettingsPageOpen(rid) {
  return _lobbySettingsPageRids.has(rid);
}

/** Show the dedicated settings page for a lobby. */
function _openLobbySettingsPage(rid, subtab) {
  if (subtab) {
    try { localStorage.setItem(_lobbySubtabStorageKey(rid), subtab); } catch (_) { /* ignore */ }
  }
  _lobbySettingsPageRids.add(rid);
  _renderRegDetailInline(rid);
  window.scrollTo({ top: 0 });
}

/** Leave the settings page and return to the lobby overview. */
function _closeLobbySettingsPage(rid) {
  _lobbySettingsPageRids.delete(rid);
  _renderRegDetailInline(rid);
  window.scrollTo({ top: 0 });
}

function _lobbySubtabStorageKey(rid) {
  return `adminLobbySettingsSubtab:${rid}`;
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
 * Open the lobby settings page on a given sub-tab.
 * Used by the lobby status-bar shortcut button.
 */
function _jumpToLobbySettings(rid, subtab) {
  _openLobbySettingsPage(rid, subtab);
}

/**
 * Open the read-only Answers panel (on the lobby overview) and scroll it into
 * view. Called from the Questions sub-tab "View answers" shortcut — leaves
 * the settings page first when it is open.
 */
function _jumpToLobbyAnswers(rid) {
  if (_isLobbySettingsPageOpen(rid)) _closeLobbySettingsPage(rid);
  const panel = document.getElementById(`reg-answers-panel-${rid}`);
  if (!panel) return;
  if (panel.tagName === 'DETAILS' && !panel.open) panel.open = true;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Open the participant-filter panel (on the lobby overview) and scroll it
 * into view.
 */
function _jumpToLobbyFilter(rid) {
  if (_isLobbySettingsPageOpen(rid)) _closeLobbySettingsPage(rid);
  const panel = document.getElementById(`reg-filter-panel-${rid}`);
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
  const hasFilter = (r.participant_filter?.length || 0) > 0;
  const eligibleCount = hasFilter ? (r.eligible_player_ids?.length || 0) : 0;

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
    actions += `<button type="button" class="btn btn-sm btn-danger" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',true))">${t('txt_reg_close_registration')}</button>`;
  } else {
    actions += `<button type="button" class="btn btn-sm btn-primary" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',false))">${t('txt_reg_open_registration')}</button>`;
    actions += `<button type="button" class="btn btn-sm btn-secondary" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',true))">${t('txt_reg_archive')}</button>`;
  }
  actions += `<button type="button" class="btn btn-sm" onclick="_copyRegLink('${esc(rid)}', this)">${t('txt_reg_copy_link')}</button>`;
  actions += `<button type="button" class="btn btn-sm btn-muted status-bar-settings-btn" onclick="_jumpToLobbySettings('${esc(rid)}','details')" title="${escAttr(t('txt_admin_status_jump_settings'))}">${_ic('settings')} ${t('txt_admin_status_jump_settings')}</button>`;

  return `
    <div class="card lobby-status-bar tournament-status-bar" id="lobby-status-bar-${esc(rid)}">
      <div class="gp-ops-header-top">
        <h3 class="d-flex items-center gap-2 flex-wrap">
          <span>${esc(r.name || rid)}</span>
          ${statusPill}
          <span class="badge badge-count">${count} ${t(count === 1 ? 'txt_reg_player_singular' : 'txt_reg_players_plural')}</span>
          ${hasQuestions && answeredCount > 0 ? `<span class="badge badge-count cursor-pointer" title="${escAttr(t('txt_reg_answers_title'))}" onclick="_jumpToLobbyAnswers('${esc(rid)}')">${answeredCount} ${t('txt_reg_answers_badge')}</span>` : ''}
          ${hasFilter ? `<span class="badge badge-eligible cursor-pointer" title="${escAttr(t('txt_reg_filter_title'))}" onclick="_jumpToLobbyFilter('${esc(rid)}')">${eligibleCount} / ${count} ${t('txt_reg_filter_eligible')}</span>` : ''}
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
  html += `<input type="text" id="reg-alias-input-${esc(rid)}" class="settings-input settings-input--mono settings-input--grow" placeholder="${t('txt_tv_alias_placeholder')}" value="${escAttr(regAlias)}" pattern="[a-zA-Z0-9_-]+" maxlength="64">`;
  html += `<button type="button" id="reg-alias-save-btn-${esc(rid)}" class="btn btn-sm btn-primary" onclick="withLoading(this,()=>_setRegAlias('${esc(rid)}'))">${t('txt_txt_save')}</button>`;
  if (regAlias) {
    html += `<button type="button" class="btn btn-sm btn-danger" onclick="withLoading(this,()=>_deleteRegAlias('${esc(rid)}'))">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `<div class="settings-url-preview">`;
  html += `<div class="settings-url-preview-row">`;
  html += `<span class="settings-url-preview-hint">${t('txt_reg_public_url')}</span>`;
  html += `<a href="${regUrl}" target="_blank" rel="noopener" class="lobby-reg-link">${regUrl}</a>`;
  html += `<button type="button" class="settings-url-copy-btn" onclick="_copyRegLink('${esc(rid)}', this)">${t('txt_reg_copy_link')}</button>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<div class="form-group"><label class="settings-label">${t('txt_reg_tournament_name')}</label>`;
  html += `<input type="text" id="reg-edit-name-${esc(rid)}" value="${escAttr(r.name)}"></div>`;

  html += `<div class="form-group"><label class="settings-label">${t('txt_reg_description')}</label>`;
  html += `<textarea id="reg-edit-desc-${esc(rid)}" class="reg-desc-textarea" rows="3" oninput="_autoResizeTextarea(this)">${esc(r.description || '')}</textarea>`;
  html += `<div id="reg-desc-preview-${esc(rid)}" class="lobby-desc-preview" style="display:none"></div>`;
  html += `<button type="button" class="btn btn-sm mt-1 fs-xs" onclick="_toggleRegDescPreview('${esc(rid)}')">${t('txt_reg_preview')}</button>`;
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

  html += `<div class="d-flex items-center gap-2 mt-2 mb-2">`;
  html += `<input type="checkbox" id="reg-edit-listed-${esc(rid)}" ${r.listed ? 'checked' : ''} class="cursor-pointer">`;
  html += `<label for="reg-edit-listed-${esc(rid)}" class="fs-md cursor-pointer">${t('txt_reg_listed')}</label></div>`;

  if (window._emailConfigured) {
    html += `<div class="d-flex items-center gap-2 mt-2 mb-2">`;
    html += `<input type="checkbox" id="reg-edit-autoemail-${esc(rid)}" ${r.auto_send_email ? 'checked' : ''} class="cursor-pointer">`;
    html += `<label for="reg-edit-autoemail-${esc(rid)}" class="fs-md cursor-pointer">${t('txt_email_auto_send')}</label></div>`;
  }

  html += `<div class="lobby-settings-actions">`;
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
    html += `<div class="reg-questions-jump-row reg-questions-jump-row--end">`;
    html += `<button type="button" class="btn btn-sm btn-muted" onclick="_jumpToLobbyAnswers('${esc(rid)}')">${t('txt_reg_view_answers')} (${answered})</button>`;
    html += `</div>`;
  }
  html += `<div class="d-flex items-center gap-2 mb-2">`;
  html += `<input type="checkbox" id="reg-contact-toggle-${esc(rid)}" class="cursor-pointer" ${hasContactQ ? 'checked' : ''} onchange="_toggleRegContactQuestion('${esc(rid)}', this.checked, '${editQContainer}')">`;
  html += `<label for="reg-contact-toggle-${esc(rid)}" class="fs-md cursor-pointer">${t('txt_reg_request_contact')}</label>`;
  html += `</div>`;
  html += `<div id="${editQContainer}"><div class="reg-q-empty" id="${editQContainer}-empty">${t('txt_reg_q_no_questions')}</div></div>`;
  html += `<div class="d-flex gap-2 mt-2 flex-wrap items-center">`;
  html += `<button type="button" class="add-participant-btn flex-1" onclick="_addRegQuestion('${editQContainer}')">${t('txt_reg_add_question')}</button>`;
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
  html += `<div class="d-flex gap-2 mt-2 flex-wrap items-center">`;
  if (window._emailConfigured) {
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendRegMessageEmails('${esc(rid)}'))" title="${t('txt_email_confirm_send_message_all')}">${_ic('mail')} ${t('txt_email_send_message_all')}</button>`;
    if ((r.participant_filter?.length || 0) > 0) {
      const eligibleCount = r.eligible_player_ids?.length || 0;
      html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendRegMessageEmails('${esc(rid)}',true))" title="${escAttr(t('txt_email_confirm_send_message_eligible'))}">${_ic('mail')} ${t('txt_email_send_message_eligible')} (${eligibleCount})</button>`;
    }
  }
  html += `<button type="button" id="reg-message-save-btn-${esc(rid)}" class="btn btn-primary btn-sm ml-auto" onclick="withLoading(this,()=>_saveRegMessage('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div>`;
  html += `</div>`;

  if (!window._emailConfigured) return html;

  const s = emailSettings || {};
  const senderName = s.sender_name || '';
  const replyTo = s.reply_to || '';

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_email_sender_name')}</label>`;
  html += `<p class="settings-help">${t('txt_email_sender_name_help')}</p>`;
  html += `<input type="text" id="reg-email-settings-sender-name-${esc(rid)}" value="${escAttr(senderName)}" maxlength="100" placeholder="${t('txt_email_sender_placeholder')}" class="w-full fs-md">`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_email_reply_to')}</label>`;
  html += `<p class="settings-help">${t('txt_email_reply_to_help')}</p>`;
  html += `<input type="email" id="reg-email-settings-reply-to-${esc(rid)}" value="${escAttr(replyTo)}" placeholder="${t('txt_email_reply_to_placeholder')}" class="w-full fs-md">`;
  html += `</div>`;

  html += `<div class="settings-section-actions settings-section-actions--end">`;
  html += `<button type="button" id="reg-email-settings-save-btn-${esc(rid)}" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegEmailSettings('${esc(rid)}'))">${t('txt_email_save_email')}</button>`;
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

// ─── Page orchestrator ────────────────────────────────────────────────────

/**
 * Render the dedicated per-lobby settings page: a back-to-lobby header bar
 * followed by the sub-tabbed settings card (always expanded).
 *
 * ctx fields:
 *   - regDetail:     object from _regDetails[rid]
 *   - emailSettings: object from _regEmailSettings[rid] (may be null)
 */
function _renderLobbySettingsPage(rid, ctx) {
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
    { key: 'payments',  label: t('txt_pay_tab'),                      icon: '€',  body: _renderPaymentSettingsIsland('registration', rid) },
    { key: 'access',    label: t('txt_lobby_settings_tab_access'),    icon: '🛡', body: accessBody },
  ].filter(st => st.body && st.body.trim());

  if (subtabs.length === 0) return '';
  const activeKey = subtabs.some(st => st.key === active) ? active : subtabs[0].key;

  let html = `<div class="card lobby-status-bar tournament-status-bar lobby-settings-page-bar">`;
  html += `<div class="gp-ops-header-top">`;
  html += `<h3 class="d-flex items-center gap-2 flex-wrap">`;
  html += `<span>${esc(r.name || rid)}</span>`;
  html += `<span class="badge badge-count">${t('txt_lobby_settings_title')}</span>`;
  html += `</h3>`;
  html += `<div class="gp-ops-next-action">`;
  html += `<button type="button" class="btn btn-sm btn-muted" onclick="_closeLobbySettingsPage('${esc(rid)}')">← ${t('txt_reg_back_to_lobby')}</button>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  html += `<div class="card admin-settings-card lobby-settings-card" id="lobby-settings-card">`;
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
  html += `</div>`;   // card
  return html;
}
