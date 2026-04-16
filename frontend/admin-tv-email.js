// ─── TV Mode ─────────────────────────────────────────────

/**
 * Render the TV Mode control card for the admin panel.
 * tvSettings is the object returned by GET /api/tournaments/{tid}/tv-settings.
 * hasCourts indicates whether the tournament uses court assignments.
 * isMexicano indicates whether the tournament is a Mexicano-type (score breakdowns only apply there).
 */
function _renderTvControls(tvSettings, hasCourts, isMexicano = false) {
  if (!currentTid) return '';
  const s = tvSettings || {};
  const def = (k, d) => (s[k] !== undefined ? s[k] : d);

  const chkRow = (key, label, defaultVal, opts = {}) => {
    const disabled = opts.disabled || false;
    const forceOff = opts.forceOff || false;
    const forceOn = opts.forceOn || false;
    const resolvedVal = forceOff ? false : forceOn ? true : def(key, defaultVal);
    const checked = resolvedVal ? 'checked' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const opacityStyle = disabled ? 'opacity:0.45;cursor:not-allowed;' : 'cursor:pointer;';
    // Auto-persist forced value so the backend/TV page stays in sync
    if ((forceOff || forceOn) && def(key, defaultVal) !== resolvedVal) {
      _updateTvSetting(key, resolvedVal);
    }
    return `<label style="display:flex;align-items:center;gap:0.45rem;${opacityStyle}font-size:0.84rem;"${disabled ? ' title="' + t('txt_tv_no_courts_hint') + '"' : ''}>
      <input type="checkbox" style="width:auto;min-height:auto;margin:0" ${checked} ${disabledAttr}
        onchange="_updateTvSetting('${key}', this.checked)">
      ${label}
    </label>`;
  };

  // Get current tournament alias
  const currentAlias = _tournamentMeta[currentTid]?.alias || '';
  
  let html = `<details class="card" id="tv-controls-panel">`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="display:inline-block;transition:transform 0.18s;font-size:0.7em;color:var(--text-muted)">▸</span> ${t('txt_txt_tv_mode_controls')}</span>`;
  html += `<button type="button" class="btn btn-primary" style="margin-left:auto" onclick="event.preventDefault();window.open('/tv/'+((_tournamentMeta[currentTid]&&_tournamentMeta[currentTid].alias)||currentTid),'padel_tv_'+currentTid,'noopener noreferrer')">📺 ↗</button>`;
  html += `</summary>`;
  html += `<div style="margin-top:0.65rem">`;
  
  // Tournament Alias Section
  html += `<div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">🔗 ${t('txt_txt_tournament_alias')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_tv_alias_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="tournament-alias-input" placeholder="${t('txt_tv_alias_placeholder')}" value="${escAttr(currentAlias)}" 
    pattern="[a-zA-Z0-9_-]+" maxlength="64" 
    style="flex:1;min-width:200px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentAlias()" style="white-space:nowrap">${t('txt_txt_set_alias')}</button>`;
  if (currentAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="_deleteTournamentAlias()" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  const _tvSlug = currentAlias || currentTid;
  html += `<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:0.78rem">`;
  html += `<span style="color:var(--text-muted)">${t('txt_txt_tv_url')}</span> <code style="color:var(--accent);font-size:0.85rem">/tv/${esc(_tvSlug)}</code>`;
  if (!currentAlias) {
    html += ` <span style="color:var(--text-muted);font-size:0.72rem">(${t('txt_tv_raw_id_hint')})</span>`;
  }
  html += ` <button type="button" onclick="navigator.clipboard.writeText(window.location.origin+'/tv/${escAttr(_tvSlug)}');alert('${escAttr(t('txt_txt_url_copied'))}')"
      style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:3px;padding:0.1rem 0.4rem;cursor:pointer;font-size:0.75rem;margin-left:0.3rem">📋 ${t('txt_txt_copy')}</button>`;
  html += `</div>`;
  html += `</div>`;
  
  // Banner Section
  const currentBanner = def('banner_text', '');
  html += `<div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">📢 ${t('txt_banner_label')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_banner_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="tournament-banner-input" placeholder="${t('txt_banner_placeholder')}" value="${escAttr(currentBanner)}" 
    maxlength="500" 
    style="flex:1;min-width:200px;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentBanner()" style="white-space:nowrap">${t('txt_txt_set')}</button>`;
  if (currentBanner) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearTournamentBanner()" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `</div>`;

  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.65rem">${t('txt_tv_sections_help')}</p>`;
  html += `<div class="tv-settings-grid">`;
  html += chkRow('show_past_matches',   t('txt_txt_past_matches'),            true);
  if (isMexicano) html += chkRow('show_score_breakdown',t('txt_tv_score_breakdowns'),         false);
  html += chkRow('show_standings',      t('txt_tv_standings_leaderboard'),    true);
  html += chkRow('show_bracket',        t('txt_txt_play_off_bracket'),        true);
  html += chkRow('show_courts',         t('txt_tv_court_assignments_view'),   true,  { disabled: !hasCourts, forceOff: !hasCourts });
  html += chkRow('show_pending_matches', t('txt_tv_pending_matches_view'),     false, { forceOn: !hasCourts });
  html += `</div>`;

  // Player scoring toggle
  const _playerScoringOn = def('allow_player_scoring', true);
  html += `<div style="margin-top:0.65rem;padding-top:0.55rem;border-top:1px solid var(--border)">`;
  html += `<label style="display:flex;align-items:center;gap:0.45rem;cursor:pointer;font-size:0.84rem;">
    <input type="checkbox" style="width:auto;min-height:auto;margin:0" ${_playerScoringOn ? 'checked' : ''}
      onchange="_updateTvSetting('allow_player_scoring', this.checked); document.getElementById('scoring-dep-settings').style.opacity = this.checked ? '1' : '0.4'; document.getElementById('scoring-dep-settings').style.pointerEvents = this.checked ? '' : 'none'">
    ${t('txt_tv_allow_player_scoring')}
  </label>`;
  html += `<p style="color:var(--text-muted);font-size:0.76rem;margin:0.25rem 0 0 1.4rem">${t('txt_tv_allow_player_scoring_help')}</p>`;
  html += `</div>`;

  // Dependent scoring settings — greyed out when player scoring is off
  html += `<div id="scoring-dep-settings" style="transition:opacity 0.15s;${_playerScoringOn ? '' : 'opacity:0.4;pointer-events:none;'}">`;

  // Score confirmation mode
  html += `<div style="margin-top:0.65rem;padding-top:0.55rem;border-top:1px solid var(--border)">`;
  const scoreConf = def('score_confirmation', 'immediate');
  html += `<label style="font-size:0.84rem;display:block;margin-bottom:0.3rem">${t('txt_tv_score_confirmation')}</label>`;
  html += `<select style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem" onchange="_updateTvSetting('score_confirmation', this.value)">`;
  html += `<option value="immediate"${scoreConf === 'immediate' ? ' selected' : ''}>${t('txt_tv_score_confirmation_immediate')}</option>`;
  html += `<option value="required"${scoreConf === 'required' ? ' selected' : ''}>${t('txt_tv_score_confirmation_required')}</option>`;
  html += `</select>`;
  html += `<p style="color:var(--text-muted);font-size:0.76rem;margin:0.25rem 0 0">${t('txt_tv_score_confirmation_help')}</p>`;
  html += `</div>`;

  // Correction window (displayed in minutes, stored as seconds)
  const corrSecs = def('correction_window_seconds', 0);
  const corrMins = Math.round(corrSecs / 60 * 10) / 10;
  html += `<div style="margin-top:0.65rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">`;
  html += `<label style="font-size:0.84rem;color:var(--text-muted);white-space:nowrap">${t('txt_tv_correction_window')}</label>`;
  html += `<input type="number" min="0" max="60" step="0.5" value="${corrMins}" style="width:5rem;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem"`;
  html += ` onchange="_updateTvSetting('correction_window_seconds', Math.max(0, Math.min(3600, Math.round((+this.value||0)*60))))">`;
  html += `<span style="font-size:0.84rem;color:var(--text-muted)">${t('txt_tv_window_minutes_label')}</span>`;
  html += `</div>`;
  html += `<p style="color:var(--text-muted);font-size:0.76rem;margin:0.15rem 0 0">${t('txt_tv_correction_window_help')}</p>`;

  html += `</div>`; // close #scoring-dep-settings

  const currentInterval = def('refresh_interval', 15);
  html += `<div style="margin-top:0.65rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">`;
  html += `<label style="font-size:0.84rem;color:var(--text-muted);white-space:nowrap">${t('txt_txt_auto_refresh_every')}</label>`;
  html += `<select style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem" onchange="_updateTvSetting('refresh_interval', +this.value)">`;
  [[-1,t('txt_tv_on_update')],[0,t('txt_tv_never')],[5,'5 s'],[10,'10 s'],[15,'15 s'],[30,'30 s'],[60,'1 min'],[120,'2 min'],[300,'5 min']].forEach(([secs, lbl]) => {
    html += `<option value="${secs}"${currentInterval === secs ? ' selected' : ''}>${lbl}</option>`;
  });
  html += `</select></div>`;

  // Schema rendering controls
  const boxScale   = def('schema_box_scale',   1.0);
  const lineWidth  = def('schema_line_width',  1.0);
  const arrowScale = def('schema_arrow_scale', 1.0);
  const titleFontScale = def('schema_title_font_scale', 1.0);
  html += `<details style="margin-top:0.65rem">`;
  html += `<summary style="cursor:pointer;color:var(--text-muted);font-size:0.82rem;user-select:none">⚙ ${t('txt_txt_rendering_options')}</summary>`;
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
  html += _renderEloSection();
  html += `</div>`;
  html += `</details>`;
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

// ─── Email Settings ────────────────────────────────────────

/**
 * Render the Email Settings control card for the admin panel.
 * emailSettings is the object returned by GET /api/tournaments/{tid}/email-settings.
 * Only rendered when window._emailConfigured is true.
 */
function _renderEmailControls(emailSettings) {
  if (!currentTid || !window._emailConfigured) return '';
  const s = emailSettings || {};
  const senderName = s.sender_name || '';
  const replyTo = s.reply_to || '';

  let html = `<details class="card" id="email-controls-panel">`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="display:inline-block;transition:transform 0.18s;font-size:0.7em;color:var(--text-muted)">▸</span> 📧 ${t('txt_email_settings')}</span>`;
  html += `</summary>`;
  html += `<div style="margin-top:0.65rem">`;

  // Sender Display Name
  html += `<div style="margin-bottom:1rem">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.3rem;display:block">${t('txt_email_sender_name')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_email_sender_name_help')}</p>`;
  html += `<input type="text" id="email-settings-sender-name" value="${escAttr(senderName)}" maxlength="100"
    placeholder="${t('txt_email_sender_placeholder')}" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  // Reply-To Address
  html += `<div style="margin-bottom:1rem">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.3rem;display:block">${t('txt_email_reply_to')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_email_reply_to_help')}</p>`;
  html += `<input type="email" id="email-settings-reply-to" value="${escAttr(replyTo)}"
    placeholder="${t('txt_email_reply_to_placeholder')}" style="width:100%;font-size:0.85rem">`;
  html += `</div>`;

  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveEmailSettings())">${t('txt_email_save_email')}</button>`;
  html += `<span id="email-settings-saved-msg" style="color:var(--success,#22c55e);font-size:0.82rem;display:none">${t('txt_email_settings_saved')}</span>`;
  html += `</div>`;

  html += `</div></details>`;
  return html;
}

/** Render a small ELO recalculate section (meant to be placed inside the TV controls card). */
function _renderEloSection() {
  if (!currentTid) return '';
  let html = `<div style="margin-top:0.65rem;padding-top:0.55rem;border-top:1px solid var(--border)">`;
  html += `<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">`;
  html += `<button type="button" class="btn btn-warning btn-sm" onclick="withLoading(this,_recalculateTournamentElo)">`;
  html += `♻️ ${t('txt_txt_recalculate_elo')}`;
  html += `</button>`;
  html += `</div></div>`;
  return html;
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

// ─── Registration Lobbies ─────────────────────────────────

