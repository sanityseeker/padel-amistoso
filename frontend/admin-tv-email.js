// ─── TV / Scope / Comms / Maintenance panel bodies ──────────────────────
//
// Each body function returns inner HTML (no outer card / details wrapper).
// They are composed by `_renderSettingsCard` (admin-settings-panel.js) into
// a unified Settings card with a sub-tab navigator.

/**
 * TV display & sharing body: alias, banner, TV section toggles, refresh
 * interval, schema sliders, "Open TV" launcher.
 */
function _renderTvSharingBody(tvSettings, hasCourts, isMexicano = false, hasPlayoffs = false) {
  if (!currentTid) return '';
  const s = tvSettings || {};
  const def = (k, d) => (s[k] !== undefined ? s[k] : d);
  const currentTournament = _tournamentMeta[currentTid] || {};

  const chkRow = (key, label, defaultVal, opts = {}) => {
    const disabled = opts.disabled || false;
    const forceOff = opts.forceOff || false;
    const forceOn = opts.forceOn || false;
    const resolvedVal = forceOff ? false : forceOn ? true : def(key, defaultVal);
    const checked = resolvedVal ? 'checked' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const opacityStyle = disabled ? 'opacity:0.45;cursor:not-allowed;' : 'cursor:pointer;';
    if ((forceOff || forceOn) && def(key, defaultVal) !== resolvedVal) {
      _updateTvSetting(key, resolvedVal);
    }
    return `<label style="display:flex;align-items:center;gap:0.45rem;${opacityStyle}font-size:0.84rem;"${disabled ? ' title="' + t('txt_tv_no_courts_hint') + '"' : ''}>
      <input type="checkbox" style="width:auto;min-height:auto;margin:0" ${checked} ${disabledAttr}
        onchange="_updateTvSetting('${key}', this.checked)">
      ${label}
    </label>`;
  };

  const currentAlias = currentTournament.alias || '';

  let html = '';

  // ── Group: Public link ─────────────────────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">🔗 ${t('txt_admin_settings_group_public_link')}</h4>`;

  // Tournament Alias
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_txt_tournament_alias')}</label>`;
  html += `<p class="settings-help">${t('txt_tv_alias_help')}</p>`;
  html += `<div class="settings-inline-row">`;
  html += `<input type="text" id="tournament-alias-input" placeholder="${t('txt_tv_alias_placeholder')}" value="${escAttr(currentAlias)}"
    pattern="[a-zA-Z0-9_-]+" maxlength="64"
    style="flex:1;min-width:200px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentAlias()" style="white-space:nowrap">${t('txt_txt_set_alias')}</button>`;
  if (currentAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="_deleteTournamentAlias()" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  const _tvSlug = currentAlias || currentTid;
  html += `<div class="settings-url-preview">`;
  html += `<div class="settings-url-preview-row">`;
  html += `<span style="color:var(--text-muted)">${t('txt_txt_tv_url')}</span> <code>/tv/${esc(_tvSlug)}</code>`;
  html += `</div>`;
  html += `<div class="settings-url-actions">`;
  html += `<button type="button" class="settings-url-copy-btn" onclick="navigator.clipboard.writeText(window.location.origin+'/tv/${escAttr(_tvSlug)}');alert('${escAttr(t('txt_txt_url_copied'))}')">📋 ${t('txt_txt_copy')}</button>`;
  html += `<button type="button" class="settings-url-copy-btn" onclick="window.open('/tv/${escAttr(_tvSlug)}','padel_tv_${escAttr(currentTid)}','noopener noreferrer')">📺 ${t('txt_txt_tv_mode_controls')} ↗</button>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  // ── Group: On-screen content ───────────────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">📺 ${t('txt_admin_settings_group_onscreen')}</h4>`;

  // Banner
  const currentBanner = def('banner_text', '');
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_banner_label')}</label>`;
  html += `<p class="settings-help">${t('txt_banner_help')}</p>`;
  html += `<div class="settings-inline-row">`;
  html += `<input type="text" id="tournament-banner-input" placeholder="${t('txt_banner_placeholder')}" value="${escAttr(currentBanner)}"
    maxlength="500"
    style="flex:1;min-width:200px;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentBanner()" style="white-space:nowrap">${t('txt_txt_set')}</button>`;
  if (currentBanner) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearTournamentBanner()" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `</div>`;

  // TV section toggles
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_admin_settings_tv_sections')}</label>`;
  html += `<p class="settings-help">${t('txt_tv_sections_help')}</p>`;
  html += `<div class="tv-settings-grid">`;
  html += chkRow('show_past_matches',   t('txt_txt_past_matches'),            true);
  if (isMexicano) html += chkRow('show_score_breakdown', t('txt_tv_score_breakdowns'), false);
  html += chkRow('show_standings',      t('txt_tv_standings_leaderboard'),    true);
  html += chkRow('show_bracket',        t('txt_txt_play_off_bracket'),        true);
  html += chkRow('show_courts',         t('txt_tv_court_assignments_view'),   true,  { disabled: !hasCourts, forceOff: !hasCourts });
  html += chkRow('show_pending_matches', t('txt_tv_pending_matches_view'),    false, { forceOn: !hasCourts });
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  // ── Group: Refresh & visuals ───────────────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">🔄 ${t('txt_admin_settings_group_refresh_visuals')}</h4>`;

  // Auto-refresh
  const currentInterval = def('refresh_interval', 15);
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_txt_auto_refresh_every')}</label>`;
  html += `<p class="settings-help">${t('txt_admin_settings_refresh_help')}</p>`;
  html += `<select style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem" onchange="_updateTvSetting('refresh_interval', +this.value)">`;
  [[-1,t('txt_tv_on_update')],[0,t('txt_tv_never')],[5,'5 s'],[10,'10 s'],[15,'15 s'],[30,'30 s'],[60,'1 min'],[120,'2 min'],[300,'5 min']].forEach(([secs, lbl]) => {
    html += `<option value="${secs}"${currentInterval === secs ? ' selected' : ''}>${lbl}</option>`;
  });
  html += `</select>`;
  html += `</div>`;

  // Schema rendering controls — only relevant when playoffs are active.
  if (hasPlayoffs) {
  const boxScale   = def('schema_box_scale',   1.0);
  const lineWidth  = def('schema_line_width',  1.0);
  const arrowScale = def('schema_arrow_scale', 1.0);
  const titleFontScale = def('schema_title_font_scale', 1.0);
  html += `<div class="settings-block">`;
  html += `<details class="settings-collapse-inner">`;
  html += `<summary>⚙ ${t('txt_txt_rendering_options')}</summary>`;
  html += `<div class="tv-sliders-grid">`;
  const sliders = [
    ['schema_box_scale',        'tv-schema-box',         t('txt_txt_box_size'),    0.3, 3.0, boxScale],
    ['schema_line_width',       'tv-schema-lw',          t('txt_txt_line_width'),  0.3, 5.0, lineWidth],
    ['schema_arrow_scale',      'tv-schema-arrow',       t('txt_txt_arrow_size'),  0.3, 5.0, arrowScale],
    ['schema_title_font_scale', 'tv-schema-title-scale', t('txt_txt_header_size'), 0.3, 3.0, titleFontScale],
  ];
  sliders.forEach(([key, elId, label, min, max, val]) => {
    html += `<label style="font-size:0.83rem;color:var(--text-muted);white-space:nowrap">${label} <span id="${elId}-val" style="color:var(--text)">${val.toFixed(1)}</span></label>`;
    html += `<input type="range" id="${elId}" min="${min}" max="${max}" step="0.1" value="${val}" style="width:100%;min-height:auto"
      oninput="document.getElementById('${elId}-val').textContent=(+this.value).toFixed(1)"
      onchange="_updateTvSetting('${key}', +this.value)">`;
  });
  html += `</div></details>`;
  html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/**
 * Scoring rules body: player scoring toggle, score-confirmation mode,
 * correction window, and per-stage points/sets toggles for active stages.
 *
 * scoringStages: optional array of `{ key, label }` entries; each adds a
 * points/sets toggle bound to `_setStageScoreMode(key, mode)`.
 */
function _renderScoringRulesBody(tvSettings, scoringStages = []) {
  if (!currentTid) return '';
  const s = tvSettings || {};
  const def = (k, d) => (s[k] !== undefined ? s[k] : d);

  let html = '';

  // ── Group: Player scoring & confirmation ─────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">🎯 ${t('txt_admin_settings_group_scoring_flow')}</h4>`;

  const _playerScoringOn = def('allow_player_scoring', true);
  html += `<div class="settings-block">`;
  html += `<label class="settings-master-toggle">`
    + `<input type="checkbox" ${_playerScoringOn ? 'checked' : ''}`
    +   ` onchange="_updateTvSetting('allow_player_scoring', this.checked); document.getElementById('scoring-dep-settings').classList.toggle('disabled', !this.checked)">`
    + `${t('txt_tv_allow_player_scoring')}`
    + `</label>`;
  html += `<p class="settings-master-help">${t('txt_tv_allow_player_scoring_help')}</p>`;
  html += `</div>`;

  html += `<div id="scoring-dep-settings" class="settings-dep-group${_playerScoringOn ? '' : ' disabled'}">`;

  const scoreConf = def('score_confirmation', 'immediate');
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_tv_score_confirmation')}</label>`;
  html += `<p class="settings-help">${t('txt_tv_score_confirmation_help')}</p>`;
  html += `<select style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem" onchange="_updateTvSetting('score_confirmation', this.value)">`;
  html += `<option value="immediate"${scoreConf === 'immediate' ? ' selected' : ''}>${t('txt_tv_score_confirmation_immediate')}</option>`;
  html += `<option value="required"${scoreConf === 'required' ? ' selected' : ''}>${t('txt_tv_score_confirmation_required')}</option>`;
  html += `</select>`;
  html += `</div>`;

  const corrSecs = def('correction_window_seconds', 0);
  const corrMins = Math.round(corrSecs / 60 * 10) / 10;
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_tv_correction_window')}</label>`;
  html += `<p class="settings-help">${t('txt_tv_correction_window_help')}</p>`;
  html += `<div class="settings-inline-row">`;
  html += `<input type="number" min="0" max="60" step="0.5" value="${corrMins}" style="width:5rem;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem"`;
  html += ` onchange="_updateTvSetting('correction_window_seconds', Math.max(0, Math.min(3600, Math.round((+this.value||0)*60))))">`;
  html += `<span style="font-size:0.84rem;color:var(--text-muted)">${t('txt_tv_window_minutes_label')}</span>`;
  html += `</div>`;
  html += `</div>`;

  html += `</div>`;
  html += `</div>`;

  // ── Group: Score format per stage ────────────────────────────
  if (scoringStages && scoringStages.length) {
    html += `<div class="settings-group">`;
    html += `<h4 class="settings-group-title">🎾 ${t('txt_admin_settings_group_score_format')}</h4>`;
    html += `<div class="settings-block">`;
    html += `<label class="settings-label">${t('txt_admin_settings_input_format')}</label>`;
    html += `<p class="settings-help">${t('txt_admin_settings_input_format_help')}</p>`;
    for (const stage of scoringStages) {
      const mode = _gpScoreMode[stage.key] || 'points';
      html += `<div class="settings-stage-row">`;
      html += `<span class="settings-stage-label">${esc(stage.label)}</span>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${mode === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('${escAttr(stage.key)}','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${mode === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('${escAttr(stage.key)}','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }
    html += `</div>`;
    html += `</div>`;
  }

  return html;
}

/**
 * Communications body: sender display name, reply-to, "Notify next round"
 * shortcut, "Send all player codes" shortcut, organizer message composer.
 * Returns '' when `window._emailConfigured` is false.
 */
function _renderCommsBody(emailSettings) {
  if (!currentTid || !window._emailConfigured) return '';
  const s = emailSettings || {};
  const senderName = s.sender_name || '';
  const replyTo = s.reply_to || '';
  const playerCount = Object.keys(_playerSecrets || {}).length;

  let html = '';

  // ── Group: Sender configuration ─────────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">✉ ${t('txt_admin_settings_group_sender')}</h4>`;

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_email_sender_name')}</label>`;
  html += `<p class="settings-help">${t('txt_email_sender_name_help')}</p>`;
  html += `<input type="text" id="email-settings-sender-name" value="${escAttr(senderName)}" maxlength="100"
    placeholder="${t('txt_email_sender_placeholder')}" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_email_reply_to')}</label>`;
  html += `<p class="settings-help">${t('txt_email_reply_to_help')}</p>`;
  html += `<input type="email" id="email-settings-reply-to" value="${escAttr(replyTo)}"
    placeholder="${t('txt_email_reply_to_placeholder')}" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<div class="settings-inline-row">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveEmailSettings())">${t('txt_email_save_email')}</button>`;
  html += `<span id="email-settings-saved-msg" style="color:var(--success,#22c55e);font-size:0.82rem;display:none">${t('txt_email_settings_saved')}</span>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  // ── Group: Bulk notifications ───────────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">📣 ${t('txt_admin_settings_group_bulk')}</h4>`;
  html += `<div class="settings-block">`;
  html += `<p class="settings-help">${t('txt_admin_settings_comms_bulk_help')}</p>`;
  html += `<div class="settings-inline-row">`;
  html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,_sendNextRoundEmails)">📧 ${t('txt_email_notify_round')}</button>`;
  if (playerCount > 0) {
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,_sendAllTournamentEmails)">📧 ${t('txt_email_send_all')}</button>`;
  }
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  // ── Group: Organizer message ────────────────────────────────
  if (playerCount > 0) {
    html += `<div class="settings-group">`;
    html += `<h4 class="settings-group-title">💬 ${t('txt_admin_settings_group_organizer_msg')}</h4>`;
    html += `<div class="settings-block">`;
    html += `<label class="settings-label">${t('txt_email_organizer_message')}</label>`;
    html += `<textarea id="pc-organizer-message" class="reg-desc-textarea" rows="3" placeholder="${t('txt_email_message_placeholder')}" oninput="_autoResizeTextarea(this)" style="width:100%"></textarea>`;
    html += `<div class="settings-inline-row" style="margin-top:0.4rem">`;
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendTournamentMessageEmails())">📧 ${t('txt_email_send_message')}</button>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;
  }

  return html;
}

/**
 * Access & scope body: collaborators list, club + community attachment row,
 * and Recalculate-ELO action.
 */
function _renderAccessScopeBody(collaborators) {
  if (!currentTid) return '';
  const currentTournament = _tournamentMeta[currentTid] || {};
  const currentCommunityId = currentTournament.community_id || 'open';
  const communityOptions = (_adminCommunities || []).map(c =>
    `<option value="${esc(c.id)}" ${c.id === currentCommunityId ? 'selected' : ''}>${c.is_builtin ? t('txt_comm_global_default') : esc(c.name)}</option>`
  ).join('');

  let html = '';

  // ── Group: Scope (community + club) ─────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">🏷 ${t('txt_admin_settings_group_scope')}</h4>`;
  html += `<div class="settings-block">`;

  html += `<p class="settings-help">${t('txt_tv_attach_club_community_help')}</p>`;

  const adminClubsLocal = (_adminClubs || []).filter(c => c.community_id === currentCommunityId);
  if (adminClubsLocal.length) {
    const currentClubId = currentTournament.club_id || '';
    const noneLabel = t('txt_txt_none_selected') || 'none';
    const clubOptions = `<option value="" ${!currentClubId ? 'selected' : ''}>— ${esc(noneLabel)} —</option>`
      + adminClubsLocal.map(c =>
        `<option value="${esc(c.id)}" ${c.id === currentClubId ? 'selected' : ''}>${esc(c.name)}</option>`
      ).join('');
    html += `<div class="settings-inline-row" style="margin-bottom:0.35rem">`;
    html += `<span style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap">${t('txt_tv_attach_club')}</span>`;
    html += `<select id="tournament-club-select" style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem;min-width:180px">${clubOptions}</select>`;
    html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentClub()">${t('txt_tv_attach_now')}</button>`;
    html += `<span id="tournament-club-msg" style="font-size:0.78rem"></span>`;
    html += `</div>`;
  }
  if (communityOptions) {
    html += `<div class="settings-inline-row">`;
    html += `<select id="tournament-community-select" style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem;min-width:220px">${communityOptions}</select>`;
    html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentCommunity()">${t('txt_tv_attach_now')}</button>`;
    html += `<span id="tournament-community-msg" style="font-size:0.78rem"></span>`;
    html += `</div>`;
  } else {
    html += `<p class="settings-help">${t('txt_comm_no_communities')}</p>`;
  }
  const currentCommunityLabel = currentTournament.community_name || currentCommunityId;
  const currentClubLabel = currentTournament.club_name || '';
  const currentScopeLabel = currentClubLabel || currentCommunityLabel;
  html += `<div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-muted)">${t('txt_tv_current_scope')}: ${esc(currentScopeLabel)}</div>`;
  html += `</div>`;
  html += `</div>`;

  // ── Group: Collaborators ────────────────────────────────────
  const collabHtml = _renderCollaboratorsBody(collaborators);
  if (collabHtml) {
    html += `<div class="settings-group">`;
    html += `<h4 class="settings-group-title">👥 ${t('txt_txt_collaborators')}</h4>`;
    html += `<div class="settings-block">`;
    html += collabHtml;
    html += `</div>`;
    html += `</div>`;
  }

  // ── Group: Maintenance ──────────────────────────────────────
  html += `<div class="settings-group">`;
  html += `<h4 class="settings-group-title">🛠 ${t('txt_admin_settings_maintenance')}</h4>`;
  html += `<div class="settings-block">`;
  html += `<p class="settings-help">${t('txt_admin_settings_recalc_help')}</p>`;
  html += `<div class="settings-inline-row">`;
  html += `<button type="button" class="btn btn-warning btn-sm" onclick="withLoading(this,_recalculateTournamentElo)">♻ ${t('txt_txt_recalculate_elo')}</button>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  return html;
}

/** Persist a single TV setting toggle to the backend. */
async function _updateTvSetting(key, value) {
  if (!currentTid) return;
  try {
    await api(`/api/tournaments/${currentTid}/tv-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: value }),
    });
  } catch (e) {
    console.error('TV setting update failed:', e.message);
  }
}

/** Trigger full tournament ELO recomputation from completed matches. */
async function _recalculateTournamentElo() {
  if (!currentTid) return;
  if (!confirm(t('txt_txt_confirm_recalculate_elo'))) return;
  try {
    await api(`/api/tournaments/${currentTid}/elo/recalculate`, { method: 'POST' });
    await _rerenderCurrentViewPreserveDrafts();
    _showToast(t('txt_txt_elo_recalculated'));
  } catch (e) {
    _showToast(t('txt_txt_elo_recalc_failed_value', { value: e.message }));
  }
}

/** Send next-round schedule notifications to all players with email addresses. */
async function _sendNextRoundEmails() {
  if (!currentTid) return;
  try {
    const data = await api(`/api/tournaments/${currentTid}/send-next-round-emails`, { method: 'POST' });
    alert(t('txt_email_notify_round_sent', { sent: data.sent, skipped: data.skipped }));
  } catch (e) {
    alert(e.message || t('txt_email_round_notify_failed'));
  }
}

/** Persist email settings (sender_name, reply_to) to the backend via PATCH. */
async function _saveEmailSettings() {
  if (!currentTid) return;
  const senderName = document.getElementById('email-settings-sender-name')?.value.trim() ?? '';
  const replyTo = document.getElementById('email-settings-reply-to')?.value.trim() ?? '';
  try {
    await api(`/api/tournaments/${currentTid}/email-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ sender_name: senderName, reply_to: replyTo || null }),
    });
    const msg = document.getElementById('email-settings-saved-msg');
    if (msg) {
      msg.style.display = 'inline';
      setTimeout(() => { msg.style.display = 'none'; }, 2500);
    }
  } catch (e) {
    console.error('Email settings save failed:', e.message);
  }
}

/** Resolve a score dispute as admin. */
async function _adminResolveDispute(matchId, ctx) {
  if (!currentTid) return;
  const radios = document.querySelectorAll(`input[name="dr-${matchId}"]`);
  let chosen = 'original';
  for (const r of radios) { if (r.checked) { chosen = r.value; break; } }

  const payload = { chosen };

  if (chosen === 'custom') {
    // Check for tennis/sets mode in custom inputs
    const setsDiv = document.getElementById('dr-custom-sets-' + matchId);
    const isTennis = setsDiv && !setsDiv.classList.contains('hidden');
    if (isTennis) {
      const sets = [];
      for (let i = 0; i < 10; i++) {
        const e1 = document.getElementById('ts1-dr-' + matchId + '-' + i);
        const e2 = document.getElementById('ts2-dr-' + matchId + '-' + i);
        if (!e1 || !e2) break;
        const v1 = +e1.value || 0;
        const v2 = +e2.value || 0;
        if (v1 === 0 && v2 === 0) continue;
        sets.push([v1, v2]);
      }
      if (sets.length === 0) { _showToast(t('txt_txt_enter_at_least_one_set_score')); return; }
      // Compute totals from sets
      let t1 = 0, t2 = 0;
      for (const s of sets) { t1 += s[0]; t2 += s[1]; }
      payload.score1 = t1;
      payload.score2 = t2;
      payload.sets = sets;
    } else {
      const s1 = +(document.getElementById('drs1-' + matchId)?.value) || 0;
      const s2 = +(document.getElementById('drs2-' + matchId)?.value) || 0;
      if (s1 === 0 && s2 === 0) { _showToast(t('txt_txt_enter_custom_score')); return; }
      payload.score1 = s1;
      payload.score2 = s2;
    }
  }

  try {
    await api(`/api/tournaments/${currentTid}/matches/${matchId}/resolve-dispute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    _showToast(t('txt_txt_resolve_dispute_failed_value', { value: e.message }));
  }
}

/** Show the inline comment editor for a match. */
function _openCommentEdit(matchId) {
  const row = document.getElementById(`mc-row-${matchId}`);
  if (!row) return;
  row.classList.remove('hidden');
  const input = document.getElementById(`mc-${matchId}`);
  if (input) { input.focus(); input.select(); }
}

/** Hide the inline comment editor without saving. */
function _closeCommentEdit(matchId) {
  const row = document.getElementById(`mc-row-${matchId}`);
  if (row) row.classList.add('hidden');
}

/** Set a comment on a pending match. */
async function _setMatchComment(matchId) {
  if (!currentTid) return;
  const input = document.getElementById(`mc-${matchId}`);
  if (!input) return;
  const comment = input.value.trim();
  try {
    await api(`/api/tournaments/${currentTid}/match-comment`, {
      method: 'PATCH',
      body: JSON.stringify({ match_id: matchId, comment }),
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Set match comment failed:', e.message);
  }
}

/** Clear the comment on a match. */
async function _clearMatchComment(matchId) {
  if (!currentTid) return;
  try {
    await api(`/api/tournaments/${currentTid}/match-comment`, {
      method: 'PATCH',
      body: JSON.stringify({ match_id: matchId, comment: '' }),
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Clear match comment failed:', e.message);
  }
}

/** Set the tournament announcement banner text. */
async function _setTournamentBanner() {
  if (!currentTid) return;
  const input = document.getElementById('tournament-banner-input');
  if (!input) return;
  const text = input.value.trim();
  try {
    await _updateTvSetting('banner_text', text);
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Set banner failed:', e.message);
  }
}

/** Clear the tournament announcement banner. */
async function _clearTournamentBanner() {
  if (!currentTid) return;
  try {
    await _updateTvSetting('banner_text', '');
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Clear banner failed:', e.message);
  }
}

/** Set tournament alias */
async function _setTournamentAlias() {
  if (!currentTid) return;
  const input = document.getElementById('tournament-alias-input');
  const alias = input.value.trim();
  
  if (!alias) {
    alert(t('txt_txt_please_enter_an_alias'));
    return;
  }
  
  // Validate pattern
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    alert(t('txt_txt_alias_can_only_contain_letters_numbers_hyphens_and_underscores'));
    return;
  }
  
  try {
    await api(`/api/tournaments/${currentTid}/alias`, {
      method: 'PUT',
      body: JSON.stringify({ alias }),
    });
    // Update the meta cache
    if (_tournamentMeta[currentTid]) {
      _tournamentMeta[currentTid].alias = alias;
    }
    // Reload tournaments list to update all views
    await loadTournaments();
    // Re-render current view to show updated alias section
    await _rerenderCurrentViewPreserveDrafts();
    alert(t('txt_txt_alias_value_set_successfully', { value: alias }));
  } catch (e) {
    alert(t('txt_txt_failed_to_set_alias_value', { value: e.message }));
  }
}

/** Delete tournament alias */
async function _deleteTournamentAlias() {
  if (!currentTid) return;
  if (!confirm(t('txt_txt_remove_the_alias_from_this_tournament'))) return;
  
  try {
    await api(`/api/tournaments/${currentTid}/alias`, {
      method: 'DELETE',
    });
    // Update the meta cache
    if (_tournamentMeta[currentTid]) {
      delete _tournamentMeta[currentTid].alias;
    }
    // Clear the input
    const input = document.getElementById('tournament-alias-input');
    if (input) input.value = '';
    // Reload tournaments list to update all views
    await loadTournaments();
    // Re-render current view to show updated alias section
    await _rerenderCurrentViewPreserveDrafts();
    alert(t('txt_txt_alias_removed_successfully'));
  } catch (e) {
    alert(t('txt_txt_failed_to_remove_alias_value', { value: e.message }));
  }
}

/** Attach the current tournament to a community (and its linked club branding). */
async function _setTournamentCommunity() {
  if (!currentTid) return;
  const sel = document.getElementById('tournament-community-select');
  const msgEl = document.getElementById('tournament-community-msg');
  if (!sel) return;
  try {
    await api(`/api/tournaments/${currentTid}/community`, {
      method: 'PATCH',
      body: JSON.stringify({ community_id: sel.value }),
    });
    await loadTournaments();
    await _rerenderCurrentViewPreserveDrafts();
    if (msgEl) {
      msgEl.style.color = 'var(--green)';
      msgEl.textContent = `✓ ${t('txt_tv_attach_updated')}`;
      setTimeout(() => { msgEl.textContent = ''; }, 2200);
    }
  } catch (e) {
    if (msgEl) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = e.message;
    }
  }
}

async function _setTournamentClub() {
  if (!currentTid) return;
  const sel = document.getElementById('tournament-club-select');
  const msgEl = document.getElementById('tournament-club-msg');
  if (!sel) return;
  const newClubId = sel.value || null;
  try {
    await api(`/api/tournaments/${currentTid}/club`, {
      method: 'PATCH',
      body: JSON.stringify({ club_id: newClubId }),
    });
    await loadTournaments();
    await _rerenderCurrentViewPreserveDrafts();
    if (msgEl) {
      msgEl.style.color = 'var(--green)';
      msgEl.textContent = `✓ ${t('txt_tv_attach_updated')}`;
      setTimeout(() => { msgEl.textContent = ''; }, 2200);
    }
  } catch (e) {
    if (msgEl) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = e.message;
    }
  }
}

// ─── Registration Lobbies ─────────────────────────────────

