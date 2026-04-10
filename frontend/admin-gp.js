async function renderGP() {
  _totalPts = 0;  // GP matches have no fixed total
  const _renderTid = currentTid;
  const el = document.getElementById('view-content');
  try {
    const [status, groups, playoffs, tvSettings, playerSecrets, collabData, emailSettings] = await Promise.all([
      api(`/api/tournaments/${currentTid}/gp/status`),
      api(`/api/tournaments/${currentTid}/gp/groups`),
      api(`/api/tournaments/${currentTid}/gp/playoffs`).catch(()=>null),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/collaborators`).catch(() => null),
      api(`/api/tournaments/${currentTid}/email-settings`).catch(() => ({})),
    ]);

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }
    _scoreConfirmationMode = tvSettings.score_confirmation || 'immediate';
    _gpCurrentCourts = status.courts || [];
    _gpGroupNames = Object.keys(groups.standings);
    _gpCurrentPhase = status.phase;

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderEmailControls(emailSettings);
    html += _renderPlayerCodes(playerSecrets);
    html += _renderCollaboratorsSection(collabData?.collaborators || []);
    if (status.phase === 'playoffs') {
      html += `<div class="alert alert-info">${t('txt_txt_phase')}: <span class="badge badge-phase">${t('txt_txt_play_offs')}</span></div>`;
    }

    const groupPending = _sortTbdLast(Object.values(groups.matches)
      .flat()
      .filter(m => m.status !== 'completed'));
    const playoffPending = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));
    const assignmentMatches = (status.phase === 'groups') ? groupPending : playoffPending;
    html += _renderCourtAssignmentsCard(
      assignmentMatches,
      status.phase === 'groups' ? t('txt_txt_court_assignments_group_stage') : t('txt_txt_court_assignments_play_offs'),
      status.assign_courts !== false,
    );

    const groupFormatLabel = _gpScoreMode['gp-group'] === 'sets' ? `🎾 ${t('txt_txt_sets')}` : t('txt_txt_points_label');
    if (status.phase === 'groups') {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_group_stage_input_format')}</h3>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${_gpScoreMode['gp-group'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('gp-group','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${_gpScoreMode['gp-group'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('gp-group','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    if (status.champion) {
      html += `<div class="alert alert-success">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
    }

    if (status.phase === 'finished') {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_export_outcome')}</h3>`;
      html += `<label class="switch-label"><input type="checkbox" id="export-include-history" checked><span class="switch-track"></span>${t('txt_txt_include_match_history')}</label>`;
      html += `<div class="export-actions-row">`;
      html += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
      html += `<button type="button" class="btn btn-muted" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    const shouldCollapseGroups = status.phase !== 'groups';
    if (shouldCollapseGroups) {
      html += `<details id="gp-group-stage-details" class="card"><summary>${t('txt_txt_group_stage_results_format_value', { value: groupFormatLabel })}</summary>`;
    }

    // Group standings
    for (const [gName, rows] of Object.entries(groups.standings)) {
      html += `<div class="card" id="gp-group-card-${escAttr(gName)}"><h3 class="card-heading-row">${t('txt_txt_group_name_value', { value: esc(gName) })} <button class="format-info-btn" onclick="showAbbrevPopup(event,'standings')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></h3>`;
      const hParticipant = status.team_mode ? t('txt_txt_team') : t('txt_txt_player');
      const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
      html += `<table><thead><tr><th>${hParticipant}</th><th>${t('txt_txt_p_abbrev')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th>`;
      if (hasSets) html += `<th>${t('txt_txt_sw_abbrev')}</th><th>${t('txt_txt_sl_abbrev')}</th><th>${t('txt_txt_sd_abbrev')}</th>`;
      html += `<th>${t('txt_txt_pf_abbrev')}</th><th>${t('txt_txt_pa_abbrev')}</th><th>${t('txt_txt_diff_abbrev')}</th></tr></thead><tbody>`;
      for (const r of rows) {
        html += `<tr><td>${esc(r.player)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>`;
        if (hasSets) html += `<td>${r.sets_won}</td><td>${r.sets_lost}</td><td>${r.sets_diff}</td>`;
        html += `<td>${r.points_for}</td><td>${r.points_against}</td><td>${r.point_diff}</td></tr>`;
      }
      html += `</tbody></table>`;

      // Group matches
      const gMatches = _sortTbdLast(groups.matches[gName] || []);
      if (gMatches.length > 0) {
        html += `<h4 class="group-matches-heading">${t('txt_txt_matches')}</h4>`;
      }
      for (const m of gMatches) {
        html += matchRow(m, 'gp-group');
      }

      html += `</div>`;
    }

    if (shouldCollapseGroups) {
      html += `</details>`;
    }

    // Next round / Start playoffs controls
    if (status.phase === 'groups') {
      const allGroupMatches = Object.values(groups.matches).flat();
      const pending = allGroupMatches.filter(m => m.status !== 'completed');
      if (pending.length === 0) {
        html += `<div id="gp-playoffs-section">`;
        html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/gp/courts`);
        html += `<div class="gp-next-actions-row">`;
        if (groups.has_more_rounds) {
          html += `<button type="button" class="btn btn-primary btn-lg-action" onclick="withLoading(this,nextGpGroupRound)">⚡ ${t('txt_txt_generate_next_group_round')}</button>`;
        }
        html += `<button type="button" class="btn btn-success btn-lg-action" onclick="withLoading(this,proposeGpPlayoffs)">🏆 ${t('txt_txt_start_playoffs')} →</button>`;
        html += `</div>`;
        html += `</div>`;
      } else {
        const total = allGroupMatches.length;
        const done = total - pending.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        html += `<div id="gp-group-progress-section" class="alert alert-info">${t('txt_txt_n_match_remaining', { n: pending.length })} (${done}/${total})<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div></div>`;
        if (window._emailConfigured) {
          html += `<div class="notify-round-wrap"><button type="button" class="btn btn-sm" onclick="withLoading(this,_sendNextRoundEmails)">📧 ${t('txt_email_notify_round')}</button></div>`;
        }
      }
    }

    // Playoff bracket
    if (status.phase === 'playoffs' || status.phase === 'finished') {
      html += _schemaCardHtml('gp-playoff-schema', t('txt_txt_play_off_bracket'), 'generateGpPlayoffSchema');

      html += `<div class="card">`;
      html += `<div class="playoff-header-row">`;
      html += `<h2 class="playoff-header-title">${t('txt_txt_play_offs')}</h2>`;
      if (window._emailConfigured) {
        html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,_sendNextRoundEmails)">📧 ${t('txt_email_notify_round')}</button>`;
      }
      html += `</div>`;
      html += `<div class="score-format-row">`;
      html += `<span class="score-format-label">${t('txt_txt_score_format')}:</span>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${_gpScoreMode['gp-playoff'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('gp-playoff','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${_gpScoreMode['gp-playoff'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('gp-playoff','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div></div>`;
      if (playoffs && playoffs.matches) {
        for (const m of _sortTbdLast(playoffs.matches)) {
          html += matchRow(m, 'gp-playoff');
        }
      }
      html += `</div>`;
    }

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

// ─── Render Standalone Playoff ────────────────────────────
async function renderPO() {
  _totalPts = 0;
  const _renderTid = currentTid;
  const el = document.getElementById('view-content');
  try {
    const [status, playoffs, tvSettings, playerSecrets, collabData, emailSettings] = await Promise.all([
      api(`/api/tournaments/${currentTid}/po/status`),
      api(`/api/tournaments/${currentTid}/po/playoffs`),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/collaborators`).catch(() => null),
      api(`/api/tournaments/${currentTid}/email-settings`).catch(() => ({})),
    ]);

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }
    _scoreConfirmationMode = tvSettings.score_confirmation || 'immediate';
    _poCurrentPhase = status.phase;

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderEmailControls(emailSettings);
    html += _renderPlayerCodes(playerSecrets);
    html += _renderCollaboratorsSection(collabData?.collaborators || []);

    if (status.champion) {
      html += `<div class="alert alert-success">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
    }

    if (status.phase === 'finished') {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_export_outcome')}</h3>`;
      html += `<label class="switch-label"><input type="checkbox" id="export-include-history" checked><span class="switch-track"></span>${t('txt_txt_include_match_history')}</label>`;
      html += `<div class="export-actions-row">`;
      html += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
      html += `<button type="button" class="btn btn-muted" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    const pending = _sortTbdLast((playoffs.pending || []).filter(m => m.status !== 'completed'));
    html += _renderCourtAssignmentsCard(pending, t('txt_txt_court_assignments_play_offs'), status.assign_courts !== false);

    html += _schemaCardHtml('po-playoff-schema', t('txt_txt_play_off_bracket'), 'generatePoPlayoffSchema');

    html += `<div class="card">`;
    html += `<div class="playoff-header-row">`;
    html += `<h2 class="playoff-header-title">${t('txt_txt_play_offs')}</h2>`;
    if (window._emailConfigured) {
      html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,_sendNextRoundEmails)">📧 ${t('txt_email_notify_round')}</button>`;
    }
    html += `</div>`;
    html += `<div class="score-format-row">`;
    html += `<span class="score-format-label">${t('txt_txt_score_format')}:</span>`;
    html += `<div class="score-mode-toggle">`;
    html += `<button type="button" class="${_gpScoreMode['po-playoff'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('po-playoff','points')">${t('txt_txt_points_label')}</button>`;
    html += `<button type="button" class="${_gpScoreMode['po-playoff'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('po-playoff','sets')">🎾 ${t('txt_txt_sets')}</button>`;
    html += `</div></div>`;

    html += `<details id="po-inline-bracket" class="bracket-collapse bracket-inline" open><summary class="bracket-collapse-summary"><span class="bracket-chevron bracket-chevron-anim">▶</span>${t('txt_txt_play_off_bracket')}</summary>`;
    html += `<img class="bracket-img" src="/api/tournaments/${currentTid}/po/playoffs-schema?fmt=png&_t=${Date.now()}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand" onerror="this.style.display='none'">`;
    html += `</details>`;
    if (playoffs.matches) {
      for (const m of _sortTbdLast(playoffs.matches)) {
        html += matchRow(m, 'po-playoff');
      }
    }
    html += `</div>`;

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

function matchRow(m, ctx) {
  const t1 = m.team1.join(' & ') || 'TBD';
  const t2 = m.team2.join(' & ') || 'TBD';
  const court = m.court ? `<span class="match-court">${esc(m.court)}</span>` : '';
  const roundLabel = m.round_label ? `<span class="badge badge-scheduled">${esc(m.round_label)}</span>` : '';

  if (m.status === 'completed') {
    // Score display — show sets if available, else plain score
    const sc = m.score || [0, 0];
    let scoreDisplay;
    let scoreClass = 'match-score';
    if (m.sets && m.sets.length > 0) {
      scoreClass = 'match-score sets-stack';
      scoreDisplay = m.sets
        .map(s => `<span class="set-row">${s[0]}-${s[1]}</span>`)
        .join('');
    } else {
      scoreDisplay = `${sc[0]} – ${sc[1]}`;
    }

    const w1 = sc[0] > sc[1];
    const w2 = sc[1] > sc[0];
    const t1Class = w1 ? ' team-winner' : (w2 ? ' team-loser' : '');
    const t2Class = w2 ? ' team-winner' : (w1 ? ' team-loser' : '');
    let html = `<div id="mcard-${m.id}" class="match-card match-card-wrap">`;
    html += `${roundLabel} <div class="match-teams"><span class="${t1Class}">${esc(t1)}</span> <span class="vs">vs</span> <span class="${t2Class}">${esc(t2)}</span></div> ${court}`;
    html += ` <span class="${scoreClass}" id="mscore-${m.id}">${scoreDisplay}</span>`;
    html += ` <span class="badge badge-completed">✓</span>`;
    if (m.disputed) {
      if (m.dispute_escalated) {
        html += ` <span class="badge badge-dispute" title="${t('txt_txt_dispute_escalated_tip')}">⚠️ ${t('txt_txt_dispute_label')}</span>`;
      } else {
        html += ` <span class="badge badge-dispute badge-dispute-pending" title="${t('txt_txt_dispute_pending_tip')}">🔄 ${t('txt_txt_dispute_review_label')}</span>`;
      }
    } else if (m.scored_by && !m.score_confirmed && _scoreConfirmationMode !== 'immediate') {
      html += ` <span class="badge badge-pending-score" title="Player-submitted, not yet confirmed">⏳</span>`;
    }
    const _editSetsJson = JSON.stringify(m.sets || []);
    html += `<button type="button" class="match-edit-btn" id="medit-btn-${m.id}" data-sets='${_editSetsJson}' onclick="_toggleEditMatch('${m.id}','${ctx}',${sc[0]},${sc[1]})">${t('txt_txt_edit')}</button>`;
    if (m.disputed) {
      const origScore = (m.sets && m.sets.length > 0)
        ? m.sets.map(s => `${s[0]}–${s[1]}`).join(' / ')
        : (m.score ? `${m.score[0]}–${m.score[1]}` : '?');
      const dispScore = (m.dispute_sets && m.dispute_sets.length > 0)
        ? m.dispute_sets.map(s => `${s[0]}–${s[1]}`).join(' / ')
        : (m.dispute_score ? `${m.dispute_score[0]}–${m.dispute_score[1]}` : '?');
      const escalatedNote = m.dispute_escalated
        ? `<div class="admin-dispute-note note-escalated">⚠️ ${t('txt_txt_escalated_by_player')}</div>`
        : `<div class="admin-dispute-note note-reviewing">🔄 ${t('txt_txt_players_reviewing')}</div>`;
      html += `<div class="admin-dispute-panel" id="dispute-panel-${m.id}">`;
      html += escalatedNote;
      html += `<div class="admin-dispute-scores">`;
      html += `<label><input type="radio" name="dr-${m.id}" value="original" checked onclick="document.getElementById('dr-custom-${m.id}')?.classList.add('hidden')"> <span class="dispute-option-text">${t('txt_txt_original')}:</span> <span class="dispute-score-value">${origScore}</span></label>`;
      html += `<label><input type="radio" name="dr-${m.id}" value="correction" onclick="document.getElementById('dr-custom-${m.id}')?.classList.add('hidden')"> <span class="dispute-option-text">${t('txt_txt_correction')}:</span> <span class="dispute-score-value">${dispScore}</span></label>`;
      html += `<label><input type="radio" name="dr-${m.id}" value="custom" onclick="document.getElementById('dr-custom-${m.id}')?.classList.remove('hidden')"> <span class="dispute-option-text">${t('txt_txt_custom_score')}</span></label>`;
      html += `</div>`;

      // Custom score inputs (hidden until 'custom' radio is selected)
      const isSetCtx = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
      const custMode = _gpScoreMode[ctx] || 'points';
      html += `<div class="admin-dispute-custom hidden" id="dr-custom-${m.id}">`;
      if (isSetCtx) {
        html += `<div id="dr-custom-pts-${m.id}" class="custom-score-row ${custMode === 'sets' ? 'hidden' : ''}">`;
        html += `<input type="number" id="drs1-${m.id}" min="0" placeholder="0">`;
        html += `<span>–</span>`;
        html += `<input type="number" id="drs2-${m.id}" min="0" placeholder="0">`;
        html += `</div>`;
        html += `<div id="dr-custom-sets-${m.id}" class="${custMode === 'sets' ? '' : 'hidden'}">`;
        html += `<div class="tennis-sets" id="dr-tennis-${m.id}">`;
        html += _renderTennisSetInputs('dr-' + m.id, 3);
        html += `</div></div>`;
      } else {
        const autoCalc = _totalPts > 0 && ctx === 'mex';
        const onCustInput = autoCalc ? `oninput="_autoFillDisputeCustom('${m.id}', ${_totalPts})"` : '';
        html += `<div class="custom-score-row">`;
        html += `<input type="number" id="drs1-${m.id}" min="0" placeholder="0" ${onCustInput}>`;
        html += `<span>–</span>`;
        html += `<input type="number" id="drs2-${m.id}" min="0" placeholder="0" ${onCustInput}>`;
        html += `</div>`;
      }
      html += `</div>`;

      html += `<button type="button" class="btn btn-warning btn-sm admin-dispute-resolve" onclick="_adminResolveDispute('${m.id}','${ctx}')">${t('txt_txt_resolve_dispute')}</button>`;
      html += `</div>`;
    }

    // Inline edit form (hidden)
    const isSetScoringCtxEdit = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
    const autoCalc = _totalPts > 0 && ctx === 'mex';
    const onInput = autoCalc ? `oninput="_autoFillScore('${m.id}', ${_totalPts})"` : '';
    html += `<div class="match-actions hidden" id="medit-${m.id}">`;
    if (isSetScoringCtxEdit) {
      const stageMode = _gpScoreMode[ctx] || 'points';
      html += `<div id="score-normal-${m.id}" class="${stageMode === 'sets' ? 'hidden' : ''}">`;
      html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" min="0" value="${sc[0]}" ${onInput}>`;
      html += `<span>–</span>`;
      html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" min="0" value="${sc[1]}" ${onInput}>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
      html += `</div>`;
      html += `<div id="score-tennis-${m.id}" class="${stageMode === 'sets' ? '' : 'hidden'}">`;
      html += `<div class="tennis-sets" id="tennis-sets-${m.id}">`;
      html += _renderTennisSetInputs(m.id, 3);
      html += `</div>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitTennisScore('${m.id}','${ctx}')">${t('txt_txt_save_sets')}</button>`;
      html += `</div>`;
    } else {
      html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" min="0" value="${sc[0]}" ${onInput}>`;
      html += `<span>–</span>`;
      html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" min="0" value="${sc[1]}" ${onInput}>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    }
    html += `<button type="button" class="btn btn-sm btn-muted" onclick="_cancelEditMatch('${m.id}')">✕</button>`;
    html += `</div>`;

    // Breakdown toggle for Mexicano matches
    const isMex = ctx === 'mex' || ctx === 'mex-playoff';
    const bd = isMex ? _mexBreakdowns[m.id] : null;
    if (bd && Object.keys(bd).length > 0) {
      html += `<details class="breakdown-details" id="breakdown-${m.id}">`;
      html += `<summary>📊 ${t('txt_txt_score_breakdown')}</summary>`;
      html += `<div class="breakdown-panel">`;
      html += `<table class="breakdown-table"><thead><tr><th>${t('txt_txt_player')}</th><th>${t('txt_txt_raw')}</th><th>${t('txt_txt_relative_strength')}</th><th>${t('txt_txt_strength_weight')}</th><th>${t('txt_txt_strength_multiplier')}</th><th>${t('txt_txt_loss_disc_multiplier')}</th><th>${t('txt_txt_win_bonus_header')}</th><th>${t('txt_txt_final')}</th></tr></thead><tbody>`;
      for (const [pid, d] of Object.entries(bd)) {
        const pname = _mexPlayerMap[pid] || pid;
        const rs = d.relative_strength || 0;
        html += `<tr><td>${esc(pname)}</td><td>${d.raw}</td><td>${rs > 0 ? rs.toFixed(3) : '—'}</td><td>${_mexStrengthWeight > 0 ? '×' + _mexStrengthWeight : '—'}</td><td>${d.strength_mult !== 1 ? '×' + d.strength_mult.toFixed(2) : '—'}</td><td>${d.loss_disc !== 1 ? '×' + d.loss_disc.toFixed(2) : '—'}</td><td>${d.win_bonus > 0 ? '+' + d.win_bonus : '—'}</td><td><strong>${d.final}</strong></td></tr>`;
      }
      html += `</tbody></table></div>`;
      html += `</details>`;
    }

    // Comment banner (completed match)
    html += `<div class="match-comment-banner">`;
    if (m.comment) {
      html += `<span class="match-comment-text" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_click_to_edit')}">💬 ${esc(m.comment)}</span>`;
    } else {
      html += `<span class="match-comment-add" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_comment_placeholder')}">💬 ${t('txt_match_add_comment')}</span>`;
    }
    html += `<div class="match-comment-edit hidden" id="mc-row-${m.id}">`;
    html += `<input type="text" id="mc-${m.id}" value="${m.comment ? esc(m.comment) : ''}" placeholder="${t('txt_match_comment_placeholder')}" maxlength="500" onkeydown="if(event.key==='Enter')_setMatchComment('${m.id}')">` ;
    html += `<button type="button" class="btn-comment-save" onclick="_setMatchComment('${m.id}')">${t('txt_txt_save')}</button>`;
    if (m.comment) html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearMatchComment('${m.id}')">✕</button>`;
    html += `<button type="button" class="btn-comment-cancel" aria-label="${t('txt_txt_cancel')}" onclick="_closeCommentEdit('${m.id}')">✕</button>`;
    html += `</div></div>`;

    html += `</div>`;
    return html;
  }

  // ── Pending confirmation — player submitted but score_confirmation="required" ──
  // Match status may be in_progress with a score that's awaiting confirmation,
  // or may even have a dispute. Show the score, lifecycle badges, and dispute panel.
  if (m.score && m.scored_by && !m.score_confirmed) {
    const sc = m.score;
    let scoreDisplay;
    let scoreClass = 'match-score';
    if (m.sets && m.sets.length > 0) {
      scoreClass = 'match-score sets-stack';
      scoreDisplay = m.sets.map(s => `<span class="set-row">${s[0]}-${s[1]}</span>`).join('');
    } else {
      scoreDisplay = `${sc[0]} – ${sc[1]}`;
    }

    let html = `<div id="mcard-${m.id}" class="match-card match-card-wrap">`;
    html += `${roundLabel} <div class="match-teams">${esc(t1)} <span class="vs">vs</span> ${esc(t2)}</div> ${court}`;
    html += ` <span class="${scoreClass}" id="mscore-${m.id}">${scoreDisplay}</span>`;
    if (m.disputed) {
      if (m.dispute_escalated) {
        html += ` <span class="badge badge-dispute" title="${t('txt_txt_dispute_escalated_tip')}">⚠️ ${t('txt_txt_dispute_label')}</span>`;
      } else {
        html += ` <span class="badge badge-dispute badge-dispute-pending" title="${t('txt_txt_dispute_pending_tip')}">🔄 ${t('txt_txt_dispute_review_label')}</span>`;
      }
    } else if (_scoreConfirmationMode !== 'immediate') {
      html += ` <span class="badge badge-pending-score" title="Player-submitted, awaiting confirmation">⏳</span>`;
    }
    const _editSetsJson = JSON.stringify(m.sets || []);
    html += `<button type="button" class="match-edit-btn" id="medit-btn-${m.id}" data-sets='${_editSetsJson}' onclick="_toggleEditMatch('${m.id}','${ctx}',${sc[0]},${sc[1]})">${t('txt_txt_edit')}</button>`;

    if (m.disputed) {
      const origScore = (m.sets && m.sets.length > 0)
        ? m.sets.map(s => `${s[0]}–${s[1]}`).join(' / ')
        : `${sc[0]}–${sc[1]}`;
      const dispScore = (m.dispute_sets && m.dispute_sets.length > 0)
        ? m.dispute_sets.map(s => `${s[0]}–${s[1]}`).join(' / ')
        : (m.dispute_score ? `${m.dispute_score[0]}–${m.dispute_score[1]}` : '?');
      const escalatedNote = m.dispute_escalated
        ? `<div class="admin-dispute-note note-escalated">⚠️ ${t('txt_txt_escalated_by_player')}</div>`
        : `<div class="admin-dispute-note note-reviewing">🔄 ${t('txt_txt_players_reviewing')}</div>`;
      html += `<div class="admin-dispute-panel" id="dispute-panel-${m.id}">`;
      html += escalatedNote;
      html += `<div class="admin-dispute-scores">`;
      html += `<label><input type="radio" name="dr-${m.id}" value="original" checked onclick="document.getElementById('dr-custom-${m.id}')?.classList.add('hidden')"> <span class="dispute-option-text">${t('txt_txt_original')}:</span> <span class="dispute-score-value">${origScore}</span></label>`;
      html += `<label><input type="radio" name="dr-${m.id}" value="correction" onclick="document.getElementById('dr-custom-${m.id}')?.classList.add('hidden')"> <span class="dispute-option-text">${t('txt_txt_correction')}:</span> <span class="dispute-score-value">${dispScore}</span></label>`;
      html += `<label><input type="radio" name="dr-${m.id}" value="custom" onclick="document.getElementById('dr-custom-${m.id}')?.classList.remove('hidden')"> <span class="dispute-option-text">${t('txt_txt_custom_score')}</span></label>`;
      html += `</div>`;

      const isSetCtx = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
      const custMode = _gpScoreMode[ctx] || 'points';
      html += `<div class="admin-dispute-custom hidden" id="dr-custom-${m.id}">`;
      if (isSetCtx) {
        html += `<div id="dr-custom-pts-${m.id}" class="custom-score-row ${custMode === 'sets' ? 'hidden' : ''}">`;
        html += `<input type="number" id="drs1-${m.id}" min="0" placeholder="0">`;
        html += `<span>–</span>`;
        html += `<input type="number" id="drs2-${m.id}" min="0" placeholder="0">`;
        html += `</div>`;
        html += `<div id="dr-custom-sets-${m.id}" class="${custMode === 'sets' ? '' : 'hidden'}">`;
        html += `<div class="tennis-sets" id="dr-tennis-${m.id}">`;
        html += _renderTennisSetInputs('dr-' + m.id, 3);
        html += `</div></div>`;
      } else {
        const autoCalc = _totalPts > 0 && ctx === 'mex';
        const onCustInput = autoCalc ? `oninput="_autoFillDisputeCustom('${m.id}', ${_totalPts})"` : '';
        html += `<div class="custom-score-row">`;
        html += `<input type="number" id="drs1-${m.id}" min="0" placeholder="0" ${onCustInput}>`;
        html += `<span>–</span>`;
        html += `<input type="number" id="drs2-${m.id}" min="0" placeholder="0" ${onCustInput}>`;
        html += `</div>`;
      }
      html += `</div>`;

      html += `<button type="button" class="btn btn-warning btn-sm admin-dispute-resolve" onclick="_adminResolveDispute('${m.id}','${ctx}')">${t('txt_txt_resolve_dispute')}</button>`;
      html += `</div>`;
    }

    // Inline edit form (hidden)
    const isSetScoringCtxEdit = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
    const autoCalcEdit = _totalPts > 0 && ctx === 'mex';
    const onInputEdit = autoCalcEdit ? `oninput="_autoFillScore('${m.id}', ${_totalPts})"` : '';
    html += `<div class="match-actions hidden" id="medit-${m.id}">`;
    if (isSetScoringCtxEdit) {
      const stageMode = _gpScoreMode[ctx] || 'points';
      html += `<div id="score-normal-${m.id}" class="${stageMode === 'sets' ? 'hidden' : ''}">`;
      html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" min="0" value="${sc[0]}" ${onInputEdit}>`;
      html += `<span>–</span>`;
      html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" min="0" value="${sc[1]}" ${onInputEdit}>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
      html += `</div>`;
      html += `<div id="score-tennis-${m.id}" class="${stageMode === 'sets' ? '' : 'hidden'}">`;
      html += `<div class="tennis-sets" id="tennis-sets-${m.id}">`;
      html += _renderTennisSetInputs(m.id, 3);
      html += `</div>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitTennisScore('${m.id}','${ctx}')">${t('txt_txt_save_sets')}</button>`;
      html += `</div>`;
    } else {
      html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" min="0" value="${sc[0]}" ${onInputEdit}>`;
      html += `<span>–</span>`;
      html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" min="0" value="${sc[1]}" ${onInputEdit}>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    }
    html += `<button type="button" class="btn btn-sm btn-muted" onclick="_cancelEditMatch('${m.id}')">✕</button>`;
    html += `</div>`;

    // Comment banner
    html += `<div class="match-comment-banner">`;
    if (m.comment) {
      html += `<span class="match-comment-text" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_click_to_edit')}">💬 ${esc(m.comment)}</span>`;
    } else {
      html += `<span class="match-comment-add" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_comment_placeholder')}">💬 ${t('txt_match_add_comment')}</span>`;
    }
    html += `<div class="match-comment-edit hidden" id="mc-row-${m.id}">`;
    html += `<input type="text" id="mc-${m.id}" value="${m.comment ? esc(m.comment) : ''}" placeholder="${t('txt_match_comment_placeholder')}" maxlength="500" onkeydown="if(event.key==='Enter')_setMatchComment('${m.id}')">`;
    html += `<button type="button" class="btn-comment-save" onclick="_setMatchComment('${m.id}')">${t('txt_txt_save')}</button>`;
    if (m.comment) html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearMatchComment('${m.id}')">✕</button>`;
    html += `<button type="button" class="btn-comment-cancel" aria-label="${t('txt_txt_cancel')}" onclick="_closeCommentEdit('${m.id}')">✕</button>`;
    html += `</div></div>`;

    html += `</div>`;
    return html;
  }

  // Not yet completed — show input form
  const isMex = ctx === 'mex' || ctx === 'mex-playoff';
  const isSetScoringCtx = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
  const autoCalc = _totalPts > 0 && ctx === 'mex';
  const onInput = autoCalc
    ? `oninput="_autoFillScore('${m.id}', ${_totalPts})"`
    : '';
  const hasTbd = !m.team1?.join('').trim() || !m.team2?.join('').trim();
  const tbdAttr = hasTbd ? ` disabled title="${t('txt_txt_players_not_yet_determined')}"` : '';
  const tbdClass = hasTbd ? ' match-tbd-disabled' : '';
  const saveBtnClass = `btn btn-success btn-sm${hasTbd ? ' btn-disabled-ish' : ''}`;

  let html = `<div id="mcard-${m.id}" class="match-card match-card-wrap${tbdClass}">${roundLabel} <div class="match-teams">${esc(t1)} <span class="vs">vs</span> ${esc(t2)}</div> ${court}`;

  // Points / tennis-set scoring toggle for playoff/group contexts
  if (isSetScoringCtx) {
    const stageMode = _gpScoreMode[ctx] || 'points';
    html += `<div class="match-actions" id="score-input-${m.id}">`;
    html += `<div id="score-normal-${m.id}" class="${stageMode === 'sets' ? 'hidden' : ''}">`;
    html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" min="0" value="" placeholder="0" ${onInput}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" min="0" value="" placeholder="${autoCalc ? _totalPts : 0}" ${onInput}>`;
    html += `<button type="button" class="${saveBtnClass}"${tbdAttr} onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    html += `</div>`;
    html += `<div id="score-tennis-${m.id}" class="${stageMode === 'sets' ? '' : 'hidden'}">`;
    html += `<div class="tennis-sets" id="tennis-sets-${m.id}">`;
    html += _renderTennisSetInputs(m.id, 3);
    html += `</div>`;
    html += `<button type="button" class="${saveBtnClass}"${tbdAttr} onclick="submitTennisScore('${m.id}','${ctx}')">${t('txt_txt_save_sets')}</button>`;
    html += `</div>`;
    html += `</div>`;
  } else {
    html += `<div class="match-actions">`;
    html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" min="0" value="" placeholder="0" ${onInput}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" min="0" value="" placeholder="${autoCalc ? _totalPts : 0}" ${onInput}>`;
    html += `<button type="button" class="${saveBtnClass}"${tbdAttr} onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    html += `</div>`;
  }

  // Comment banner (pending match)
  html += `<div class="match-comment-banner">`;
  if (m.comment) {
    html += `<span class="match-comment-text" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_click_to_edit')}">💬 ${esc(m.comment)}</span>`;
  } else {
    html += `<span class="match-comment-add" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_comment_placeholder')}">💬 ${t('txt_match_add_comment')}</span>`;
  }
  html += `<div class="match-comment-edit hidden" id="mc-row-${m.id}">`;
  html += `<input type="text" id="mc-${m.id}" value="${m.comment ? esc(m.comment) : ''}" placeholder="${t('txt_match_comment_placeholder')}" maxlength="500" onkeydown="if(event.key==='Enter')_setMatchComment('${m.id}')">`;
  html += `<button type="button" class="btn-comment-save" onclick="_setMatchComment('${m.id}')">${t('txt_txt_save')}</button>`;
  if (m.comment) html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearMatchComment('${m.id}')">✕</button>`;
  html += `<button type="button" class="btn-comment-cancel" aria-label="${t('txt_txt_cancel')}" onclick="_closeCommentEdit('${m.id}')">✕</button>`;
  html += `</div></div>`;

  html += `</div>`;
  return html;
}

function _captureViewDrafts() {
  const root = document.getElementById('view-content');
  if (!root) return {};

  const drafts = {};
  root.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'button' || el.type === 'submit') return;

    let key = '';
    if (el.id) {
      key = `id:${el.id}`;
    } else if (el.dataset?.match !== undefined && el.dataset?.slot !== undefined) {
      key = `manual:${el.dataset.match}:${el.dataset.slot}`;
    } else {
      return;
    }

    drafts[key] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });

  // Preserve open/closed state of identified <details> elements
  root.querySelectorAll('details[id]').forEach(el => {
    drafts[`details:${el.id}`] = el.open;
  });

  return drafts;
}

function _restoreViewDrafts(drafts) {
  const root = document.getElementById('view-content');
  if (!root || !drafts) return;

  for (const [key, value] of Object.entries(drafts)) {
    if (key.startsWith('details:')) {
      const el = document.getElementById(key.slice(8));
      if (el && el.tagName === 'DETAILS') {
        if (value) el.setAttribute('open', ''); else el.removeAttribute('open');
      }
      continue;
    }
    let el = null;
    if (key.startsWith('id:')) {
      el = document.getElementById(key.slice(3));
    } else if (key.startsWith('manual:')) {
      const [, match, slot] = key.split(':');
      el = root.querySelector(`.manual-sel[data-match="${match}"][data-slot="${slot}"]`);
    }
    if (!el) continue;

    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = Boolean(value);
    } else {
      el.value = value;
    }
  }
}

async function _rerenderCurrentViewPreserveDrafts() {
  const scrollY = window.scrollY;
  const drafts = _captureViewDrafts();
  if (currentType === 'registration') {
    await renderRegistration();
  } else if (currentType === 'group_playoff') {
    await renderGP();
  } else if (currentType === 'playoff') {
    await renderPO();
  } else {
    await renderMex();
  }
  _restoreViewDrafts(drafts);
  window.scrollTo({ top: scrollY, behavior: 'instant' });
  // Reseed the version so the poll doesn't trigger a redundant re-render
  // right after an admin-initiated mutation or an already-handled poll update.
  if (currentTid) {
    fetch(`/api/tournaments/${currentTid}/version`)
      .then(r => r.json())
      .then(d => { _adminLastKnownVersion = d.version; })
      .catch(() => {});
  }
}

/** Surgically update only the affected match card (and secondary displays like
 *  leaderboard / progress bar) after a score submission, avoiding a full
 *  page re-render.  Falls back to _rerenderCurrentViewPreserveDrafts when a
 *  structural change is detected (phase transition, last match in round, etc.). */
async function _surgicalScoreUpdate(matchId, ctx) {
  try {
    let updatedMatch = null;
    let needsFullRender = false;

    if (ctx === 'gp-group') {
      const [groups, status] = await Promise.all([
        api(`/api/tournaments/${currentTid}/gp/groups`),
        api(`/api/tournaments/${currentTid}/gp/status`),
      ]);
      if (status.phase !== _gpCurrentPhase) {
        needsFullRender = true;
      } else {
        const allGroupMatches = Object.values(groups.matches).flat();
        const totalPending = allGroupMatches.filter(m => m.status !== 'completed').length;
        if (totalPending === 0) {
          needsFullRender = true; // reveal the "start playoffs" section
        } else {
          for (const gMatches of Object.values(groups.matches)) {
            const m = gMatches.find(m => m.id === matchId);
            if (m) { updatedMatch = m; break; }
          }
          if (!updatedMatch) {
            needsFullRender = true;
          } else {
            const card = document.getElementById('mcard-' + matchId);
            if (!card) {
              needsFullRender = true;
            } else {
              card.outerHTML = matchRow(updatedMatch, 'gp-group');
              const total = allGroupMatches.length;
              const done = total - totalPending;
              const pct = Math.round((done / total) * 100);
              const progressEl = document.getElementById('gp-group-progress-section');
              if (progressEl) {
                progressEl.innerHTML = `${t('txt_txt_n_match_remaining', { n: totalPending })} (${done}/${total})<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>`;
              }
            }
          }
        }
      }
    } else if (ctx === 'gp-playoff') {
      const [playoffs, status] = await Promise.all([
        api(`/api/tournaments/${currentTid}/gp/playoffs`),
        api(`/api/tournaments/${currentTid}/gp/status`),
      ]);
      if (status.phase !== _gpCurrentPhase) {
        needsFullRender = true;
      } else {
        updatedMatch = playoffs.matches?.find(m => m.id === matchId) ?? null;
        if (!updatedMatch) {
          needsFullRender = true;
        } else {
          const card = document.getElementById('mcard-' + matchId);
          if (!card) { needsFullRender = true; }
          else {
            card.outerHTML = matchRow(updatedMatch, 'gp-playoff');
            // Refresh all other visible cards so loser-bracket slots fill in immediately.
            for (const m of (playoffs.matches || [])) {
              if (m.id === matchId) continue;
              const otherCard = document.getElementById('mcard-' + m.id);
              if (otherCard) otherCard.outerHTML = matchRow(m, 'gp-playoff');
            }
          }
        }
      }
    } else if (ctx === 'mex') {
      const [matches, status] = await Promise.all([
        api(`/api/tournaments/${currentTid}/mex/matches`),
        api(`/api/tournaments/${currentTid}/mex/status`),
      ]);
      _mexBreakdowns = matches.breakdowns || {};
      if (status.phase !== _mexCurrentPhase) {
        needsFullRender = true;
      } else {
        const pending = matches.pending.length;
        if (pending === 0) {
          needsFullRender = true; // reveal next-round controls
        } else {
          updatedMatch = matches.all_matches?.find(m => m.id === matchId) ?? null;
          if (!updatedMatch) {
            needsFullRender = true;
          } else {
            const card = document.getElementById('mcard-' + matchId);
            if (!card) {
              needsFullRender = true;
            } else {
              card.outerHTML = matchRow(updatedMatch, 'mex');
              window._mexStatusLeaderboard = status.leaderboard || [];
              _renderMexLeaderboard();
              const totalMex = matches.current_matches.length;
              const doneMex = totalMex - pending;
              const pctMex = totalMex > 0 ? Math.round((doneMex / totalMex) * 100) : 0;
              const progressEl = document.getElementById('mex-round-progress');
              if (progressEl) {
                progressEl.innerHTML = `${t('txt_txt_n_match_remaining', { n: pending })} (${doneMex}/${totalMex})<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pctMex}%"></div></div>`;
              }
            }
          }
        }
      }
    } else if (ctx === 'mex-playoff') {
      const [playoffs, status] = await Promise.all([
        api(`/api/tournaments/${currentTid}/mex/playoffs`),
        api(`/api/tournaments/${currentTid}/mex/status`),
      ]);
      if (status.phase !== _mexCurrentPhase) {
        needsFullRender = true;
      } else {
        updatedMatch = playoffs.matches?.find(m => m.id === matchId) ?? null;
        if (!updatedMatch) {
          needsFullRender = true;
        } else {
          const card = document.getElementById('mcard-' + matchId);
          if (!card) { needsFullRender = true; }
          else {
            card.outerHTML = matchRow(updatedMatch, 'mex-playoff');
            // Refresh all other visible cards so loser-bracket slots fill in immediately.
            for (const m of (playoffs.matches || [])) {
              if (m.id === matchId) continue;
              const otherCard = document.getElementById('mcard-' + m.id);
              if (otherCard) otherCard.outerHTML = matchRow(m, 'mex-playoff');
            }
          }
        }
      }
    } else if (ctx === 'po-playoff') {
      const [playoffs, status] = await Promise.all([
        api(`/api/tournaments/${currentTid}/po/playoffs`),
        api(`/api/tournaments/${currentTid}/po/status`),
      ]);
      if (status.phase !== _poCurrentPhase) {
        needsFullRender = true;
      } else {
        updatedMatch = playoffs.matches?.find(m => m.id === matchId) ?? null;
        if (!updatedMatch) {
          needsFullRender = true;
        } else {
          const card = document.getElementById('mcard-' + matchId);
          if (!card) { needsFullRender = true; }
          else {
            // Update the scored match card.
            card.outerHTML = matchRow(updatedMatch, 'po-playoff');
            // In double-elimination, recording a result populates loser-bracket slots
            // in other match cards. Refresh every other visible card from the fresh data
            // so those TBD slots fill in without a full page re-render.
            for (const m of (playoffs.matches || [])) {
              if (m.id === matchId) continue;
              const otherCard = document.getElementById('mcard-' + m.id);
              if (otherCard) otherCard.outerHTML = matchRow(m, 'po-playoff');
            }
          }
        }
      }
    } else {
      needsFullRender = true;
    }

    if (needsFullRender) {
      await _rerenderCurrentViewPreserveDrafts();
      return;
    }

    // Reseed version so the poll doesn't fire a redundant re-render.
    fetch(`/api/tournaments/${currentTid}/version`)
      .then(r => r.json())
      .then(d => { _adminLastKnownVersion = d.version; })
      .catch(() => {});
  } catch (_e) {
    await _rerenderCurrentViewPreserveDrafts();
  }
}

/** Map scoring context to API path suffix. */
const _SCORE_ENDPOINTS = {
  'gp-group':   { points: 'gp/record-group',           tennis: 'gp/record-group-tennis' },
  'gp-playoff': { points: 'gp/record-playoff',         tennis: 'gp/record-playoff-tennis' },
  'mex-playoff':{ points: 'mex/record-playoff',        tennis: 'mex/record-playoff-tennis' },
  'mex':        { points: 'mex/record',                 tennis: null },
  'po-playoff': { points: 'po/record',                  tennis: 'po/record-tennis' },
};

function _scoreApiPath(ctx, isTennis) {
  const entry = _SCORE_ENDPOINTS[ctx] || _SCORE_ENDPOINTS['mex'];
  return `/api/tournaments/${currentTid}/${isTennis ? entry.tennis : entry.points}`;
}

async function submitScore(matchId, ctx) {
  const s1 = +document.getElementById('s1-' + matchId).value;
  const s2 = +document.getElementById('s2-' + matchId).value;
  try {
    await api(_scoreApiPath(ctx, false), {
      method: 'POST', body: JSON.stringify({ match_id: matchId, score1: s1, score2: s2 })
    });
    await _surgicalScoreUpdate(matchId, ctx);
  } catch (e) { alert(e.message); }
}

function _renderTennisSetInputs(matchId, numSets) {
  let html = '';
  for (let i = 0; i < numSets; i++) {
    const isLastSet = i === numSets - 1;
    const maxAttr = isLastSet ? '' : ' max="7"';
    html += `<div class="tennis-set-row">`;
    html += `<span class="tennis-set-label">S${i + 1}:</span>`;
    html += `<input class="tennis-set-input" type="number" id="ts1-${matchId}-${i}" min="0"${maxAttr} value="" placeholder="0">`;
    html += `<span class="tennis-set-sep">-</span>`;
    html += `<input class="tennis-set-input" type="number" id="ts2-${matchId}-${i}" min="0"${maxAttr} value="" placeholder="0">`;
    html += `</div>`;
  }
  return html;
}

async function _setStageScoreMode(ctx, mode) {
  if (!(ctx in _gpScoreMode)) return;
  _gpScoreMode[ctx] = mode;
  _updateTvSetting('score_mode', { [ctx]: mode });
  if (currentType === 'group_playoff' || currentType === 'mexicano' || currentType === 'playoff') {
    await _rerenderCurrentViewPreserveDrafts();
  }
}

async function submitTennisScore(matchId, ctx) {
  // Validate 3rd set: requires S1 and S2 to each have a winner and be split
  const s3a = +(document.getElementById(`ts1-${matchId}-2`)?.value) || 0;
  const s3b = +(document.getElementById(`ts2-${matchId}-2`)?.value) || 0;
  if (s3a + s3b > 0) {
    const s1a = +(document.getElementById(`ts1-${matchId}-0`)?.value) || 0;
    const s1b = +(document.getElementById(`ts2-${matchId}-0`)?.value) || 0;
    const s2a = +(document.getElementById(`ts1-${matchId}-1`)?.value) || 0;
    const s2b = +(document.getElementById(`ts2-${matchId}-1`)?.value) || 0;
    const s1Winner = s1a > s1b ? 1 : (s1b > s1a ? 2 : 0);
    const s2Winner = s2a > s2b ? 1 : (s2b > s2a ? 2 : 0);
    if (s1Winner === 0) { alert(t('txt_txt_set_equal_scores', { n: 1 })); return; }
    if (s2Winner === 0) { alert(t('txt_txt_set_equal_scores', { n: 2 })); return; }
    if (s1Winner === s2Winner) { alert(t('txt_txt_third_set_needs_split')); return; }
  }

  // Gather set scores
  const sets = [];
  for (let i = 0; i < 10; i++) {
    const e1 = document.getElementById('ts1-' + matchId + '-' + i);
    const e2 = document.getElementById('ts2-' + matchId + '-' + i);
    if (!e1 || !e2) break;
    const v1 = +e1.value || 0;
    const v2 = +e2.value || 0;
    if (v1 === 0 && v2 === 0) continue;  // skip empty sets
    sets.push([v1, v2]);
  }
  if (sets.length === 0) { alert(t('txt_txt_enter_at_least_one_set_score')); return; }

  try {
    await api(_scoreApiPath(ctx, true), {
      method: 'POST', body: JSON.stringify({ match_id: matchId, sets })
    });
    await _surgicalScoreUpdate(matchId, ctx);
  } catch (e) { alert(e.message); }
}

// ─── GP Playoff Configuration ─────────────────────────────
let _gpRecommended = [];
let _gpAdvancingIds = new Set();
let _gpExternalParticipants = [];
let _gpCurrentCourts = [];
let _gpGroupNames = [];
let _gpCurrentPhase = '';
let _mexCurrentPhase = '';
let _poCurrentPhase = '';

async function nextGpGroupRound() {
  try {
    await api(`/api/tournaments/${currentTid}/gp/next-group-round`, { method: 'POST' });
    renderGP();
  } catch (e) { alert(e.message); }
}

async function proposeGpPlayoffs() {
  try {
    const data = await api(`/api/tournaments/${currentTid}/gp/recommend-playoffs`);
    _gpRecommended = data.recommended_participants || [];
    _gpAdvancingIds = new Set(_gpRecommended.map(r => r.player_id));
    _gpExternalParticipants = [];
    const section = document.getElementById('gp-playoffs-section');
    if (section) section.innerHTML = _renderGpPlayoffEditor();
  } catch (e) { alert(e.message); }
}

function _renderGpPlayoffEditor() {
  let html = `<div class="card">`;
  html += `<h2>${t('txt_txt_configure_gp_playoffs')}</h2>`;
  html += `<p class="gp-editor-intro">${t('txt_txt_select_advancing_players')}</p>`;

  // Participant checkboxes grouped by group — grid layout
  const byGroup = {};
  for (const r of _gpRecommended) {
    if (!byGroup[r.group]) byGroup[r.group] = [];
    byGroup[r.group].push(r);
  }
  html += `<div class="gp-groups-container">`;
  for (const [gName, rows] of Object.entries(byGroup)) {
    html += `<div class="gp-group-box">`;
    html += `<div class="gp-group-title">${esc(gName)}</div>`;
    for (const r of rows) {
      const checked = _gpAdvancingIds.has(r.player_id) ? ' checked' : '';
      html += `<label class="gp-player-row">`;
      html += `<input type="checkbox" value="${r.player_id}" class="gp-advancing-cb"${checked} onchange="_gpToggleAdvancing(this)">`;
      html += `<span class="gp-player-name">${esc(r.player)}</span>`;
      const _usesSets = r.sets_won > 0 || r.sets_lost > 0;
      const _diffPart = _usesSets
        ? `${t('txt_txt_sd_abbrev')}: ${r.sets_diff >= 0 ? '+' : ''}${r.sets_diff}, diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}`
        : `diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}`;
      html += `<span class="gp-player-stats">${r.wins} ${t('txt_txt_w_abbrev')}, ${_diffPart}</span>`;
      html += `</label>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  // External participants section
  html += `<div class="gp-external-section">`;
  html += `<h3>${t('txt_txt_external_participants')}</h3>`;
  html += `<p class="gp-external-hint">${t('txt_txt_external_participants_hint')}</p>`;
  html += `<div id="gp-external-list">`;
  for (let i = 0; i < _gpExternalParticipants.length; i++) {
    const ep = _gpExternalParticipants[i];
    html += `<div class="gp-external-row">`;
    html += `<span class="gp-external-name">★ ${esc(ep.name)}</span>`;
    html += `<input type="number" value="${ep.score}" class="playoff-editor-score-input" onchange="_gpUpdateExternalScore(${i}, this.value)">`;
    html += `<button type="button" class="btn btn-sm btn-muted playoff-editor-remove-btn" onclick="_gpRemoveExternal(${i})">✕</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `<div class="gp-external-add-row">`;
  html += `<input type="text" id="gp-external-name" placeholder="${t('txt_txt_add_external_participant')}" onkeydown="if(event.key==='Enter')_gpAddExternal()">`;
  html += `<input type="number" id="gp-external-score" class="playoff-editor-score-input" placeholder="${t('txt_txt_score')}" value="0">`;
  html += `<button type="button" class="btn btn-sm btn-primary" onclick="_gpAddExternal()">+</button>`;
  html += `</div>`;
  html += `</div>`;

  // Format selector
  html += `<div class="gp-format-row">`;
  html += `<div class="form-group"><label>${t('txt_txt_format')}</label><select id="gp-playoff-format"><option value="single">${t('txt_txt_single_elimination')}</option><option value="double">${t('txt_txt_double_elimination')}</option></select></div>`;
  html += `</div>`;

  // Courts + action buttons
  html += _renderCourtsSection(_gpCurrentCourts, `/api/tournaments/${currentTid}/gp/courts`);
  html += `<div class="proposal-actions proposal-actions-top">`;
  html += `<button type="button" class="btn btn-success btn-lg-action" onclick="withLoading(this,_confirmGpPlayoffs)">✓ ${t('txt_txt_start_playoffs')}</button>`;
  html += `<button type="button" class="btn btn-muted btn-lg-action" onclick="renderGP()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _gpToggleAdvancing(cb) {
  if (cb.checked) _gpAdvancingIds.add(cb.value);
  else _gpAdvancingIds.delete(cb.value);
}

function _gpAddExternal() {
  const input = document.getElementById('gp-external-name');
  const scoreInput = document.getElementById('gp-external-score');
  const name = (input?.value || '').trim();
  if (!name) return;
  const score = parseInt(scoreInput?.value || '0', 10) || 0;
  _gpExternalParticipants.push({ name, score });
  input.value = '';
  if (scoreInput) scoreInput.value = '0';
  const section = document.getElementById('gp-playoffs-section');
  if (section) section.innerHTML = _renderGpPlayoffEditor();
}

function _gpRemoveExternal(idx) {
  _gpExternalParticipants.splice(idx, 1);
  const section = document.getElementById('gp-playoffs-section');
  if (section) section.innerHTML = _renderGpPlayoffEditor();
}

function _gpUpdateExternalScore(idx, value) {
  if (idx >= 0 && idx < _gpExternalParticipants.length) {
    _gpExternalParticipants[idx].score = parseInt(value, 10) || 0;
  }
}

async function _confirmGpPlayoffs() {
  const ids = [..._gpAdvancingIds];
  const fmt = document.getElementById('gp-playoff-format')?.value || 'single';
  const extra = _gpExternalParticipants.length > 0
    ? _gpExternalParticipants.map(ep => ({ name: ep.name, score: ep.score }))
    : null;
  const totalParticipants = ids.length + (extra ? extra.length : 0);
  if (totalParticipants < 2) {
    alert(t('txt_txt_team_n_select_both_players', { n: 1 }));
    return;
  }
  try {
    await api(`/api/tournaments/${currentTid}/gp/start-playoffs`, {
      method: 'POST',
      body: JSON.stringify({
        advancing_player_ids: ids.length > 0 ? ids : null,
        extra_participants: extra,
        double_elimination: fmt === 'double',
      }),
    });
    _gpRecommended = [];
    _gpAdvancingIds = new Set();
    _gpExternalParticipants = [];
    renderGP();
  } catch (e) { alert(e.message); }
}

async function startPlayoffs() {
  // Direct start (backwards compat) — delegates to confirm flow
  await _confirmGpPlayoffs();
}

// ─── Render Mexicano ──────────────────────────────────────
