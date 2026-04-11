let _registrations = [];
let _showArchivedRegistrations = false;
let _regDetails = {};  // rid → full registration detail data
let _regCollaborators = {};  // rid → list of co-editor usernames
let _regEmailSettings = {};  // rid → email settings {sender_name, reply_to}
let _currentRegDetail = null;  // last-opened registration (for convert flow)

/** Render the per-registration email settings collapsible section. */
function _renderRegEmailControls(rid, emailSettings) {
  if (!window._emailConfigured) return '';
  const s = emailSettings || {};
  const senderName = s.sender_name || '';
  const replyTo = s.reply_to || '';

  let html = `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:0.45rem">`;
  html += `<span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>📧 ${t('txt_email_settings')}`;
  html += `</summary>`;
  html += `<div style="padding:0.75rem 0">`;

  // Sender Display Name
  html += `<div class="form-group">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.3rem;display:block">${t('txt_email_sender_name')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_email_sender_name_help')}</p>`;
  html += `<input type="text" id="reg-email-settings-sender-name-${esc(rid)}" value="${escAttr(senderName)}" maxlength="100" placeholder="Summer Cup" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  // Reply-To Address
  html += `<div class="form-group">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.3rem;display:block">${t('txt_email_reply_to')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_email_reply_to_help')}</p>`;
  html += `<input type="email" id="reg-email-settings-reply-to-${esc(rid)}" value="${escAttr(replyTo)}" placeholder="organizer@example.com" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegEmailSettings('${esc(rid)}'))">${t('txt_email_save_email')}</button>`;
  html += `<span id="reg-email-settings-saved-msg-${esc(rid)}" style="color:var(--success,#22c55e);font-size:0.82rem;display:none">${t('txt_email_settings_saved')}</span>`;
  html += `</div>`;

  html += `</div></details>`;
  return html;
}

/** Persist per-registration email settings (sender_name, reply_to) to the backend. */
async function _saveRegEmailSettings(rid) {
  const senderName = document.getElementById(`reg-email-settings-sender-name-${rid}`)?.value.trim() ?? '';
  const replyTo = document.getElementById(`reg-email-settings-reply-to-${rid}`)?.value.trim() ?? '';
  try {
    const result = await api(`/api/registrations/${rid}/email-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ sender_name: senderName, reply_to: replyTo || null }),
    });
    _regEmailSettings[rid] = result;
    const msg = document.getElementById(`reg-email-settings-saved-msg-${rid}`);
    if (msg) {
      msg.style.display = 'inline';
      setTimeout(() => { msg.style.display = 'none'; }, 2500);
    }
  } catch (e) {
    console.error('Reg email settings save failed:', e.message);
  }
}
let _regPollTimer = null;
const _REG_POLL_INTERVAL_MS = 20000;

// Registration detail auto-refresh
let _regDetailPollTimer = null;
let _regDetailFetching = false;
let _regDetailLastCount = null;
let _regDetailLastAnswerSig = null;
let _regDetailLastAssignedSig = null;
const _REG_DETAIL_POLL_INTERVAL_MS = 12000;

function _regAnswerSig(registrants) {
  return (registrants || []).map(r => `${r.player_id}:${JSON.stringify(r.answers ?? {})}`).join('|');
}

function _regAssignedSig(assignedPlayerIds) {
  return [...(assignedPlayerIds || [])].sort().join('|');
}

function _startRegDetailPoll() {
  _stopRegDetailPoll();
  if (!currentTid || currentType !== 'registration') return;
  _regDetailLastCount = _currentRegDetail?.registrant_count ?? null;
  _regDetailLastAnswerSig = _regAnswerSig(_currentRegDetail?.registrants);
  _regDetailLastAssignedSig = _regAssignedSig(_currentRegDetail?.assigned_player_ids);
  _regDetailPollTimer = setInterval(async () => {
    if (!currentTid || currentType !== 'registration' || _regDetailFetching) return;
    _regDetailFetching = true;
    try {
      const d = await api(`/api/registrations/${currentTid}`).catch(() => null);
      if (!d) return;
      const sig = _regAnswerSig(d.registrants);
      const assignedSig = _regAssignedSig(d.assigned_player_ids);
      const countChanged = _regDetailLastCount !== null && d.registrant_count !== _regDetailLastCount;
      const answersChanged = sig !== _regDetailLastAnswerSig;
      const assignedChanged = assignedSig !== _regDetailLastAssignedSig;
      _regDetailLastCount = d.registrant_count;
      _regDetailLastAnswerSig = sig;
      _regDetailLastAssignedSig = assignedSig;
      if (countChanged || answersChanged || assignedChanged) {
        _regDetails[currentTid] = d;
        _currentRegDetail = d;
        _renderRegDetailInline(currentTid);
      }
    } catch (_) { /* network blip */ }
    finally { _regDetailFetching = false; }
  }, _REG_DETAIL_POLL_INTERVAL_MS);
}

function _stopRegDetailPoll() {
  if (_regDetailPollTimer) { clearInterval(_regDetailPollTimer); _regDetailPollTimer = null; }
  _regDetailFetching = false;
  _regDetailLastCount = null;
  _regDetailLastAnswerSig = null;
  _regDetailLastAssignedSig = null;
}

function _startRegPoll() {
  _stopRegPoll();
  _regPollTimer = setInterval(_pollRegistrations, _REG_POLL_INTERVAL_MS);
}

function _stopRegPoll() {
  if (_regPollTimer) { clearInterval(_regPollTimer); _regPollTimer = null; }
}

async function _pollRegistrations() {
  try {
    await loadTournaments();
  } catch (_) { /* network blip — ignore */ }
}

async function loadRegistrations() {
  await loadTournaments();
}

function _setShowArchivedRegistrations(enabled) {
  _showArchivedRegistrations = !!enabled;
  loadTournaments();
}

async function _loadRegDetail(rid) {
  const data = await api(`/api/registrations/${rid}`);
  _regDetails[rid] = data;
  _currentRegDetail = data;
  _renderRegDetailInline(rid);
}

function _renderRegDetailInline(rid) {
  const el = document.getElementById('view-content');
  const r = _regDetails[rid];
  if (!el || !r) return;

  let closeOpenBtn = '';
  if (r.archived) {
    closeOpenBtn = `<button type="button" class="btn btn-secondary" style="padding:0.35rem 0.8rem;font-size:0.78rem;white-space:nowrap" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',false))">${t('txt_reg_unarchive')}</button>`;
  } else if (r.open) {
    closeOpenBtn = `<button type="button" class="btn" style="padding:0.35rem 0.8rem;font-size:0.78rem;background:var(--red);color:#fff;white-space:nowrap" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',true))">${t('txt_reg_close_registration')}</button>`;
  } else {
    closeOpenBtn = `<div style="display:flex;gap:0.4rem;flex-shrink:0">`
      + `<button type="button" class="btn btn-primary" style="padding:0.35rem 0.8rem;font-size:0.78rem;white-space:nowrap" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',false))">${t('txt_reg_open_registration')}</button>`
      + `<button type="button" class="btn btn-secondary" style="padding:0.35rem 0.8rem;font-size:0.78rem;white-space:nowrap" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',true))">${t('txt_reg_archive')}</button>`
      + `</div>`;
  }
  let html = `<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;margin-bottom:0.5rem"><h2 style="margin:0">${esc(r.name)}</h2>${closeOpenBtn}</div>`;
  const regAlias = r.alias || '';
  const regUrl = regAlias
    ? `${window.location.origin}/register/${regAlias}`
    : `${window.location.origin}/register/${esc(r.id)}`;

  // Registration link + alias section
  html += `<div style="margin-bottom:1rem;padding:0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">${t('txt_reg_registration_alias')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_reg_alias_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="reg-alias-input-${esc(rid)}" placeholder="my-tournament" value="${esc(regAlias)}" pattern="[a-zA-Z0-9_-]+" maxlength="64" style="flex:1;min-width:180px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_setRegAlias('${esc(rid)}'))" style="white-space:nowrap">${t('txt_txt_set_alias')}</button>`;
  if (regAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="withLoading(this,()=>_deleteRegAlias('${esc(rid)}'))" style="white-space:nowrap">${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `<div style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">`;
  html += `<div style="flex:1;min-width:220px;padding:0.4rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:0.78rem;word-break:break-all">`;
  html += `<span style="color:var(--text-muted)">${t('txt_reg_public_url')}</span> <a href="${regUrl}" target="_blank" style="color:var(--accent);font-size:0.85rem">${regUrl}</a>`;
  html += `</div>`;
  html += `<button type="button" class="btn btn-sm" style="font-size:0.7rem;white-space:nowrap" onclick="_copyRegLink('${esc(rid)}')">${t('txt_reg_copy_link')}</button>`;
  html += `</div></div>`;

  html += `<div class="reg-sections-group reg-sections-group-admin">`;

  // Settings section
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:0.45rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_settings')}</summary>`;
  html += `<div style="padding:0.75rem 0">`;
  html += `<div class="form-group"><label>${t('txt_reg_tournament_name')}</label>`;
  html += `<input type="text" id="reg-edit-name-${esc(rid)}" value="${esc(r.name)}"></div>`;
  html += `<div class="form-group"><label>${t('txt_reg_description')}</label>`;
  html += `<textarea id="reg-edit-desc-${esc(rid)}" class="reg-desc-textarea" rows="3" oninput="_autoResizeTextarea(this)">${esc(r.description || '')}</textarea>`;
  html += `<div id="reg-desc-preview-${esc(rid)}" style="display:none;margin-top:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"></div>`;
  html += `<button type="button" class="btn btn-sm" style="margin-top:0.3rem;font-size:0.75rem" onclick="_toggleRegDescPreview('${esc(rid)}')">${t('txt_reg_preview')}</button></div>`;
  html += `<div class="form-group"><label>${t('txt_email_requirement')}</label>`;
  html += `<select id="reg-edit-emailreq-${esc(rid)}">`;
  html += `<option value="required" ${(r.email_requirement || 'optional') === 'required' ? 'selected' : ''}>${t('txt_email_mode_required')}</option>`;
  html += `<option value="optional" ${(r.email_requirement || 'optional') === 'optional' ? 'selected' : ''}>${t('txt_email_mode_optional')}</option>`;
  html += `<option value="disabled" ${(r.email_requirement || 'optional') === 'disabled' ? 'selected' : ''}>${t('txt_email_mode_disabled')}</option>`;
  html += `</select></div>`;
  html += `<div class="form-group"><label>${t('txt_reg_join_code')}</label>`;
  html += `<input type="text" id="reg-edit-joincode-${esc(rid)}" value="${esc(r.join_code || '')}" placeholder="${t('txt_reg_join_code_placeholder')}"></div>`;
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
  html += _renderRegCollaboratorsSection(rid, _regCollaborators[rid] || []);
  html += `</div></details>`;

  // Email settings section (only when email is configured)
  if (window._emailConfigured) {
    html += _renderRegEmailControls(rid, _regEmailSettings[rid] || {});
  }

  // Admin message section
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:0.45rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_admin_message')}</summary>`;
  html += `<div style="padding:0.75rem 0">`;
  html += `<div class="form-group" style="margin-bottom:0.4rem">`;
  html += `<textarea id="reg-edit-message-${esc(rid)}" class="reg-desc-textarea" rows="3" placeholder="${t('txt_reg_message_placeholder')}" oninput="_autoResizeTextarea(this)">${esc(r.message || '')}</textarea>`;
  html += `</div>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.5rem">`;
  if (window._emailConfigured) {
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendRegMessageEmails('${esc(rid)}'))" title="${t('txt_email_confirm_send_message_all')}">📧 ${t('txt_email_send_message_all')}</button>`;
  }
  html += `<button type="button" class="btn btn-primary btn-sm" style="margin-left:auto" onclick="withLoading(this,()=>_saveRegMessage('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div></div></details>`;

  // Questions edit section
  const editQContainer = `reg-edit-questions-${rid}`;
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;user-select:none;font-weight:700;display:flex;align-items:center;gap:0.5rem;list-style:none">`;
  html += `<span style="display:flex;align-items:center;gap:0.4rem;flex:1"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_questions')}</span>`;
  html += `<span class="participant-count" id="${editQContainer}-count">(0)</span>`;
  html += `</summary>`;
  html += `<div style="padding:0.6rem 0">`;
  const hasContactQ = (r.questions || []).some(q => q.key === 'contact');
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.55rem">`;
  html += `<input type="checkbox" id="reg-contact-toggle-${esc(rid)}" style="width:1rem;height:1rem;cursor:pointer" ${hasContactQ ? 'checked' : ''} onchange="_toggleRegContactQuestion('${esc(rid)}', this.checked, '${editQContainer}')">`;
  html += `<label for="reg-contact-toggle-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_request_contact')}</label>`;
  html += `</div>`;
  html += `<div id="${editQContainer}"><div class="reg-q-empty" id="${editQContainer}-empty">${t('txt_reg_q_no_questions')}</div></div>`;
  html += `<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">`;
  html += `<button type="button" class="add-participant-btn" onclick="_addRegQuestion('${editQContainer}')" style="flex:1">${t('txt_reg_add_question')}</button>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegQuestions('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div></div></details>`;

  html += `</div>`;

  html += `<div class="reg-sections-group reg-sections-group-players">`;

  // Registrants table (collapsible) — names, passphrases, actions only
  html += `<details class="reg-section" style="margin-bottom:0.75rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_registrants')} (${r.registrants.length})</span>`;
  html += `</summary>`;
  if (r.registrants.length > 0) {
    html += `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.65rem;margin-bottom:0.25rem">`;
    html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="_copyAllRegCodes('${esc(rid)}')">${t('txt_txt_copy_all_codes')}</button>`;
    if (window._emailConfigured) {
      html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="_sendAllRegEmails('${esc(rid)}')">${t('txt_email_send_all')}</button>`;
    }
    html += `</div>`;
  }
  if (r.registrants.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_reg_no_registrants')}</p>`;
  } else {
    // Duplicate name detection
    const _nameCounts = new Map();
    for (const reg of r.registrants) {
      const norm = reg.player_name.trim().toLowerCase();
      _nameCounts.set(norm, (_nameCounts.get(norm) || 0) + 1);
    }
    const _dupNames = new Set([..._nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
    if (_dupNames.size > 0) {
      const dupList = r.registrants
        .filter(reg => _dupNames.has(reg.player_name.trim().toLowerCase()))
        .map(reg => esc(reg.player_name));
      const unique = [...new Set(dupList)].join(', ');
      html += `<div style="margin-top:0.5rem;padding:0.45rem 0.7rem;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.5);border-radius:6px;font-size:0.8rem;color:#f59e0b">${t('txt_reg_duplicate_names', { names: unique })}</div>`;
    }
    html += `<div style="overflow-x:auto;margin-top:0.5rem"><table style="width:100%;border-collapse:collapse;font-size:0.84rem">`;
    html += `<thead><tr style="border-bottom:2px solid var(--border)">`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_reg_name')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_email')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_txt_passphrase')}</th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.5rem"></th>`;
    html += `</tr></thead><tbody>`;
    for (const reg of r.registrants) {
      const isDup = _dupNames.has(reg.player_name.trim().toLowerCase());
      const rowStyle = isDup
        ? 'border-bottom:1px solid var(--border);background:rgba(251,191,36,0.08)'
        : 'border-bottom:1px solid var(--border)';
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding:0.4rem 0.5rem;font-weight:600">${isDup ? '⚠ ' : ''}${esc(reg.player_name)}</td>`;
      html += `<td style="padding:0.4rem 0.5rem;font-size:0.82em;color:var(--text-muted)">${reg.email ? esc(reg.email) : '—'}</td>`;
      html += `<td style="padding:0.4rem 0.5rem"><code style="font-size:0.9em;color:var(--accent);user-select:all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent)" title="Click to copy">${esc(reg.passphrase)}</code></td>`;
      html += `<td style="padding:0.4rem 0.5rem;text-align:center;white-space:nowrap">`;
      html += `<button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem;margin-right:0.25rem" onclick="_editRegistrant('${esc(r.id)}','${esc(reg.player_id)}','${esc(reg.player_name)}','${esc(reg.email||'')}')" title="${t('txt_reg_edit_player')}">✏️</button>`;
      if (window._emailConfigured && reg.email) {
        html += `<button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem;margin-right:0.25rem" onclick="_sendRegEmail('${esc(r.id)}','${esc(reg.player_id)}')" title="${t('txt_email_send')}">✉️</button>`;
      }
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem" onclick="_removeRegistrant('${esc(r.id)}','${esc(reg.player_id)}')" title="${t('txt_reg_confirm_remove')}">✕</button>`;
      html += `</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  html += `<div style="margin-top:0.5rem"><button type="button" class="add-participant-btn" onclick="_adminAddRegistrant('${esc(rid)}')">${t('txt_reg_add_player')}</button></div>`;
  html += `</details>`;

  // Question Answers panel (separate, only shown when questions exist)
  const questions = r.questions || [];
  if (questions.length > 0 && r.registrants.length > 0) {
    html += _renderAnswersPanel(rid, r, questions);
  }

  html += `</div>`;

  // Linked tournaments section (shown after first or more conversions)
  const _linkedTournaments = (r.linked_tournaments || []).filter((item) => item?.id);
  if (_linkedTournaments.length > 0) {
    html += `<div class="linked-tournaments">`;
    html += `<div class="linked-tournaments-title">${t('txt_reg_linked_tournaments')}</div>`;
    html += `<div class="linked-tournaments-list">`;
    _linkedTournaments.forEach(function(linked) {
      const ltid = linked.id;
      const fromMeta = _tournamentMeta?.[ltid] || (_openTournaments || []).find(function(tr) { return tr.id === ltid; });
      const tname = linked.name || fromMeta?.name || ltid;
      const ttype = linked.type || fromMeta?.type;
      if (ttype) {
        html += `<a href="#" class="linked-tournament-link" onclick="openTournament('${esc(ltid)}','${esc(ttype)}','${esc(tname)}');return false" title="${esc(ltid)}">${esc(tname)}</a>`;
      } else {
        html += `<a href="/tv/${encodeURIComponent(ltid)}" class="linked-tournament-link" target="_blank" rel="noopener" title="${esc(ltid)}">${esc(tname)}</a>`;
      }
    });
    html += `</div>`;
    html += `</div>`;
  }

  // Convert button + close/open registration toggle
  const regBtnLabel = (r.converted_to_tids?.length > 0) ? t('txt_reg_create_another') : t('txt_reg_convert_to_tournament');
  let regConvDisabled = '';
  if (r.registrants.length < 2) regConvDisabled = `disabled title="${t('txt_reg_min_registrants_needed')}"`;
  html += `<div style="display:flex;gap:0.75rem;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:1.25rem">`;
  if (!r.archived) {
    html += `<button type="button" class="btn btn-success" style="padding:0.7rem 1.5rem;font-size:1rem" onclick="_startConvertFromReg('${esc(rid)}')" ${regConvDisabled}>${regBtnLabel}</button>`;
  }
  html += `</div>`;

  html += `</div>`; // close .card

  // ── Save UI state before replacing DOM ────────────────────────────
  const openDetails = new Set();
  el.querySelectorAll('details.reg-section').forEach((d, i) => { if (d.open) openDetails.add(i); });
  const savedInputs = {};
  el.querySelectorAll('input[id], textarea[id], select[id]').forEach(inp => {
    if (inp.type === 'checkbox') savedInputs[inp.id] = { checked: inp.checked };
    else savedInputs[inp.id] = { value: inp.value };
  });
  const savedQuestionDraft = _captureRegQuestionsDraft(`reg-edit-questions-${rid}`);
  const scrollY = window.scrollY;
  // Save answers-panel filter state (not captured by id-based savedInputs)
  const savedParticipantFilter = el.querySelector('.reg-answers-participant-select')?.value ?? '';
  const savedParticipantSearch = el.querySelector('.reg-answers-participant-search')?.value ?? '';
  const savedActiveChoices = {};
  const savedTextSearches = {};
  const savedSpoilerOpen = new Set();
  const savedSortedCards = new Set();
  el.querySelectorAll('.reg-answer-card').forEach((card, i) => {
    const activeBar = card.querySelector('.reg-answer-bar-row.active');
    if (activeBar) savedActiveChoices[i] = activeBar.dataset.choice ?? '';
    const search = card.querySelector('.reg-answer-text-search');
    if (search?.value) savedTextSearches[i] = search.value;
    if (card.querySelector('.reg-answer-spoiler')?.open) savedSpoilerOpen.add(i);
    if (card.querySelector('.reg-answer-sort-btn')?.dataset.sorted === 'true') savedSortedCards.add(i);
  });

  el.innerHTML = html;

  // ── Restore UI state after replacing DOM ──────────────────────────
  el.querySelectorAll('details.reg-section').forEach((d, i) => { if (openDetails.has(i)) d.open = true; });
  for (const [id, state] of Object.entries(savedInputs)) {
    const inp = document.getElementById(id);
    if (!inp) continue;
    if ('checked' in state) inp.checked = state.checked;
    else inp.value = state.value;
  }
  window.scrollTo({ top: scrollY });

  // Restore answers-panel filter state: active choices, spoilers, sort, text searches
  el.querySelectorAll('.reg-answer-card').forEach((card, i) => {
    if (i in savedActiveChoices) {
      const barRow = Array.from(card.querySelectorAll('.reg-answer-bar-row'))
        .find(r => r.dataset.choice === savedActiveChoices[i]);
      if (barRow) barRow.classList.add('active');
    }
    if (savedTextSearches[i]) {
      const search = card.querySelector('.reg-answer-text-search');
      if (search) search.value = savedTextSearches[i];
    }
    if (savedSpoilerOpen.has(i) || i in savedActiveChoices) {
      const spoiler = card.querySelector('.reg-answer-spoiler');
      if (spoiler) spoiler.open = true;
    }
    if (savedSortedCards.has(i)) {
      const sortBtn = card.querySelector('.reg-answer-sort-btn');
      if (sortBtn) _regSortChoiceAnswers(sortBtn);
    }
  });
  // Restore participant filter and re-apply all row filters (participant + choice + hide-empty)
  const _restoredParticipantSearch = el.querySelector('.reg-answers-participant-search');
  if (_restoredParticipantSearch && savedParticipantSearch) {
    _restoredParticipantSearch.value = savedParticipantSearch;
    _regFilterParticipantOptions(_restoredParticipantSearch);
  }
  const _restoredParticipantSelect = el.querySelector('.reg-answers-participant-select');
  if (_restoredParticipantSelect && savedParticipantFilter) {
    _restoredParticipantSelect.value = savedParticipantFilter;
    _regFilterByParticipant(_restoredParticipantSelect);
  } else if (!savedParticipantSearch) {
    el.querySelectorAll('.reg-answer-card').forEach(card => _regApplyRowFilters(card));
  }
  // Re-apply text search filters after row visibility is settled
  el.querySelectorAll('.reg-answer-text-search').forEach(search => {
    if (search.value) _regFilterAnswers(search);
  });

  const descEl = document.getElementById(`reg-edit-desc-${rid}`);
  if (descEl) _autoResizeTextarea(descEl);
  const msgEl = document.getElementById(`reg-edit-message-${rid}`);
  if (msgEl) _autoResizeTextarea(msgEl);
  _populateRegQuestions(`reg-edit-questions-${rid}`, questions);
  if (savedQuestionDraft !== null) {
    _restoreRegQuestionsDraft(`reg-edit-questions-${rid}`, savedQuestionDraft);
  }
}

function _copyRegLink(rid) {
  const alias = _regDetails[rid]?.alias;
  const url = alias
    ? `${window.location.origin}/register/${alias}`
    : `${window.location.origin}/register/${rid}`;
  navigator.clipboard.writeText(url).then(() => {
    const origText = event?.target?.textContent;
    if (event?.target) { event.target.textContent = '✓'; setTimeout(() => { event.target.textContent = origText || t('txt_reg_copy_link'); }, 1200); }
  });
}

async function _setRegAlias(rid) {
  const input = document.getElementById(`reg-alias-input-${rid}`);
  const alias = input?.value.trim();
  if (!alias) { alert(t('txt_txt_please_enter_an_alias')); return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) { alert(t('txt_txt_alias_can_only_contain_letters_numbers_hyphens_and_underscores')); return; }
  try {
    await api(`/api/registrations/${rid}/alias`, { method: 'PUT', body: JSON.stringify({ alias }) });
    if (_regDetails[rid]) _regDetails[rid].alias = alias;
    _renderRegDetailInline(rid);
    alert(t('txt_txt_alias_value_set_successfully', { value: alias }));
  } catch (e) { alert(t('txt_txt_failed_to_set_alias_value', { value: e.message })); }
}

async function _deleteRegAlias(rid) {
  if (!confirm(t('txt_txt_remove_the_alias_from_this_tournament'))) return;
  try {
    await api(`/api/registrations/${rid}/alias`, { method: 'DELETE' });
    if (_regDetails[rid]) delete _regDetails[rid].alias;
    _renderRegDetailInline(rid);
    alert(t('txt_txt_alias_removed_successfully'));
  } catch (e) { alert(t('txt_txt_failed_to_remove_alias_value', { value: e.message })); }
}

async function _archiveRegistration(rid, archive) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: archive }),
    });
    if (_regDetails[rid]) _regDetails[rid].archived = archive;
    _currentRegDetail = _regDetails[rid] || _currentRegDetail;
    if (currentTid === rid && currentType === 'registration') {
      _renderRegDetailInline(rid);
    }
    await loadRegistrations();
  } catch (e) { console.error('_archiveRegistration failed:', e); }
}

async function _toggleRegOpen(rid, currentlyOpen) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: !currentlyOpen }),
    });
    if (_regDetails[rid]) _regDetails[rid].open = !currentlyOpen;
    _currentRegDetail = _regDetails[rid] || _currentRegDetail;
    if (currentTid === rid && currentType === 'registration') {
      _renderRegDetailInline(rid);
    }
    await loadRegistrations();
  } catch (e) { console.error('_toggleRegOpen failed:', e); }
}

async function _toggleRegListed(rid, currentlyListed) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listed: !currentlyListed }),
    });
    if (_regDetails[rid]) _regDetails[rid].listed = !currentlyListed;
    await loadRegistrations();
  } catch (e) { console.error('_toggleRegListed failed:', e); }
}

function _openTournamentFromReg(tid) {
  const meta = _tournamentMeta[tid];
  if (meta) {
    openTournament(tid, meta.type, meta.name);
  } else {
    // Tournament not in cache — fetch list first, then open
    loadTournaments().then(() => {
      const m = _tournamentMeta[tid];
      if (m) openTournament(tid, m.type, m.name);
      else alert('Tournament not found');
    });
  }
}

async function _deleteRegistration(rid) {
  if (!confirm(t('txt_reg_confirm_delete'))) return;
  try {
    await api(`/api/registrations/${rid}`, { method: 'DELETE' });
    delete _regDetails[rid];
    if (_currentRegDetail && _currentRegDetail.id === rid) _currentRegDetail = null;
    // Unpin the tab if it was open
    if (_openTournaments.some(t => t.id === rid)) _unpinTournament(rid);
    await loadRegistrations();
  } catch (e) { alert(t('txt_reg_error')); }
}

// ─── Create registration form ─────────────────────────────

function _defaultLobbyName() {
  return _currentSport === 'tennis' ? 'My Tennis Tournament' : 'My Padel Tournament';
}

function _captureCreateRegistrationDraft() {
  const form = document.getElementById('reg-create-form');
  const nameEl = document.getElementById('reg-new-name');
  if (!form || !nameEl) return null;

  const questions = [];
  const items = form.querySelectorAll('#reg-new-questions .reg-q-item');
  items.forEach(item => {
    const label = item.querySelector('.reg-q-label')?.value?.trim() || '';
    if (!label) return;
    const type = item.querySelector('.reg-q-type-toggle')?.dataset.current || 'text';
    const required = !!item.querySelector('.reg-q-required')?.checked;
    const key = item.dataset.originalKey || '';
    const choices = (type === 'choice' || type === 'multichoice')
      ? Array.from(item.querySelectorAll('.reg-q-choice-val')).map(i => i.value.trim()).filter(Boolean)
      : [];
    questions.push({ key, label, type, required, choices });
  });

  return {
    name: nameEl.value || '',
    description: document.getElementById('reg-new-desc')?.value || '',
    joinCodeEnabled: !!document.getElementById('reg-new-joincode-toggle')?.checked,
    joinCode: document.getElementById('reg-new-joincode')?.value || '',
    emailRequirement: document.getElementById('reg-new-emailreq')?.value || 'optional',
    contactEnabled: !!document.getElementById('reg-new-contact')?.checked,
    listed: !!document.getElementById('reg-new-listed')?.checked,
    questions,
  };
}

function _restoreCreateRegistrationDraft(draft) {
  if (!draft) return;

  const nameEl = document.getElementById('reg-new-name');
  const descEl = document.getElementById('reg-new-desc');
  const joinToggleEl = document.getElementById('reg-new-joincode-toggle');
  const joinCodeEl = document.getElementById('reg-new-joincode');
  const emailReqEl = document.getElementById('reg-new-emailreq');
  const contactEl = document.getElementById('reg-new-contact');
  const listedEl = document.getElementById('reg-new-listed');

  if (nameEl) nameEl.value = draft.name || '';
  if (descEl) descEl.value = draft.description || '';
  if (joinToggleEl) joinToggleEl.checked = !!draft.joinCodeEnabled;
  if (joinCodeEl) {
    joinCodeEl.style.display = draft.joinCodeEnabled ? '' : 'none';
    joinCodeEl.value = draft.joinCode || '';
  }
  if (emailReqEl) emailReqEl.value = draft.emailRequirement || 'optional';
  if (contactEl) contactEl.checked = !!draft.contactEnabled;
  if (listedEl) listedEl.checked = !!draft.listed;

  const containerId = 'reg-new-questions';
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="reg-q-empty" id="${containerId}-empty">${t('txt_reg_q_no_questions')}</div>`;
    _regQuestionCounter = 0;
    for (const q of draft.questions || []) {
      _addRegQuestion(containerId, true);
      const cards = container.querySelectorAll('.reg-q-card');
      const card = cards[cards.length - 1];
      if (!card) continue;

      if (q.key) card.dataset.originalKey = q.key;
      const labelEl = card.querySelector('.reg-q-label');
      if (labelEl) labelEl.value = q.label || '';
      const requiredEl = card.querySelector('.reg-q-required');
      if (requiredEl) requiredEl.checked = !!q.required;

      const typeBtn = card.querySelector(`.reg-q-type-toggle button[data-type="${q.type || 'text'}"]`);
      if (typeBtn) _setRegQType(typeBtn, q.type || 'text');

      if (q.type === 'choice' || q.type === 'multichoice') {
        const choicesList = card.querySelector('.reg-q-choices-list');
        const addChoiceBtn = card.querySelector('.reg-q-add-choice-btn');
        if (choicesList) choicesList.innerHTML = '';
        for (const choice of q.choices || []) {
          if (!addChoiceBtn) break;
          _addRegChoice(addChoiceBtn);
          const rows = card.querySelectorAll('.reg-q-choice-row .reg-q-choice-val');
          const input = rows[rows.length - 1];
          if (input) input.value = choice;
        }
      }
    }
    _updateRegQNumbers(containerId);
  }
}

function showCreateRegistration() {
  const draft = _captureCreateRegistrationDraft();
  const el = document.getElementById('reg-create-form');
  if (!el) return;
  _regQuestionCounter = 0;

  el.innerHTML = `
      <div class="field-section" style="margin-bottom:0.75rem">
        <input id="reg-new-name" value="${_defaultLobbyName()}" class="tournament-name-input" placeholder="${t('txt_reg_tournament_name')}" style="width:100%;min-width:160px">
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div class="field-section-title">${t('txt_reg_description')}</div>
        <textarea id="reg-new-desc" class="reg-desc-textarea" rows="3" oninput="_autoResizeTextarea(this)"></textarea>
        <div id="reg-new-desc-preview" style="display:none;margin-top:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.3rem">
          <button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="_toggleNewRegDescPreview()">${t('txt_reg_preview')}</button>
          <small style="color:var(--text-muted);font-size:0.75rem">${t('txt_reg_description_hint')}</small>
        </div>
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <label class="switch-label" style="cursor:pointer">
          <input type="checkbox" id="reg-new-joincode-toggle" onchange="document.getElementById('reg-new-joincode').style.display=this.checked?'':'none'">
          <span class="switch-track"></span>
          <span>${t('txt_reg_join_code_toggle')}</span>
        </label>
        <input type="text" id="reg-new-joincode" placeholder="${t('txt_reg_join_code_placeholder')}" maxlength="64" style="display:none;margin-top:0.4rem">
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div class="field-section-title">${t('txt_email_requirement')}</div>
        <select id="reg-new-emailreq" style="width:100%">
          <option value="required">${t('txt_email_mode_required')}</option>
          <option value="optional" selected>${t('txt_email_mode_optional')}</option>
          <option value="disabled">${t('txt_email_mode_disabled')}</option>
        </select>
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.55rem">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="field-section-title" style="margin-bottom:0">${t('txt_reg_questions')}</span>
            <span class="participant-count" id="reg-new-questions-count">(0)</span>
          </div>
          <label for="reg-new-contact" style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;cursor:pointer">
            <input type="checkbox" id="reg-new-contact" checked style="width:1rem;height:1rem;cursor:pointer" onchange="_toggleNewRegContact(this.checked)">
            <span>${t('txt_reg_request_contact')}</span>
          </label>
        </div>
        <div id="reg-new-questions">
          <div class="reg-q-empty" id="reg-new-questions-empty">${t('txt_reg_q_no_questions')}</div>
        </div>
        <button type="button" class="add-participant-btn" style="margin-top:0.4rem" onclick="_addRegQuestion('reg-new-questions')">${t('txt_reg_add_question')}</button>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
        <input type="checkbox" id="reg-new-listed" style="width:1rem;height:1rem;cursor:pointer">
        <label for="reg-new-listed" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_listed')}</label>
      </div>
      <div style="text-align:center">
        <button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,_submitCreateRegistration)">${t('txt_reg_create')}</button>
      </div>`;

  _restoreCreateRegistrationDraft(draft);

  _toggleNewRegContact(true);
}

async function _submitCreateRegistration() {
  const name = document.getElementById('reg-new-name')?.value?.trim();
  if (!name) return;
  const body = { name };

  const desc = document.getElementById('reg-new-desc')?.value?.trim();
  if (desc) body.description = desc;

  if (document.getElementById('reg-new-joincode-toggle')?.checked) {
    const code = document.getElementById('reg-new-joincode')?.value?.trim();
    if (code) body.join_code = code;
  }

  const questions = _collectRegQuestions();
  if (document.getElementById('reg-new-contact')?.checked) {
    if (!questions.some(q => q.key === 'contact')) {
      questions.unshift({ key: 'contact', label: t('txt_reg_contact'), type: 'text', required: false, choices: [] });
    }
  }
  if (questions.length) body.questions = questions;

  body.listed = !!document.getElementById('reg-new-listed')?.checked;
  body.email_requirement = document.getElementById('reg-new-emailreq')?.value || 'optional';

  body.sport = _currentSport || 'padel';

  await api('/api/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await loadRegistrations();
  setActiveTab('home');
}

let _regQuestionCounter = 0;

function _updateRegQNumbers(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const cards = container.querySelectorAll('.reg-q-card');
  const count = cards.length;
  cards.forEach((card, i) => {
    const num = card.querySelector('.reg-q-number');
    if (num) num.textContent = `Q${i + 1}`;
  });
  const countEl = document.getElementById(`${containerId}-count`);
  if (countEl) countEl.textContent = `(${count})`;
  const empty = document.getElementById(`${containerId}-empty`);
  if (empty) empty.style.display = count ? 'none' : '';
}

function _addRegQuestion(containerId, noFocus = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const idx = _regQuestionCounter++;
  const div = document.createElement('div');
  div.className = 'reg-q-card reg-q-item';
  div.dataset.qidx = idx;
  div.dataset.qContainer = containerId;
  div.innerHTML = `
    <div class="reg-q-card-header">
      <span class="reg-q-number">Q1</span>
      <label class="switch-label" style="cursor:pointer;font-size:0.78rem">
        <input type="checkbox" class="reg-q-required">
        <span class="switch-track"></span>
        <span>${t('txt_reg_q_required')}</span>
      </label>
      <button type="button" class="reg-q-remove" onclick="_removeRegQuestion(this)" title="Remove">✕</button>
    </div>
    <div class="reg-q-card-body">
      <input type="text" class="reg-q-label" placeholder="${t('txt_reg_question_label')}" maxlength="128">
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
        <div class="reg-q-type-toggle" data-current="text">
          <button type="button" class="active" data-type="text" onclick="_setRegQType(this,'text')">${t('txt_reg_q_type_text')}</button>
          <button type="button" data-type="number" onclick="_setRegQType(this,'number')">${t('txt_reg_q_type_number')}</button>
          <button type="button" data-type="choice" onclick="_setRegQType(this,'choice')">${t('txt_reg_q_type_choice')}</button>
          <button type="button" data-type="multichoice" onclick="_setRegQType(this,'multichoice')">${t('txt_reg_q_type_multichoice')}</button>
        </div>
      </div>
      <div class="reg-q-choices-area">
        <div class="reg-q-choices-list"></div>
        <button type="button" class="reg-q-add-choice-btn" onclick="_addRegChoice(this)">${t('txt_reg_q_add_choice')}</button>
      </div>
    </div>`;
  container.appendChild(div);
  _updateRegQNumbers(containerId);
  if (!noFocus) div.querySelector('.reg-q-label')?.focus();
}

function _removeRegQuestion(btn) {
  const card = btn.closest('.reg-q-card');
  const containerId = card?.dataset.qContainer || 'reg-new-questions';
  if (card) card.remove();
  _updateRegQNumbers(containerId);
}

function _setRegQType(btn, type) {
  const toggle = btn.closest('.reg-q-type-toggle');
  if (!toggle) return;
  toggle.dataset.current = type;
  toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const area = btn.closest('.reg-q-card-body')?.querySelector('.reg-q-choices-area');
  if (!area) return;
  if (type === 'choice' || type === 'multichoice') {
    area.classList.add('open');
    if (!area.querySelector('.reg-q-choice-row')) _addRegChoice(area.querySelector('.reg-q-add-choice-btn'));
  } else {
    area.classList.remove('open');
  }
}

function _addRegChoice(btn) {
  const area = btn.closest('.reg-q-choices-area');
  const list = area?.querySelector('.reg-q-choices-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'reg-q-choice-row';
  row.innerHTML = `<input type="text" class="reg-q-choice-val" placeholder="${t('txt_reg_q_choices_placeholder')}" maxlength="128"><button type="button" class="reg-q-choice-remove" onclick="this.parentElement.remove()" title="Remove">✕</button>`;
  list.appendChild(row);
  row.querySelector('input')?.focus();
}

function _collectRegQuestions(containerId = 'reg-new-questions') {
  const container = document.getElementById(containerId);
  const items = container ? container.querySelectorAll('.reg-q-item') : [];
  // Start fallback index past all existing q<n> keys to avoid collisions on new questions
  let idx = 0;
  for (const item of items) {
    const origKey = item.dataset.originalKey;
    if (origKey) {
      const m = origKey.match(/^q(\d+)$/);
      if (m) idx = Math.max(idx, parseInt(m[1], 10) + 1);
    }
  }
  const questions = [];
  for (const item of items) {
    const label = item.querySelector('.reg-q-label')?.value?.trim();
    if (!label) continue;
    const toggle = item.querySelector('.reg-q-type-toggle');
    const type = toggle?.dataset.current || 'text';
    const required = !!item.querySelector('.reg-q-required')?.checked;
    const key = item.dataset.originalKey || `q${idx++}`;
    const q = { key, label, type, required };
    if (type === 'choice' || type === 'multichoice') {
      const inputs = item.querySelectorAll('.reg-q-choice-val');
      q.choices = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    } else {
      q.choices = [];
    }
    questions.push(q);
  }
  return questions;
}

// ─── Registration detail helpers ──────────────────────────

async function _copyAllRegCodes(rid) {
  const r = _regDetails[rid];
  if (!r?.registrants) return;
  const lines = r.registrants.map(reg => `${reg.player_name}: ${reg.passphrase}`).join('\n');
  try {
    await navigator.clipboard.writeText(lines);
    _showToast(t('txt_txt_codes_copied'));
  } catch { /* clipboard access denied */ }
}

function _renderAnswersPanel(rid, r, questions) {
  let h = `<details class="reg-section" style="margin-bottom:0.75rem">`;
  h += `<summary class="reg-section-summary" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  h += `<span style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_answers_title')} (${questions.length})</span>`;
  h += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="event.preventDefault();_downloadAnswersCSV('${esc(rid)}')">${t('txt_reg_download_answers_csv')}</button>`;
  h += `</summary>`;

  const DICT_THRESHOLD = 25;
  // Participant quick-filter (search input + select)
  h += `<div class="reg-answers-participant-filter-row">`;
  h += `<label class="reg-answers-participant-label">${t('txt_reg_participant_filter')}</label>`;
  h += `<input type="text" class="reg-answers-participant-search" placeholder="${esc(t('txt_reg_search_by_name'))}" autocomplete="off" spellcheck="false" oninput="_regFilterParticipantOptions(this)">`;
  h += `<select class="reg-answers-participant-select" onchange="_regFilterByParticipant(this)">`;
  h += `<option value="">${t('txt_reg_all_participants')}</option>`;
  for (const reg of r.registrants) {
    h += `<option value="${esc(reg.player_name)}">${esc(reg.player_name)}</option>`;
  }
  h += `</select>`;
  h += `</div>`;
  h += `<div class="reg-answers-grid">`;
  for (const q of questions) {
    let counts = {}, useDictionary = false, choiceToLetter = {};
    const isChoiceType = (q.type === 'choice' || q.type === 'multichoice') && q.choices?.length;
    if (isChoiceType) {
      for (const c of q.choices) counts[c] = 0;
      for (const reg of r.registrants) {
        const a = reg.answers?.[q.key];
        if (a) {
          if (q.type === 'multichoice') {
            let selected = [];
            try { selected = JSON.parse(a) || []; } catch (_) {}
            for (const s of selected) counts[s] = (counts[s] || 0) + 1;
          } else {
            counts[a] = (counts[a] || 0) + 1;
          }
        }
      }
      useDictionary = q.choices.some(c => c.length > DICT_THRESHOLD);
      if (useDictionary) {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        q.choices.forEach((c, i) => { choiceToLetter[c] = letters[i] ?? `#${i + 1}`; });
      }
    }

    // Card header
    const unansweredCount = r.registrants.filter(reg => !reg.answers?.[q.key]).length;
    h += `<div class="reg-answer-card${unansweredCount > 0 ? ' hide-empty' : ''}">`;

    h += `<div class="reg-answer-card-header">`;
    h += `<span class="reg-answer-card-label">${esc(q.label)}</span>`;
    if (q.type === 'choice' || q.type === 'multichoice') {
      const typeLabel = q.type === 'multichoice' ? t('txt_reg_q_type_multichoice') : t('txt_reg_q_type_choice');
      h += `<span class="badge ${q.required ? 'badge-phase' : ''}" style="font-size:0.68rem">${typeLabel}${q.required ? ' · ' + t('txt_reg_q_required') : ''}</span>`;
    } else {
      const ansCount = r.registrants.length - unansweredCount;
      if (q.type === 'number') {
        h += `<span class="badge" style="font-size:0.68rem">${t('txt_reg_q_type_number')}</span>`;
      }
      h += `<span class="reg-answer-count-badge">${ansCount} / ${r.registrants.length}</span>`;
    }
    if (unansweredCount > 0) {
      h += `<button type="button" class="reg-answer-hide-empty-btn active" onclick="event.stopPropagation();_regToggleHideEmpty(this)" title="${t('txt_reg_hide_unanswered')}">⊘ ${unansweredCount}</button>`;
    }
    h += `</div>`;

    // Dictionary legend (choice questions with long options)
    if (useDictionary) {
      h += `<div class="reg-answer-legend">`;
      for (const c of q.choices) {
        h += `<span class="reg-answer-legend-item"><b>${choiceToLetter[c]}</b><span class="reg-answer-legend-text">${esc(c)}</span></span>`;
      }
      h += `</div>`;
    }

    // Distribution bars (choice/multichoice questions)
    if (isChoiceType) {
      h += `<div class="reg-answer-bars">`;
      for (const c of q.choices) {
        const pct = r.registrants.length > 0 ? Math.round((counts[c] / r.registrants.length) * 100) : 0;
        const label = useDictionary ? choiceToLetter[c] : esc(c);
        h += `<div class="reg-answer-bar-row" data-choice="${esc(c)}" title="${t('txt_reg_filter_by_choice')}" onclick="_regFilterByChoice(this)">`;
        h += `<span class="reg-answer-bar-label">${label}</span>`;
        h += `<div class="reg-answer-bar-track"><div class="reg-answer-bar-fill" style="width:${pct}%"></div></div>`;
        h += `<span class="reg-answer-bar-count">${counts[c]}</span>`;
        h += `</div>`;
      }
      h += `</div>`;
    }

    // Inline individual answers list (text/number questions) or spoiler (choice/multichoice questions)
    if (q.type !== 'choice' && q.type !== 'multichoice') {
      const TRUNCATE = 100;
      h += `<div class="reg-answer-text-section">`;
      // Number stats: average
      if (q.type === 'number') {
        const numVals = r.registrants
          .map(reg => parseFloat(reg.answers?.[q.key]))
          .filter(n => !isNaN(n));
        if (numVals.length > 0) {
          const avg = (numVals.reduce((a, b) => a + b, 0) / numVals.length).toFixed(2).replace(/\.?0+$/, '');
          h += `<div class="reg-answer-num-stats">${t('txt_reg_answers_avg')}: <b>${avg}</b></div>`;
        }
      }
      if (r.registrants.length > 4) {
        h += `<input type="text" class="reg-answer-text-search" placeholder="${t('txt_reg_search_by_name')}" oninput="_regFilterAnswers(this)">`;
      }
      h += `<div class="reg-answer-text-list">`;
      for (const reg of r.registrants) {
        const answer = reg.answers?.[q.key] || '';
        const isLong = answer.length > TRUNCATE;
        const snippet = isLong ? esc(answer.slice(0, TRUNCATE)) + '\u2026' : (answer ? esc(answer) : '&mdash;');
        const clickAttr = isLong ? `onclick="_regToggleAnswerExpand(this)" title="${t('txt_reg_click_to_expand')}"` : '';
        h += `<div class="reg-answer-text-row${isLong ? ' long' : ''}" data-name="${esc(reg.player_name)}" data-answered="${answer ? 'true' : 'false'}">`;
        h += `<span class="reg-answer-name">${esc(reg.player_name)}</span>`;
        h += `<span class="reg-answer-text-val" ${clickAttr} data-full="${esc(answer)}">${snippet}</span>`;
        h += `</div>`;
      }
      h += `</div></div>`;
    } else {
      // Individual answers under spoiler with sort toggle
      h += `<details class="reg-answer-spoiler">`;
      h += `<summary class="reg-answer-spoiler-summary">`;
      h += `<span class="reg-answer-spoiler-title">${t('txt_reg_show_individual_answers')} (${r.registrants.length})</span>`;
      h += `<button type="button" class="reg-answer-sort-btn" data-sorted="false" onclick="event.stopPropagation();event.preventDefault();_regSortChoiceAnswers(this)">${t('txt_reg_sort_by_answer')}</button>`;
      h += `</summary>`;
      h += `<div class="reg-answer-list">`;
      for (let i = 0; i < r.registrants.length; i++) {
        const reg = r.registrants[i];
        const raw = reg.answers?.[q.key];
        let display = '—', sortKey = '';
        if (raw && q.type === 'multichoice') {
          let selected = [];
          try { selected = JSON.parse(raw) || []; } catch (_) {}
          display = selected.map(s => useDictionary ? (choiceToLetter[s] ?? esc(s)) : esc(s)).join(', ') || '—';
          sortKey = selected.join(',');
        } else if (raw) {
          display = useDictionary ? (choiceToLetter[raw] ?? esc(raw)) : esc(raw);
          sortKey = raw;
        }
        h += `<div class="reg-answer-row" data-name="${esc(reg.player_name)}" data-choice="${esc(sortKey)}" data-answered="${raw ? 'true' : 'false'}" data-idx="${i}">`;
        h += `<span class="reg-answer-name">${esc(reg.player_name)}</span>`;
        h += `<span class="reg-answer-value">${display}</span>`;
        h += `</div>`;
      }
      h += `</div></details>`;
    }

    h += `</div>`; // close card
  }
  h += `</div>`;
  h += `</details>`;
  return h;
}

function _regToggleAnswerExpand(el) {
  const row = el.closest('.reg-answer-text-row');
  if (!row) return;
  const isExpanded = row.classList.toggle('expanded');
  const full = el.dataset.full || '';
  el.textContent = isExpanded ? full : full.slice(0, 100) + '\u2026';
}

function _regFilterAnswers(input) {
  const q = input.value.toLowerCase();
  const list = input.parentElement?.querySelector('.reg-answer-text-list');
  if (!list) return;
  const card = input.closest('.reg-answer-card');
  const hideEmpty = card?.classList.contains('hide-empty') ?? false;
  for (const row of list.querySelectorAll('.reg-answer-text-row')) {
    const name = (row.dataset.name || '').toLowerCase();
    const answered = row.dataset.answered === 'true';
    const nameMatch = !q || name.includes(q);
    row.style.display = (!nameMatch || (hideEmpty && !answered)) ? 'none' : '';
  }
}

function _regFilterParticipantOptions(searchInput) {
  const q = searchInput.value.toLowerCase();
  const select = searchInput.nextElementSibling;
  if (!select) return;
  for (const opt of select.options) {
    if (!opt.value) { opt.hidden = false; continue; } // always show "All"
    opt.hidden = q ? !opt.value.toLowerCase().includes(q) : false;
  }
  // Auto-select if exactly one visible match; reset to "All" when cleared
  const visible = Array.from(select.options).filter(o => !o.hidden && o.value);
  if (visible.length === 1) {
    select.value = visible[0].value;
  } else if (!q) {
    select.value = '';
  }
  _regFilterByParticipant(select);
}

function _regFilterByParticipant(selectEl) {
  const participant = selectEl.value;
  const grid = selectEl.closest('details')?.querySelector('.reg-answers-grid');
  if (!grid) return;
  grid.dataset.participant = participant;
  grid.querySelectorAll('.reg-answer-card').forEach(card => {
    if (participant) {
      const spoiler = card.querySelector('.reg-answer-spoiler');
      if (spoiler) spoiler.open = true;
    }
    _regApplyRowFilters(card);
  });
}

function _regApplyRowFilters(card) {
  const hideEmpty = card.classList.contains('hide-empty');
  const activeChoice = card.querySelector('.reg-answer-bar-row.active')?.dataset.choice ?? null;
  const searchInput = card.querySelector('.reg-answer-text-search');
  const nameQuery = searchInput ? searchInput.value.toLowerCase() : '';
  const participantFilter = card.closest('.reg-answers-grid')?.dataset.participant ?? '';

  // Text question rows
  card.querySelectorAll('.reg-answer-text-row').forEach(row => {
    const answered = row.dataset.answered === 'true';
    const name = (row.dataset.name || '').toLowerCase();
    const nameMatch = !nameQuery || name.includes(nameQuery);
    const participantMatch = !participantFilter || row.dataset.name === participantFilter;
    row.style.display = (!nameMatch || !participantMatch || (hideEmpty && !answered)) ? 'none' : '';
  });

  // Choice individual answer rows
  card.querySelectorAll('.reg-answer-row').forEach(row => {
    const answered = row.dataset.answered === 'true';
    const choiceMatch = activeChoice === null || row.dataset.choice === activeChoice;
    const participantMatch = !participantFilter || row.dataset.name === participantFilter;
    row.style.display = (hideEmpty && !answered) || !choiceMatch || !participantMatch ? 'none' : '';
  });
}

function _regToggleHideEmpty(btn) {
  const card = btn.closest('.reg-answer-card');
  if (!card) return;
  const active = card.classList.toggle('hide-empty');
  btn.classList.toggle('active', active);
  _regApplyRowFilters(card);
}

function _regFilterByChoice(barRow) {
  const card = barRow.closest('.reg-answer-card');
  if (!card) return;
  const spoiler = card.querySelector('.reg-answer-spoiler');
  if (!spoiler) return;

  const wasActive = barRow.classList.contains('active');
  card.querySelectorAll('.reg-answer-bar-row').forEach(r => r.classList.remove('active'));

  if (!wasActive) {
    barRow.classList.add('active');
    spoiler.open = true;
  }

  _regApplyRowFilters(card);
}

function _regSortChoiceAnswers(btn) {
  const list = btn.closest('.reg-answer-spoiler')?.querySelector('.reg-answer-list');
  if (!list) return;
  const sorted = btn.dataset.sorted === 'true';
  const rows = Array.from(list.querySelectorAll('.reg-answer-row'));
  if (!sorted) {
    rows.sort((a, b) => (a.dataset.choice || '').localeCompare(b.dataset.choice || ''));
    btn.dataset.sorted = 'true';
    btn.textContent = t('txt_reg_sort_by_registration');
    btn.classList.add('active');
  } else {
    rows.sort((a, b) => parseInt(a.dataset.idx || 0) - parseInt(b.dataset.idx || 0));
    btn.dataset.sorted = 'false';
    btn.textContent = t('txt_reg_sort_by_answer');
    btn.classList.remove('active');
  }
  rows.forEach(row => list.appendChild(row));
}

function _csvCell(v) {
  const s = String(v ?? '');
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function _downloadAnswersCSV(rid) {
  const r = _regDetails[rid];
  if (!r?.registrants) return;
  const questions = r.questions || [];
  if (!questions.length) return;
  const header = [t('txt_reg_name'), ...questions.map(q => q.label)].map(_csvCell).join(',');
  const rows = r.registrants.map(reg => {
    const cells = [reg.player_name, ...questions.map(q => {
      const raw = reg.answers?.[q.key] || '';
      if (q.type === 'multichoice' && raw) {
        try { return (JSON.parse(raw) || []).join(', '); } catch (_) {}
      }
      return raw;
    })];
    return cells.map(_csvCell).join(',');
  });
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `answers_${(r.name || rid).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function _autoResizeTextarea(el) {
  el.style.overflow = 'hidden';
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function _captureRegQuestionsDraft(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const items = container.querySelectorAll('.reg-q-item');
  const draft = [];
  for (const item of items) {
    const label = item.querySelector('.reg-q-label')?.value?.trim() || '';
    if (!label) continue;
    const type = item.querySelector('.reg-q-type-toggle')?.dataset.current || 'text';
    const required = !!item.querySelector('.reg-q-required')?.checked;
    const key = item.dataset.originalKey || '';
    const choices = (type === 'choice' || type === 'multichoice')
      ? Array.from(item.querySelectorAll('.reg-q-choice-val')).map(i => i.value.trim()).filter(Boolean)
      : [];
    draft.push({ key, label, type, required, choices });
  }
  return draft;
}

function _restoreRegQuestionsDraft(containerId, draft) {
  const container = document.getElementById(containerId);
  if (!container || draft == null) return;
  container.innerHTML = `<div class="reg-q-empty" id="${containerId}-empty">${t('txt_reg_q_no_questions')}</div>`;
  _regQuestionCounter = 0;
  for (const q of draft) {
    _addRegQuestion(containerId, true);
    const cards = container.querySelectorAll('.reg-q-card');
    const card = cards[cards.length - 1];
    if (!card) continue;
    if (q.key) card.dataset.originalKey = q.key;

    const labelInput = card.querySelector('.reg-q-label');
    if (labelInput) labelInput.value = q.label || '';

    const reqCb = card.querySelector('.reg-q-required');
    if (reqCb) reqCb.checked = !!q.required;

    const type = q.type || 'text';
    if (type !== 'text') {
      const typeBtn = card.querySelector(`.reg-q-type-toggle button[data-type="${type}"]`);
      if (typeBtn) _setRegQType(typeBtn, type);
    }

    if (type === 'choice' || type === 'multichoice') {
      const area = card.querySelector('.reg-q-choices-area');
      const list = area?.querySelector('.reg-q-choices-list');
      const addBtn = area?.querySelector('.reg-q-add-choice-btn');
      if (list) list.innerHTML = '';
      for (const choice of q.choices || []) {
        if (!addBtn) break;
        _addRegChoice(addBtn);
        const rows = card.querySelectorAll('.reg-q-choice-row .reg-q-choice-val');
        const input = rows[rows.length - 1];
        if (input) input.value = choice;
      }
    }
  }
  _updateRegQNumbers(containerId);
}

function _populateRegQuestions(containerId, questions) {
  for (const q of questions) {
    _addRegQuestion(containerId, true);
    const container = document.getElementById(containerId);
    if (!container) break;
    const cards = container.querySelectorAll('.reg-q-card');
    const card = cards[cards.length - 1];
    if (!card) continue;
    card.dataset.originalKey = q.key;
    const labelInput = card.querySelector('.reg-q-label');
    if (labelInput) labelInput.value = q.label;
    if (q.required) {
      const reqCb = card.querySelector('.reg-q-required');
      if (reqCb) reqCb.checked = true;
    }
    if (q.type !== 'text') {
      const typeBtn = card.querySelector(`.reg-q-type-toggle button[data-type="${q.type}"]`);
      if (typeBtn) _setRegQType(typeBtn, q.type);
    }
    if (q.type === 'choice' || q.type === 'multichoice') {
      const area = card.querySelector('.reg-q-choices-area');
      const list = area?.querySelector('.reg-q-choices-list');
      if (list && q.choices?.length) {
        list.innerHTML = '';
        for (const choice of q.choices) {
          const row = document.createElement('div');
          row.className = 'reg-q-choice-row';
          row.innerHTML = `<input type="text" class="reg-q-choice-val" placeholder="${t('txt_reg_q_choices_placeholder')}" maxlength="128"><button type="button" class="reg-q-choice-remove" onclick="this.parentElement.remove()" title="Remove">✕</button>`;
          row.querySelector('input').value = choice;
          list.appendChild(row);
        }
      }
    }
  }
}

async function _saveRegQuestions(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const containerId = `reg-edit-questions-${rid}`;
  const newQuestions = _collectRegQuestions(containerId);
  const origQuestions = r.questions || [];

  const newKeyMap = new Map(newQuestions.map(q => [q.key, q]));
  const keysToDiscard = [];
  for (const orig of origQuestions) {
    if (!newKeyMap.has(orig.key)) {
      keysToDiscard.push(orig.key);
      continue;
    }
    const updated = newKeyMap.get(orig.key);
    if (orig.type !== updated.type) {
      keysToDiscard.push(orig.key);
      continue;
    }
    if (orig.type === 'choice') {
      const origSet = new Set(orig.choices || []);
      const newArr = updated.choices || [];
      const changed = newArr.length !== origSet.size || newArr.some(c => !origSet.has(c));
      if (changed) keysToDiscard.push(orig.key);
    }
  }

  const body = { questions: newQuestions };
  const hasAffectedAnswers = keysToDiscard.length > 0 &&
    r.registrants?.some(reg => keysToDiscard.some(k => reg.answers?.[k]));
  if (hasAffectedAnswers && confirm(t('txt_reg_q_discard_prompt'))) {
    body.clear_answers_for_keys = keysToDiscard;
  }

  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
}

async function _saveRegSettings(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const body = {};
  const name = document.getElementById(`reg-edit-name-${rid}`)?.value?.trim();
  if (name) body.name = name;
  const desc = document.getElementById(`reg-edit-desc-${rid}`)?.value;
  if (desc !== undefined) {
    if (desc.trim()) body.description = desc; else body.clear_description = true;
  }
  const joinCode = document.getElementById(`reg-edit-joincode-${rid}`)?.value?.trim();
  if (joinCode) body.join_code = joinCode; else body.clear_join_code = true;

  body.listed = !!document.getElementById(`reg-edit-listed-${rid}`)?.checked;
  body.email_requirement = document.getElementById(`reg-edit-emailreq-${rid}`)?.value || 'optional';

  const autoEmailCb = document.getElementById(`reg-edit-autoemail-${rid}`);
  if (autoEmailCb) body.auto_send_email = autoEmailCb.checked;

  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
  await loadRegistrations();
}

function _editRegistrant(rid, pid, currentName, currentEmail) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:380px;width:100%">
    <h3 style="margin:0 0 1rem;font-size:1rem">${t('txt_reg_edit_player')}</h3>
    <div style="margin-bottom:0.75rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_name')}</label>
      <input id="_er-name" type="text" value="${escAttr(currentName)}" maxlength="128" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="margin-bottom:1.1rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_email_label')} <span style="color:var(--text-muted);font-weight:400">(${t('txt_txt_optional')})</span></label>
      <input id="_er-email" type="email" value="${escAttr(currentEmail)}" maxlength="320" placeholder="${t('txt_reg_email_placeholder')}" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button type="button" class="btn btn-sm" id="_er-cancel">${t('txt_txt_cancel')}</button>
      <button type="button" class="btn btn-primary btn-sm" id="_er-save">${t('txt_reg_save')}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#_er-cancel').onclick = () => modal.remove();
  modal.querySelector('#_er-save').onclick = async () => {
    const nameEl = modal.querySelector('#_er-name');
    const emailEl = modal.querySelector('#_er-email');
    const newName = nameEl.value.trim();
    const newEmail = emailEl.value.trim();
    if (!newName) { nameEl.focus(); return; }
    const patch = {};
    if (newName !== currentName) patch.player_name = newName;
    if (newEmail !== currentEmail) patch.email = newEmail || null;
    if (!Object.keys(patch).length) { modal.remove(); return; }
    try {
      await api(`/api/registrations/${rid}/registrant/${pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      modal.remove();
      _showToast(t('txt_reg_saved'));
      await _loadRegDetail(rid);
      await loadRegistrations();
    } catch (e) { alert(e.message || t('txt_reg_error')); }
  };
  modal.querySelector('#_er-name').focus();
}

async function _removeRegistrant(rid, pid) {
  if (!confirm(t('txt_reg_confirm_remove'))) return;
  try {
    await api(`/api/registrations/${rid}/registrant/${pid}`, { method: 'DELETE' });
    await _loadRegDetail(rid);
    await loadRegistrations();
  } catch (e) { alert(e.message || t('txt_reg_error')); }
}

function _adminAddRegistrant(rid) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:380px;width:100%">
    <h3 style="margin:0 0 1rem;font-size:1rem">${t('txt_reg_add_player')}</h3>
    <div style="margin-bottom:0.75rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_name')}</label>
      <input id="_ar-name" type="text" maxlength="128" placeholder="${t('txt_reg_add_player_prompt')}" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="margin-bottom:1.1rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_email_label')} <span style="color:var(--text-muted);font-weight:400">(${t('txt_txt_optional')})</span></label>
      <input id="_ar-email" type="email" maxlength="320" placeholder="${t('txt_reg_email_placeholder')}" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button type="button" class="btn btn-sm" id="_ar-cancel">${t('txt_txt_cancel')}</button>
      <button type="button" class="btn btn-primary btn-sm" id="_ar-save">${t('txt_reg_add_player')}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#_ar-cancel').onclick = () => modal.remove();
  modal.querySelector('#_ar-save').onclick = async () => {
    const nameEl = modal.querySelector('#_ar-name');
    const emailEl = modal.querySelector('#_ar-email');
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const body = { player_name: name };
    if (email) body.email = email;
    try {
      await api(`/api/registrations/${rid}/registrant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      modal.remove();
      _showToast(t('txt_reg_saved'));
      await _loadRegDetail(rid);
      await loadRegistrations();
    } catch (e) { alert(e.message || t('txt_reg_error')); }
  };
  modal.querySelector('#_ar-name').focus();
}

async function _saveRegMessage(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const msg = document.getElementById(`reg-edit-message-${rid}`)?.value?.trim();
  const body = msg ? { message: msg } : { clear_message: true };
  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
  _showToast(t('txt_reg_saved'));
}

async function _sendRegEmail(rid, pid) {
  try {
    await api(`/api/registrations/${rid}/send-email/${pid}`, { method: 'POST' });
    _showToast(t('txt_email_sent'));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _sendAllRegEmails(rid) {
  if (!confirm(t('txt_email_confirm_send_all'))) return;
  try {
    const res = await api(`/api/registrations/${rid}/send-all-emails`, { method: 'POST' });
    _showToast(t('txt_email_sent_count', { sent: res.sent || 0, skipped: res.skipped || 0 }));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _notifyTournamentPlayers(tid) {
  if (!confirm(t('txt_email_confirm_notify'))) return;
  try {
    const res = await api(`/api/tournaments/${tid}/notify-players`, { method: 'POST' });
    const data = typeof res === 'object' ? res : await res;
    _showToast(t('txt_email_notify_sent', { sent: data.sent || 0, skipped: data.skipped || 0 }));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _sendRegMessageEmails(rid) {
  if (!confirm(t('txt_email_confirm_send_message_all'))) return;
  try {
    const res = await api(`/api/registrations/${rid}/send-message-emails`, { method: 'POST' });
    const data = typeof res === 'object' ? res : await res;
    _showToast(t('txt_email_message_sent_count', { sent: data.sent || 0, skipped: data.skipped || 0 }));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _clearRegMessage(rid) {
  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear_message: true }) });
  await _loadRegDetail(rid);
}

function _toggleRegDescPreview(rid) {
  const preview = document.getElementById(`reg-desc-preview-${rid}`);
  const textarea = document.getElementById(`reg-edit-desc-${rid}`);
  if (!preview || !textarea) return;
  if (preview.style.display === 'none') {
    const md = textarea.value || '';
    try {
      const rawHtml = typeof marked !== 'undefined' && marked.parse ? marked.parse(md) : md.replace(/</g, '&lt;');
      preview.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] }) : esc(md);
    } catch (_) { preview.textContent = md; }
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

function _toggleNewRegDescPreview() {
  const preview = document.getElementById('reg-new-desc-preview');
  const textarea = document.getElementById('reg-new-desc');
  if (!preview || !textarea) return;
  if (preview.style.display === 'none') {
    const md = textarea.value || '';
    try {
      const rawHtml = typeof marked !== 'undefined' && marked.parse ? marked.parse(md) : md.replace(/</g, '&lt;');
      preview.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] }) : esc(md);
    } catch (_) { preview.textContent = md; }
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

