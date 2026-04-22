async function renderMex() {
  const _renderTid = currentTid;
  const el = document.getElementById('view-content');
  try {
    const [status, matches, tvSettings, playerSecrets, playoffsData, collabData, emailSettings] = await Promise.all([
      api(`/api/tournaments/${currentTid}/mex/status`),
      api(`/api/tournaments/${currentTid}/mex/matches`),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/mex/playoffs`).catch(() => ({ matches: [], pending: [] })),
      api(`/api/tournaments/${currentTid}/collaborators`).catch(() => null),
      api(`/api/tournaments/${currentTid}/email-settings`).catch(() => ({})),
    ]);

    _totalPts = status.total_points_per_match || 0;
    _mexPlayers = status.players || [];
    _mexTeamMode = status.team_mode || false;
    _mexTeamRoster = status.team_roster || {};
    _mexSport = status.sport || 'padel';
    // Default playoff toggle to match the tournament's round format:
    // Tennis Individual (team_mode=true) → toggle off (1-per-slot);
    // Tennis Team (team_mode=false) → toggle on (2-per-slot).
    _mexPlayoffTeamToggle = _mexSport === 'tennis' ? !_mexTeamMode : false;
    _mexBreakdowns = matches.breakdowns || {};
    _mexStrengthWeight = status.strength_weight || 0;
    _mexPlayerMap = {};
    for (const p of _mexPlayers) _mexPlayerMap[p.id] = p.name;
    window._mexStatusLeaderboard = status.leaderboard || [];

    // Store data needed by the manual pairing editor's round stats card
    window._mexAllMatches = matches.all_matches || [];
    window._mexSkillGap = status.skill_gap ?? null;

    // Snapshot all advanced settings for the in-place editor
    _mexSettingsEditorOpen = false;
    _mexSettingsCurrent = {
      num_rounds: status.num_rounds,
      skill_gap: status.skill_gap,
      win_bonus: status.win_bonus ?? 0,
      strength_weight: status.strength_weight ?? 0,
      loss_discount: status.loss_discount ?? 1.0,
      balance_tolerance: status.balance_tolerance ?? 0.2,
      teammate_repeat_weight: status.teammate_repeat_weight ?? 2.0,
      opponent_repeat_weight: status.opponent_repeat_weight ?? 1.0,
      repeat_decay: status.repeat_decay ?? 0.5,
      partner_balance_weight: status.partner_balance_weight ?? 0,
    };

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }
    _scoreConfirmationMode = tvSettings.score_confirmation || 'immediate';
    _mexCurrentPhase = status.phase;

    const hasCourts = status.assign_courts !== false;

    // Phase-aware header
    const isPlayoffs = status.phase === 'playoffs';
    const isFinished = status.phase === 'finished';
    const isRolling = status.rolling;
    const mexicanoEnded = Boolean(status.mexicano_ended);
    const mexRoundsDone = !isRolling && status.current_round >= status.num_rounds && matches.pending.length === 0;
    const hasPlayoffBracket = (playoffsData.matches || []).length > 0;

    const playoffMatches = playoffsData.matches || [];
    const activeMatches = (isPlayoffs || hasPlayoffBracket)
      ? playoffMatches
      : (matches.all_matches || matches.current_matches || []);
    const mexOpsStats = _buildMexOpsStats({
      status,
      hasPlayoffBracket,
      hasCourts,
      matches: activeMatches,
    });
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts, true);
    html += _renderEmailControls(emailSettings);
    html += _renderPlayerCodes(playerSecrets);
    html += _renderCollaboratorsSection(collabData?.collaborators || []);
    html += _renderMexOpsHeader(mexOpsStats);
    html += _renderMexReviewQueueCard(activeMatches);

    if (isPlayoffs) {
      html += `<div class="alert alert-info">${t('txt_txt_phase')}: <span class="badge badge-phase">${t('txt_txt_play_offs')}</span></div>`;
    } else if (isFinished && hasPlayoffBracket) {
      html += `<div class="alert alert-info">${t('txt_txt_tournament_finished_after_playoffs')}</div>`;
    } else if (isFinished) {
      html += `<div class="alert alert-info">${t('txt_txt_tournament_finished_no_playoffs')}</div>`;
    } else if (mexicanoEnded) {
      html += `<div class="alert alert-info">${t('txt_txt_mexicano_phase_ended')}</div>`;
    } else if (!isPlayoffs && isRolling) {
      html += `<div class="alert alert-info">${t('txt_txt_mexicano_round_n', { n: status.current_round })} <span class="badge badge-phase">${t('txt_txt_rolling')}</span></div>`;
    } else if (!isPlayoffs) {
      html += `<div class="alert alert-info">${t('txt_txt_mexicano_round_n_of_m', { n: status.current_round, m: status.num_rounds })}${mexRoundsDone ? ` — <strong>${t('txt_txt_mexicano_rounds_complete_ready_for_play_offs')}</strong>` : ''}</div>`;
    }

    if (status.champion) {
      html += `<div class="alert alert-success">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
    }

    if (isFinished) {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_export_outcome')}</h3>`;
      html += `<label class="switch-label"><input type="checkbox" id="export-include-history" checked><span class="switch-track"></span>${t('txt_txt_include_match_history')}</label>`;
      html += `<div class="export-actions-row">`;
      html += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
      html += `<button type="button" class="btn btn-muted" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    if (isPlayoffs || hasPlayoffBracket) {
      const pendingPo = (playoffsData.pending || []).filter(m => m.status !== 'completed');
      html += _renderCourtAssignmentsCard(pendingPo, t('txt_txt_court_assignments_mexicano_play_offs'), status.assign_courts !== false);

      html += _schemaCardHtml('mex-playoff-schema', t('txt_txt_mexicano_play_offs_bracket'), 'generateMexPlayoffSchema');

      html += `<div class="card">`;
      html += `<div class="playoff-header-row">`;
      html += `<h2 class="playoff-header-title">${t('txt_txt_mexicano_play_off_bracket')}</h2>`;
      if (window._emailConfigured) {
        html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,_sendNextRoundEmails)">📧 ${t('txt_email_notify_round')}</button>`;
      }
      html += `</div>`;
      html += `<div class="score-format-row">`;
      html += `<span class="score-format-label">${t('txt_txt_score_format')}:</span>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${_gpScoreMode['mex-playoff'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('mex-playoff','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${_gpScoreMode['mex-playoff'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('mex-playoff','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div></div>`;
      html += `<details id="mex-inline-bracket" class="bracket-collapse bracket-inline" open><summary class="bracket-collapse-summary"><span class="bracket-chevron bracket-chevron-anim">▶</span>${t('txt_txt_mexicano_play_offs_bracket')}</summary>`;
      html += `<img class="bracket-img" src="/api/tournaments/${currentTid}/mex/playoffs-schema?fmt=png&_t=${Date.now()}" alt="${t('txt_txt_mexicano_play_offs_bracket')}" onclick="_openBracketLightbox(this.src)" title="${t('txt_txt_click_to_expand')}" onerror="this.style.display='none'">`;
      html += `</details>`;
      for (const m of _sortTbdLast(playoffsData.matches)) {
        html += matchRow(m, 'mex-playoff');
      }
      html += `</div>`;
    } else {
      html += _renderCourtAssignmentsCard(matches.current_matches, t('txt_txt_court_assignments_current_round'), status.assign_courts !== false);
    }

    // Leaderboard (rendered after innerHTML is set, to allow sorting without re-fetching)
    html += `<div class="card" id="mex-leaderboard-card"></div>`;

    // Phase: Mexicano rounds
    if (!(isPlayoffs || isFinished)) {
      // Phase: Mexicano rounds
      if (matches.current_matches.length > 0) {
        html += `<div class="card">`;
        html += `<div class="current-round-header">`;
        html += `<h2 class="playoff-header-title">${t('txt_txt_current_round_matches')}</h2>`;
        if (window._emailConfigured) {
          html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,_sendNextRoundEmails)" title="${t('txt_email_notify_round')}">📧 ${t('txt_email_notify_round')}</button>`;
        }
        html += `</div>`;
        for (const m of matches.current_matches) {
          html += matchRow(m, 'mex');
        }
        html += `</div>`;
      }

      // Next round / end / playoffs controls
      const pending = matches.pending.length;
      const canGenerateRound = isRolling || status.current_round < status.num_rounds;

      // Advanced settings panel (always visible during Mexicano phase)
      html += _renderMexSettingsSection();

      if (pending === 0 && !mexicanoEnded && canGenerateRound) {
        // Missed games / sit-out management panel
        if (status.sit_out_count > 0 && status.missed_games) {
          html += `<div class="card" id="mex-sitout-panel">`;
          html += `<h3>🪑 ${t('txt_txt_missed_games_sitout')}</h3>`;
          html += `<p class="muted-note-sm">${t('txt_txt_sitout_instructions', { n: status.sit_out_count })}</p>`;
          html += `<div class="sitout-grid">`;
          // Sort by most missed first
          const mgList = Object.entries(status.missed_games)
            .map(([id, d]) => ({id, name: d.name, sat_out: d.sat_out, played: d.matches_played}))
            .sort((a, b) => b.sat_out - a.sat_out || a.played - b.played);
          for (const mg of mgList) {
            const forced = _forcedSitOuts.has(mg.id);
            html += `<div class="sitout-item${forced ? ' forced' : ''}" onclick="_toggleForcedSitOut('${mg.id}', ${status.sit_out_count})">`;
            html += `<span class="missed-badge">${t('txt_txt_n_missed', { n: mg.sat_out })}</span>`;
            html += `<span>${esc(mg.name)}</span>`;
            html += `<span class="muted-tiny">${t('txt_txt_n_played', { n: mg.played })}</span>`;
            html += `</div>`;
          }
          html += `</div>`;
          html += `<div id="sitout-selection-info" class="muted-note-sm sitout-selection-info"></div>`;
          html += `</div>`;
        }

        html += `<div id="mex-next-section">`;
        html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/mex/courts`);
        html += `<div class="decision-actions-row">`;
        html += `<button type="button" class="btn btn-success btn-lg-action" onclick="withLoading(this,proposeMexPairings)">⚡ ${t('txt_txt_propose_next_round')}</button>`;
        if (status.current_round > 0) {
          html += `<button type="button" class="btn btn-primary btn-lg-action" onclick="withLoading(this,endMexicano)">🛑 ${t('txt_txt_end_mexicano')}</button>`;
        }
        html += `</div>`;
        html += `</div>`;
      } else if (pending > 0) {
        const totalMex = matches.current_matches.length;
        const doneMex = totalMex - pending;
        const pctMex = totalMex > 0 ? Math.round((doneMex / totalMex) * 100) : 0;
        html += `<div id="mex-round-progress" class="alert alert-info">${t('txt_txt_n_match_remaining', { n: pending })} (${doneMex}/${totalMex})<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pctMex}%"></div></div></div>`;
      } else if (pending === 0 && !mexicanoEnded && !canGenerateRound) {
        html += `<div id="mex-next-section">`;
        html += `<button type="button" class="btn btn-primary" onclick="withLoading(this,endMexicano)">🛑 ${t('txt_txt_end_mexicano')}</button>`;
        html += `</div>`;
      }

      if (mexicanoEnded && !isPlayoffs && !isFinished) {
        html += `<div id="mex-playoffs-section" class="card">`;
        html += `<h2>${t('txt_txt_post_mexicano_decision')}</h2>`;
        html += `<p class="panel-intro">${t('txt_txt_post_mexicano_instructions')}</p>`;
        html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/mex/courts`);
        html += `<div class="decision-actions-row">`;
        html += `<button type="button" class="btn btn-success btn-lg-action" onclick="withLoading(this,proposeMexPlayoffs)">🏆 ${t('txt_txt_start_optional_playoffs')}</button>`;
        html += `<button type="button" class="btn btn-muted btn-lg-action" onclick="withLoading(this,finishMexicanoAsIs)">✓ ${t('txt_txt_finish_as_is')}</button>`;
        html += `<button type="button" class="btn btn-muted btn-lg-action" onclick="withLoading(this,undoEndMexicano)">← ${t('txt_txt_back_to_mexicano')}</button>`;
        html += `</div>`;
        html += `</div>`;
      }

      // History — grouped by round as collapsible accordion
      if (matches.all_matches.length > matches.current_matches.length) {
        html += `<div class="card"><h3>${t('txt_txt_previous_rounds')}</h3>`;
        const prev = matches.all_matches.filter(m => !matches.current_matches.some(c => c.id === m.id));
        // Group by round_number
        const byRound = {};
        for (const m of prev) {
          const rn = m.round_number || 0;
          if (!byRound[rn]) byRound[rn] = [];
          byRound[rn].push(m);
        }
        // Sort rounds descending (most recent first)
        const roundNums = Object.keys(byRound).map(Number).sort((a, b) => b - a);
        for (let ri = 0; ri < roundNums.length; ri++) {
          const rn = roundNums[ri];
          const rMatches = byRound[rn];
          const label = rMatches[0]?.round_label || `Round ${rn}`;
          const openAttr = ri === 0 ? ' open' : '';
          html += `<details class="round-group"${openAttr} id="mex-round-${rn}">`;
          html += `<summary>${esc(label)} — ${rMatches.length} ${rMatches.length > 1 ? t('txt_txt_matches') : t('txt_txt_match')}</summary>`;
          for (const m of rMatches) {
            html += matchRow(m, 'mex');
          }
          html += `</details>`;
        }
        html += `</div>`;
      }
    }

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
    _renderMexLeaderboard();
    _mexApplyReviewQueueFilter();
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

let _mexReviewQueueFilterState = 'all';
let _courtBoardCompact = localStorage.getItem('courtBoardCompact') === '1';

function _buildMexOpsStats({ status, hasPlayoffBracket, hasCourts, matches }) {
  const unresolved = (matches || []).filter(m => m.status !== 'completed');
  const disputes = unresolved.filter(m => m.disputed);
  const escalated = disputes.filter(m => m.dispute_escalated);
  const pendingConfirmation = unresolved.filter(m => m.score && m.scored_by && !m.score_confirmed && !m.disputed);
  const unassignedCourtsCount = hasCourts
    ? unresolved.filter(m => !String(m.court || '').trim()).length
    : 0;

  let nextAction = 'none';
  if (disputes.length > 0 || pendingConfirmation.length > 0) {
    nextAction = 'review';
  } else if (unresolved.length > 0) {
    nextAction = 'record';
  } else if (status.phase === 'playoffs') {
    nextAction = 'finish-playoffs';
  } else if (status.phase !== 'finished' && !status.mexicano_ended && (status.rolling || status.current_round < status.num_rounds)) {
    nextAction = 'next-round';
  } else if (status.phase !== 'finished' && !status.mexicano_ended) {
    nextAction = 'end-mexicano';
  } else if (status.phase !== 'finished' && status.mexicano_ended && !hasPlayoffBracket) {
    nextAction = 'start-playoffs';
  }

  return {
    unresolvedCount: unresolved.length,
    pendingConfirmationCount: pendingConfirmation.length,
    disputesCount: disputes.length,
    escalatedCount: escalated.length,
    unassignedCourtsCount,
    nextAction,
  };
}

function _renderMexOpsHeader(stats) {
  const actionLabelMap = {
    review: t('txt_txt_next_action_review_queue'),
    record: t('txt_txt_next_action_record_scores'),
    'next-round': t('txt_txt_propose_next_round'),
    'end-mexicano': t('txt_txt_end_mexicano'),
    'start-playoffs': t('txt_txt_start_optional_playoffs'),
    'finish-playoffs': t('txt_txt_next_action_complete_playoffs'),
    none: '—',
  };
  const actionLabel = actionLabelMap[stats.nextAction] || actionLabelMap.none;
  return `
    <div class="card gp-ops-header" id="mex-ops-header">
      <div class="gp-ops-header-top">
        <h3>${t('txt_txt_ops_overview')}</h3>
        <div class="gp-ops-next-action">
          <span>${t('txt_txt_next_action')}:</span>
          <button type="button" class="btn btn-sm" ${stats.nextAction === 'none' ? 'disabled' : ''} onclick="_mexFocusNextAction('${stats.nextAction}')">${esc(actionLabel)}</button>
        </div>
      </div>
      <div class="gp-ops-stats-grid">
        <div class="gp-ops-stat-pill"><span>${t('txt_txt_pending_matches')}</span><strong>${stats.unresolvedCount}</strong></div>
        ${_scoreConfirmationMode !== 'immediate' ? `<div class="gp-ops-stat-pill"><span>${t('txt_txt_pending_confirmation')}</span><strong>${stats.pendingConfirmationCount}</strong></div>` : ''}
        ${_scoreConfirmationMode !== 'immediate' ? `<div class="gp-ops-stat-pill"><span>${t('txt_txt_disputes')}</span><strong>${stats.disputesCount}</strong></div>` : ''}
        ${_scoreConfirmationMode !== 'immediate' ? `<div class="gp-ops-stat-pill"><span>${t('txt_txt_escalated')}</span><strong>${stats.escalatedCount}</strong></div>` : ''}
      </div>
    </div>
  `;
}

function _renderMexReviewQueueCard(matches) {
  const reviewItems = (matches || []).filter(m => _gpGetReviewItemKind(m));
  if (!reviewItems.length) return '';

  const disputesCount = reviewItems.filter(m => _gpGetReviewItemKind(m) === 'disputes').length;
  const pendingCount = reviewItems.length - disputesCount;
  let html = `<div class="card gp-review-queue-card" id="mex-review-queue-card">`;
  html += `<div class="gp-review-queue-head">`;
  html += `<h3>${t('txt_txt_review_queue')}</h3>`;
  html += `<div class="gp-review-filter" id="mex-review-filter">`;
  html += `<button type="button" class="active" onclick="_mexSetReviewQueueFilter('all')">${t('txt_txt_filter_all')} (${reviewItems.length})</button>`;
  if (_scoreConfirmationMode !== 'immediate') html += `<button type="button" onclick="_mexSetReviewQueueFilter('disputes')">${t('txt_txt_disputes')} (${disputesCount})</button>`;
  if (_scoreConfirmationMode !== 'immediate') html += `<button type="button" onclick="_mexSetReviewQueueFilter('pending')">${t('txt_txt_pending_confirmation')} (${pendingCount})</button>`;
  html += `</div></div>`;
  html += `<div class="gp-review-items" id="mex-review-items">`;
  for (const m of reviewItems) {
    const kind = _gpGetReviewItemKind(m);
    const kindLabel = kind === 'disputes' ? t('txt_txt_disputes') : t('txt_txt_pending_confirmation');
    const roundLabel = m.round_label ? esc(m.round_label) : t('txt_txt_match');
    const courtLabel = m.court ? esc(m.court) : t('txt_txt_no_courts');
    const scorePreview = esc(_gpMatchScorePreview(m));
    const teams = `${(m.team1 || []).join(' & ') || 'TBD'} vs ${(m.team2 || []).join(' & ') || 'TBD'}`;
    html += `<div class="gp-review-row" data-kind="${kind}">`;
    html += `<div class="gp-review-row-main">`;
    html += `<div class="gp-review-row-meta"><span class="badge badge-scheduled">${esc(kindLabel)}</span><span>${roundLabel}</span><span>${courtLabel}</span><span>${scorePreview}</span></div>`;
    html += `<div class="gp-review-row-teams">${esc(teams)}</div>`;
    html += `</div>`;
    html += `<button type="button" class="btn btn-sm" onclick="_goToMatchFromQueue('${m.id}')">${t('txt_txt_go_to_match')}</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `<div class="gp-review-empty hidden" id="mex-review-empty">${t('txt_txt_no_review_items')}</div>`;
  html += `</div>`;
  return html;
}

function _mexSetReviewQueueFilter(filter) {
  _mexReviewQueueFilterState = filter;
  _mexApplyReviewQueueFilter();
}

function _mexApplyReviewQueueFilter() {
  const root = document.getElementById('mex-review-queue-card');
  if (!root) return;
  const rows = [...root.querySelectorAll('.gp-review-row')];
  const filter = _mexReviewQueueFilterState;

  rows.forEach(row => {
    const show = filter === 'all' || row.dataset.kind === filter;
    row.classList.toggle('hidden', !show);
  });

  const visibleRows = rows.filter(row => !row.classList.contains('hidden')).length;
  const empty = root.querySelector('#mex-review-empty');
  if (empty) empty.classList.toggle('hidden', visibleRows > 0);

  const filterWrap = root.querySelector('#mex-review-filter');
  if (filterWrap) {
    const labels = {
      all: t('txt_txt_filter_all'),
      disputes: t('txt_txt_disputes'),
      pending: t('txt_txt_pending_confirmation'),
    };
    filterWrap.querySelectorAll('button').forEach(btn => {
      const isActive = btn.textContent.trim().startsWith(labels[filter]);
      btn.classList.toggle('active', isActive);
    });
  }
}

function _mexFocusNextAction(action) {
  if (action === 'review') {
    document.getElementById('mex-review-queue-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (action === 'record') {
    const firstPending = document.querySelector('.match-card-wrap[data-status="pending"]');
    if (firstPending?.id?.startsWith('mcard-')) {
      _scrollToMatch(firstPending.id.slice(6));
    }
    return;
  }
  if (action === 'next-round' || action === 'end-mexicano') {
    document.getElementById('mex-next-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (action === 'start-playoffs') {
    document.getElementById('mex-playoffs-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (action === 'finish-playoffs') {
    document.getElementById('mex-playoff-schema')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function _mexSetSort(col) {
  if (_mexSortCol === col) {
    _mexSortDir = _mexSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _mexSortCol = col;
    // strings & rank sort ascending by default; numeric stats sort descending
    _mexSortDir = (col === 'player' || col === 'rank') ? 'asc' : 'desc';
  }
  _renderMexLeaderboard();
}

function _renderMexLeaderboard() {
  const card = document.getElementById('mex-leaderboard-card');
  if (!card) return;
  const leaderboard = window._mexStatusLeaderboard || [];
  const byAvg = leaderboard.length > 0 && leaderboard[0].ranked_by_avg;

  // Sort a shallow copy so server order is preserved for next default render
  const rows = [...leaderboard];
  if (_mexSortCol !== null) {
    rows.sort((a, b) => {
      let va = a[_mexSortCol];
      let vb = b[_mexSortCol];
      if (typeof va === 'string' || typeof vb === 'string') {
        const cmp = (va || '').localeCompare(vb || '');
        return _mexSortDir === 'asc' ? cmp : -cmp;
      }
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      return _mexSortDir === 'desc' ? vb - va : va - vb;
    });
  }

  const indicator = (col) => {
    if (_mexSortCol !== col) return '';
    return _mexSortDir === 'desc' ? ' ↓' : ' ↑';
  };
  const thHtml = (col, label) => {
    const isDefaultRankCol = _mexSortCol === null && ((col === 'total_points' && !byAvg) || (col === 'avg_points' && byAvg));
    const isActive = _mexSortCol === col;
    const inner = isDefaultRankCol
      ? `<strong>${label} ↓</strong>`
      : isActive
        ? `<strong>${label}${indicator(col)}</strong>`
        : label;
    return `<th class="sortable-col${isActive ? ' sort-active' : ''}" onclick="_mexSetSort('${col}')">${inner}</th>`;
  };

  let html = `<h2 class="card-heading-row">${t('txt_txt_leaderboard')} <button class="format-info-btn" onclick="showAbbrevPopup(event,'leaderboard')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></h2>`;
  html += `<table><thead><tr>`;
  html += thHtml('rank', t('txt_txt_rank'));
  html += thHtml('player', (_mexTeamRoster && Object.keys(_mexTeamRoster).length > 0) ? t('txt_txt_team') : t('txt_txt_player'));
  html += thHtml('total_points', t('txt_txt_total_pts_abbrev'));
  html += thHtml('matches_played', t('txt_txt_played_abbrev'));
  html += thHtml('wins', t('txt_txt_w_abbrev'));
  html += thHtml('draws', t('txt_txt_d_abbrev'));
  html += thHtml('losses', t('txt_txt_l_abbrev'));
  html += thHtml('avg_points', t('txt_txt_avg_pts_abbrev'));
  html += thHtml('buchholz', t('txt_txt_buchholz_abbrev'));
  html += `</tr></thead><tbody>`;

  for (const r of rows) {
    const totalCell = byAvg ? r.total_points : `<strong>${r.total_points}</strong>`;
    const avgCell   = byAvg ? `<strong>${r.avg_points.toFixed(2)}</strong>` : r.avg_points.toFixed(2);
    const rowClass = r.removed ? ' class="leaderboard-row-removed"' : '';
    const rankCell = r.removed ? `<span class="muted-text">—</span>` : r.rank;
    const nameCell = r.removed ? `${esc(r.player)} <span class="badge badge-closed badge-removed-inline">${t('txt_txt_removed')}</span>` : esc(r.player);
    html += `<tr${rowClass}><td>${rankCell}</td><td>${nameCell}</td><td>${totalCell}</td><td>${r.matches_played}</td><td>${r.wins || 0}</td><td>${r.draws || 0}</td><td>${r.losses || 0}</td><td>${avgCell}</td><td>${r.buchholz != null ? r.buchholz : '—'}</td></tr>`;
  }
  html += `</tbody></table>`;
  card.innerHTML = html;
}

function _renderCourtAssignmentsCard(matches, title, assignCourts = true) {
  if (!assignCourts) {
    // Courts disabled — group by round, defined players first, multi-column grid
    if (!matches || matches.length === 0) {
      return `<div class="card"><h3>${t('txt_txt_pending_matches')}</h3><em>${t('txt_txt_no_pending_assignments')}</em></div>`;
    }
    const _tl = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
    const _hasTbd = (m) => !m.team1?.join('').trim() || !m.team2?.join('').trim();
    // Group by round_label, preserving first-seen order
    const _byRound = {};
    const _roundOrder = [];
    for (const m of matches) {
      const key = m.round_label || '';
      if (!_byRound[key]) { _byRound[key] = []; _roundOrder.push(key); }
      _byRound[key].push(m);
    }
    // Within each round: defined-player matches first, TBD last
    for (const key of _roundOrder) {
      _byRound[key].sort((a, b) => _hasTbd(a) - _hasTbd(b));
    }
    let html = `<div class="card"><h3>${t('txt_txt_pending_matches')}</h3>`;
    html += `<div class="pending-grid">`;
    for (const key of _roundOrder) {
      html += `<div>`;
      if (key) html += `<div class="pending-round-label">${esc(key)}</div>`;
      for (const m of _byRound[key]) {
        const tbd = _hasTbd(m);
        const _cmt = m.comment ? `<div class="match-comment-text match-comment-static">💬 ${esc(m.comment)}</div>` : '';
        const _jumpAttr = m.id ? ` role="button" tabindex="0" style="cursor:pointer" onclick="_scrollToMatch('${m.id}')" onkeydown="if(event.key==='Enter')_scrollToMatch('${m.id}')"` : '';
        html += `<div class="match-card pending-match-card${tbd ? ' match-tbd-disabled' : ''}"${_jumpAttr}><div class="match-teams">${esc(_tl(m.team1))} <span class="vs">vs</span> ${esc(_tl(m.team2))}</div>${_cmt}</div>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  if (!matches || matches.length === 0) {
    return `<div class="card"><h3>${esc(title)}</h3><em>${t('txt_txt_no_pending_assignments')}</em></div>`;
  }

  // Group all pending matches by court, sorted by slot_number within each court.
  const matchesByCourt = {};
  for (const m of matches) {
    if (!m.court) continue;
    if (!matchesByCourt[m.court]) matchesByCourt[m.court] = [];
    matchesByCourt[m.court].push(m);
  }
  for (const arr of Object.values(matchesByCourt)) {
    arr.sort((a, b) => (a.slot_number ?? 0) - (b.slot_number ?? 0));
  }

  const courtNames = Object.keys(matchesByCourt).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (courtNames.length === 0) {
    return `<div class="card"><h3>${esc(title)}</h3><em>${t('txt_txt_no_pending_assignments')}</em></div>`;
  }

  const _teamLabel = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
  const compactCls = _courtBoardCompact ? ' court-board-compact' : '';
  const compactBtnLabel = _courtBoardCompact ? t('txt_txt_court_board_expand') : t('txt_txt_court_board_compact');

  let html = `<div class="card"><div class="court-board-header"><h3>${esc(title)}</h3><button type="button" class="btn btn-sm btn-outline" onclick="_toggleCourtBoardCompact()" aria-pressed="${_courtBoardCompact}">${esc(compactBtnLabel)}</button></div><div class="court-board${compactCls}">`;
  for (const courtName of courtNames) {
    const courtMatches = matchesByCourt[courtName];
    html += `<div class="court-column">`;
    html += `<div class="court-title">${esc(courtName)}</div>`;
    for (let i = 0; i < courtMatches.length; i++) {
      const m = courtMatches[i];
      const t1 = _teamLabel(m.team1);
      const t2 = _teamLabel(m.team2);
      const r = m.round_label ? `<span class="court-round">${esc(m.round_label)}</span>` : '';
      const jumpLabel = `${t('txt_txt_go_to_match')}: ${t1} vs ${t2}`;
      const upcomingCls = i > 0 ? ' court-match-upcoming' : '';
      html += `<div class="court-match-item${upcomingCls}" role="button" tabindex="0" data-match-id="${m.id}" aria-label="${esc(jumpLabel)}" onclick="_scrollToMatch('${m.id}')" onkeydown="if(event.key==='Enter')_scrollToMatch('${m.id}')">${esc(t1)} <span class="muted-text">vs</span> ${esc(t2)}${r}</div>`;
      if (m.comment && !_courtBoardCompact) html += `<div class="court-match-item court-match-item-no-top"><span class="match-comment-text match-comment-static">💬 ${esc(m.comment)}</span></div>`;
    }
    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}

function _toggleCourtBoardCompact() {
  _courtBoardCompact = !_courtBoardCompact;
  localStorage.setItem('courtBoardCompact', _courtBoardCompact ? '1' : '0');
  if (currentType === 'group_playoff') renderGP();
  else if (currentType === 'playoff') renderPO();
  else renderMex();
}

async function nextMexRound() {
  try {
    await api(`/api/tournaments/${currentTid}/mex/next-round`, { method: 'POST' });
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

// ─── Pairing proposal picker ──────────────────────────────
let _selectedOptionId = null;
let _currentPlayerStats = null;
let _forcedSitOuts = new Set();
let _currentPairingProposals = [];
let _showRepeatDetails = false;
let _mexProposalRequestedCount = 3;
// null = use persistent setting, number = live slider override
let _partnerBalanceWeightOverride = null;

// ─── Sit-out override toggle ──────────────────────────────
async function _toggleForcedSitOut(playerId, maxSitOuts) {
  if (_forcedSitOuts.has(playerId)) {
    _forcedSitOuts.delete(playerId);
  } else {
    if (_forcedSitOuts.size >= maxSitOuts) {
      // Remove the first one added
      const first = _forcedSitOuts.values().next().value;
      _forcedSitOuts.delete(first);
    }
    _forcedSitOuts.add(playerId);
  }
  // Update visual state without full re-render
  document.querySelectorAll('.sitout-item').forEach(el => {
    const onclick = el.getAttribute('onclick');
    const match = onclick && onclick.match(/_toggleForcedSitOut\('([^']+)'/);
    if (match) {
      el.classList.toggle('forced', _forcedSitOuts.has(match[1]));
    }
  });
  const info = document.getElementById('sitout-selection-info');
  if (info) {
    if (_forcedSitOuts.size > 0) {
      const names = [..._forcedSitOuts].map(id => {
        const p = _mexPlayers.find(x => x.id === id);
        return p ? p.name : id;
      });
      info.innerHTML = `<strong>${t('txt_txt_forced_sitout')}</strong> ${esc(names.join(', '))} (${_forcedSitOuts.size}/${maxSitOuts})`;
    } else {
      info.innerHTML = `<em>${t('txt_txt_no_override_automatic')}</em>`;
    }
  }

  const nextSection = document.getElementById('mex-next-section');
  const remaining = maxSitOuts - _forcedSitOuts.size;
  if (_forcedSitOuts.size > 0 && remaining > 0) {
    // Partial selection — wait for all required sit-outs before calling the API
    if (nextSection) {
      nextSection.innerHTML = `<em class="muted-text">${t('txt_txt_select_more_sitouts', {n: remaining})}</em>`;
    }
    return;
  }
  if (nextSection) {
    nextSection.innerHTML = _renderProposalProgressBar();
  }
  try {
    await proposeMexPairings(_mexProposalRequestedCount);
  } catch (e) {
    if (nextSection) {
      nextSection.innerHTML = `<div class="alert alert-error">${esc(e.message || t('txt_txt_failed_refresh_proposals'))}</div>`;
    }
  }
}

// ─── Edit completed match ─────────────────────────────────
function _toggleEditMatch(matchId, ctx, s1, s2) {
  const editDiv = document.getElementById('medit-' + matchId);
  const scoreSpan = document.getElementById('mscore-' + matchId);
  const editBtn = document.getElementById('medit-btn-' + matchId);
  if (!editDiv) return;

  editDiv.classList.remove('hidden');

  // Populate plain-score inputs
  const s1El = document.getElementById('s1-' + matchId);
  const s2El = document.getElementById('s2-' + matchId);
  if (s1El) s1El.value = s1;
  if (s2El) s2El.value = s2;

  // Pre-populate tennis set inputs with existing set data (stored on the button)
  const setsRaw = editBtn ? editBtn.dataset.sets : null;
  if (setsRaw) {
    try {
      const sets = JSON.parse(setsRaw);
      for (let i = 0; i < 3; i++) {
        const e1 = document.getElementById('ts1-' + matchId + '-' + i);
        const e2 = document.getElementById('ts2-' + matchId + '-' + i);
        if (e1) e1.value = (sets[i] !== undefined) ? sets[i][0] : '';
        if (e2) e2.value = (sets[i] !== undefined) ? sets[i][1] : '';
      }
    } catch (_) {}
  }

  if (scoreSpan) scoreSpan.classList.add('hidden');
  if (editBtn) editBtn.classList.add('hidden');
}

function _cancelEditMatch(matchId) {
  const editDiv = document.getElementById('medit-' + matchId);
  const scoreSpan = document.getElementById('mscore-' + matchId);
  const editBtn = document.getElementById('medit-btn-' + matchId);
  if (editDiv) editDiv.classList.add('hidden');
  if (scoreSpan) scoreSpan.classList.remove('hidden');
  if (editBtn) editBtn.classList.remove('hidden');
}

async function proposeMexPairings(requestedCount = 3) {
  try {
    _mexProposalRequestedCount = requestedCount;
    let url = `/api/tournaments/${currentTid}/mex/propose-pairings?n=${requestedCount}`;
    if (_forcedSitOuts.size > 0) {
      url += `&sit_out_ids=${[..._forcedSitOuts].join(',')}`;
    }
    if (typeof _partnerBalanceWeightOverride === 'number') {
      url += `&partner_balance_weight=${_partnerBalanceWeightOverride}`;
    }
    const data = await api(url);
    const proposals = data.proposals;
    _currentPairingProposals = proposals;
    _currentPlayerStats = data.player_stats || null;
    _selectedOptionId = (proposals.find(p => p.recommended) || proposals[0])?.option_id || null;

    // Replace only the next-section div so the rest of the view stays intact
    const section = document.getElementById('mex-next-section');
    if (section) {
      section.innerHTML = _renderProposalPicker(proposals);
    }
  } catch (e) { _showToast(e.message, 'error'); }
}

async function _loadMoreMexPairings(btn) {
  if (btn && btn.classList.contains('loading')) return;
  if (btn) btn.classList.add('loading');
  try {
    const previousSelected = _selectedOptionId;
    await proposeMexPairings(10);
    if (previousSelected && _currentPairingProposals.some(p => p.option_id === previousSelected)) {
      _selectedOptionId = previousSelected;
    }
    const section = document.getElementById('mex-next-section');
    if (section && _currentPairingProposals.length > 0) {
      section.innerHTML = _renderProposalPicker(_currentPairingProposals);
    }
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

function _onPartnerBalanceSliderInput(value) {
  // Immediately update the readout without re-fetching (cheap visual feedback).
  const lbl = document.getElementById('pbw-val');
  if (lbl) lbl.textContent = value.toFixed(1);
}

async function _applyPartnerBalanceWeight(value) {
  _partnerBalanceWeightOverride = value;
  const lbl = document.getElementById('pbw-val');
  if (lbl) lbl.textContent = value.toFixed(1);
  // Re-fetch proposals using the temporary override — does not persist.
  try {
    await proposeMexPairings(_mexProposalRequestedCount);
  } catch (e) { /* silent — network errors should not disrupt slider interaction */ }
}

function _renderProposalProgressBar() {
  return `<div class="proposal-progress-bar-container">
    <div class="proposal-progress-bar"></div>
  </div>
  <p class="proposal-progress-note">${t('txt_txt_generating_proposals')}</p>`;
}

function _renderProposalPicker(proposals) {
  let html = `<div class="card">`;
  html += `<div class="proposal-header-row">`;
  html += `<h2>${t('txt_txt_choose_pairings')}</h2>`;
  html += `<button type="button" class="btn btn-outline-muted" onclick="_showManualEditor()">✏️ ${t('txt_txt_manual_override')}</button>`;
  html += `</div>`;
  html += `<div class="proposal-display-controls">`;  

  if (_currentPlayerStats) {
    html += `<details class="proposal-display-history">`;
    html += `<summary>${t('txt_txt_player_match_history')}</summary>`;
    html += `<div id="stats-panel">${_renderPlayerStats(_currentPlayerStats)}</div>`;
    html += `</details>`;
  }

  html += `<label class="proposal-display-toggle"><input type="checkbox" ${_showRepeatDetails ? 'checked' : ''} onchange="_toggleRepeatDetails(this.checked)"><span class="switch-track"></span>${t('txt_txt_show_repeat_details')}</label>`;
  html += `</div>`;

  const bestOption = proposals.find(p => p.recommended) || proposals[0] || null;
  const allAlternatives = proposals
    .filter(p => !bestOption || p.option_id !== bestOption.option_id);

  const proposalLabelNumber = (proposal) => {
    const match = String(proposal?.label || '').match(/(\d+)\s*$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };

  const sortByLabelNumber = (left, right) => {
    const numDiff = proposalLabelNumber(left) - proposalLabelNumber(right);
    if (numDiff !== 0) return numDiff;
    return String(left.label || '').localeCompare(String(right.label || ''));
  };

  const allBalancedOptions = allAlternatives.filter(p => p.strategy === 'balanced').sort(sortByLabelNumber);
  const allSeededOptions = allAlternatives.filter(p => p.strategy === 'seeded').sort(sortByLabelNumber);

  const balancedOptions = allBalancedOptions;
  const seededOptions = allSeededOptions;
  const hasLoadedMore = _mexProposalRequestedCount >= 10;

  const renderProposalCard = (p) => {
    const fmt2 = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num.toFixed(2) : '0.00';
    };
    const sel = p.option_id === _selectedOptionId;
    let card = `<div class="proposal-card${sel ? ' selected' : ''}" onclick="_selectProposal('${p.option_id}')">`;
    card += `<div class="proposal-card-header">`;
    card += `<h4>${esc(p.label)}</h4>`;
    if (p.strategy === 'seeded') {
      card += `<span class="badge badge-scheduled">${t('txt_txt_seeded')}</span>`;
    }
    if (p.recommended) card += `<span class="badge badge-best">★ ${t('txt_txt_best')}</span>`;
    card += `</div>`;
    card += `<div class="proposal-metrics">`;
    card += `⚖️ ${t('txt_txt_score_gap')}: <strong>${fmt2(p.score_imbalance)} pts</strong><br>`;
    const repLabel = p.repeat_count === 0
      ? `✅ ${t('txt_txt_no_repeated_matchups')}`
      : `⚠️ ${t('txt_txt_n_repeats', { n: fmt2(p.repeat_count) })}`;  
    card += `${repLabel}`;
    if ((p.exact_prev_round_repeats || 0) > 0) {
      card += `<br>🔁 ${t('txt_txt_exact_rematch_warning', { n: p.exact_prev_round_repeats })}`;
    }
    if ((p.skill_gap_violations || 0) > 0) {
      const excess = fmt2(p.skill_gap_worst_excess || 0);
      card += `<br>🚫 ${t('txt_txt_skill_gap_violation', { n: p.skill_gap_violations, excess })}`;
    }
    if (p.sit_out_names && p.sit_out_names.length > 0) {
      card += `<br>🪑 ${t('txt_txt_sitting_out')}: <em>${esc(p.sit_out_names.join(', '))}</em>`;
    }
    card += `</div>`;

    for (const m of p.matches) {
      const t1 = m.team1_names.join(' & ');
      const t2 = m.team2_names.join(' & ');
      const court = m.court_name ? ` <span class="court-tag">[${esc(m.court_name)}]</span>` : '';
      card += `<div class="proposal-match">${esc(t1)} <span class="muted-text">vs</span> ${esc(t2)}${court}</div>`;
    }

    // Per-person repeat details
    if (_showRepeatDetails && p.per_person_repeats && p.repeat_count > 0) {
      card += `<div class="repeat-detail">`;
      for (const [name, detail] of Object.entries(p.per_person_repeats)) {
        const parts = [];
        for (const pr of (detail.partner_repeats || [])) {
          parts.push(esc(t('txt_txt_partner_n_times', { player: pr.player, count: pr.count })));
        }
        for (const or_ of (detail.opponent_repeats || [])) {
          parts.push(esc(t('txt_txt_vs_n_times', { player: or_.player, count: or_.count })));
        }
        if (parts.length > 0) {
          card += `<span class="rp-name">${esc(name)}</span>: ${parts.join(', ')}<br>`;
        }
      }
      card += `</div>`;
    }

    card += `</div>`;
    return card;
  };

  // Partner balance quick slider (individual mode only)
  if (!_mexTeamMode) {
    const savedPbw = _mexSettingsCurrent?.partner_balance_weight ?? 0;
    const sliderPbw = typeof _partnerBalanceWeightOverride === 'number' ? _partnerBalanceWeightOverride : savedPbw;
    html += `<div class="proposal-balance-slider">`;
    html += `<label>${t('txt_txt_partner_balance_slider_label')}: <strong id="pbw-val">${sliderPbw.toFixed(1)}</strong></label>`;
    html += `<input type="range" id="pbw-slider" min="0" max="2" step="0.1" value="${sliderPbw}" oninput="_onPartnerBalanceSliderInput(+this.value)" onchange="_applyPartnerBalanceWeight(+this.value)">`;
    html += `</div>`;
  }

  if (bestOption) {
    html += `<h3 class="proposal-section-title proposal-section-title-best">${t('txt_txt_best')}</h3>`;
    html += `<p class="proposal-section-desc">${t('txt_txt_best_description')}</p>`;
    html += `<div class="proposal-cards">`;
    html += renderProposalCard(bestOption);
    html += `</div>`;
  }

  if (allAlternatives.length > 0) {
    html += `<div class="proposal-section-row">`;
    html += `<h3>${t('txt_txt_alternatives')}</h3>`;
    html += `<div class="proposal-inline-actions">`;
    if (!hasLoadedMore) {
      html += `<button class="proposal-inline-action" type="button" onclick="_loadMoreMexPairings(this)">⬇ ${t('txt_txt_load_more_combos')}</button>`;
    } else {
      html += `<button class="proposal-inline-action" type="button" onclick="_loadMoreMexPairings(this)">🔄 ${t('txt_txt_refresh_proposals')}</button>`;
    }
    html += `</div>`;
    html += `</div>`;
  }

  if (balancedOptions.length > 0) {
    html += `<h3 class="proposal-section-title proposal-section-title-balanced">${t('txt_txt_balanced')}</h3>`;
    html += `<p class="proposal-section-desc">${t('txt_txt_balanced_description')}</p>`;
    html += `<div class="proposal-cards">`;
    for (const p of balancedOptions) {
      html += renderProposalCard(p);
    }
    html += `</div>`;
  }

  if (seededOptions.length > 0) {
    html += `<h3 class="proposal-section-title proposal-section-title-seeded">${t('txt_txt_seeded')}</h3>`;
    html += `<p class="proposal-section-desc">${t('txt_txt_seeded_description')}</p>`;
    if (seededOptions.length > 0) {
      html += `<div class="proposal-cards">`;
      for (const p of seededOptions) {
        html += renderProposalCard(p);
      }
      html += `</div>`;
    } else {
      html += `<p class="proposal-section-desc"><em>${t('txt_txt_no_seeded_alternatives')}</em></p>`;
    }
  }

  html += `<div class="proposal-action-bar">`;
  html += `<button type="button" class="btn btn-success" onclick="_confirmMexRound()">✓ ${t('txt_txt_confirm_selection')}</button>`;
  html += `<button type="button" class="btn btn-ghost" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`; // .card
  return html;
}

function _toggleRepeatDetails(show) {
  _showRepeatDetails = Boolean(show);
  const section = document.getElementById('mex-next-section');
  if (section && _currentPairingProposals.length > 0) {
    section.innerHTML = _renderProposalPicker(_currentPairingProposals);
  }
}

function _selectProposal(optionId) {
  _selectedOptionId = optionId;
  document.querySelectorAll('.proposal-card').forEach(c => {
    c.classList.toggle('selected', c.getAttribute('onclick') === `_selectProposal('${optionId}')`);
  });
}

async function _confirmMexRound() {
  if (!_selectedOptionId) { _showToast(t('txt_txt_select_a_pairing_option_first'), 'error'); return; }
  try {
    await api(`/api/tournaments/${currentTid}/mex/next-round`, {
      method: 'POST',
      body: JSON.stringify({ option_id: _selectedOptionId }),
    });
    _selectedOptionId = null;
    _currentPlayerStats = null;
    _partnerBalanceWeightOverride = null;
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

// ─── Mexicano settings editor ─────────────────────────────
let _mexSettingsCurrent = null;

function _renderMexSettingsSection() {
  const s = _mexSettingsCurrent;
  if (!s) return '';
  const rolling = s.num_rounds === 0;
  const roundsLabel = rolling ? '∞' : s.num_rounds;
  const skillLabel = s.skill_gap != null ? s.skill_gap : '—';
  const summaryText = `${t('txt_txt_advanced_settings')} — ${roundsLabel} ${t('txt_txt_number_of_rounds').toLowerCase()} · gap: ${skillLabel} · bonus: ${s.win_bonus ?? 0} · str: ${s.strength_weight ?? 0} · disc: ${s.loss_discount ?? 1}`;

  let html = `<details class="advanced-section">`;
  html += `<summary>${summaryText}</summary>`;
  html += `<div class="advanced-section-body">`;
  html += `<div class="advanced-grid">`;
  html += `<div class="adv-field"><label>${t('txt_txt_number_of_rounds')}</label>`;
  html += `<div class="advanced-rounds-row">`;
  html += `<div class="score-mode-toggle" id="mex-settings-rounds-toggle">`;
  html += `<button type="button" class="${rolling ? 'active' : ''}" onclick="_setMexSettingsRoundsMode('unlimited')">∞</button>`;
  html += `<button type="button" class="${!rolling ? 'active' : ''}" onclick="_setMexSettingsRoundsMode('fixed')">${t('txt_txt_fixed')}</button>`;
  html += `</div>`;
  html += `<input id="mex-settings-rounds" class="mex-settings-rounds-input${rolling ? ' hidden' : ''}" type="number" min="1" value="${rolling ? 8 : s.num_rounds}">`;
  html += `</div></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_skill_gap_label')}</label><input id="mex-settings-skill-gap" type="number" min="0" placeholder="${t('txt_txt_skill_gap_placeholder')}" value="${s.skill_gap ?? ''}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_win_bonus_label')}</label><input id="mex-settings-win-bonus" type="number" min="0" value="${s.win_bonus ?? 0}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_rival_strength_label')}</label><input id="mex-settings-strength-weight" type="number" min="0" max="1" step="0.05" value="${s.strength_weight ?? 0}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_strength_min_matches_label')}</label><input id="mex-settings-strength-min-matches" type="number" min="0" step="1" value="${s.strength_min_matches ?? 4}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_strength_win_factor_label')}</label><input id="mex-settings-strength-win-factor" type="number" min="0" max="1" step="0.05" value="${s.strength_win_factor ?? 1}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_strength_draw_factor_label')}</label><input id="mex-settings-strength-draw-factor" type="number" min="0" max="1" step="0.05" value="${s.strength_draw_factor ?? 0.75}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_strength_loss_factor_label')}</label><input id="mex-settings-strength-loss-factor" type="number" min="0" max="1" step="0.05" value="${s.strength_loss_factor ?? 0.5}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_loss_discount_label')}</label><input id="mex-settings-loss-discount" type="number" min="0" max="1" step="0.05" value="${s.loss_discount ?? 1}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_balance_tolerance_label')}</label><input id="mex-settings-balance-tol" type="number" min="0" step="0.1" value="${s.balance_tolerance ?? 0.2}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_teammate_repeat_weight_label')}</label><input id="mex-settings-teammate-repeat-wt" type="number" min="0" step="0.1" value="${s.teammate_repeat_weight ?? 2}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_opponent_repeat_weight_label')}</label><input id="mex-settings-opponent-repeat-wt" type="number" min="0" step="0.1" value="${s.opponent_repeat_weight ?? 1}"></div>`;
  html += `<div class="adv-field"><label>${t('txt_txt_repeat_decay_label')}</label><input id="mex-settings-repeat-decay" type="number" min="0" step="0.1" value="${s.repeat_decay ?? 0.5}"></div>`;
  if (!s.team_mode) {
    html += `<div class="adv-field"><label>${t('txt_txt_partner_balance_weight_label')}</label><input id="mex-settings-partner-balance-wt" type="number" min="0" step="0.1" value="${s.partner_balance_weight ?? 0}"></div>`;
  }
  html += `</div>`;
  html += `<div class="advanced-save-row">`;
  html += `<button type="button" class="btn btn-sm btn-success" onclick="withLoading(this,_saveMexSettings)">${t('txt_txt_save')}</button>`;
  html += `</div>`;
  html += `</div></details>`;
  return html;
}

function _setMexSettingsRoundsMode(mode) {
  const toggle = document.getElementById('mex-settings-rounds-toggle');
  if (toggle) toggle.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', (mode === 'unlimited') === (i === 0)));
  const inp = document.getElementById('mex-settings-rounds');
  if (inp) inp.style.display = mode === 'fixed' ? '' : 'none';
}

async function _saveMexSettings() {
  const rolling = document.getElementById('mex-settings-rounds-toggle')?.querySelectorAll('button')[0].classList.contains('active');
  const skillGapRaw = (document.getElementById('mex-settings-skill-gap')?.value || '').trim();
  const body = {
    num_rounds: rolling ? 0 : +(document.getElementById('mex-settings-rounds')?.value || 8),
    skill_gap: skillGapRaw === '' ? null : +skillGapRaw,
    win_bonus: +(document.getElementById('mex-settings-win-bonus')?.value || 0),
    strength_weight: +(document.getElementById('mex-settings-strength-weight')?.value || 0),
    strength_min_matches: +(document.getElementById('mex-settings-strength-min-matches')?.value ?? 4),
    strength_win_factor: +(document.getElementById('mex-settings-strength-win-factor')?.value ?? 1),
    strength_draw_factor: +(document.getElementById('mex-settings-strength-draw-factor')?.value ?? 0.75),
    strength_loss_factor: +(document.getElementById('mex-settings-strength-loss-factor')?.value ?? 0.5),
    loss_discount: +(document.getElementById('mex-settings-loss-discount')?.value || 1),
    balance_tolerance: +(document.getElementById('mex-settings-balance-tol')?.value || 0.2),
    teammate_repeat_weight: +(document.getElementById('mex-settings-teammate-repeat-wt')?.value || 2),
    opponent_repeat_weight: +(document.getElementById('mex-settings-opponent-repeat-wt')?.value || 1),
    repeat_decay: +(document.getElementById('mex-settings-repeat-decay')?.value || 0.5),
    partner_balance_weight: +(document.getElementById('mex-settings-partner-balance-wt')?.value || 0),
  };
  try {
    await api(`/api/tournaments/${currentTid}/mex/settings`, { method: 'PATCH', body: JSON.stringify(body) });
    await renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

// ─── Court editor ─────────────────────────────────────────
let _courtEditorItems = [];
let _courtEditorOpen = false;
let _courtEditorPatchUrl = '';

function _renderCourtsSection(courts, patchUrl) {
  const names = (courts || []).map(c => typeof c === 'string' ? c : (c.name || ''));
  return `<div id="courts-editor-section" class="courts-section">${_courtsInnerHtml(names, patchUrl)}</div>`;
}

function _courtsInnerHtml(names, patchUrl) {
  if (_courtEditorOpen && _courtEditorPatchUrl === patchUrl) {
    const patchAttr = patchUrl.replace(/'/g, "\\'");
    let html = `<div class="courts-editor-list">`;
    for (let i = 0; i < _courtEditorItems.length; i++) {
      html += `<div class="court-editor-chip"><span class="court-row-label">${i + 1}.</span><input class="courts-editor-input" type="text" value="${esc(_courtEditorItems[i])}" oninput="_updateCourtEditorName(${i}, this.value)" placeholder="${t('txt_txt_court')} ${i + 1}"><button type="button" class="court-chip-delete" onclick="_deleteEditorCourt(${i}, '${patchAttr}')" aria-label="Remove">&times;</button></div>`;
    }
    html += `</div>`;
    html += `<div class="courts-editor-actions">`;
    html += `<button type="button" class="btn btn-sm btn-ghost" onclick="_addEditorCourt('${patchAttr}')">+ ${t('txt_txt_add_court')}</button>`;
    html += `<button type="button" class="btn btn-sm btn-success court-editor-save-btn" onclick="_saveCourtEditor('${patchAttr}')">${t('txt_txt_save')}</button>`;
    html += `<button type="button" class="btn-outline-muted" onclick="_cancelCourtEditor()">${t('txt_txt_cancel')}</button>`;
    html += `</div>`;
    return html;
  }
  const label = names.length > 0
    ? names.map(n => esc(n)).join(', ')
    : `<em>${t('txt_txt_no_courts')}</em>`;
  const namesAttr = JSON.stringify(names).replace(/"/g, '&quot;');
  return `\uD83C\uDFDF\uFE0F ${t('txt_txt_courts')}: <span class="courts-summary-names">${label}</span>&ensp;<button type="button" class="btn-outline-muted" onclick="_openCourtEditor(${namesAttr}, '${patchUrl}')">${t('txt_txt_edit')}</button>`;
}

function _openCourtEditor(names, patchUrl) {
  _courtEditorItems = Array.isArray(names) ? [...names] : [];
  _courtEditorOpen = true;
  _courtEditorPatchUrl = patchUrl;
  _refreshCourtsSection(patchUrl);
}

function _refreshCourtsSection(patchUrl) {
  const el = document.getElementById('courts-editor-section');
  if (el) el.innerHTML = _courtsInnerHtml(_courtEditorItems, patchUrl);
}

function _addEditorCourt(patchUrl) {
  _courtEditorItems.push('');
  _refreshCourtsSection(patchUrl);
}

function _removeEditorCourt(patchUrl) {
  if (_courtEditorItems.length > 1) {
    _courtEditorItems.pop();
    _refreshCourtsSection(patchUrl);
  }
}

function _deleteEditorCourt(idx, patchUrl) {
  if (_courtEditorItems.length > 1) {
    _courtEditorItems.splice(idx, 1);
  } else {
    _courtEditorItems[0] = '';
  }
  _refreshCourtsSection(patchUrl);
}

function _updateCourtEditorName(idx, value) {
  _courtEditorItems[idx] = value;
}

async function _saveCourtEditor(patchUrl) {
  const names = _courtEditorItems.map((n, i) => (n || '').trim() || `Court ${i + 1}`);
  try {
    await api(patchUrl, {
      method: 'PATCH',
      body: JSON.stringify({ court_names: names }),
    });
    _courtEditorOpen = false;
    _courtEditorPatchUrl = '';
    if (currentType === 'mexicano') renderMex();
    else if (currentType === 'group_playoff') renderGP();
  } catch (e) { _showToast(e.message, 'error'); }
}

function _cancelCourtEditor() {
  _courtEditorOpen = false;
  _courtEditorPatchUrl = '';
  if (currentType === 'mexicano') renderMex();
  else if (currentType === 'group_playoff') renderGP();
}

// ─── Manual pairing editor ───────────────────────────────
let _manualMatchCount = 0;
let _manualLockedMatches = new Set();  // indices of locked matches
let _manualLeaderboard = {};           // player_id → {rank, avg_points, total_points}

function _showManualEditor() {
  const section = document.getElementById('mex-next-section');
  if (!section) return;

  const numCourts = Math.floor(_mexPlayers.length / 4);
  _manualMatchCount = numCourts;
  _manualLockedMatches = new Set();

  // Build leaderboard lookup from status data stored during renderMex
  _manualLeaderboard = {};
  if (window._mexStatusLeaderboard) {
    for (const r of window._mexStatusLeaderboard) {
      _manualLeaderboard[r.player_id] = {
        rank: r.rank,
        avg_points: r.avg_points,
        total_points: r.total_points,
      };
    }
  }

  // Check if we can pre-fill from the selected proposal
  let prefillProposal = null;
  if (_selectedOptionId && _currentPairingProposals.length > 0) {
    prefillProposal = _currentPairingProposals.find(p => p.option_id === _selectedOptionId) || null;
  }
  if (prefillProposal) {
    _manualMatchCount = Math.max(numCourts, prefillProposal.matches.length);
  }

  let html = `<div class="card manual-editor-card">`;
  html += `<div class="manual-editor-header">`;
  html += `<h2>✏️ ${t('txt_txt_manual_pairing_editor')}</h2>`;
  html += `<div class="manual-editor-actions">`;
  html += `<button type="button" class="btn btn-sm btn-outline-muted" onclick="proposeMexPairings()">← ${t('txt_txt_back_to_proposals')}</button>`;
  html += `<button type="button" class="btn btn-sm btn-outline-muted" onclick="_manualClearAll()">✕ ${t('txt_txt_manual_clear_all')}</button>`;
  html += `</div>`;
  html += `</div>`;

  if (prefillProposal) {
    html += `<p class="manual-prefill-hint">${t('txt_txt_manual_editor_prefill_hint')}</p>`;
  } else {
    html += `<p class="manual-prefill-hint">${t('txt_txt_manual_editor_instructions')}</p>`;
  }

  html += `<div id="manual-matches" class="manual-matches-grid">`;
  for (let i = 0; i < _manualMatchCount; i++) {
    html += _renderManualMatch(i);
  }
  html += `</div>`;

  html += `<div class="manual-match-actions-row">`;
  html += `<button type="button" class="btn btn-sm btn-muted" onclick="_addManualMatch()">+ ${t('txt_txt_add_match')}</button>`;
  html += `<button type="button" class="btn btn-sm btn-muted" onclick="_removeManualMatch()">− ${t('txt_txt_remove_match')}</button>`;
  html += `</div>`;

  html += `<div id="manual-sitout" class="manual-sitout-bar"></div>`;

  html += `<div id="manual-round-stats"></div>`;

  html += `<div class="proposal-action-bar">`;
  html += `<button type="button" class="btn btn-success" onclick="_commitManualRound()">✓ ${t('txt_txt_commit_manual_round')}</button>`;
  html += `<button type="button" class="btn btn-ghost" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;

  section.innerHTML = html;

  // Pre-fill dropdowns from proposal if available
  if (prefillProposal) {
    for (let i = 0; i < prefillProposal.matches.length; i++) {
      const m = prefillProposal.matches[i];
      const setVal = (slot, val) => {
        const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
        if (sel) sel.value = val;
      };
      setVal('t1a', m.team1_ids[0]);
      setVal('t1b', m.team1_ids[1]);
      setVal('t2a', m.team2_ids[0]);
      setVal('t2b', m.team2_ids[1]);
    }
  }

  _updateManualSitout();
}

function _manualGetAvailablePlayers(matchIdx) {
  // Players not locked in other matches are available for this match
  const lockedByOthers = new Set();
  if (_manualLockedMatches.size > 0) {
    for (const lockedIdx of _manualLockedMatches) {
      if (lockedIdx === matchIdx) continue;
      document.querySelectorAll(`.manual-sel[data-match="${lockedIdx}"]`).forEach(sel => {
        if (sel.value) lockedByOthers.add(sel.value);
      });
    }
  }
  return _mexPlayers.filter(p => !lockedByOthers.has(p.id));
}

function _manualPlayerLabel(p) {
  const lb = _manualLeaderboard[p.id];
  if (!lb) return esc(p.name);
  return `${esc(p.name)} (${t('txt_txt_manual_rank', { n: lb.rank })} · ${t('txt_txt_manual_avg_pts')} ${lb.avg_points.toFixed(1)})`;
}

function _renderManualMatch(idx) {
  const available = _manualGetAvailablePlayers(idx);
  const isLocked = _manualLockedMatches.has(idx);

  const opts = available.map(p =>
    `<option value="${p.id}">${_manualPlayerLabel(p)}</option>`
  ).join('');
  const blank = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;

  let card = `<div class="manual-match-card${isLocked ? ' locked' : ''}" id="manual-card-${idx}">`;
  card += `<div class="manual-match-header">`;
  card += `<div class="manual-match-title">${t('txt_txt_match_n', { n: idx + 1 })}</div>`;
  if (isLocked) {
    card += `<button type="button" class="btn btn-sm manual-lock-btn locked" onclick="_manualUnlockMatch(${idx})">🔒 ${t('txt_txt_manual_unlock_match')}</button>`;
  } else {
    card += `<button type="button" class="btn btn-sm manual-lock-btn" onclick="_manualLockMatch(${idx})">🔓 ${t('txt_txt_manual_lock_match')}</button>`;
  }
  card += `</div>`;

  if (isLocked) {
    card += `<div class="manual-locked-hint">${t('txt_txt_manual_match_locked')}</div>`;
  }

  const disabled = isLocked ? ' disabled' : '';
  card += `<div class="manual-team-block">`;
  card += `<div class="manual-team-label">${t('txt_txt_team')} 1</div>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t1a" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t1b" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `</div>`;

  card += `<div class="manual-vs-divider">vs</div>`;

  card += `<div class="manual-team-block">`;
  card += `<div class="manual-team-label">${t('txt_txt_team')} 2</div>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t2a" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t2b" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `</div>`;

  card += `</div>`;
  return card;
}

function _manualLockMatch(idx) {
  // Validate that all 4 slots are filled
  const slots = ['t1a', 't1b', 't2a', 't2b'];
  const ids = slots.map(slot => {
    const sel = document.querySelector(`.manual-sel[data-match="${idx}"][data-slot="${slot}"]`);
    return sel ? sel.value : '';
  });
  if (ids.some(id => !id)) {
    _showToast(t('txt_txt_match_n_slots_required', { n: idx + 1 }), 'error');
    return;
  }
  // Check no duplicates within this match
  const unique = new Set(ids);
  if (unique.size < 4) {
    _showToast(t('txt_txt_a_player_is_assigned_to_multiple_teams_please_fix_duplicates'), 'error');
    return;
  }

  _manualLockedMatches.add(idx);
  _refreshAllManualMatches();
}

function _manualUnlockMatch(idx) {
  _manualLockedMatches.delete(idx);
  _refreshAllManualMatches();
}

function _refreshAllManualMatches() {
  // Save current selections
  const selections = {};
  for (let i = 0; i < _manualMatchCount; i++) {
    selections[i] = {};
    for (const slot of ['t1a', 't1b', 't2a', 't2b']) {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      selections[i][slot] = sel ? sel.value : '';
    }
  }

  // Re-render all match cards
  const container = document.getElementById('manual-matches');
  if (!container) return;
  let html = '';
  for (let i = 0; i < _manualMatchCount; i++) {
    html += _renderManualMatch(i);
  }
  container.innerHTML = html;

  // Restore selections
  for (let i = 0; i < _manualMatchCount; i++) {
    for (const slot of ['t1a', 't1b', 't2a', 't2b']) {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      if (sel && selections[i][slot]) {
        // Only restore if the option is still available
        const opt = sel.querySelector(`option[value="${selections[i][slot]}"]`);
        if (opt) sel.value = selections[i][slot];
      }
    }
  }

  _updateManualSitout();
  _updateManualRoundStats();
}

function _onManualSelChange() {
  _updateManualSitout();
  _updateManualRoundStats();
}

function _manualClearAll() {
  _manualLockedMatches.clear();
  document.querySelectorAll('.manual-sel').forEach(sel => { sel.value = ''; });
  _refreshAllManualMatches();
}

function _addManualMatch() {
  _manualMatchCount++;
  _refreshAllManualMatches();
}

function _removeManualMatch() {
  if (_manualMatchCount <= 1) return;
  // Unlock the last match if it was locked
  _manualLockedMatches.delete(_manualMatchCount - 1);
  _manualMatchCount--;
  _refreshAllManualMatches();
}

function _updateManualSitout() {
  const used = new Set();
  document.querySelectorAll('.manual-sel').forEach(sel => {
    if (sel.value) used.add(sel.value);
  });
  const sitting = _mexPlayers.filter(p => !used.has(p.id));
  const el = document.getElementById('manual-sitout');
  if (el) {
    if (sitting.length > 0) {
      const names = sitting.map(p => {
        const lb = _manualLeaderboard[p.id];
        const stats = lb ? ` (${t('txt_txt_manual_avg_pts')} ${lb.avg_points.toFixed(1)})` : '';
        return `${esc(p.name)}${stats}`;
      }).join(', ');
      el.innerHTML = `🪑 ${t('txt_txt_sitting_out')}: <em>${names}</em>`;
    } else {
      el.innerHTML = t('txt_txt_all_players_assigned');
    }
  }
}

// ─── Manual round stats card ─────────────────────────────
function _getManualMatches() {
  const matchSpecs = [];
  for (let i = 0; i < _manualMatchCount; i++) {
    const get = (slot) => {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      return sel ? sel.value : '';
    };
    const t1a = get('t1a'), t1b = get('t1b'), t2a = get('t2a'), t2b = get('t2b');
    if (t1a && t1b && t2a && t2b) {
      matchSpecs.push({ team1_ids: [t1a, t1b], team2_ids: [t2a, t2b] });
    }
  }
  return matchSpecs;
}

function _pairRepeatCount(idA, idB, counts) {
  return (counts[idA] || {})[idB] || 0;
}

function _matchFingerprint(t1, t2) {
  const a = [...t1].sort().join(',');
  const b = [...t2].sort().join(',');
  return [a, b].sort().join('|');
}

function _getPreviousRoundFingerprints() {
  const fps = new Set();
  const allMatches = window._mexAllMatches || [];
  if (allMatches.length === 0) return fps;
  let maxRound = 0;
  for (const m of allMatches) {
    if ((m.round_number || 0) > maxRound) maxRound = m.round_number;
  }
  if (maxRound === 0) return fps;
  for (const m of allMatches) {
    if (m.round_number === maxRound && m.team1_ids && m.team2_ids) {
      fps.add(_matchFingerprint(m.team1_ids, m.team2_ids));
    }
  }
  return fps;
}

function _computeManualRoundStats() {
  const matches = _getManualMatches();
  if (matches.length === 0) return null;

  const stats = _currentPlayerStats || {};
  const lb = _manualLeaderboard;

  // Build partner/opponent count lookups keyed by player ID
  const partnerCounts = {};
  const opponentCounts = {};
  for (const [, data] of Object.entries(stats)) {
    const pid = data.player_id;
    partnerCounts[pid] = {};
    opponentCounts[pid] = {};
    for (const pr of (data.partners || [])) {
      const pObj = _mexPlayers.find(p => p.name === pr.player);
      if (pObj) partnerCounts[pid][pObj.id] = pr.count;
    }
    for (const opp of (data.opponents || [])) {
      const pObj = _mexPlayers.find(p => p.name === opp.player);
      if (pObj) opponentCounts[pid][pObj.id] = opp.count;
    }
  }

  let totalScoreImbalance = 0;
  let totalRepeatCount = 0;
  let exactPrevRoundRepeats = 0;
  let skillGapViolations = 0;
  let skillGapWorstExcess = 0;
  const perPersonRepeats = {};

  const prevRoundFps = _getPreviousRoundFingerprints();
  const skillGap = window._mexSkillGap;

  for (const m of matches) {
    // Score imbalance
    const t1Score = m.team1_ids.reduce((s, id) => s + (lb[id]?.avg_points || 0), 0);
    const t2Score = m.team2_ids.reduce((s, id) => s + (lb[id]?.avg_points || 0), 0);
    totalScoreImbalance += Math.abs(t1Score - t2Score);

    const t1a = m.team1_ids[0], t1b = m.team1_ids[1];
    const t2a = m.team2_ids[0], t2b = m.team2_ids[1];

    // Partner repeats
    totalRepeatCount += _pairRepeatCount(t1a, t1b, partnerCounts);
    totalRepeatCount += _pairRepeatCount(t2a, t2b, partnerCounts);
    // Opponent repeats
    totalRepeatCount += _pairRepeatCount(t1a, t2a, opponentCounts);
    totalRepeatCount += _pairRepeatCount(t1a, t2b, opponentCounts);
    totalRepeatCount += _pairRepeatCount(t1b, t2a, opponentCounts);
    totalRepeatCount += _pairRepeatCount(t1b, t2b, opponentCounts);

    // Per-person repeat detail
    const allIds = [...m.team1_ids, ...m.team2_ids];
    for (const pid of allIds) {
      const name = _mexPlayerMap[pid] || pid;
      if (!perPersonRepeats[name]) perPersonRepeats[name] = { partner_repeats: [], opponent_repeats: [] };
      const det = perPersonRepeats[name];
      const isT1 = m.team1_ids.includes(pid);
      const teammates = isT1 ? m.team1_ids : m.team2_ids;
      const opponents = isT1 ? m.team2_ids : m.team1_ids;
      for (const tid of teammates) {
        if (tid === pid) continue;
        const cnt = _pairRepeatCount(pid, tid, partnerCounts);
        if (cnt > 0) det.partner_repeats.push({ player: _mexPlayerMap[tid] || tid, count: cnt });
      }
      for (const oid of opponents) {
        const cnt = _pairRepeatCount(pid, oid, opponentCounts);
        if (cnt > 0) det.opponent_repeats.push({ player: _mexPlayerMap[oid] || oid, count: cnt });
      }
    }

    // Exact previous round rematch
    if (prevRoundFps.has(_matchFingerprint(m.team1_ids, m.team2_ids))) {
      exactPrevRoundRepeats++;
    }

    // Skill gap violation
    if (skillGap != null && skillGap > 0) {
      const t1Est = m.team1_ids.reduce((s, id) => s + (lb[id]?.total_points || 0), 0);
      const t2Est = m.team2_ids.reduce((s, id) => s + (lb[id]?.total_points || 0), 0);
      const gap = Math.abs(t1Est - t2Est);
      if (gap > skillGap) {
        skillGapViolations++;
        skillGapWorstExcess = Math.max(skillGapWorstExcess, gap - skillGap);
      }
    }
  }

  return {
    score_imbalance: totalScoreImbalance,
    repeat_count: totalRepeatCount,
    exact_prev_round_repeats: exactPrevRoundRepeats,
    skill_gap_violations: skillGapViolations,
    skill_gap_worst_excess: skillGapWorstExcess,
    per_person_repeats: perPersonRepeats,
    match_count: matches.length,
  };
}

function _updateManualRoundStats() {
  const el = document.getElementById('manual-round-stats');
  if (!el) return;
  const stats = _computeManualRoundStats();
  if (!stats || stats.match_count === 0) { el.innerHTML = ''; return; }

  const fmt2 = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '0.00';

  let html = `<div class="manual-stats-card">`;
  html += `<div class="manual-stats-title">${t('txt_txt_round_summary')}</div>`;
  html += `<div class="proposal-metrics">`;
  html += `⚖️ ${t('txt_txt_score_gap')}: <strong>${fmt2(stats.score_imbalance)} pts</strong><br>`;

  if (stats.repeat_count === 0) {
    html += `✅ ${t('txt_txt_no_repeated_matchups')}`;
  } else {
    html += `⚠️ ${t('txt_txt_n_repeats', { n: fmt2(stats.repeat_count) })}`;
  }
  if (stats.exact_prev_round_repeats > 0) {
    html += `<br>🔁 ${t('txt_txt_exact_rematch_warning', { n: stats.exact_prev_round_repeats })}`;
  }
  if (stats.skill_gap_violations > 0) {
    html += `<br>🚫 ${t('txt_txt_skill_gap_violation', { n: stats.skill_gap_violations, excess: fmt2(stats.skill_gap_worst_excess) })}`;
  }
  html += `</div>`;

  // Per-person repeat details
  if (stats.repeat_count > 0 && stats.per_person_repeats) {
    html += `<div class="repeat-detail">`;
    for (const [name, detail] of Object.entries(stats.per_person_repeats)) {
      const parts = [];
      for (const pr of (detail.partner_repeats || [])) {
        parts.push(esc(t('txt_txt_partner_n_times', { player: pr.player, count: pr.count })));
      }
      for (const or_ of (detail.opponent_repeats || [])) {
        parts.push(esc(t('txt_txt_vs_n_times', { player: or_.player, count: or_.count })));
      }
      if (parts.length > 0) {
        html += `<span class="rp-name">${esc(name)}</span>: ${parts.join(', ')}<br>`;
      }
    }
    html += `</div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
}

async function _commitManualRound() {
  const matches = [];
  const allUsed = new Set();
  const errors = [];

  for (let i = 0; i < _manualMatchCount; i++) {
    const get = (slot) => {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      return sel ? sel.value : '';
    };
    const t1a = get('t1a'), t1b = get('t1b'), t2a = get('t2a'), t2b = get('t2b');
    const ids = [t1a, t1b, t2a, t2b];

    if (ids.some(id => !id)) {
      errors.push(t('txt_txt_match_n_slots_required', { n: i + 1 }));
      continue;
    }
    for (const id of ids) {
      if (allUsed.has(id)) {
        const name = _mexPlayers.find(p => p.id === id)?.name || id;
        errors.push(t('txt_txt_player_assigned_multiple', { value: name }));
      }
      allUsed.add(id);
    }

    matches.push({ team1_ids: [t1a, t1b], team2_ids: [t2a, t2b] });
  }

  if (errors.length > 0) {
    _showToast(errors.join('; '), 'error');
    return;
  }

  try {
    await api(`/api/tournaments/${currentTid}/mex/custom-round`, {
      method: 'POST',
      body: JSON.stringify({ matches }),
    });
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

function _renderPlayerStats(stats) {
  const names = Object.keys(stats).sort();
  let opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  let html = `<h4>${t('txt_txt_partner_opponent_history')}</h4>`;
  html += `<div class="player-stats-dropdown">`;
  html += `<select onchange="_showPlayerDetail(this.value)" id="stats-player-select"><option value="">${t('txt_txt_select_player')}</option>${opts}</select>`;
  html += `</div>`;
  html += `<div id="stats-player-detail"></div>`;
  return html;
}

function _showPlayerDetail(name) {
  const el = document.getElementById('stats-player-detail');
  if (!el || !name || !_currentPlayerStats || !_currentPlayerStats[name]) {
    if (el) el.innerHTML = '';
    return;
  }
  const data = _currentPlayerStats[name];
  const partnerList = data.partners.map(x => `${esc(x.player)} (×${x.count})`).join(', ') || t('txt_txt_none_yet');
  const opponentList = data.opponents.map(x => `${esc(x.player)} (×${x.count})`).join(', ') || t('txt_txt_none_yet');
  el.innerHTML = `<div class="player-stats-detail">
    <div class="stat-row"><span class="stat-label">${t('txt_txt_partners')}:</span> ${partnerList}</div>
    <div class="stat-row"><span class="stat-label">${t('txt_txt_opponents')}:</span> ${opponentList}</div>
    <div class="stat-row"><span class="stat-label">${t('txt_txt_partner_repeats')}:</span> ${data.total_partner_repeats}</div>
    <div class="stat-row"><span class="stat-label">${t('txt_txt_opponent_repeats')}:</span> ${data.total_opponent_repeats}</div>
  </div>`;
}

// ─── Mexicano Playoffs ───────────────────────────────
let _playoffTeams = [];
let _mexPlayoffTeamCount = 4;
let _playoffScoreMap = {};  // player_id → total_points
let _savedPlayoffTeams = {};  // teamIndex → { a: playerId, b: playerId }
let _mexExternalParticipants = [];  // {name, score, id}[] external participants for mex playoffs
let _mexExtCounter = 0;  // counter for generating unique temp IDs
let _teamCountDebounceTimer = null;
let _mexPlayoffTeamToggle = false;  // team mode toggle for tennis individual playoffs
let _mexPlayoffComposedTeams = [];  // [[pid1, pid2], ...] pre-composed teams

async function proposeMexPlayoffs(teamCount = null) {
  try {
    const effectiveTeamMode = _mexGetEffectiveTeamMode();
    const regularCount = (_mexPlayers || []).length;
    const extCount = _mexExternalParticipants.length;
    const totalPool = regularCount + extCount;
    const maxTeams = effectiveTeamMode
      ? Math.max(2, totalPool)
      : Math.max(2, Math.floor(totalPool / 2));
    const requestedTeams = Math.max(2, Math.min(maxTeams, Number(teamCount || _mexPlayoffTeamCount || 4)));
    _mexPlayoffTeamCount = requestedTeams;
    // Cap API fetch to available regular players
    const regularMaxTeams = effectiveTeamMode ? regularCount : Math.floor(regularCount / 2);
    const apiTeamsToFetch = Math.max(0, Math.min(requestedTeams, regularMaxTeams));
    const participantsToRecommend = effectiveTeamMode ? apiTeamsToFetch : apiTeamsToFetch * 2;
    if (participantsToRecommend > 0) {
      const data = await api(`/api/tournaments/${currentTid}/mex/recommend-playoffs?n_teams=${participantsToRecommend}`);
      _playoffTeams = data.recommended_teams.map(t => ({ id: t.player_id, name: t.player, score: t.total_points ?? 0, estimatedScore: t.estimated_points ?? t.total_points ?? 0, rankedByAvg: t.ranked_by_avg, avgScore: t.avg_points ?? 0 }));
    } else {
      _playoffTeams = [];
    }
    _savedPlayoffTeams = {};  // reset saved state when editor re-initialises
    // Use estimated score for display/sorting when match counts differ
    _playoffScoreMap = Object.fromEntries(_playoffTeams.map(p => [p.id, p.rankedByAvg ? p.estimatedScore : p.score]));
    // Inject external participants into the available pool
    _syncExternalsToPlayoffTeams();
    const section = document.getElementById('mex-playoffs-section') || document.getElementById('mex-next-section');
    if (section) {
      section.innerHTML = _renderPlayoffEditor();
    }
  } catch (e) { _showToast(e.message, 'error'); }
}

function _syncExternalsToPlayoffTeams() {
  for (const ext of _mexExternalParticipants) {
    if (!_playoffTeams.some(p => p.id === ext.id)) {
      _playoffTeams.push({ id: ext.id, name: ext.name, score: ext.score, estimatedScore: ext.score, rankedByAvg: false, avgScore: 0, isExternal: true });
    }
    _playoffScoreMap[ext.id] = ext.score;
  }
}

async function _changeMexPlayoffTeamCount(value) {
  clearTimeout(_teamCountDebounceTimer);
  _teamCountDebounceTimer = setTimeout(() => proposeMexPlayoffs(Number(value)), 300);
}

async function endMexicano() {
  if (!confirm(t('txt_txt_confirm_end_mexicano'))) return;
  try {
    await api(`/api/tournaments/${currentTid}/mex/end`, { method: 'POST' });
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

async function undoEndMexicano() {
  if (!confirm(t('txt_txt_confirm_undo_end_mexicano'))) return;
  try {
    await api(`/api/tournaments/${currentTid}/mex/undo-end`, { method: 'POST' });
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

async function finishMexicanoAsIs() {
  if (!confirm(t('txt_txt_confirm_finish_as_is'))) return;
  try {
    await api(`/api/tournaments/${currentTid}/mex/finish`, { method: 'POST' });
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

function _mexGetEffectiveTeamMode() {
  // For tennis mexicano, the playoff toggle directly controls the bracket slot format.
  // Toggle off (Individual) → effectiveTeamMode=true (1-per-slot);
  // Toggle on (Team) → effectiveTeamMode=false (2-per-slot).
  if (_mexSport === 'tennis') return !_mexPlayoffTeamToggle;
  return _mexTeamMode;
}

function _isTennisMex() {
  return _mexSport === 'tennis';
}

function _renderPlayoffEditor() {
  const effectiveTeamMode = _mexGetEffectiveTeamMode();

  let html = `<div class="card">`;
  html += `<h2>${t('txt_txt_configure_mexicano_playoffs')}</h2>`;
  const _useEstNote = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;
  const estNote = _useEstNote ? `<span class="playoff-editor-est-note">${t('txt_txt_estimated_points_note')}</span>` : '';
  html += `<p class="panel-intro">${effectiveTeamMode ? ts('txt_txt_participant_row_instructions', _currentSport) : ts('txt_txt_team_row_instructions', _currentSport)} ${estNote}</p>`;

  // Playoff team mode toggle — shown for all tennis mexicano tournaments
  if (_isTennisMex()) {
    html += `<div style="margin-bottom:0.75rem">`;
    html += `<div class="form-group"><label>${t('txt_txt_playoff_mode')}</label>`;
    html += `<div class="score-mode-toggle" id="mex-playoff-team-toggle">`;
    html += `<button type="button" class="${!_mexPlayoffTeamToggle ? 'active' : ''}" onclick="_mexSetPlayoffTeamToggle(false)">${t('txt_txt_individual_mode')}</button>`;
    html += `<button type="button" class="${_mexPlayoffTeamToggle ? 'active' : ''}" onclick="_mexSetPlayoffTeamToggle(true)">${t('txt_txt_team_mode_short')}</button>`;
    html += `</div></div>`;
    html += `</div>`;
  }

  const regularCount = (_mexPlayers || []).length;
  const extCount = _mexExternalParticipants.length;
  const totalPool = regularCount + extCount;
  const maxTeams = effectiveTeamMode
    ? Math.max(2, totalPool)
    : Math.max(2, Math.floor(totalPool / 2));
  html += `<div class="inline-group playoff-editor-inline-group">`;
  html += `<div class="form-group"><label>${ts('txt_txt_teams_participating', _currentSport)}</label><select id="playoff-team-count" onchange="_changeMexPlayoffTeamCount(this.value)">`;
  for (let teams = 2; teams <= maxTeams; teams++) {
    const selected = teams === _mexPlayoffTeamCount ? ' selected' : '';
    html += `<option value="${teams}"${selected}>${ts('txt_txt_n_teams', _currentSport, { n: teams })}</option>`;
  }
  html += `</select></div>`;
  html += `</div>`;

  // External participants — add section (between team count and team rows)
  html += `<div class="playoff-editor-external-box">`;
  html += `<h3 class="playoff-editor-external-title">${t('txt_txt_external_participants')}</h3>`;
  if (_mexExternalParticipants.length > 0) {
    html += `<div id="mex-external-list" class="playoff-editor-external-list">`;
    for (let i = 0; i < _mexExternalParticipants.length; i++) {
      const ep = _mexExternalParticipants[i];
      html += `<div class="playoff-editor-external-row">`;
      html += `<span class="playoff-editor-external-name">★ ${esc(ep.name)}</span>`;
      html += `<input type="number" value="${ep.score}" class="playoff-editor-score-input" onchange="_mexUpdateExternalScore(${i}, this.value)">`;
      html += `<button type="button" class="btn btn-sm btn-muted playoff-editor-remove-btn" onclick="_mexRemoveExternal(${i})">✕</button>`;
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `<div class="playoff-editor-external-add">`;
  // Tennis inverts: effectiveTM=true means 1v1 (player), effectiveTM=false means 2v2 (team).
  const extIsTeam = _mexSport === 'tennis' ? !effectiveTeamMode : effectiveTeamMode;
  html += `<input type="text" id="mex-external-name" class="playoff-editor-external-name-input" placeholder="${extIsTeam ? t('txt_txt_add_external_team') : t('txt_txt_add_external_player')}" onkeydown="if(event.key==='Enter')_mexAddExternal()">`;
  html += `<input type="number" id="mex-external-score" class="playoff-editor-score-input" placeholder="${t('txt_txt_score')}" value="0">`;
  html += `<button type="button" class="btn btn-sm btn-primary" onclick="_mexAddExternal()">+</button>`;
  html += `</div>`;
  html += `</div>`;

  const useEst = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;

  const participantOptions = (selectedId) => {
    let options = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;
    for (let i = 0; i < _playoffTeams.length; i++) {
      const p = _playoffTeams[i];
      const selected = p.id === selectedId ? ' selected' : '';
      const pts = p.isExternal ? `${p.score}` : (useEst ? `${p.estimatedScore.toFixed(1)}*` : `${p.score}`);
      const prefix = p.isExternal ? '★' : `#${i + 1}`;
      options += `<option value="${p.id}"${selected}>${prefix} ${esc(p.name)} (${pts} pts)</option>`;
    }
    return options;
  };

  // Regular mode only: combined score for a 2-player team
  const teamScore = (aid, bid) => {
    if (!aid || !bid) return '—';
    const total = (_playoffScoreMap[aid] || 0) + (_playoffScoreMap[bid] || 0);
    return useEst ? `${total.toFixed(1)}* pts` : `${total} pts`;
  };

  // Team mode: score for a single participant
  const singleScore = (aid) => {
    if (!aid) return '—';
    const val = _playoffScoreMap[aid] || 0;
    return useEst ? `${val.toFixed(1)}* pts` : `${val} pts`;
  };

  const teamCount = _mexPlayoffTeamCount;
  html += `<div class="playoff-team-list">`;
  for (let i = 0; i < teamCount; i++) {
    html += `<div class="playoff-team-item playoff-team-item-compact">`;
    html += `<span class="seed playoff-team-seed">${ts('txt_txt_team_n', _currentSport, { n: i + 1 })}</span>`;
    if (effectiveTeamMode) {
      // Team mode: one participant = one playoff slot
      const defaultId = _playoffTeams[i]?.id || '';
      const initScore = singleScore(defaultId);
      html += `<select id="playoff-team-${i}-a" class="manual-sel playoff-team-select" onchange="_updateTeamScore(${i})">${participantOptions(defaultId)}</select>`;
      html += `<span id="team-score-${i}" class="tag playoff-team-score">${initScore}</span>`;
    } else {
      // Regular mode: two players form a team
      const leftDefault = _playoffTeams[i * 2]?.id || '';
      const rightDefault = _playoffTeams[i * 2 + 1]?.id || '';
      const initScore = teamScore(leftDefault, rightDefault);
      html += `<select id="playoff-team-${i}-a" class="manual-sel playoff-team-select" onchange="_updateTeamScore(${i})">${participantOptions(leftDefault)}</select>`;
      html += `<span class="playoff-team-plus">+</span>`;
      html += `<select id="playoff-team-${i}-b" class="manual-sel playoff-team-select" onchange="_updateTeamScore(${i})">${participantOptions(rightDefault)}</select>`;
      html += `<span id="team-score-${i}" class="tag playoff-team-score">${initScore}</span>`;
    }
    html += `<button type="button" id="playoff-save-${i}" class="btn btn-success playoff-team-save-btn" onclick="_savePlayoffTeam(${i})">✓ ${t('txt_txt_save')}</button>`;
    html += `<button type="button" id="playoff-edit-${i}" class="btn btn-muted playoff-team-edit-btn" onclick="_editPlayoffTeam(${i})">✎ ${t('txt_txt_edit')}</button>`;
    html += `<span id="playoff-saved-badge-${i}" class="playoff-team-saved-badge">✓ ${t('txt_txt_saved')}</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  html += `<div class="inline-group playoff-editor-inline-group">`;
  html += `<div class="form-group"><label>${t('txt_txt_format')}</label><select id="playoff-format"><option value="single">${t('txt_txt_single_elimination')}</option><option value="double">${t('txt_txt_double_elimination')}</option></select></div>`;
  html += `</div>`;
  html += `<div class="proposal-actions">`;
  html += `<button type="button" class="btn btn-success btn-lg-action" onclick="withLoading(this,_startMexPlayoffs)">✓ ${t('txt_txt_start_mexicano_playoffs')}</button>`;
  html += `<button type="button" class="btn btn-muted btn-lg-action" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _mexSetPlayoffTeamToggle(isTeam) {
  _mexPlayoffTeamToggle = isTeam;
  _savedPlayoffTeams = {};
  // Re-fetch with correct slot count for the new mode, then re-render
  proposeMexPlayoffs(_mexPlayoffTeamCount);
}

async function _startMexPlayoffs() {
  const effectiveTeamMode = _mexGetEffectiveTeamMode();
  const allIds = [];  // all selected IDs (real + ext_ placeholders)
  const composedTeams = [];  // for playoff_teams when toggle is on
  const used = new Set();
  const teamCount = _mexPlayoffTeamCount;
  for (let i = 0; i < teamCount; i++) {
    const left = document.getElementById(`playoff-team-${i}-a`)?.value || '';

    if (effectiveTeamMode) {
      // Team mode: one participant per playoff slot
      if (!left) {
        _showToast(t('txt_txt_team_n_select_both_players', { n: i + 1 }), 'error');
        return;
      }
      if (used.has(left)) {
        _showToast(t('txt_txt_a_player_is_assigned_to_multiple_teams_please_fix_duplicates'), 'error');
        return;
      }
      used.add(left);
      allIds.push(left);
    } else {
      // Regular mode: two players form a team
      const right = document.getElementById(`playoff-team-${i}-b`)?.value || '';
      if (!left || !right) {
        _showToast(t('txt_txt_team_n_select_both_players', { n: i + 1 }), 'error');
        return;
      }
      if (left === right) {
        _showToast(t('txt_txt_team_n_players_must_be_different', { n: i + 1 }), 'error');
        return;
      }
      if (used.has(left) || used.has(right)) {
        _showToast(t('txt_txt_a_player_is_assigned_to_multiple_teams_please_fix_duplicates'), 'error');
        return;
      }
      used.add(left);
      used.add(right);
      allIds.push(left, right);
      composedTeams.push([left, right]);
    }
  }
  // Separate real player IDs from ext_ placeholder IDs
  const teamIds = [];
  const extParticipants = [];
  for (const pid of allIds) {
    if (pid.startsWith('ext_')) {
      const ext = _mexExternalParticipants.find(e => e.id === pid);
      if (ext) extParticipants.push({ name: ext.name, score: ext.score, placeholder_id: pid });
      teamIds.push(pid);  // keep in position so backend can replace
    } else {
      teamIds.push(pid);
    }
  }
  const fmt = document.getElementById('playoff-format')?.value || 'single';
  const extra = extParticipants.length > 0 ? extParticipants : null;
  // Determine playoff_teams to send to backend:
  // - If 2-per-slot selectors were used (effectiveTM=false), send composed teams.
  // - If 1-per-slot but backend tournament is team_mode=false (tennis Team 2v2),
  //   send singleton teams so the backend doesn't auto-pair into 2v2.
  let playoffTeamsPayload = null;
  if (composedTeams.length > 0) {
    playoffTeamsPayload = composedTeams;
  } else if (effectiveTeamMode && !_mexTeamMode) {
    playoffTeamsPayload = allIds.map(pid => [pid]);
  }
  try {
    await api(`/api/tournaments/${currentTid}/mex/start-playoffs`, {
      method: 'POST',
      body: JSON.stringify({
        team_player_ids: teamIds,
        double_elimination: fmt === 'double',
        extra_participants: extra,
        playoff_teams: playoffTeamsPayload,
      }),
    });
    _playoffTeams = [];
    _mexExternalParticipants = [];
    _mexExtCounter = 0;
    renderMex();
  } catch (e) { _showToast(e.message, 'error'); }
}

function _updateTeamScore(i) {
  const aId = document.getElementById(`playoff-team-${i}-a`)?.value || '';
  const el = document.getElementById(`team-score-${i}`);
  if (!el) return;
  const useEst = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;
  const effectiveTeamMode = _mexGetEffectiveTeamMode();
  if (effectiveTeamMode) {
    if (!aId) { el.textContent = '—'; return; }
    const val = _playoffScoreMap[aId] || 0;
    el.textContent = useEst ? `${val.toFixed(1)}* pts` : `${val} pts`;
  } else {
    const bId = document.getElementById(`playoff-team-${i}-b`)?.value || '';
    if (!aId || !bId) { el.textContent = '—'; return; }
    const total = (_playoffScoreMap[aId] || 0) + (_playoffScoreMap[bId] || 0);
    el.textContent = useEst ? `${total.toFixed(1)}* pts` : `${total} pts`;
  }
}

function _mexAddExternal() {
  const input = document.getElementById('mex-external-name');
  const scoreInput = document.getElementById('mex-external-score');
  const name = (input?.value || '').trim();
  if (!name) return;
  const score = parseInt(scoreInput?.value || '0', 10) || 0;
  const id = `ext_${_mexExtCounter++}`;
  _mexExternalParticipants.push({ name, score, id });
  // Inject into playoff teams pool so it appears in dropdowns
  _playoffTeams.push({ id, name, score, estimatedScore: score, rankedByAvg: false, avgScore: 0, isExternal: true });
  _playoffScoreMap[id] = score;
  input.value = '';
  if (scoreInput) scoreInput.value = '0';
  const section = document.getElementById('mex-playoffs-section') || document.getElementById('mex-next-section');
  if (section) section.innerHTML = _renderPlayoffEditor();
}

function _mexRemoveExternal(idx) {
  const removed = _mexExternalParticipants.splice(idx, 1)[0];
  if (removed) {
    _playoffTeams = _playoffTeams.filter(p => p.id !== removed.id);
    delete _playoffScoreMap[removed.id];
    // Clear any saved teams using the removed external
    for (const [teamIdx, team] of Object.entries(_savedPlayoffTeams)) {
      if (team.a === removed.id || team.b === removed.id) {
        delete _savedPlayoffTeams[teamIdx];
      }
    }
  }
  const section = document.getElementById('mex-playoffs-section') || document.getElementById('mex-next-section');
  if (section) section.innerHTML = _renderPlayoffEditor();
}

function _mexUpdateExternalScore(idx, value) {
  if (idx >= 0 && idx < _mexExternalParticipants.length) {
    const newScore = parseInt(value, 10) || 0;
    _mexExternalParticipants[idx].score = newScore;
    const extId = _mexExternalParticipants[idx].id;
    const pt = _playoffTeams.find(p => p.id === extId);
    if (pt) { pt.score = newScore; pt.estimatedScore = newScore; }
    _playoffScoreMap[extId] = newScore;
  }
}

function _getLockedPlayoffIds(exceptTeamIdx = -1) {
  const ids = new Set();
  for (const [idx, team] of Object.entries(_savedPlayoffTeams)) {
    if (Number(idx) === exceptTeamIdx) continue;
    if (team.a) ids.add(team.a);
    if (!_mexGetEffectiveTeamMode() && team.b) ids.add(team.b);
  }
  return ids;
}

function _savePlayoffTeam(i) {
  const aEl = document.getElementById(`playoff-team-${i}-a`);
  const a = aEl?.value || '';
  const effectiveTeamMode = _mexGetEffectiveTeamMode();
  if (effectiveTeamMode) {
    if (!a) { _showToast(t('txt_txt_team_n_select_both_players_before_saving', { n: i + 1 }), 'error'); return; }
    _savedPlayoffTeams[i] = { a };
  } else {
    const bEl = document.getElementById(`playoff-team-${i}-b`);
    const b = bEl?.value || '';
    if (!a || !b) { _showToast(t('txt_txt_team_n_select_both_players_before_saving', { n: i + 1 }), 'error'); return; }
    if (a === b) { _showToast(t('txt_txt_team_n_players_must_be_different', { n: i + 1 }), 'error'); return; }
    _savedPlayoffTeams[i] = { a, b };
  }
  _refreshPlayoffOptions();
}

function _editPlayoffTeam(i) {
  delete _savedPlayoffTeams[i];
  _refreshPlayoffOptions();
}

function _refreshPlayoffOptions() {
  const useEst = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;
  const teamCount = _mexPlayoffTeamCount;

  for (let i = 0; i < teamCount; i++) {
    const aEl = document.getElementById(`playoff-team-${i}-a`);
    const bEl = _mexGetEffectiveTeamMode() ? null : document.getElementById(`playoff-team-${i}-b`);
    const saveBtn  = document.getElementById(`playoff-save-${i}`);
    const editBtn  = document.getElementById(`playoff-edit-${i}`);
    const badge    = document.getElementById(`playoff-saved-badge-${i}`);
    if (!aEl) continue;

    const saved = _savedPlayoffTeams[i];
    if (saved) {
      aEl.disabled = true;
      if (bEl) bEl.disabled = true;
      if (saveBtn) saveBtn.style.display = 'none';
      if (editBtn) editBtn.style.display = '';
      if (badge)   badge.style.display = '';
    } else {
      const locked = _getLockedPlayoffIds(i);
      const curA = aEl.value;
      const curB = bEl ? bEl.value : '';

      const buildOptions = (selectedId) => {
        let opts = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;
        for (let j = 0; j < _playoffTeams.length; j++) {
          const p = _playoffTeams[j];
          if (locked.has(p.id)) continue;  // hide participants already locked in other rows
          const sel = p.id === selectedId ? ' selected' : '';
          const pts = p.isExternal ? `${p.score}` : (useEst ? `${p.estimatedScore.toFixed(1)}*` : `${p.score}`);
          const prefix = p.isExternal ? '★' : `#${j + 1}`;
          opts += `<option value="${p.id}"${sel}>${prefix} ${esc(p.name)} (${pts} pts)</option>`;
        }
        return opts;
      };

      aEl.innerHTML = buildOptions(curA);
      aEl.disabled = false;
      if (bEl) {
        bEl.innerHTML = buildOptions(curB);
        bEl.disabled = false;
        if (locked.has(curB)) bEl.value = '';
      }
      if (saveBtn) saveBtn.style.display = '';
      if (editBtn) editBtn.style.display = 'none';
      if (badge)   badge.style.display = 'none';
      // If the previously selected participant was just taken by another row, clear the selection
      if (locked.has(curA)) aEl.value = '';
      _updateTeamScore(i);
    }
  }
}

// ─── Rolling Mode toggle ────────────────────────────────
function _setMexRoundsMode(mode) {
  const toggle = document.getElementById('mex-rounds-toggle');
  const roundsInput = document.getElementById('mex-rounds');
  const [btnUnlimited, btnFixed] = toggle.querySelectorAll('button');
  if (mode === 'unlimited') {
    btnUnlimited.classList.add('active');
    btnFixed.classList.remove('active');
    roundsInput.style.display = 'none';
  } else {
    btnFixed.classList.add('active');
    btnUnlimited.classList.remove('active');
    roundsInput.style.display = '';
    roundsInput.focus();
  }
}

function _export_include_history() {
  const input = document.getElementById('export-include-history');
  return input ? Boolean(input.checked) : true;
}

function _format_match_score(m) {
  if (m.sets && m.sets.length > 0) {
    return m.sets.map(s => `${s[0]}-${s[1]}`).join(', ');
  }
  if (m.score && m.score.length === 2) {
    return `${m.score[0]}-${m.score[1]}`;
  }
  return '—';
}

function _report_table(headers, rows) {
  const thead = `<tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map(row => `<tr>${row.map(c => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('');
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function _build_report_document(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #1f2937; }
    h1 { margin: 0 0 8px; }
    h2 { margin: 24px 0 8px; color: #1d4ed8; }
    .muted { color: #6b7280; font-size: 0.92rem; margin-bottom: 16px; }
    .champ { margin: 12px 0 18px; padding: 10px; background: #ecfdf5; border: 1px solid #86efac; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 0.9rem; }
    th { background: #f3f4f6; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function _download_text_file(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function _open_printable_pdf(htmlDoc) {
  const w = window.open('', '_blank');
  if (!w) {
    _showToast(t('txt_txt_popup_blocked_allow_popups_to_export_pdf'), 'error');
    return;
  }
  w.document.open();
  w.document.write(htmlDoc);
  w.document.close();
  setTimeout(() => w.print(), 250);
}

async function _fetch_image_as_base64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result); // data:image/png;base64,...
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function exportTournamentOutcome(format) {
  if (!currentTid || !currentType) return;
  const includeHistory = _export_include_history();
  const now = new Date().toLocaleString();
  const name = currentTournamentName || `Tournament ${currentTid}`;

  try {
    let body = `<h1>${esc(name)} — ${t('txt_txt_results')}</h1>`;
    body += `<div class="muted">${t('txt_txt_generated_value', { value: esc(now) })}</div>`;

    if (currentType === 'group_playoff') {
      const schemaUrl = `/api/tournaments/${currentTid}/gp/playoffs-schema?fmt=png`
        + `&box_scale=${(document.getElementById('tv-schema-box')?.value || 1.0)}`
        + `&line_width=${(document.getElementById('tv-schema-lw')?.value || 1.0)}`
        + `&arrow_scale=${(document.getElementById('tv-schema-arrow')?.value || 1.0)}`
        + `&title_font_scale=${(document.getElementById('tv-schema-title-scale')?.value || 1.0)}`;
      const [status, groups, playoffs, schemaSrc] = await Promise.all([
        api(`/api/tournaments/${currentTid}/gp/status`),
        api(`/api/tournaments/${currentTid}/gp/groups`),
        api(`/api/tournaments/${currentTid}/gp/playoffs`).catch(() => ({ matches: [] })),
        _fetch_image_as_base64(schemaUrl),
      ]);

      if (status.champion) {
        body += `<div class="champ">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
      }

      // ── Play-offs (above group content) ───────────────────────
      if (schemaSrc) {
        body += `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
        body += `<img src="${schemaSrc}" alt="${t('txt_txt_play_off_bracket')}" style="max-width:100%;height:auto;margin:8px 0 18px">`;
      }

      if (includeHistory) {
        const pMatches = (playoffs?.matches || []).filter(m => m.status === 'completed');
        if (pMatches.length > 0) {
          body += `<h2>${t('txt_txt_play_off_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            pMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }

      // ── Group stage (below) ───────────────────────────────────
      body += `<h2>${t('txt_txt_group_standings')}</h2>`;
      for (const [gName, rows] of Object.entries(groups.standings || {})) {
        body += `<h3>${t('txt_txt_group_name_value', { value: esc(gName) })}</h3>`;
        const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
        const headers = [t('txt_txt_player'), t('txt_txt_played'), t('txt_txt_w_abbrev'), t('txt_txt_d_abbrev'), t('txt_txt_l_abbrev')];
        if (hasSets) headers.push(t('txt_txt_sw_abbrev'), t('txt_txt_sl_abbrev'), t('txt_txt_sd_abbrev'));
        headers.push(t('txt_txt_pf_abbrev'), t('txt_txt_pa_abbrev'), t('txt_txt_diff_abbrev'));
        body += _report_table(
          headers,
          rows.map(r => {
            const base = [r.player, r.played, r.wins, r.draws, r.losses];
            if (hasSets) base.push(r.sets_won, r.sets_lost, r.sets_diff);
            base.push(r.points_for, r.points_against, r.point_diff);
            return base;
          }),
        );
      }

      if (includeHistory) {
        const gMatches = Object.values(groups.matches || {}).flat().filter(m => m.status === 'completed');
        if (gMatches.length > 0) {
          body += `<h2>${t('txt_txt_group_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            gMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }
    } else if (currentType === 'playoff') {
      const schemaUrl = `/api/tournaments/${currentTid}/po/playoffs-schema?fmt=png`
        + `&box_scale=${(document.getElementById('tv-schema-box')?.value || 1.0)}`
        + `&line_width=${(document.getElementById('tv-schema-lw')?.value || 1.0)}`
        + `&arrow_scale=${(document.getElementById('tv-schema-arrow')?.value || 1.0)}`
        + `&title_font_scale=${(document.getElementById('tv-schema-title-scale')?.value || 1.0)}`;
      const [status, playoffs, schemaSrc] = await Promise.all([
        api(`/api/tournaments/${currentTid}/po/status`),
        api(`/api/tournaments/${currentTid}/po/playoffs`),
        _fetch_image_as_base64(schemaUrl),
      ]);

      if (status.champion) {
        body += `<div class="champ">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
      }

      if (schemaSrc) {
        body += `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
        body += `<img src="${schemaSrc}" alt="${t('txt_txt_play_off_bracket')}" style="max-width:100%;height:auto;margin:8px 0 18px">`;
      }

      if (includeHistory) {
        const pMatches = (playoffs?.matches || []).filter(m => m.status === 'completed');
        if (pMatches.length > 0) {
          body += `<h2>${t('txt_txt_play_off_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            pMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }
    } else {
      const schemaUrl = `/api/tournaments/${currentTid}/mex/playoffs-schema?fmt=png`
        + `&box_scale=${(document.getElementById('tv-schema-box')?.value || 1.0)}`
        + `&line_width=${(document.getElementById('tv-schema-lw')?.value || 1.0)}`
        + `&arrow_scale=${(document.getElementById('tv-schema-arrow')?.value || 1.0)}`
        + `&title_font_scale=${(document.getElementById('tv-schema-title-scale')?.value || 1.0)}`;
      const [status, matches, playoffs, schemaSrc] = await Promise.all([
        api(`/api/tournaments/${currentTid}/mex/status`),
        api(`/api/tournaments/${currentTid}/mex/matches`),
        api(`/api/tournaments/${currentTid}/mex/playoffs`).catch(() => ({ matches: [] })),
        _fetch_image_as_base64(schemaUrl),
      ]);

      if (status.champion) {
        body += `<div class="champ">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
      }

      // ── Play-offs (above leaderboard/rounds) ──────────────────
      if (schemaSrc) {
        body += `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
        body += `<img src="${schemaSrc}" alt="${t('txt_txt_play_off_bracket')}" style="max-width:100%;height:auto;margin:8px 0 18px">`;
      }

      if (includeHistory) {
        const playoffMatches = (playoffs?.matches || []).filter(m => m.status === 'completed');
        if (playoffMatches.length > 0) {
          body += `<h2>${t('txt_txt_play_off_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            playoffMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }

      // ── Mexicano (below) ──────────────────────────────────────
      body += `<h2>${t('txt_txt_leaderboard')}</h2>`;
      body += _report_table(
        [t('txt_txt_rank'), t('txt_txt_player'), t('txt_txt_total_pts'), t('txt_txt_played'), t('txt_txt_w_abbrev'), t('txt_txt_d_abbrev'), t('txt_txt_l_abbrev'), t('txt_txt_avg_pts')],
        (status.leaderboard || []).map(r => [r.rank, r.player, r.total_points, r.matches_played, r.wins || 0, r.draws || 0, r.losses || 0, r.avg_points]),
      );

      if (includeHistory) {
        const mexMatches = (matches.all_matches || []).filter(m => m.status === 'completed');
        if (mexMatches.length > 0) {
          body += `<h2>${t('txt_txt_mexicano_round_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            mexMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }
    }

    const htmlDoc = _build_report_document(`${name} ${t('txt_txt_results')}`, body);
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tournament';

    if (format === 'pdf') {
      _open_printable_pdf(htmlDoc);
    } else {
      _download_text_file(`${slug}-results.html`, htmlDoc, 'text/html;charset=utf-8');
    }
  } catch (e) {
    _showToast(t('txt_txt_export_failed_value', { value: e.message }), 'error');
  }
}

// ─── Player Codes ────────────────────────────────────────

/** Cache for player secrets (per tournament) */
