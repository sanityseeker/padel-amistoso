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
    _gpSetDecider = tvSettings.set_decider || 'full_set';
    _scoreConfirmationMode = tvSettings.score_confirmation || 'immediate';
    _gpCurrentCourts = status.courts || [];
    _gpGroupNames = Object.keys(groups.standings);
    _gpCurrentPhase = status.phase;
    _gpSport = status.sport || 'padel';
    _gpTeamRoster = status.team_roster || {};
    _gpTeamMode = status.team_mode || false;

    const hasCourts = status.assign_courts !== false;
    const allGroupMatches = Object.values(groups.matches).flat();
    const allPlayoffMatches = playoffs?.matches || [];
    const phaseMatches = status.phase === 'groups' ? allGroupMatches : allPlayoffMatches;
    let html = '';
    const gpPhaseLabel = {
      groups: t('txt_txt_group_stage'),
      playoffs: t('txt_txt_play_offs'),
      finished: t('txt_txt_finished'),
    }[status.phase] || '';
    html += _renderTournamentStatusBar({
      id: 'gp-ops-header',
      stats: _buildOpsStats(phaseMatches),
      reviewCardId: 'gp-review-queue-card',
      phase: gpPhaseLabel,
      rounds: status.phase === 'playoffs' ? _buildBracketRounds(allPlayoffMatches) : [],
    });
    // Pending court assignments are the most important admin focus, so they
    // appear immediately under the status bar.
    const groupPending = _sortTbdLast(Object.values(groups.matches)
      .flat()
      .filter(m => m.status !== 'completed'));
    const playoffPending = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));
    const assignmentMatches = (status.phase === 'groups') ? groupPending : playoffPending;
    html += _renderCourtAssignmentsCard(
      assignmentMatches,
      status.phase === 'groups' ? t('txt_txt_court_assignments_group_stage') : t('txt_txt_court_assignments_play_offs'),
      status.assign_courts !== false,
      status.phase === 'groups' ? 'gp-group' : 'gp-playoff',
    );
    html += _renderGpReviewQueueCard(phaseMatches);

    const groupFormatLabel = _gpScoreMode['gp-group'] === 'sets' ? t('txt_txt_sets') : t('txt_txt_points_label');
    html += _renderChampionAlerts(status);

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

    // Group quick-nav bar (only during active group phase). The unified
    // match filter chips share this bar so they sit alongside the group chips.
    if (status.phase === 'groups' && _gpGroupNames.length > 1) {
      html += `<div class="group-nav-bar" id="gp-group-nav">`;
      for (const gName of _gpGroupNames) {
        const gPending = (groups.matches[gName] || []).filter(m => m.status !== 'completed').length;
        const cls = gPending > 0 ? 'group-nav-btn has-pending' : 'group-nav-btn all-done';
        html += `<button type="button" class="${cls}" onclick="_scrollToGroup('${escAttr(gName)}')">${t('txt_txt_group_name_value', { value: esc(gName) })}</button>`;
      }
      html += `<span class="group-nav-sep" aria-hidden="true"></span>`;
      html += _renderMatchFilterChips(currentTid);
      html += `</div>`;
    } else if (status.phase === 'groups') {
      html += `<div class="group-nav-bar" id="gp-group-nav">${_renderMatchFilterChips(currentTid)}</div>`;
    }

    // Group standings
    for (const [gName, rows] of Object.entries(groups.standings)) {
      html += `<div class="card" id="gp-group-card-${escAttr(gName)}"><h3 class="card-heading-row">${t('txt_txt_group_name_value', { value: esc(gName) })} <button class="format-info-btn" onclick="showAbbrevPopup(event,'standings')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></h3>`;
      const hParticipant = (status.team_roster && Object.keys(status.team_roster).length > 0) ? t('txt_txt_team') : t('txt_txt_player');
      const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
      html += `<table class="standings-table"><thead><tr><th>${hParticipant}</th><th>${t('txt_txt_p_abbrev')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th>`;
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
        const gPending = gMatches.filter(m => m.status !== 'completed').length;
        const gTotal = gMatches.length;
        const summaryText = t('txt_txt_matches_summary', { pending: gPending, total: gTotal });
        html += `<details class="group-matches-details" id="gp-matches-${escAttr(gName)}" open>`;
        html += `<summary>${t('txt_txt_matches')} <span class="matches-summary-count">(${gPending} / ${gTotal})</span></summary>`;
      }
      for (const m of gMatches) {
        html += matchRow(m, 'gp-group');
      }
      if (gMatches.length > 0) {
        html += `</details>`;
      }

      html += `</div>`;
    }

    if (shouldCollapseGroups) {
      html += `</details>`;
    }

    // Next round / Start playoffs controls. Always rendered during the
    // groups phase so admins can see what's possible; buttons are disabled
    // with a tooltip when prerequisites aren't met (#13).
    if (status.phase === 'groups') {
      const pending = allGroupMatches.filter(m => m.status !== 'completed');
      const blockedReason = _decisionDisabledReason({
        pendingMatches: pending.length,
        hasMoreRounds: true,
      });
      html += `<div id="gp-playoffs-section">`;
      html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/gp/courts`);
      html += `<div class="decision-actions-row">`;
      if (groups.has_more_rounds) {
        const reason = blockedReason;
        html += `<button type="button" class="btn btn-primary btn-lg-action"${_decisionDisabledAttrs(reason)} onclick="withLoading(this,nextGpGroupRound)">${_ic('zap')} ${t('txt_txt_generate_next_group_round')}</button>`;
      }
      const playoffReason = blockedReason;
      html += `<button type="button" class="btn btn-success btn-lg-action"${_decisionDisabledAttrs(playoffReason)} onclick="withLoading(this,proposeGpPlayoffs)">${_ic('trophy')} ${t('txt_txt_start_playoffs')} →</button>`;
      if (blockedReason) {
        html += `<div class="decision-actions-disabled-note">${esc(blockedReason)}</div>`;
      }
      html += `</div>`;
      html += `</div>`;
    }

    // Playoff bracket
    if (status.phase === 'playoffs' || status.phase === 'finished') {
      const gpEspejo = status.espejo === true;
      const gpSplit = status.espejo_split === true;
      html += _renderAdminBracketCard(`/api/tournaments/${currentTid}/gp/playoffs-schema`, tvSettings, {
        isDouble: status.double_elimination === true && !gpEspejo,
        isEspejo: gpEspejo,
        isSplit: gpSplit,
      });
      html += _renderPlayoffMatchesByRound(
        playoffs?.matches || [],
        'gp-playoff',
        gpEspejo ? 'gp-espejo-losers' : 'gp-playoff',
        status.espejo_super_final ? 'gp-espejo-super-final' : (gpEspejo ? 'gp-espejo-losers' : 'gp-playoff'),
        gpSplit,
      );
    }

    // Unified Settings card at the bottom of the page.
    const scoringStages = [];
    if (status.phase === 'groups') {
      scoringStages.push({ key: 'gp-group', label: t('txt_txt_group_stage') });
    }
    if (status.phase === 'playoffs' || status.phase === 'finished') {
      scoringStages.push({ key: 'gp-playoff', label: t('txt_txt_play_offs') });
      if (status.espejo) {
        scoringStages.push({ key: 'gp-espejo-losers', label: t(status.espejo_split ? 'txt_txt_espejo_silver_bracket' : 'txt_txt_espejo_losers_bracket') });
      }
      if (status.espejo_super_final) {
        // Legacy: only tournaments created before the Super Final was removed.
        scoringStages.push({ key: 'gp-espejo-super-final', label: t('txt_txt_espejo_super_final') });
      }
    }
    html += _renderSettingsCard({
      tvSettings,
      emailSettings,
      hasCourts,
      isMexicano: false,
      scoringStages,
      playerSecrets,
      collaborators: collabData?.collaborators || [],
    });

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
    _mountPaymentsPanel('tournament', currentTid);
    _gpApplyReviewQueueFilter();
    // Default to pending filter when entering playoffs so completed matches are hidden by default.
    const savedFilter = _readPersistedMatchFilter(currentTid);
    _applyMatchFilter(status.phase === 'playoffs' && savedFilter === 'all' ? 'pending' : savedFilter);
    // Sync schema builder sliders to loaded TV settings so both previews match.
    requestAnimationFrame(() => _syncSchemaBuilderFromTvSettings(tvSettings));
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

function _gpGetReviewItemKind(match) {
  if (!match || match.status === 'completed') return null;
  if (match.disputed) return 'disputes';
  if (_scoreConfirmationMode !== 'immediate' && match.score && match.scored_by && !match.score_confirmed) return 'pending';
  return null;
}

function _gpMatchScorePreview(match) {
  if (!match.score && (!match.sets || match.sets.length === 0)) return '—';
  if (match.sets && match.sets.length > 0) return formatSetScore(match.sets, _matchDecider(match), ' / ');
  return `${match.score[0]}-${match.score[1]}`;
}

function _renderGpReviewQueueCard(matches) {
  const reviewItems = (matches || []).filter(m => _gpGetReviewItemKind(m));
  if (!reviewItems.length) return '';

  const disputesCount = reviewItems.filter(m => _gpGetReviewItemKind(m) === 'disputes').length;
  const pendingCount = reviewItems.length - disputesCount;
  let html = `<div class="card gp-review-queue-card" id="gp-review-queue-card">`;
  html += `<div class="gp-review-queue-head">`;
  html += `<h3>${t('txt_txt_review_queue')}</h3>`;
  html += `<div class="gp-review-filter" id="gp-review-filter">`;
  html += `<button type="button" class="active" onclick="_gpSetReviewQueueFilter('all')">${t('txt_txt_filter_all')} (${reviewItems.length})</button>`;
  if (_scoreConfirmationMode !== 'immediate') html += `<button type="button" onclick="_gpSetReviewQueueFilter('disputes')">${t('txt_txt_disputes')} (${disputesCount})</button>`;
  if (_scoreConfirmationMode !== 'immediate') html += `<button type="button" onclick="_gpSetReviewQueueFilter('pending')">${t('txt_txt_pending_confirmation')} (${pendingCount})</button>`;
  html += `</div></div>`;
  html += `<div class="gp-review-items" id="gp-review-items">`;
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
  html += `<div class="gp-review-empty hidden" id="gp-review-empty">${t('txt_txt_no_review_items')}</div>`;
  html += `</div>`;
  return html;
}

function _gpSetReviewQueueFilter(filter) {
  _gpReviewQueueFilterState = filter;
  _gpApplyReviewQueueFilter();
}

function _gpApplyReviewQueueFilter() {
  const root = document.getElementById('gp-review-queue-card');
  if (!root) return;
  const rows = [...root.querySelectorAll('.gp-review-row')];
  const filter = _gpReviewQueueFilterState;

  rows.forEach(row => {
    const show = filter === 'all' || row.dataset.kind === filter;
    row.classList.toggle('hidden', !show);
  });

  const visibleRows = rows.filter(row => !row.classList.contains('hidden')).length;
  const empty = root.querySelector('#gp-review-empty');
  if (empty) empty.classList.toggle('hidden', visibleRows > 0);

  const filterWrap = root.querySelector('#gp-review-filter');
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

function _goToMatchFromQueue(matchId) {
  if (_gpMatchFilterState !== 'all') _applyMatchFilter('all');
  _scrollToMatch(matchId);
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
    _gpSetDecider = tvSettings.set_decider || 'full_set';
    _scoreConfirmationMode = tvSettings.score_confirmation || 'immediate';
    _poCurrentPhase = status.phase;
    const poMatches = playoffs.matches || [];

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTournamentStatusBar({
      id: 'po-ops-header',
      stats: _buildOpsStats(poMatches),
      reviewCardId: 'po-review-queue-card',
      phase: status.phase === 'finished' ? t('txt_txt_finished') : '',
      rounds: status.phase === 'finished' ? [] : _buildBracketRounds(poMatches),
    });
    const pending = _sortTbdLast((playoffs.pending || []).filter(m => m.status !== 'completed'));
    html += _renderCourtAssignmentsCard(pending, t('txt_txt_court_assignments_play_offs'), status.assign_courts !== false, 'po-playoff');
    html += _renderPoReviewQueueCard(poMatches);

    if (hasCourts) {
      html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/po/courts`);
    }

    html += _renderChampionAlerts(status);

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

    html += _renderAdminBracketCard(`/api/tournaments/${currentTid}/po/playoffs-schema`, tvSettings, { isEspejo: status.espejo === true });
    html += _renderPlayoffMatchesByRound(
      playoffs.matches || [],
      'po-playoff',
      status.espejo ? 'po-espejo-losers' : 'po-playoff',
      status.espejo_super_final ? 'po-espejo-super-final' : (status.espejo ? 'po-espejo-losers' : 'po-playoff'),
    );

    const poScoringStages = [{ key: 'po-playoff', label: t('txt_txt_play_offs') }];
    if (status.espejo) {
      poScoringStages.push({ key: 'po-espejo-losers', label: t('txt_txt_espejo_losers_bracket') });
    }
    if (status.espejo_super_final) {
      // Legacy: only tournaments created before the Super Final was removed.
      poScoringStages.push({ key: 'po-espejo-super-final', label: t('txt_txt_espejo_super_final') });
    }
    html += _renderSettingsCard({
      tvSettings,
      emailSettings,
      hasCourts,
      isMexicano: false,
      scoringStages: poScoringStages,
      playerSecrets,
      collaborators: collabData?.collaborators || [],
    });

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
    _mountPaymentsPanel('tournament', currentTid);
    _poApplyReviewQueueFilter();
    // Default to pending filter so completed matches start collapsed.
    const savedPoFilter = _readPersistedMatchFilter(currentTid);
    _applyMatchFilter(status.phase !== 'finished' && savedPoFilter === 'all' ? 'pending' : savedPoFilter);
    requestAnimationFrame(() => _syncSchemaBuilderFromTvSettings(tvSettings));
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

function _renderPoReviewQueueCard(matches) {
  const reviewItems = (matches || []).filter(m => _gpGetReviewItemKind(m));
  if (!reviewItems.length) return '';

  const disputesCount = reviewItems.filter(m => _gpGetReviewItemKind(m) === 'disputes').length;
  const pendingCount = reviewItems.length - disputesCount;
  let html = `<div class="card gp-review-queue-card" id="po-review-queue-card">`;
  html += `<div class="gp-review-queue-head">`;
  html += `<h3>${t('txt_txt_review_queue')}</h3>`;
  html += `<div class="gp-review-filter" id="po-review-filter">`;
  html += `<button type="button" class="active" onclick="_poSetReviewQueueFilter('all')">${t('txt_txt_filter_all')} (${reviewItems.length})</button>`;
  if (_scoreConfirmationMode !== 'immediate') html += `<button type="button" onclick="_poSetReviewQueueFilter('disputes')">${t('txt_txt_disputes')} (${disputesCount})</button>`;
  if (_scoreConfirmationMode !== 'immediate') html += `<button type="button" onclick="_poSetReviewQueueFilter('pending')">${t('txt_txt_pending_confirmation')} (${pendingCount})</button>`;
  html += `</div></div>`;
  html += `<div class="gp-review-items" id="po-review-items">`;
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
  html += `<div class="gp-review-empty hidden" id="po-review-empty">${t('txt_txt_no_review_items')}</div>`;
  html += `</div>`;
  return html;
}

function _poSetReviewQueueFilter(filter) {
  _poReviewQueueFilterState = filter;
  _poApplyReviewQueueFilter();
}

function _poApplyReviewQueueFilter() {
  const root = document.getElementById('po-review-queue-card');
  if (!root) return;
  const rows = [...root.querySelectorAll('.gp-review-row')];
  const filter = _poReviewQueueFilterState;

  rows.forEach(row => {
    const show = filter === 'all' || row.dataset.kind === filter;
    row.classList.toggle('hidden', !show);
  });

  const visibleRows = rows.filter(row => !row.classList.contains('hidden')).length;
  const empty = root.querySelector('#po-review-empty');
  if (empty) empty.classList.toggle('hidden', visibleRows > 0);

  const filterWrap = root.querySelector('#po-review-filter');
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

// ─── Match rows ───────────────────────────────────────────
// matchRow() is shared by all three formats (GP, Mexicano, Play-offs).  The
// helpers below build its pieces; per-match format logic lives here only.

/** Scoring contexts that accept both points and set scores. */
const _SET_SCORE_CTXS = new Set(['gp-group', 'gp-playoff', 'gp-espejo-losers', 'gp-espejo-super-final', 'mex-playoff', 'po-playoff', 'po-espejo-losers', 'po-espejo-super-final']);

/** Client-only Points/Sets choice per row (key: match id, or `dr-<id>` for the
 *  dispute custom form).  Survives re-renders; never sent to the server. */
const _matchModeLocal = new Map();

/** Last rendered match objects by id, read by the format popover. */
const _matchRowCache = new Map();

/** True when *ctx* accepts set scores as well as points. */
function _isSetCtx(ctx) {
  return _SET_SCORE_CTXS.has(ctx);
}

/** Stage-wide default input mode (tv_settings.score_mode) for *ctx*. */
function _stageScoreMode(ctx) {
  return (typeof _gpScoreMode !== 'undefined' && _gpScoreMode[ctx]) || 'points';
}

/** Tournament default third-set decider (tv_settings.set_decider). */
let _gpSetDecider = 'full_set';

/**
 * Third-set decider in effect for a match: the decider its stored set score
 * was recorded under, else its override, else the tournament default.
 */
function _matchDecider(m) {
  return (m && m.effective_decider) || _gpSetDecider || 'full_set';
}

/** Label for the decider value, for chips and the settings card. */
function _deciderLabel(decider) {
  return decider === 'match_tiebreak' ? t('txt_match_format_decider_tiebreak') : t('txt_match_format_decider_full_set');
}

/**
 * Input mode a score form opens in.
 * Order: the row's local toggle > the match's saved override > the format the
 * stored score uses (`saved`, edit/dispute forms only) > the stage default.
 */
function _matchInputMode(m, ctx, saved = null, localKey = null) {
  if (!_isSetCtx(ctx)) return 'points';
  return _matchModeLocal.get(localKey || m.id) || m.format_override?.mode || saved || _stageScoreMode(ctx);
}

/** Points a Mexicano round score must sum to (0 when no sum rule applies). */
function _matchPointsTarget(m, ctx) {
  if (ctx !== 'mex') return 0;
  return m.effective_points_target || m.format_override?.points_target || _totalPts || 0;
}

/** True when the match has a format that differs from the tournament default. */
function _matchFormatIsOverridden(m, ctx) {
  const fo = m.format_override;
  if (!fo) return false;
  if (ctx === 'mex') return !!fo.points_target && fo.points_target !== _totalPts;
  return (!!fo.mode && fo.mode !== _stageScoreMode(ctx)) || (!!fo.decider && fo.decider !== _gpSetDecider);
}

/** Label inside the format button: the input mode plus a TB tag (set contexts). */
function _matchFormatModeLabel(m, mode) {
  let label = `<span class="match-format-mode">${esc(mode === 'sets' ? t('txt_txt_sets') : t('txt_txt_points_label'))}</span>`;
  if (mode === 'sets' && _matchDecider(m) === 'match_tiebreak') {
    label += ` <span class="match-format-tb" title="${escAttr(t('txt_match_tb_rule'))}">${esc(t('txt_match_tb_label'))}</span>`;
  }
  return label;
}

/**
 * The single per-match format button: shows the current entry mode (or the
 * Mexicano points target) and opens the shared format popover, where the
 * scorer switches Points/Sets and adjusts the match's saved format.
 * With `onlyIfOverride`, renders nothing unless the match has an override.
 *
 * @param {object} m        Serialised match.
 * @param {string} ctx      Scoring context.
 * @param {object} [opts]
 * @param {boolean} [opts.onlyIfOverride]  Indicator-only use on scored rows.
 * @param {string|null} [opts.mode]        Input mode to show (defaults to the row's).
 * @param {string|null} [opts.modeKey]     `_matchModeLocal` key (`dr-<id>` in dispute panels).
 * @param {string} [opts.idPrefix]         Element id prefix; keeps ids unique per form.
 */
function _renderMatchFormatChip(m, ctx, { onlyIfOverride = false, mode = null, modeKey = null, idPrefix = 'mfmt-btn-' } = {}) {
  if (ctx !== 'mex' && !_isSetCtx(ctx)) return '';
  if (onlyIfOverride && !m.format_override) return '';
  const key = modeKey || m.id;
  const overridden = _matchFormatIsOverridden(m, ctx);
  let label;
  let defaultValue;
  if (ctx === 'mex') {
    label = `<span class="match-format-num">${_matchPointsTarget(m, ctx)}</span>`;
    defaultValue = String(_totalPts);
  } else {
    label = _matchFormatModeLabel(m, mode || _matchInputMode(m, ctx, null, modeKey));
    defaultValue = _stageScoreMode(ctx) === 'sets' ? t('txt_txt_sets') : t('txt_txt_points_label');
  }
  const title = m.format_override
    ? t('txt_match_format_overridden')
    : t('txt_match_format_default_value', { value: defaultValue });
  const cls = `match-format-btn${overridden ? ' is-override' : ''}`;
  return `<button type="button" class="${cls}" id="${idPrefix}${m.id}" data-mode-key="${key}" aria-haspopup="dialog" aria-label="${escAttr(t('txt_match_format_btn_label'))}" title="${escAttr(title)}" onclick="_openMatchFormatPopover('${m.id}','${ctx}', this, '${key}')">${_ic('clipboard')} ${label}<span class="match-format-caret" aria-hidden="true"></span></button>`;
}

/** Show the points or sets inputs of one form without re-rendering the row. */
function _applyMatchRowMode(key, mode) {
  const isDispute = key.startsWith('dr-');
  const id = isDispute ? key.slice(3) : key;
  const pts = document.getElementById(isDispute ? `dr-custom-pts-${id}` : `score-normal-${id}`);
  const sets = document.getElementById(isDispute ? `dr-custom-sets-${id}` : `score-tennis-${id}`);
  if (pts) pts.classList.toggle('hidden', mode === 'sets');
  if (sets) sets.classList.toggle('hidden', mode !== 'sets');
  const m = _matchRowCache.get(id)?.m;
  document.querySelectorAll(`.match-format-btn[data-mode-key="${key}"]`).forEach(btn => {
    const modeEl = btn.querySelector('.match-format-mode');
    if (!modeEl) return;
    btn.querySelector('.match-format-tb')?.remove();
    const tmp = document.createElement('span');
    tmp.innerHTML = m ? _matchFormatModeLabel(m, mode) : '';
    modeEl.replaceWith(...tmp.childNodes);
  });
}

/** Remember a row's entry mode locally and swap its inputs. */
function _setMatchRowMode(key, mode, { focus = true } = {}) {
  _matchModeLocal.set(key, mode);
  _applyMatchRowMode(key, mode);
  if (!focus) return;
  const scopeId = key.startsWith('dr-')
    ? (mode === 'sets' ? `dr-custom-sets-${key.slice(3)}` : `dr-custom-pts-${key.slice(3)}`)
    : (mode === 'sets' ? `score-tennis-${key}` : `score-normal-${key}`);
  _focusFirstScoreInput(document.getElementById(scopeId));
}

/** Focus the first visible score input inside *root* (no-op when none). */
function _focusFirstScoreInput(root, { preventScroll = false } = {}) {
  if (!root) return false;
  const input = Array.from(root.querySelectorAll('input[type="number"]')).find(el => el.offsetParent !== null);
  if (!input) return false;
  input.focus({ preventScroll });
  input.select?.();
  return true;
}

/**
 * Keyboard flow for score inputs: Enter moves to the next box and saves on the
 * last one; Esc cancels an open edit form.  Works for points, set and dispute
 * inputs through the surrounding `[data-score-scope]` element.
 */
function _scoreKeydown(event) {
  const el = event.target;
  const scope = el.closest('[data-score-scope]');
  if (!scope) return;
  if (event.key === 'Escape') {
    const edit = el.closest('[id^="medit-"]');
    if (edit) {
      event.preventDefault();
      const id = edit.id.slice(6);
      _cancelEditMatch(id);
      document.getElementById('medit-btn-' + id)?.focus();
    }
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const inputs = Array.from(scope.querySelectorAll('input[type="number"]')).filter(i => i.offsetParent !== null);
  const idx = inputs.indexOf(el);
  // Sets: once S1 and S2 are won by the same team the match is over, so the
  // empty third-set boxes are skipped and Enter saves straight away.
  const isSetInput = el.classList.contains('tennis-set-input');
  const straightSets = isSetInput && idx === 3 && (() => {
    const v = inputs.slice(0, 4).map(i => +i.value || 0);
    const w1 = Math.sign(v[0] - v[1]);
    const w2 = Math.sign(v[2] - v[3]);
    return w1 !== 0 && w1 === w2;
  })();
  if (idx >= 0 && idx < inputs.length - 1 && !straightSets) {
    inputs[idx + 1].focus();
    inputs[idx + 1].select?.();
    return;
  }
  const save = scope.querySelector('[data-score-save]')
    || scope.closest('.admin-dispute-panel')?.querySelector('.admin-dispute-resolve');
  if (save && !save.disabled) save.click();
}

/**
 * Score inputs for one form: the per-match format button (set-capable and
 * Mexicano contexts) plus the points row and the sets row, one of them hidden.
 *
 * @param {object} m       Serialised match.
 * @param {string} ctx     Scoring context.
 * @param {object} opts
 * @param {string} opts.mode        'points' | 'sets' — which inputs show.
 * @param {number[]|null} opts.prefill  Score to pre-fill (edit form) or null.
 * @param {string} [opts.saveClass]  Save button classes.
 * @param {string} [opts.tbdAttr]    Extra attributes for the save buttons.
 * @param {string} [opts.idPrefix]   Id prefix for the format button.
 */
function _renderScoreInputs(m, ctx, { mode, prefill = null, saveClass = 'btn btn-success btn-sm', tbdAttr = '', idPrefix = 'mfmt-btn-' }) {
  const target = _matchPointsTarget(m, ctx);
  const onInput = target > 0 ? ` oninput="_autoFillScore('${m.id}', ${target})"` : '';
  const keys = ` onkeydown="_scoreKeydown(event)"`;
  const v1 = prefill ? `value="${prefill[0]}"` : `value="" placeholder="0"`;
  const v2 = prefill ? `value="${prefill[1]}"` : `value="" placeholder="${target > 0 ? target : 0}"`;
  const setCtx = _isSetCtx(ctx);
  let html = _renderMatchFormatChip(m, ctx, { mode: setCtx ? mode : null, idPrefix });
  html += `<div id="score-normal-${m.id}" class="score-entry${setCtx && mode === 'sets' ? ' hidden' : ''}" data-score-scope>`;
  html += `<input type="number" id="s1-${m.id}" class="score-input-narrow" inputmode="numeric" pattern="[0-9]*" min="0" ${v1}${onInput}${keys}>`;
  html += `<span>–</span>`;
  html += `<input type="number" id="s2-${m.id}" class="score-input-narrow" inputmode="numeric" pattern="[0-9]*" min="0" ${v2}${onInput}${keys}>`;
  html += `<button type="button" class="${saveClass}"${tbdAttr} data-score-save onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
  html += `</div>`;
  if (setCtx) {
    html += `<div id="score-tennis-${m.id}" class="score-entry score-entry-sets${mode === 'sets' ? '' : ' hidden'}" data-score-scope>`;
    html += `<div class="tennis-sets" id="tennis-sets-${m.id}">`;
    html += _renderTennisSetInputs(m.id, 3, _matchDecider(m));
    html += `</div>`;
    html += `<button type="button" class="${saveClass}"${tbdAttr} data-score-save onclick="submitTennisScore('${m.id}','${ctx}')">${t('txt_txt_save_sets')}</button>`;
    html += `</div>`;
  }
  return html;
}

/** Hidden inline edit form for a scored match. */
function _renderEditForm(m, ctx) {
  const sc = m.score || [0, 0];
  const saved = m.sets && m.sets.length > 0 ? 'sets' : 'points';
  let html = `<div class="match-actions hidden" id="medit-${m.id}">`;
  html += _renderScoreInputs(m, ctx, { mode: _matchInputMode(m, ctx, saved), prefill: sc, idPrefix: 'mfmt-edit-' });
  html += `<button type="button" class="btn btn-sm btn-muted" aria-label="${escAttr(t('txt_txt_cancel'))}" onclick="_cancelEditMatch('${m.id}')">✕</button>`;
  html += `</div>`;
  return html;
}

/** Inline dispute-resolution panel (original / correction / custom score). */
function _renderDisputePanel(m, ctx) {
  const fmt = (sets, score) => (sets && sets.length > 0)
    ? formatSetScore(sets, _matchDecider(m), ' / ')
    : (score ? `${score[0]}–${score[1]}` : '?');
  const origScore = fmt(m.sets, m.score);
  const dispScore = fmt(m.dispute_sets, m.dispute_score);
  const escalatedNote = m.dispute_escalated
    ? `<div class="admin-dispute-note note-escalated">${_ic('alert')} ${t('txt_txt_escalated_by_player')}</div>`
    : `<div class="admin-dispute-note note-reviewing">${_ic('refresh')} ${t('txt_txt_players_reviewing')}</div>`;
  const hideCustom = `document.getElementById('dr-custom-${m.id}')?.classList.add('hidden')`;
  const showCustom = `document.getElementById('dr-custom-${m.id}')?.classList.remove('hidden');_focusFirstScoreInput(document.getElementById('dr-custom-${m.id}'))`;
  let html = `<div class="admin-dispute-panel" id="dispute-panel-${m.id}">`;
  html += escalatedNote;
  html += `<div class="admin-dispute-scores">`;
  html += `<label><input type="radio" name="dr-${m.id}" value="original" checked onclick="${hideCustom}"> <span class="dispute-option-text">${t('txt_txt_original')}:</span> <span class="dispute-score-value">${origScore}</span></label>`;
  html += `<label><input type="radio" name="dr-${m.id}" value="correction" onclick="${hideCustom}"> <span class="dispute-option-text">${t('txt_txt_correction')}:</span> <span class="dispute-score-value">${dispScore}</span></label>`;
  html += `<label><input type="radio" name="dr-${m.id}" value="custom" onclick="${showCustom}"> <span class="dispute-option-text">${t('txt_txt_custom_score')}</span></label>`;
  html += `</div>`;

  // Custom score inputs (hidden until 'custom' is selected).  They open in the
  // format the disputed score was entered in, not the stage default.
  const keys = ` onkeydown="_scoreKeydown(event)"`;
  html += `<div class="admin-dispute-custom hidden" id="dr-custom-${m.id}">`;
  if (_isSetCtx(ctx)) {
    const saved = (m.dispute_sets && m.dispute_sets.length > 0) || (m.sets && m.sets.length > 0) ? 'sets' : 'points';
    const custMode = _matchInputMode(m, ctx, saved, `dr-${m.id}`);
    html += _renderMatchFormatChip(m, ctx, { mode: custMode, modeKey: `dr-${m.id}`, idPrefix: 'mfmt-dr-' });
    html += `<div id="dr-custom-pts-${m.id}" class="custom-score-row ${custMode === 'sets' ? 'hidden' : ''}" data-score-scope>`;
    html += `<input type="number" id="drs1-${m.id}" min="0" placeholder="0"${keys}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="drs2-${m.id}" min="0" placeholder="0"${keys}>`;
    html += `</div>`;
    html += `<div id="dr-custom-sets-${m.id}" class="${custMode === 'sets' ? '' : 'hidden'}" data-score-scope>`;
    html += `<div class="tennis-sets" id="dr-tennis-${m.id}">`;
    html += _renderTennisSetInputs('dr-' + m.id, 3, _matchDecider(m));
    html += `</div></div>`;
  } else {
    const target = _matchPointsTarget(m, ctx);
    const onCustInput = target > 0 ? ` oninput="_autoFillDisputeCustom('${m.id}', ${target})"` : '';
    html += `<div class="custom-score-row" data-score-scope>`;
    html += `<input type="number" id="drs1-${m.id}" min="0" placeholder="0"${onCustInput}${keys}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="drs2-${m.id}" min="0" placeholder="0"${onCustInput}${keys}>`;
    html += `</div>`;
  }
  html += `</div>`;

  html += `<button type="button" class="btn btn-warning btn-sm admin-dispute-resolve" onclick="_adminResolveDispute('${m.id}','${ctx}')">${t('txt_txt_resolve_dispute')}</button>`;
  html += `</div>`;
  return html;
}

/**
 * Approve / reject panel for a player score entered in a format other than
 * the match's.  The score is parked server-side and counts nowhere until
 * approved; recording a score in the inputs below also replaces it.
 */
function _renderFormatReviewPanel(m) {
  const score = (m.review_sets && m.review_sets.length > 0)
    ? formatSetScore(m.review_sets, m.review_decider || _matchDecider(m), ' / ')
    : (m.review_score ? `${m.review_score[0]}–${m.review_score[1]}` : '?');
  let html = `<div class="admin-dispute-panel" id="review-panel-${m.id}">`;
  html += `<div class="admin-dispute-note note-escalated">${_ic('alert')} ${t('txt_admin_format_review_note')}</div>`;
  html += `<div class="admin-dispute-scores"><span class="dispute-score-value">${esc(score)}</span></div>`;
  html += `<div class="admin-review-actions">`;
  html += `<button type="button" class="btn btn-success btn-sm" onclick="_adminFormatReview('${m.id}','approve')">${t('txt_admin_approve_score')}</button>`;
  html += `<button type="button" class="btn btn-sm" onclick="_adminFormatReview('${m.id}','reject')">${t('txt_admin_reject_score')}</button>`;
  html += `</div></div>`;
  return html;
}

/** Comment banner with its inline editor. */
function _renderCommentBanner(m) {
  let html = `<div class="match-comment-banner">`;
  if (m.comment) {
    html += `<span class="match-comment-text" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_click_to_edit')}">${_ic('message')} ${esc(m.comment)}</span>`;
  } else {
    html += `<span class="match-comment-add" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_comment_placeholder')}">${_ic('message')} ${t('txt_match_add_comment')}</span>`;
  }
  html += `<div class="match-comment-edit hidden" id="mc-row-${m.id}">`;
  html += `<input type="text" id="mc-${m.id}" value="${m.comment ? esc(m.comment) : ''}" placeholder="${t('txt_match_comment_placeholder')}" maxlength="500" onkeydown="if(event.key==='Enter')_setMatchComment('${m.id}')">`;
  html += `<button type="button" class="btn-comment-save" onclick="_setMatchComment('${m.id}')">${t('txt_txt_save')}</button>`;
  if (m.comment) html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearMatchComment('${m.id}')">✕</button>`;
  html += `<button type="button" class="btn-comment-cancel" aria-label="${t('txt_txt_cancel')}" onclick="_closeCommentEdit('${m.id}')">✕</button>`;
  html += `</div></div>`;
  return html;
}

/** Score display for a scored row: stacked sets, or "a – b". */
function _renderScoreDisplay(m) {
  const sc = m.score || [0, 0];
  if (m.sets && m.sets.length > 0) {
    const decider = _matchDecider(m);
    return {
      cls: 'match-score sets-stack',
      html: m.sets.map((s, i) => `<span class="set-row${isMatchTiebreakSet(m.sets, i, decider) ? ' set-row-tb' : ''}">${isMatchTiebreakSet(m.sets, i, decider) ? `[${s[0]}-${s[1]}]` : `${s[0]}-${s[1]}`}</span>`).join(''),
    };
  }
  return { cls: 'match-score', html: `${sc[0]} – ${sc[1]}` };
}

/** Dispute or awaiting-confirmation badge for a scored row. */
function _renderLifecycleBadge(m, awaitingTipKey) {
  if (m.disputed) {
    if (m.dispute_escalated) {
      return ` <span class="badge badge-dispute" title="${t('txt_txt_dispute_escalated_tip')}">${_ic('alert')} ${t('txt_txt_dispute_label')}</span>`;
    }
    return ` <span class="badge badge-dispute badge-dispute-pending" title="${t('txt_txt_dispute_pending_tip')}">${_ic('refresh')} ${t('txt_txt_dispute_review_label')}</span>`;
  }
  if (awaitingTipKey && _scoreConfirmationMode !== 'immediate') {
    return ` <span class="badge badge-pending-score" title="${t(awaitingTipKey)}" aria-label="${escAttr(t(awaitingTipKey))}">${_ic('clock')}</span>`;
  }
  return '';
}

/** Mexicano score breakdown (completed round matches only). */
function _renderBreakdown(m, ctx) {
  const isMex = ctx === 'mex' || ctx === 'mex-playoff';
  const bd = isMex ? _mexBreakdowns[m.id] : null;
  if (!bd || Object.keys(bd).length === 0) return '';
  const scaled = Object.values(bd).find(d => d.scale && d.scale !== 1);
  let html = `<details class="breakdown-details" id="breakdown-${m.id}">`;
  html += `<summary>${_ic('chart')} ${t('txt_txt_score_breakdown')}</summary>`;
  html += `<div class="breakdown-panel">`;
  if (scaled) html += `<div class="breakdown-scale-note">${esc(t('txt_match_format_scaled_note', { n: _totalPts }))} (×${scaled.scale.toFixed(2)})</div>`;
  html += `<table class="breakdown-table"><thead><tr><th>${t('txt_txt_player')}</th><th>${t('txt_txt_raw')}</th><th>${t('txt_txt_relative_strength')}</th><th>${t('txt_txt_strength_weight')}</th><th>${t('txt_txt_strength_multiplier')}</th><th>${t('txt_txt_loss_disc_multiplier')}</th><th>${t('txt_txt_win_bonus_header')}</th><th>${t('txt_txt_final')}</th></tr></thead><tbody>`;
  for (const [pid, d] of Object.entries(bd)) {
    const pname = _mexPlayerMap[pid] || pid;
    const rs = d.relative_strength || 0;
    const raw = (d.scale && d.scale !== 1 && d.played !== undefined)
      ? `${d.raw} <span class="breakdown-scale">(${d.played} ×${d.scale.toFixed(2)})</span>`
      : `${d.raw}`;
    html += `<tr><td>${esc(pname)}</td><td>${raw}</td><td>${rs > 0 ? rs.toFixed(3) : '—'}</td><td>${_mexStrengthWeight > 0 ? '×' + _mexStrengthWeight : '—'}</td><td>${d.strength_mult !== 1 ? '×' + d.strength_mult.toFixed(2) : '—'}</td><td>${d.loss_disc !== 1 ? '×' + d.loss_disc.toFixed(2) : '—'}</td><td>${d.win_bonus > 0 ? '+' + d.win_bonus : '—'}</td><td><strong>${d.final}</strong></td></tr>`;
  }
  html += `</tbody></table></div>`;
  html += `</details>`;
  return html;
}

function matchRow(m, ctx) {
  _matchRowCache.set(m.id, { m, ctx });
  _mfSyncFromRow(m);
  const t1 = m.team1.join(' & ') || 'TBD';
  const t2 = m.team2.join(' & ') || 'TBD';
  const court = m.court ? `<span class="match-court">${esc(m.court)}</span>` : '';
  const roundLabel = m.round_label ? `<span class="badge badge-scheduled match-round-badge">${esc(m.round_label)}</span>` : '';
  const editBtn = () => {
    const sc = m.score || [0, 0];
    const setsJson = JSON.stringify(m.sets || []);
    return `<button type="button" class="match-edit-btn" id="medit-btn-${m.id}" data-sets='${setsJson}' onclick="_toggleEditMatch('${m.id}','${ctx}',${sc[0]},${sc[1]})">${t('txt_txt_edit')}</button>`;
  };

  if (m.status === 'completed') {
    const sc = m.score || [0, 0];
    const disp = _renderScoreDisplay(m);
    const w1 = sc[0] > sc[1];
    const w2 = sc[1] > sc[0];
    const t1Class = w1 ? ' team-winner' : (w2 ? ' team-loser' : '');
    const t2Class = w2 ? ' team-winner' : (w1 ? ' team-loser' : '');
    let html = `<div id="mcard-${m.id}" class="match-card match-card-wrap" data-status="completed" data-disputed="${m.disputed ? '1' : '0'}">`;
    html += `${roundLabel} <div class="match-teams"><span class="${t1Class}">${esc(t1)}</span> <span class="vs">vs</span> <span class="${t2Class}">${esc(t2)}</span></div> ${court}`;
    html += ` <span class="${disp.cls}" id="mscore-${m.id}">${disp.html}</span>`;
    html += ` <span class="badge badge-completed" aria-label="${escAttr(t('txt_txt_filter_completed'))}">${_ic('check')}</span>`;
    const awaiting = m.scored_by && !m.score_confirmed ? 'txt_txt_player_submitted_not_confirmed' : null;
    html += _renderLifecycleBadge(m, awaiting);
    html += _renderMatchFormatChip(m, ctx, { onlyIfOverride: true });
    html += editBtn();
    if (m.disputed) html += _renderDisputePanel(m, ctx);
    html += _renderEditForm(m, ctx);
    html += _renderBreakdown(m, ctx);
    html += _renderCommentBanner(m);
    html += `</div>`;
    return html;
  }

  // ── Pending confirmation — player submitted but score_confirmation="required" ──
  // Match status may be in_progress with a score that's awaiting confirmation,
  // or may even have a dispute. Show the score, lifecycle badges, and dispute panel.
  if (m.score && m.scored_by && !m.score_confirmed) {
    const disp = _renderScoreDisplay(m);
    let html = `<div id="mcard-${m.id}" class="match-card match-card-wrap" data-status="pending" data-disputed="${m.disputed ? '1' : '0'}">`;
    html += `${roundLabel} <div class="match-teams">${esc(t1)} <span class="vs">vs</span> ${esc(t2)}</div> ${court}`;
    html += ` <span class="${disp.cls}" id="mscore-${m.id}">${disp.html}</span>`;
    html += _renderLifecycleBadge(m, 'txt_txt_player_submitted_awaiting_confirmation');
    html += _renderMatchFormatChip(m, ctx, { onlyIfOverride: true });
    html += editBtn();
    if (m.disputed) html += _renderDisputePanel(m, ctx);
    html += _renderEditForm(m, ctx);
    html += _renderCommentBanner(m);
    html += `</div>`;
    return html;
  }

  // Not yet completed — show input form
  const hasTbd = !m.team1?.join('').trim() || !m.team2?.join('').trim();
  const tbdAttr = hasTbd ? ` disabled title="${t('txt_txt_players_not_yet_determined')}"` : '';
  const tbdClass = hasTbd ? ' match-tbd-disabled' : '';
  const saveClass = `btn btn-success btn-sm${hasTbd ? ' btn-disabled-ish' : ''}`;

  let html = `<div id="mcard-${m.id}" class="match-card match-card-wrap${tbdClass}" data-status="pending" data-disputed="0">${roundLabel} <div class="match-teams">${esc(t1)} <span class="vs">vs</span> ${esc(t2)}</div> ${court}`;
  if (m.format_review) html += _renderFormatReviewPanel(m);
  html += `<div class="match-actions" id="score-input-${m.id}">`;
  html += _renderScoreInputs(m, ctx, { mode: _matchInputMode(m, ctx), saveClass, tbdAttr });
  html += `</div>`;
  html += _renderCommentBanner(m);
  html += `</div>`;
  return html;
}

// ─── Per-match format popover (Petite-Vue island) ─────────
// Markup: #match-format-popover in index.html, outside #view-content so view
// re-renders never destroy it.  Legacy rows open it through
// _openMatchFormatPopover(); the island owns its own state and bindings.

/** Element that opened the popover; focus returns here on close. */
let _mfTrigger = null;

const _mfStore = reactiveStore({
  open: false,
  matchId: '',
  modeKey: '',           // _matchModeLocal key of the form that opened it
  ctx: '',
  isMexRound: false,
  completed: false,
  disputed: false,
  globalMode: 'points',
  globalTarget: 0,
  globalDecider: 'full_set',
  original: null,        // server override {mode, points_target, decider} or null
  originalTarget: 0,     // effective target before editing (Mexicano)
  originalDecider: 'full_set',  // decider the stored score was recorded under / in effect
  threeSets: false,      // stored score went to a third set (decider change needs re-entry)
  draft: { mode: 'points', points_target: '', decider: 'full_set' },
  score: { s1: '', s2: '', sets: [['', ''], ['', ''], ['', '']] },
  saving: false,
  error: '',
  notice: '',
  top: 0,
  left: 0,
  lang: 'en',            // tracked so t() bindings re-render on language switch

  // Lang-tracking t() wrapper (petite-vue only re-renders on reactive reads).
  t(key, params) { void this.lang; return window.t(key, params); },

  get isOverride() { return !!this.original; },
  get defaultLabel() {
    const value = this.isMexRound
      ? String(this.globalTarget)
      : (this.globalMode === 'sets' ? this.t('txt_txt_sets') : this.t('txt_txt_points_label'));
    return this.t('txt_match_format_default_value', { value });
  },
  get draftTarget() {
    const n = parseInt(this.draft.points_target, 10);
    return Number.isFinite(n) && n > 0 ? n : this.globalTarget;
  },
  /** A Mexicano target change on a scored match needs a replacement score. */
  get needsScore() {
    return this.isMexRound && this.completed && this.draftTarget !== this.originalTarget;
  },
  /** A decider change on a three-set score needs the sets re-entered. */
  get needsSets() {
    return !this.isMexRound && this.completed && this.threeSets && this.draft.decider !== this.originalDecider;
  },
  get deciderIsTb() { return this.draft.decider === 'match_tiebreak'; },
  /** Three set rows from the popover inputs (empty rows skipped). */
  get draftSets() {
    return this.score.sets
      .map(([a, b]) => [parseInt(a, 10), parseInt(b, 10)])
      .filter(([a, b]) => Number.isFinite(a) || Number.isFinite(b))
      .map(([a, b]) => [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0]);
  },
  get canApply() {
    if (this.saving || this.disputed) return false;
    if (this.isMexRound && String(this.draft.points_target).trim() !== '') {
      const n = parseInt(this.draft.points_target, 10);
      if (!Number.isFinite(n) || n < 2 || n > 200) return false;
    }
    if (this.needsScore) {
      const s1 = parseInt(this.score.s1, 10);
      const s2 = parseInt(this.score.s2, 10);
      return Number.isFinite(s1) && Number.isFinite(s2) && s1 + s2 === this.draftTarget;
    }
    if (this.needsSets) {
      const sets = this.draftSets;
      return sets.length >= 2 && sets.every(([a, b]) => a !== b);
    }
    return true;
  },
  /** Switches the row's score boxes right away; Apply also saves it. */
  setMode(mode) {
    this.draft.mode = mode;
    if (!this.isMexRound) {
      _setMatchRowMode(this.modeKey, mode, { focus: false });
      // The row reflows (sets boxes are wider), so follow the trigger.
      _mfPositionAt(_mfTrigger);
    }
  },
  setDecider(decider) { this.draft.decider = decider; },
  setSetScore(row, which, value) { this.score.sets[row][which] = value; },
  setScore(which, value) {
    if (which === 1) this.score.s1 = value;
    else this.score.s2 = value;
    this.fillScore(which);
  },
  fillScore(which) {
    const total = this.draftTarget;
    const v = Math.max(0, Math.min(total, parseInt(which === 1 ? this.score.s1 : this.score.s2, 10) || 0));
    if (which === 1) this.score.s2 = String(total - v);
    else this.score.s1 = String(total - v);
  },
  apply() { return _mfApply(false); },
  reset() { return _mfApply(true); },
  close() { _closeMatchFormatPopover(); },
  onKeydown(e) { _mfKeydown(e); },
});

/** Build the request override from the popover draft (null = defaults). */
function _mfOverrideBody(resetToDefault) {
  if (resetToDefault) return null;
  if (_mfStore.isMexRound) {
    const target = _mfStore.draftTarget;
    return target === _mfStore.globalTarget ? null : { points_target: target };
  }
  const inherited = _mfStore.draft.mode === _mfStore.globalMode && _mfStore.draft.decider === _mfStore.globalDecider;
  if (inherited && !_mfStore.original) return null;
  const body = { mode: _mfStore.draft.mode };
  // The decider is only meaningful for set scores; keep it explicit so a
  // later change of the tournament default never reinterprets this match.
  if (_mfStore.draft.mode === 'sets' || _mfStore.draft.decider !== _mfStore.globalDecider) body.decider = _mfStore.draft.decider;
  return body;
}

/** Open the format popover for a match row, anchored under *trigger*. */
function _openMatchFormatPopover(matchId, ctx, trigger, modeKey = matchId) {
  const entry = _matchRowCache.get(matchId);
  if (!entry) return;
  const m = entry.m;
  const isMexRound = ctx === 'mex';
  _mfTrigger = trigger || null;
  if (typeof _currentLang !== 'undefined') _mfStore.lang = _currentLang;
  _mfStore.matchId = matchId;
  _mfStore.modeKey = modeKey;
  _mfStore.ctx = ctx;
  _mfStore.isMexRound = isMexRound;
  _mfStore.completed = !!m.score && (m.status === 'completed' || !!m.scored_by);
  _mfStore.disputed = !!m.disputed;
  _mfStore.globalMode = _stageScoreMode(ctx);
  _mfStore.globalTarget = _totalPts || 0;
  _mfStore.globalDecider = _gpSetDecider || 'full_set';
  _mfStore.original = m.format_override ? { ...m.format_override } : null;
  _mfStore.originalTarget = isMexRound ? _matchPointsTarget(m, ctx) : 0;
  _mfStore.originalDecider = _matchDecider(m);
  _mfStore.threeSets = Array.isArray(m.sets) && m.sets.length === 3;
  const isDisputeForm = modeKey !== matchId;
  const savedSets = (m.sets && m.sets.length) || (isDisputeForm && m.dispute_sets && m.dispute_sets.length);
  _mfStore.draft.mode = _matchInputMode(m, ctx, savedSets ? 'sets' : null, modeKey);
  _mfStore.draft.points_target = isMexRound && m.format_override?.points_target ? String(m.format_override.points_target) : '';
  _mfStore.draft.decider = _matchDecider(m);
  _mfStore.score.s1 = '';
  _mfStore.score.s2 = '';
  _mfStore.score.sets = (m.sets && m.sets.length ? m.sets : [[], [], []]).concat([[], [], []]).slice(0, 3)
    .map(s => [s[0] !== undefined ? String(s[0]) : '', s[1] !== undefined ? String(s[1]) : '']);
  _mfStore.error = '';
  _mfStore.notice = '';
  _mfStore.saving = false;
  _mfPositionAt(trigger);
  _mfStore.open = true;
  const root = document.getElementById('match-format-popover');
  if (root) root.hidden = false;
  requestAnimationFrame(() => {
    const first = root?.querySelector('input:not([disabled]), button:not([disabled])');
    first?.focus();
  });
}

/** Anchor the popover under *trigger*, clamped to the viewport. */
function _mfPositionAt(trigger) {
  if (!trigger || !document.body.contains(trigger)) return;
  const r = trigger.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 32);
  _mfStore.top = Math.round(r.bottom + window.scrollY + 6);
  _mfStore.left = Math.round(Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 16)));
}

/** Close the popover; by default focus returns to its trigger. */
function _closeMatchFormatPopover(returnFocus = true) {
  _mfStore.open = false;
  const root = document.getElementById('match-format-popover');
  if (root) root.hidden = true;
  if (returnFocus) {
    const back = _mfTrigger && document.body.contains(_mfTrigger)
      ? _mfTrigger
      : document.querySelector(`.match-format-btn[data-mode-key="${_mfStore.modeKey}"]`);
    back?.focus();
  }
  _mfTrigger = null;
}

/** Esc closes; Tab cycles inside the popover (focus trap). */
function _mfKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    _closeMatchFormatPopover();
    return;
  }
  if (e.key !== 'Tab') return;
  const root = document.getElementById('match-format-popover');
  const items = Array.from(root?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [])
    .filter(el => el.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** When a re-render brings a different override for the open match, refresh
 *  the popover and say another organiser changed it. */
function _mfSyncFromRow(m) {
  if (!_mfStore.open || _mfStore.matchId !== m.id || _mfStore.saving) return;
  const before = JSON.stringify(_mfStore.original || null);
  const after = JSON.stringify(m.format_override || null);
  if (before === after) return;
  _mfStore.original = m.format_override ? { ...m.format_override } : null;
  _mfStore.originalTarget = _mfStore.isMexRound ? _matchPointsTarget(m, _mfStore.ctx) : 0;
  _mfStore.originalDecider = _matchDecider(m);
  _mfStore.threeSets = Array.isArray(m.sets) && m.sets.length === 3;
  _mfStore.draft.mode = _matchInputMode(m, _mfStore.ctx, null, _mfStore.modeKey);
  _mfStore.draft.points_target = m.format_override?.points_target ? String(m.format_override.points_target) : '';
  _mfStore.draft.decider = _matchDecider(m);
  _mfStore.notice = t('txt_match_format_changed_elsewhere');
}

/** Replace one match card in place, keeping typed drafts. */
function _replaceMatchCard(m, ctx) {
  const card = document.getElementById('mcard-' + m.id);
  if (!card) return false;
  const drafts = _captureViewDrafts();
  const wasEditing = !document.getElementById('medit-' + m.id)?.classList.contains('hidden');
  card.outerHTML = matchRow(m, ctx);
  _restoreViewDrafts(drafts);
  if (wasEditing && m.score) _toggleEditMatch(m.id, ctx, m.score[0], m.score[1]);
  if (_gpMatchFilterState !== 'all') _applyMatchFilter(_gpMatchFilterState);
  return true;
}

/**
 * Send the popover's change.  Pending rows switch their inputs optimistically
 * and revert with a toast if the server rejects the change.
 */
async function _mfApply(resetToDefault) {
  const matchId = _mfStore.matchId;
  const modeKey = _mfStore.modeKey || matchId;
  const ctx = _mfStore.ctx;
  const entry = _matchRowCache.get(matchId);
  if (!entry || !currentTid) return;
  const override = _mfOverrideBody(resetToDefault);
  const body = { override };
  if (_mfStore.needsScore && !resetToDefault) {
    body.score1 = parseInt(_mfStore.score.s1, 10);
    body.score2 = parseInt(_mfStore.score.s2, 10);
  }
  if (_mfStore.needsSets && !resetToDefault) {
    body.sets = _mfStore.draftSets;
  }
  if (resetToDefault && _mfStore.isMexRound && _mfStore.completed && _mfStore.originalTarget !== _mfStore.globalTarget) {
    // Resetting a shortened Mexicano match also changes what its score means.
    _mfStore.draft.points_target = '';
    _mfStore.error = t('txt_match_format_completed_needs_score');
    return;
  }
  if (resetToDefault && !_mfStore.isMexRound && _mfStore.completed && _mfStore.threeSets
      && _mfStore.originalDecider !== _mfStore.globalDecider) {
    // Resetting the decider of a three-set score also changes what it means.
    _mfStore.draft.decider = _mfStore.globalDecider;
    _mfStore.error = t('txt_match_format_completed_needs_sets');
    return;
  }

  // Optimistic: show the new input mode on the row right away.
  // The live mode switch already set a local mode; drop it so the saved
  // override drives the row, and restore it if the save fails.
  const prevLocal = _matchModeLocal.get(modeKey);
  _matchModeLocal.delete(modeKey);
  const prevMode = prevLocal || _matchInputMode(entry.m, ctx, null, modeKey);
  const nextMode = resetToDefault ? _stageScoreMode(ctx) : (override?.mode || _stageScoreMode(ctx));
  if (_isSetCtx(ctx)) _applyMatchRowMode(modeKey, nextMode);

  _mfStore.saving = true;
  _mfStore.error = '';
  try {
    const res = await api(`/api/tournaments/${currentTid}/matches/${matchId}/format`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    _mfStore.saving = false;
    _closeMatchFormatPopover();
    if (body.score1 !== undefined) {
      _recordActivity(`${t('txt_admin_toast_score_saved')} (${body.score1}–${body.score2})`);
      await _rerenderCurrentViewPreserveDrafts();
    } else if (body.sets !== undefined) {
      _recordActivity(`${t('txt_admin_toast_score_saved')} (${formatSetScore(body.sets, override?.decider, ' / ')})`);
      await _rerenderCurrentViewPreserveDrafts();
    } else if (!_replaceMatchCard(res.match, ctx)) {
      await _rerenderCurrentViewPreserveDrafts();
    } else if (currentTid) {
      fetch(`/api/tournaments/${currentTid}/version`)
        .then(r => r.json())
        .then(d => { _adminLastKnownVersion = d.version; })
        .catch(() => {});
    }
  } catch (e) {
    _mfStore.saving = false;
    if (_isSetCtx(ctx)) {
      if (prevLocal) _matchModeLocal.set(modeKey, prevLocal);
      _applyMatchRowMode(modeKey, prevMode);
    }
    _mfStore.error = e.message;
    _showToast(e.message, 'error');
  }
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
  // Re-apply match filter if active
  if (_gpMatchFilterState !== 'all') _applyMatchFilter(_gpMatchFilterState);
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
              // Re-apply filter if active
              if (_gpMatchFilterState !== 'all') _applyMatchFilter(_gpMatchFilterState);
              // Update per-group match summary counts and nav-bar indicators
              for (const [gn, gm] of Object.entries(groups.matches)) {
                const gPending = gm.filter(mm => mm.status !== 'completed').length;
                const gTotal = gm.length;
                const detailsEl = document.getElementById('gp-matches-' + gn);
                if (detailsEl) {
                  const countEl = detailsEl.querySelector('.matches-summary-count');
                  if (countEl) countEl.textContent = `(${gPending} / ${gTotal})`;
                }
                // Update nav button indicator
                const navBtn = document.querySelector(`.group-nav-btn[onclick*="'${gn}'"]`);
                if (navBtn) {
                  navBtn.classList.toggle('has-pending', gPending > 0);
                  navBtn.classList.toggle('all-done', gPending === 0);
                }
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
      // Espejo: a result can seed the Losers Bracket (new cards) or finish the tournament.
      if (status.phase !== _gpCurrentPhase || status.espejo) {
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
      if (status.phase !== _poCurrentPhase || status.espejo) {
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
  'gp-group':        { points: 'gp/record-group',           tennis: 'gp/record-group-tennis' },
  'gp-playoff':      { points: 'gp/record-playoff',         tennis: 'gp/record-playoff-tennis' },
  // Espejo: the engine routes by match id, so Losers (and legacy Super Final) matches use the same endpoints.
  'gp-espejo-losers':{ points: 'gp/record-playoff',         tennis: 'gp/record-playoff-tennis' },
  'gp-espejo-super-final':{ points: 'gp/record-playoff',    tennis: 'gp/record-playoff-tennis' },
  'mex-playoff':     { points: 'mex/record-playoff',        tennis: 'mex/record-playoff-tennis' },
  'mex':             { points: 'mex/record',                 tennis: null },
  'po-playoff':      { points: 'po/record',                  tennis: 'po/record-tennis' },
  'po-espejo-losers':{ points: 'po/record',                  tennis: 'po/record-tennis' },
  'po-espejo-super-final':{ points: 'po/record',             tennis: 'po/record-tennis' },
};

function _scoreApiPath(ctx, isTennis) {
  const entry = _SCORE_ENDPOINTS[ctx] || _SCORE_ENDPOINTS['mex'];
  return `/api/tournaments/${currentTid}/${isTennis ? entry.tennis : entry.points}`;
}

/**
 * Id of the next pending, scoreable match after *matchId* in the same card,
 * or null.  Read before a save so focus can move on once the row re-renders.
 */
function _nextPendingMatchId(matchId) {
  const card = document.getElementById('mcard-' + matchId);
  if (!card || card.dataset.status !== 'pending') return null;
  const container = card.closest('.card') || card.parentElement;
  if (!container) return null;
  const rows = Array.from(container.querySelectorAll('.match-card-wrap[data-status="pending"]'));
  for (const row of rows.slice(rows.indexOf(card) + 1)) {
    if (row.style.display === 'none' || row.classList.contains('match-tbd-disabled')) continue;
    if (row.querySelector('#score-input-' + row.id.slice(6))) return row.id.slice(6);
  }
  return null;
}

/** Move focus to the first score box of a pending match row. */
function _focusMatchScoreInput(matchId) {
  if (!matchId) return;
  const box = document.getElementById('score-input-' + matchId);
  if (_focusFirstScoreInput(box, { preventScroll: true })) {
    document.getElementById('mcard-' + matchId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function submitScore(matchId, ctx) {
  const s1 = +document.getElementById('s1-' + matchId).value;
  const s2 = +document.getElementById('s2-' + matchId).value;
  const nextId = _nextPendingMatchId(matchId);
  try {
    await api(_scoreApiPath(ctx, false), {
      method: 'POST', body: JSON.stringify({ match_id: matchId, score1: s1, score2: s2 })
    });
    _recordActivity(`${t('txt_admin_toast_score_saved')} (${s1}–${s2})`);
    _matchModeLocal.delete(matchId);
    await _surgicalScoreUpdate(matchId, ctx);
    _focusMatchScoreInput(nextId);
  } catch (e) { _showToast(e.message, 'error'); }
}

function _renderTennisSetInputs(matchId, numSets, decider = 'full_set') {
  let html = '';
  for (let i = 0; i < numSets; i++) {
    const isLastSet = i === numSets - 1;
    const isTb = isLastSet && i === 2 && decider === 'match_tiebreak';
    const maxAttr = isLastSet ? '' : ' max="7"';
    html += `<div class="tennis-set-row">`;
    html += isTb
      ? `<span class="tennis-set-label is-tb" title="${escAttr(t('txt_match_tb_rule'))}">${esc(t('txt_match_tb_label'))}:</span>`
      : `<span class="tennis-set-label">S${i + 1}:</span>`;
    html += `<input class="tennis-set-input" inputmode="numeric" pattern="[0-9]*" type="number" id="ts1-${matchId}-${i}" min="0"${maxAttr} value="" placeholder="0" onkeydown="_scoreKeydown(event)">`;
    html += `<span class="tennis-set-sep">-</span>`;
    html += `<input class="tennis-set-input" inputmode="numeric" pattern="[0-9]*" type="number" id="ts2-${matchId}-${i}" min="0"${maxAttr} value="" placeholder="0" onkeydown="_scoreKeydown(event)">`;
    html += `</div>`;
  }
  return html;
}

/** Change the tournament default third-set decider (tv_settings.set_decider). */
async function _setDefaultDecider(decider) {
  if (decider !== 'full_set' && decider !== 'match_tiebreak') return;
  _gpSetDecider = decider;
  _updateTvSetting('set_decider', decider);
  if (currentType === 'group_playoff' || currentType === 'mexicano' || currentType === 'playoff') {
    await _rerenderCurrentViewPreserveDrafts();
  }
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
    if (s1Winner === 0) { _showToast(t('txt_txt_set_equal_scores', { n: 1 }), 'error'); return; }
    if (s2Winner === 0) { _showToast(t('txt_txt_set_equal_scores', { n: 2 }), 'error'); return; }
    if (s1Winner === s2Winner) { _showToast(t('txt_txt_third_set_needs_split'), 'error'); return; }
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
  if (sets.length === 0) { _showToast(t('txt_txt_enter_at_least_one_set_score'), 'error'); return; }

  const nextId = _nextPendingMatchId(matchId);
  try {
    await api(_scoreApiPath(ctx, true), {
      method: 'POST', body: JSON.stringify({ match_id: matchId, sets })
    });
    _recordActivity(`${t('txt_admin_toast_score_saved')} (${formatSetScore(sets, _matchDecider(_matchRowCache.get(matchId)?.m), ' / ')})`);
    _matchModeLocal.delete(matchId);
    await _surgicalScoreUpdate(matchId, ctx);
    _focusMatchScoreInput(nextId);
  } catch (e) { _showToast(e.message, 'error'); }
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
    _recordActivity(t('txt_admin_toast_round_generated'));
    _showAdminToast(t('txt_admin_toast_round_generated'), { duration: 3000 });
    renderGP();
  } catch (e) { alert(e.message); }
}

async function proposeGpPlayoffs() {
  try {
    const data = await api(`/api/tournaments/${currentTid}/gp/recommend-playoffs`);
    _gpRecommended = data.recommended_participants || [];
    _gpAdvancingIds = new Set(_gpRecommended.map(r => r.player_id));
    _gpExternalParticipants = [];
    _gpPlayoffTeamMode = false;
    _gpPlayoffTeams = [];
    _gpPlayoffFormat = 'single';
    _gpSplitInit();
    const section = document.getElementById('gp-playoffs-section');
    if (section) section.innerHTML = _renderGpPlayoffEditor();
  } catch (e) { alert(e.message); }
}

// ─── Oro / Plata split (Espejo by group position) ─────────
let _gpPlayoffFormat = 'single';   // 'single' | 'double' | 'espejo_split' (Oro / Plata replaces classic Espejo here)
let _gpSplitAssign = {};           // player_id -> 'oro' | 'plata' | 'out'
let _gpSplitCutoff = 1;            // quick-helper value: places 1..N go to Oro

/** Recommended rows grouped by group name, each group in group-rank order. */
function _gpRowsByGroup() {
  const byGroup = {};
  for (const r of _gpRecommended) {
    if (!byGroup[r.group]) byGroup[r.group] = [];
    byGroup[r.group].push(r);
  }
  for (const rows of Object.values(byGroup)) rows.sort((a, b) => (a.group_rank || 0) - (b.group_rank || 0));
  return byGroup;
}

/** Default pre-selection: ranks 1..ceil(size/2) of every group go to Oro, the rest to Plata. */
function _gpSplitInit() {
  _gpSplitAssign = {};
  let maxSize = 0;
  for (const rows of Object.values(_gpRowsByGroup())) {
    const half = Math.ceil(rows.length / 2);
    maxSize = Math.max(maxSize, rows.length);
    rows.forEach((r, i) => { _gpSplitAssign[r.player_id] = i < half ? 'oro' : 'plata'; });
  }
  _gpSplitCutoff = Math.max(1, Math.ceil(maxSize / 2));
}

/** Cut-off helper: places 1..K to Oro, the rest to Plata, in every group. */
function _gpSplitApplyCutoff(value) {
  const k = Math.max(0, parseInt(value, 10) || 0);
  _gpSplitCutoff = k;
  for (const rows of Object.values(_gpRowsByGroup())) {
    rows.forEach((r, i) => { _gpSplitAssign[r.player_id] = i < k ? 'oro' : 'plata'; });
  }
  document.querySelectorAll('select[data-split-pid]').forEach(sel => {
    sel.value = _gpSplitAssign[sel.dataset.splitPid] || 'out';
  });
  _gpUpdatePlayoffMatchCount();
}

function _gpSplitSet(pid, value) {
  _gpSplitAssign[pid] = value;
  _gpUpdatePlayoffMatchCount();
}

/** Number of bracket entries (teams) per bucket; individual mode pairs players up. */
function _gpSplitCounts() {
  const n = { oro: 0, plata: 0 };
  for (const r of _gpRecommended) {
    const side = _gpSplitAssign[r.player_id];
    if (side === 'oro' || side === 'plata') n[side] += 1;
  }
  const entries = v => (_gpTeamMode ? v : Math.floor(v / 2));
  return { players: n, oro: entries(n.oro), plata: entries(n.plata) };
}

/** Warnings that would make the server reject the split (shown live and before submit). */
function _gpSplitWarnings(thirdOro = false, thirdPlata = false) {
  const c = _gpSplitCounts();
  const warns = [];
  const label = { oro: t('txt_split_gold'), plata: t('txt_split_silver') };
  for (const side of ['oro', 'plata']) {
    if (!_gpTeamMode && c.players[side] % 2 !== 0) warns.push(t('txt_split_warn_odd', { bracket: label[side] }));
    else if (c[side] < 2) warns.push(t('txt_split_warn_min', { bracket: label[side] }));
  }
  if (thirdOro && c.oro < 4) warns.push(t('txt_split_warn_third', { bracket: label.oro }));
  if (thirdPlata && c.plata < 4) warns.push(t('txt_split_warn_third', { bracket: label.plata }));
  return warns;
}

/** Rows of the Oro / Plata / Out assignment editor, one box per group. */
function _renderGpSplitEditor() {
  let html = `<p class="panel-intro">${t('txt_split_intro')}</p>`;
  html += `<div class="gp-split-cutoff">`;
  html += `<label for="gp-split-cutoff">${t('txt_split_cutoff')}</label>`;
  html += `<input type="number" id="gp-split-cutoff" min="0" value="${_gpSplitCutoff}" inputmode="numeric" pattern="[0-9]*" class="playoff-editor-score-input" onchange="_gpSplitApplyCutoff(this.value)">`;
  html += `</div>`;
  html += `<div class="settings-help">${t('txt_split_cutoff_hint')}</div>`;
  html += `<div class="gp-groups-container">`;
  for (const [gName, rows] of Object.entries(_gpRowsByGroup())) {
    html += `<div class="gp-group-box">`;
    html += `<div class="gp-group-title">${esc(gName)}</div>`;
    for (const r of rows) {
      const cur = _gpSplitAssign[r.player_id] || 'out';
      html += `<div class="gp-player-row gp-split-row">`;
      html += `<span class="gp-split-rank">${r.group_rank}</span>`;
      html += `<span class="gp-player-name">${esc(r.player)}</span>`;
      html += `<span class="gp-player-stats">${_gpPlayerStatsText(r)}</span>`;
      html += `<select class="gp-split-select" data-split-pid="${escAttr(r.player_id)}" aria-label="${escAttr(r.player)}" onchange="_gpSplitSet(this.dataset.splitPid, this.value)">`;
      for (const [val, key] of [['oro', 'txt_split_gold'], ['plata', 'txt_split_silver'], ['out', 'txt_split_out']]) {
        html += `<option value="${val}"${cur === val ? ' selected' : ''}>${esc(t(key))}</option>`;
      }
      html += `</select>`;
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  html += `<div class="gp-split-summary" id="gp-split-summary" aria-live="polite"></div>`;
  return html;
}

/** Wins and score-difference text shared by the checkbox and split editors. */
function _gpPlayerStatsText(r) {
  const _usesSets = r.sets_won > 0 || r.sets_lost > 0;
  const _diffPart = _usesSets
    ? `${t('txt_txt_sd_abbrev')}: ${r.sets_diff >= 0 ? '+' : ''}${r.sets_diff}, diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}`
    : `diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}`;
  return `${r.wins} ${t('txt_txt_w_abbrev')}, ${_diffPart}`;
}

function _renderGpPlayoffEditor() {
  let html = `<div class="card">`;
  html += `<h2>${t('txt_txt_configure_gp_playoffs')}</h2>`;
  const isSplit = _gpPlayoffFormat === 'espejo_split';

  // Format selector first: the split format swaps the whole participant section.
  html += `<div class="gp-format-row">`;
  html += `<div class="form-group"><label>${t('txt_txt_format')}</label><select id="gp-playoff-format" onchange="_gpPlayoffFormatChanged()">` +
    [['single', 'txt_txt_single_elimination'], ['double', 'txt_txt_double_elimination'], ['espejo_split', 'txt_txt_espejo_split_format']]
      .map(([v, k]) => `<option value="${v}"${_gpPlayoffFormat === v ? ' selected' : ''}>${t(k)}</option>`).join('') +
    `</select></div>`;
  html += `</div>`;

  if (isSplit) {
    html += _renderGpSplitEditor();
  } else {
  html += `<p class="panel-intro">${t('txt_txt_select_advancing_players')}</p>`;

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
      html += `<span class="gp-player-stats">${_gpPlayerStatsText(r)}</span>`;
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
    html += `<input type="number" value="${ep.score}" class="playoff-editor-score-input" inputmode="numeric" pattern="[0-9]*" onchange="_gpUpdateExternalScore(${i}, this.value)">`;
    html += `<button type="button" class="btn btn-sm btn-muted playoff-editor-remove-btn" onclick="_gpRemoveExternal(${i})">✕</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `<div class="gp-external-add-row">`;
  html += `<input type="text" id="gp-external-name" placeholder="${t('txt_txt_add_external_participant')}" onkeydown="if(event.key==='Enter')_gpAddExternal()">`;
  html += `<input type="number" id="gp-external-score" class="playoff-editor-score-input" inputmode="numeric" pattern="[0-9]*" placeholder="${t('txt_txt_score')}" value="0">`;
  html += `<button type="button" class="btn btn-sm btn-primary" onclick="_gpAddExternal()">+</button>`;
  html += `</div>`;
  html += `</div>`;
  }
  // Number of winners (single elimination) + optional 3rd-place match
  html += `<div class="gp-format-row" id="gp-winners-row">`;
  html += `<div class="form-group"><label for="gp-num-winners">${t('txt_num_winners')}</label><select id="gp-num-winners" onchange="_gpWinnerControlsChanged('gp')"><option value="1">${esc(t('txt_num_winners_champion'))}</option></select>`;
  html += `<div class="settings-help">${t('txt_num_winners_hint')}</div></div>`;
  html += `</div>`;
  html += `<div class="d-flex items-center gap-2 mt-1" id="gp-third-row">`;
  html += `<input type="checkbox" id="gp-third-place" class="cursor-pointer" onchange="_gpUpdatePlayoffMatchCount()">`;
  html += `<label for="gp-third-place" class="fs-md cursor-pointer">${t(isSplit ? 'txt_split_gold_third_place' : 'txt_third_place_match')}</label>`;
  html += `</div>`;
  if (isSplit) {
    html += `<div class="d-flex items-center gap-2 mt-1" id="gp-plata-third-row">`;
    html += `<input type="checkbox" id="gp-plata-third-place" class="cursor-pointer" onchange="_gpUpdatePlayoffMatchCount()">`;
    html += `<label for="gp-plata-third-place" class="fs-md cursor-pointer">${t('txt_split_silver_third_place')}</label>`;
    html += `</div>`;
  }
  html += `<div class="gp-playoff-match-estimate" id="gp-playoff-match-estimate"></div>`;
  setTimeout(_gpUpdatePlayoffMatchCount, 0);

  // Playoff team mode toggle — shown for tennis individual tournaments
  const _gpIsIndividualTennis = _gpSport === 'tennis' && (!_gpTeamRoster || Object.keys(_gpTeamRoster).length === 0);
  if (_gpIsIndividualTennis && !isSplit) {
    html += `<div class="gp-format-row mt-2">`;
    html += `<div class="form-group"><label>${t('txt_txt_playoff_mode')}</label>`;
    html += `<div class="score-mode-toggle" id="gp-playoff-team-toggle">`;
    html += `<button type="button" class="${!_gpPlayoffTeamMode ? 'active' : ''}" onclick="_gpSetPlayoffTeamMode(false)">${t('txt_txt_individual_mode')}</button>`;
    html += `<button type="button" class="${_gpPlayoffTeamMode ? 'active' : ''}" onclick="_gpSetPlayoffTeamMode(true)">${t('txt_txt_team_mode_short')}</button>`;
    html += `</div></div>`;
    html += `</div>`;
    html += `<div id="gp-playoff-teams-section" class="mt-2" style="display:${_gpPlayoffTeamMode ? '' : 'none'}">`;
    html += `<div id="gp-playoff-teams-container"></div>`;
    html += `<div class="d-flex gap-2 flex-wrap mt-1-5">`;
    html += `<button type="button" class="add-participant-btn flex-1" onclick="_gpAddPlayoffTeam()">+ ${t('txt_txt_add_team')}</button>`;
    html += `<button type="button" class="btn btn-sm btn-muted" onclick="_gpAutoPlayoffTeams()">${t('txt_conv_auto_pair')}</button>`;
    html += `</div>`;
    html += `</div>`;
  }

  // Courts + action buttons
  html += _renderCourtsSection(_gpCurrentCourts, `/api/tournaments/${currentTid}/gp/courts`);
  html += `<div class="decision-actions-row">`;
  html += `<button type="button" class="btn btn-success btn-lg-action" onclick="withLoading(this,_confirmGpPlayoffs)">${_ic('trophy')} ${t('txt_txt_start_playoffs')}</button>`;
  html += `<button type="button" class="btn btn-muted btn-lg-action" onclick="renderGP()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _gpToggleAdvancing(cb) {
  if (cb.checked) _gpAdvancingIds.add(cb.value);
  else _gpAdvancingIds.delete(cb.value);
  _gpUpdatePlayoffMatchCount();
}

function _gpPlayoffFormatChanged() {
  const next = document.getElementById('gp-playoff-format')?.value || 'single';
  const switchesSplit = (next === 'espejo_split') !== (_gpPlayoffFormat === 'espejo_split');
  _gpPlayoffFormat = next;
  if (switchesSplit) {
    // The participant section differs between the modes: re-render the editor.
    const section = document.getElementById('gp-playoffs-section');
    if (section) section.innerHTML = _renderGpPlayoffEditor();
    return;
  }
  _gpUpdatePlayoffMatchCount();
}

/** Winner-count select changed ('gp' or 'po'): force/clear the 3rd-place box, refresh the estimate. */
function _gpWinnerControlsChanged(prefix) {
  const sel = document.getElementById(`${prefix}-num-winners`);
  const third = document.getElementById(`${prefix}-third-place`);
  if (sel && third) {
    const nw = +sel.value || 1;
    if (nw === 3) third.checked = true;
    else if (nw > 1) third.checked = false;
    third.disabled = nw !== 1;
  }
  if (prefix === 'po') _updatePoMatchEstimate();
  else _gpUpdatePlayoffMatchCount();
}

function _gpNextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Returns the number of simultaneous matches per round for single elimination.
// numWinners truncates the bracket (2 = stop after the semi-finals, 4 = after the
// quarter-finals, 3 = semi-finals + 3rd-place match); thirdPlace adds the 3rd-place
// match (played alongside the final, or after the semi-finals when numWinners is 3).
function _gpSingleElimSequence(n, numWinners = 1, thirdPlace = false) {
  if (n < 2) return [];
  const p = _gpNextPowerOfTwo(n);
  let seq = [];
  const r1 = n - p / 2;
  if (r1 > 0) seq.push(r1);
  let r = p / 4;
  while (r >= 1) { seq.push(r); r = Math.floor(r / 2); }
  const cut = numWinners === 3 ? 1 : Math.round(Math.log2(Math.max(1, numWinners)));
  if (cut > 0 && seq.length > cut) seq = seq.slice(0, seq.length - cut);
  if (thirdPlace && n >= 4) {
    if (numWinners === 3) seq.push(1);
    else seq[seq.length - 1] += 1;
  }
  return seq;
}

/**
 * Valid "number of winners" choices for a single-elimination bracket of n teams:
 * powers of two up to half the bracket size, plus 3 (semi-finals + 3rd-place match).
 * Each option carries a label naming the stopping round.
 */
function _gpWinnerOptions(n) {
  const opts = [];
  if (n < 2) return [{ value: 1, label: t('txt_num_winners_champion') }];
  const half = Math.max(1, _gpNextPowerOfTwo(n) / 2);
  for (let k = 1; k <= half; k *= 2) {
    let label;
    if (k === 1) label = t('txt_num_winners_champion');
    else if (k === 2) label = t('txt_num_winners_sf', { n: k });
    else if (k === 4) label = t('txt_num_winners_qf', { n: k });
    else label = t('txt_num_winners_round', { n: k, r: k * 2 });
    opts.push({ value: k, label });
  }
  if (n >= 4) opts.push({ value: 3, label: t('txt_num_winners_three') });
  return opts.sort((a, b) => a.value - b.value);
}

/**
 * Populate / show the "Number of winners" select and 3rd-place checkbox for a form
 * prefix ('po' or 'gp') from the team count and chosen format. Multi-winner is
 * single-elimination only; the 3rd-place match exists for single elimination and
 * Espejo, is forced on for 3 winners, and is unavailable for 2 / 4+ winners.
 */
function _gpRefreshWinnerControls(prefix, n, format) {
  const sel = document.getElementById(`${prefix}-num-winners`);
  const third = document.getElementById(`${prefix}-third-place`);
  const winnersRow = document.getElementById(`${prefix}-winners-row`);
  const thirdRow = document.getElementById(`${prefix}-third-row`);
  if (!sel || !third) return;
  const single = format === 'single';
  const canThird = (single || format === 'espejo' || format === 'espejo_split') && n >= 4;
  if (!single) {
    sel.innerHTML = `<option value="1">${esc(t('txt_num_winners_champion'))}</option>`;
    sel.value = '1';
  } else {
    const prev = +sel.value || 1;
    const opts = _gpWinnerOptions(n);
    sel.innerHTML = opts.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
    sel.value = String(opts.some(o => o.value === prev) ? prev : 1);
  }
  sel.disabled = !single;
  if (winnersRow) winnersRow.classList.toggle('hidden', !single);
  const nw = +sel.value || 1;
  if (nw === 3) { third.checked = true; }
  else if (nw > 1 || !canThird) { third.checked = false; }
  third.disabled = !canThird || nw !== 1;
  if (thirdRow) thirdRow.classList.toggle('hidden', !canThird || (nw > 1 && nw !== 3));
}

/** Read the chosen { num_winners, third_place } for a form prefix ('po' or 'gp'). */
function _gpReadWinnerControls(prefix) {
  const sel = document.getElementById(`${prefix}-num-winners`);
  const third = document.getElementById(`${prefix}-third-place`);
  const winnersRow = document.getElementById(`${prefix}-winners-row`);
  const thirdRow = document.getElementById(`${prefix}-third-row`);
  const nw = (sel && !sel.disabled && !(winnersRow && winnersRow.classList.contains('hidden'))) ? (+sel.value || 1) : 1;
  const tp = !!(third && third.checked && !(thirdRow && thirdRow.classList.contains('hidden')));
  return { num_winners: nw, third_place: tp };
}

// Returns separate { wbSeq, lbSeq } for double elimination so WB and LB rows
// can be displayed independently. LB rounds run alongside WB from R2 onward;
// remaining LB rounds (where WB champion waits) are appended to lbSeq.
function _gpDeSequences(n) {
  if (n < 2) return { wbSeq: [1], lbSeq: [] };
  const wbSeq = _gpSingleElimSequence(n);
  const lbDuring = [];
  let lbTeams = wbSeq[0];
  for (let k = 1; k < wbSeq.length; k++) {
    const lbMatches = Math.floor(lbTeams / 2);
    lbDuring.push(lbMatches);
    lbTeams = (lbTeams - lbMatches) + wbSeq[k];
  }
  const lbAfter = [];
  while (lbTeams > 1) {
    const lbMatches = Math.floor(lbTeams / 2);
    lbAfter.push(lbMatches);
    lbTeams -= lbMatches;
  }
  return { wbSeq, lbSeq: [...lbDuring, ...lbAfter] };
}

// Returns separate { wbSeq, lbSeq } for espejo — WB has all n teams (single
// elim), LB is seeded with R1 WB losers and runs as its own single elim.
function _gpEspejoSequences(n, thirdPlace = false) {
  const p = _gpNextPowerOfTwo(n);
  const wbSeq = _gpSingleElimSequence(n, 1, thirdPlace);
  const lbTeams = n - p / 2;
  const lbSeq = lbTeams >= 2 ? _gpSingleElimSequence(lbTeams) : [];
  return { wbSeq, lbSeq };
}

// Oro / Plata: two independent single-elimination brackets that run side by side.
function _gpEspejoSplitSequences(nOro, nPlata, thirdOro = false, thirdPlata = false) {
  return {
    oroSeq: _gpSingleElimSequence(nOro, 1, thirdOro),
    plataSeq: _gpSingleElimSequence(nPlata, 1, thirdPlata),
  };
}

function _gpFormatConcurrencySeq(seq) {
  if (!seq || seq.length === 0) return '';
  if (seq.every(v => v === seq[0])) return `${seq[0]}/round`;
  return seq.join(' → ');
}

function _gpEstimatePlayoffMatches(n, format, numWinners = 1, thirdPlace = false) {
  if (n < 2) return 0;
  const third = thirdPlace && n >= 4 ? 1 : 0;
  // Truncating to N winners removes the last rounds (N-1 matches); 3 winners drop only the final.
  const removed = numWinners === 3 ? 1 : Math.max(0, numWinners - 1);
  if (format === 'single') return n - 1 - removed + third;
  if (format === 'double') return 2 * (n - 1);
  if (format === 'espejo') {
    const lbTeams = n - _gpNextPowerOfTwo(n) / 2;
    return (n - 1) + Math.max(0, lbTeams - 1) + third;
  }
  return n - 1;
}

/** Number of bracket entries the GP play-off will have (individual mode pairs players up). */
function _gpPlayoffEntryCount() {
  const raw = _gpAdvancingIds.size + _gpExternalParticipants.length;
  if (_gpPlayoffTeamMode && _gpPlayoffTeams.length > 0) {
    const valid = _gpPlayoffTeams.filter(team => team.every(pid => pid)).length;
    if (valid > 0) return valid;
  }
  return _gpTeamMode ? raw : Math.floor(raw / 2);
}

function _gpUpdatePlayoffMatchCount() {
  const el = document.getElementById('gp-playoff-match-estimate');
  if (!el) return;
  const format = document.getElementById('gp-playoff-format')?.value || 'single';
  if (format === 'espejo_split') { _gpUpdateSplitEstimate(el); return; }
  const n = _gpPlayoffEntryCount();
  _gpRefreshWinnerControls('gp', n, format);
  if (n < 2) { el.innerHTML = ''; return; }

  const { num_winners: numWinners, third_place: thirdPlace } = _gpReadWinnerControls('gp');
  const count = _gpEstimatePlayoffMatches(n, format, numWinners, thirdPlace);
  const matchText = `~${count} ${t('txt_txt_matches')}`;

  function branchRow(label, seq, suffix) {
    const seqStr = seq.join(' → ');
    return `<div class="gp-playoff-branch">` +
      `<span class="gp-playoff-branch-label">${label}</span>` +
      `<span>${seqStr}${suffix ? ` · ${suffix}` : ''}</span>` +
      `</div>`;
  }

  if (format === 'single') {
    const seqStr = _gpFormatConcurrencySeq(_gpSingleElimSequence(n, numWinners, thirdPlace));
    el.textContent = seqStr ? `${matchText} · ${seqStr}` : matchText;
  } else if (format === 'double') {
    const { wbSeq, lbSeq } = _gpDeSequences(n);
    el.innerHTML = `<span class="gp-playoff-estimate-count">${matchText}</span>` +
      `<div class="gp-playoff-branches">` +
      branchRow('WB', wbSeq, '') +
      branchRow('LB', lbSeq, 'GF') +
      `</div>`;
  } else {
    const { wbSeq, lbSeq } = _gpEspejoSequences(n, thirdPlace);
    el.innerHTML = `<span class="gp-playoff-estimate-count">${matchText}</span>` +
      `<div class="gp-playoff-branches">` +
      branchRow('WB', wbSeq, '') +
      (lbSeq.length ? branchRow('LB', lbSeq, '') : '') +
      `</div>`;
  }
}

/** Counts, warnings and match estimate of the Oro / Plata editor. */
function _gpUpdateSplitEstimate(el) {
  const c = _gpSplitCounts();
  // The Oro checkbox reuses the shared 3rd-place control; Plata has its own.
  _gpRefreshWinnerControls('gp', c.oro, 'espejo_split');
  const plataBox = document.getElementById('gp-plata-third-place');
  const plataRow = document.getElementById('gp-plata-third-row');
  if (plataBox) {
    const can = c.plata >= 4;
    if (!can) plataBox.checked = false;
    plataBox.disabled = !can;
    if (plataRow) plataRow.classList.toggle('hidden', !can);
  }
  const thirdOro = _gpReadWinnerControls('gp').third_place;
  const thirdPlata = !!(plataBox && plataBox.checked);

  const summary = document.getElementById('gp-split-summary');
  if (summary) {
    let h = `<span>${esc(t('txt_split_count', { bracket: t('txt_split_gold'), n: c.oro }))}</span>` +
      `<span>${esc(t('txt_split_count', { bracket: t('txt_split_silver'), n: c.plata }))}</span>`;
    for (const w of _gpSplitWarnings(thirdOro, thirdPlata)) h += `<span class="gp-split-warning" role="alert">${esc(w)}</span>`;
    summary.innerHTML = h;
  }

  const total = _gpEstimatePlayoffMatches(c.oro, 'single', 1, thirdOro) + _gpEstimatePlayoffMatches(c.plata, 'single', 1, thirdPlata);
  if (c.oro < 2 || c.plata < 2) { el.innerHTML = ''; return; }
  const { oroSeq, plataSeq } = _gpEspejoSplitSequences(c.oro, c.plata, thirdOro, thirdPlata);
  const row = (label, seq) => `<div class="gp-playoff-branch"><span class="gp-playoff-branch-label">${esc(label)}</span><span>${seq.join(' → ')}</span></div>`;
  el.innerHTML = `<span class="gp-playoff-estimate-count">~${total} ${t('txt_txt_matches')}</span>` +
    `<div class="gp-playoff-branches">${row(t('txt_split_gold'), oroSeq)}${row(t('txt_split_silver'), plataSeq)}</div>`;
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

// ─── GP Playoff Team Composition (for tennis individual → team playoffs) ──

let _gpPlayoffTeamMode = false;
let _gpPlayoffTeams = [];  // [[pid1, pid2], ...]

function _gpSetPlayoffTeamMode(isTeam) {
  _gpPlayoffTeamMode = isTeam;
  const toggle = document.getElementById('gp-playoff-team-toggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === (isTeam ? 1 : 0)));
  }
  const section = document.getElementById('gp-playoff-teams-section');
  if (section) section.style.display = isTeam ? '' : 'none';
  if (isTeam && _gpPlayoffTeams.length === 0) _gpAutoPlayoffTeams();
}

function _gpAutoPlayoffTeams() {
  const ids = [..._gpAdvancingIds];
  _gpPlayoffTeams = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    _gpPlayoffTeams.push([ids[i], ids[i + 1]]);
  }
  _gpRenderPlayoffTeams();
}

function _gpAddPlayoffTeam() {
  _gpPlayoffTeams.push(['', '']);
  _gpRenderPlayoffTeams();
}

function _gpRemovePlayoffTeam(idx) {
  if (_gpPlayoffTeams.length <= 1) return;
  _gpPlayoffTeams.splice(idx, 1);
  _gpRenderPlayoffTeams();
}

function _gpRenderPlayoffTeams() {
  const container = document.getElementById('gp-playoff-teams-container');
  if (!container) return;
  // Collect names for the advancing players
  const nameMap = {};
  for (const r of _gpRecommended) nameMap[r.player_id] = r.player;
  for (const ep of _gpExternalParticipants) nameMap[`ext_${ep.name}`] = ep.name;
  const allIds = [..._gpAdvancingIds, ..._gpExternalParticipants.map(ep => `ext_${ep.name}`)];
  const assigned = new Set(_gpPlayoffTeams.flat().filter(Boolean));

  let html = '';
  _gpPlayoffTeams.forEach((team, idx) => {
    html += `<div class="conv-team-row">`;
    html += `<div class="d-flex items-center gap-2 mb-1-5">`;
    html += `<span class="fs-sm fw-700 text-muted">${t('txt_conv_team')} ${idx + 1}</span>`;
    html += `<button type="button" class="participant-remove-btn" onclick="_gpRemovePlayoffTeam(${idx})" title="${t('txt_txt_remove')}">×</button>`;
    html += `</div>`;
    html += `<div class="d-flex gap-1-5 flex-wrap">`;
    team.forEach((pid, mi) => {
      html += `<select data-team="${idx}" data-slot="${mi}" onchange="_gpPlayoffTeams[${idx}][${mi}]=this.value;_gpRenderPlayoffTeams()" class="playoff-team-select">`;
      html += `<option value="">—</option>`;
      for (const id of allIds) {
        const taken = assigned.has(id) && id !== pid;
        html += `<option value="${esc(id)}" ${id === pid ? 'selected' : ''} ${taken ? 'disabled class="text-muted"' : ''}>${esc(nameMap[id] || id)}</option>`;
      }
      html += `</select>`;
    });
    html += `</div>`;
    html += `</div>`;
  });

  const unassigned = allIds.filter(id => !assigned.has(id));
  if (unassigned.length > 0) {
    html += `<div class="fs-sm text-muted mt-1">${t('txt_conv_unassigned')}: ${unassigned.map(id => `<span class="fw-600">${esc(nameMap[id] || id)}</span>`).join(', ')}</div>`;
  }
  container.innerHTML = html;
}

async function _confirmGpPlayoffs() {
  const fmt = document.getElementById('gp-playoff-format')?.value || 'single';
  if (fmt === 'espejo_split') return _confirmGpSplitPlayoffs();
  const ids = [..._gpAdvancingIds];
  const extra = _gpExternalParticipants.length > 0
    ? _gpExternalParticipants.map(ep => ({ name: ep.name, score: ep.score }))
    : null;
  const totalParticipants = ids.length + (extra ? extra.length : 0);
  if (totalParticipants < 2) {
    alert(t('txt_txt_team_n_select_both_players', { n: 1 }));
    return;
  }
  const body = {
    advancing_player_ids: ids.length > 0 ? ids : null,
    extra_participants: extra,
    double_elimination: fmt === 'double',
    espejo: fmt === 'espejo',
  };
  const winnerOpts = _gpReadWinnerControls('gp');
  if (fmt !== 'double') {
    body.num_winners = fmt === 'single' ? winnerOpts.num_winners : 1;
    body.third_place = winnerOpts.third_place;
  }
  if (_gpPlayoffTeamMode && _gpPlayoffTeams.length > 0) {
    const validTeams = _gpPlayoffTeams.filter(team => team.every(pid => pid));
    if (validTeams.length < 2) {
      alert(t('txt_txt_need_at_least_2_teams'));
      return;
    }
    body.playoff_teams = validTeams;
  }
  try {
    await api(`/api/tournaments/${currentTid}/gp/start-playoffs`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    _gpRecommended = [];
    _gpAdvancingIds = new Set();
    _gpExternalParticipants = [];
    _gpPlayoffTeamMode = false;
    _gpPlayoffTeams = [];
    renderGP();
  } catch (e) { alert(e.message); }
}

/** Start the Oro / Plata split: explicit per-player bracket lists, nothing else. */
async function _confirmGpSplitPlayoffs() {
  const winnerOpts = _gpReadWinnerControls('gp');
  const plataBox = document.getElementById('gp-plata-third-place');
  const plataThird = !!(plataBox && plataBox.checked && !plataBox.disabled);
  const warnings = _gpSplitWarnings(winnerOpts.third_place, plataThird);
  if (warnings.length > 0) {
    alert(warnings.join('\n'));
    return;
  }
  const pick = side => _gpRecommended.filter(r => _gpSplitAssign[r.player_id] === side).map(r => r.player_id);
  const body = {
    espejo_split: true,
    oro_player_ids: pick('oro'),
    plata_player_ids: pick('plata'),
    third_place: winnerOpts.third_place,
    plata_third_place: plataThird,
  };
  try {
    await api(`/api/tournaments/${currentTid}/gp/start-playoffs`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    _gpRecommended = [];
    _gpAdvancingIds = new Set();
    _gpSplitAssign = {};
    _gpPlayoffFormat = 'single';
    renderGP();
  } catch (e) { alert(e.message); }
}

async function startPlayoffs() {
  // Direct start (backwards compat) — delegates to confirm flow
  await _confirmGpPlayoffs();
}

// ─── Group nav, match filter & court-board jump ───────────

/** Module-level match filter state so it can be preserved across re-renders. */
let _gpMatchFilterState = 'all';
let _gpReviewQueueFilterState = 'all';
let _poReviewQueueFilterState = 'all';

/** Smooth-scroll to a group card and briefly highlight it. */
function _scrollToGroup(gName) {
  const card = document.getElementById('gp-group-card-' + gName);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Smooth-scroll to a playoff round card and briefly highlight it. */
function _scrollToPlayoffRound(roundKey) {
  const card = document.getElementById('po-round-card-' + roundKey);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Display name of an Espejo bracket side (a match's `bracket_side`). */
function _espejoSideLabel(side, isSplit = false) {
  if (side === 'losers') return t(isSplit ? 'txt_txt_espejo_silver_bracket' : 'txt_txt_espejo_losers_bracket');
  if (side === 'super_final') return t('txt_txt_espejo_super_final');
  return t(isSplit ? 'txt_txt_espejo_gold_bracket' : 'txt_txt_espejo_winners_bracket');
}

/**
 * Champion banners for the GP and standalone play-off views.
 * Espejo: the champion is the Winners-bracket champion (shown as soon as the
 * Winners final is played); the Losers-bracket winner is the consolation winner.
 * Legacy tournaments with a Super Final keep its winner as champion.
 */
function _renderChampionAlerts(status) {
  const espejo = status.espejo === true;
  const legacySuperFinal = espejo && status.espejo_super_final === true;
  const champion = status.champion || (espejo && !legacySuperFinal ? status.winners_champion : null);
  let h = '';
  // Several equal winners (multi-winner single elimination): one alert listing every team.
  if (Array.isArray(status.winners) && status.winners.length > 1) {
    return `<div class="alert alert-success">${_ic('trophy')} ${t('txt_winners_word')}: <strong>${status.winners.map(w => esc(w.join(' & '))).join(' · ')}</strong></div>`;
  }
  if (champion) {
    h += `<div class="alert alert-success">${_ic('trophy')} ${t('txt_txt_champion')}: <strong>${esc(champion.join(', '))}</strong></div>`;
  }
  if (espejo && !legacySuperFinal && status.losers_champion) {
    h += `<div class="alert alert-info">${t(status.espejo_split ? 'txt_txt_silver_winner' : 'txt_txt_consolation_winner')}: <strong>${esc(status.losers_champion.join(', '))}</strong></div>`;
  }
  return h;
}

/**
 * Render playoff matches grouped by round_label, mirroring the group-stage
 * pattern: a sticky round nav bar at the top + one collapsible card per round.
 *
 * @param {Array}  matches      - All playoff matches (completed + pending).
 * @param {string} ctx          - Score context for winners matches.
 * @param {string} [losersCtx]  - Score context for losers-bracket matches
 *                                (only relevant for Espejo; defaults to ctx).
 * @returns {string} HTML string.
 */
function _renderPlayoffMatchesByRound(matches, ctx, losersCtx = ctx, superFinalCtx = ctx, isSplit = false) {
  if (!matches || matches.length === 0) return '';

  // Group by round_label, preserving first-seen order (which follows bracket round order).
  // Espejo matches carry bracket_side: Winners and Losers rounds share names
  // ("Semi-Final"), so the side is part of the key and shown as a prefix.
  const roundOrder = [];
  const byRound = {};
  const isEspejoList = matches.some(m => m.bracket_side);
  for (const m of matches) {
    const label = m.round_label || t('txt_txt_match');
    const key = isEspejoList ? `${_espejoSideLabel(m.bracket_side, isSplit)}: ${label}` : label;
    if (!byRound[key]) { byRound[key] = []; roundOrder.push(key); }
    byRound[key].push(m);
  }

  // ── Round nav bar ─────────────────────────────────────────────────────────
  let html = `<div class="group-nav-bar" id="po-round-nav">`;
  // No per-round counts: the status bar carries the current rounds' progress;
  // the pending dot / dimmed done state is enough here.
  for (const key of roundOrder) {
    const pending = byRound[key].some(m => m.status !== 'completed');
    const cls = pending ? 'group-nav-btn has-pending' : 'group-nav-btn all-done';
    html += `<button type="button" class="${cls}" onclick="_scrollToPlayoffRound('${escAttr(key)}')">${esc(key)}</button>`;
  }
  html += `<span class="group-nav-sep" aria-hidden="true"></span>`;
  html += _renderMatchFilterChips(currentTid);
  html += `</div>`;

  // ── One card per round ────────────────────────────────────────────────────
  for (const key of roundOrder) {
    const rMatches = _sortTbdLast(byRound[key]);
    const pending = rMatches.filter(m => m.status !== 'completed').length;
    const total = rMatches.length;
    // Start open when there are pending matches; collapse done rounds.
    const openAttr = pending > 0 ? ' open' : '';

    // Determine effective ctx: use losersCtx for losers, superFinalCtx for super_final.
    const firstSide = rMatches[0]?.bracket_side;
    const roundCtx = firstSide === 'super_final' ? superFinalCtx : (firstSide === 'losers' ? losersCtx : ctx);

    html += `<div class="card" id="po-round-card-${escAttr(key)}">`;
    html += `<details class="group-matches-details"${openAttr}>`;
    html += `<summary>${esc(key)} <span class="matches-summary-count">(${pending} / ${total})</span></summary>`;
    for (const m of rMatches) {
      const mSide = m.bracket_side;
      const mCtx = mSide === 'super_final' ? superFinalCtx : (mSide === 'losers' ? losersCtx : ctx);
      html += matchRow(m, mCtx);
    }
    html += `</details>`;
    html += `</div>`;
  }

  return html;
}

/** Apply match filter: 'all' | 'pending' | 'completed' | 'disputed'.
 *  Toggles display on .match-card-wrap elements via data-status / data-disputed.
 *  Persists per-tournament in sessionStorage. */
function _applyMatchFilter(filter) {
  if (!_MATCH_FILTER_VALUES.has(filter)) filter = 'all';
  _gpMatchFilterState = filter;
  if (typeof currentTid !== 'undefined') _persistMatchFilter(currentTid, filter);
  const root = document.getElementById('view-content');
  if (!root) return;

  // Update toggle button styling on every chip row currently in the DOM.
  for (const toggle of root.querySelectorAll('#gp-match-filter, .match-filter-toggle')) {
    for (const btn of toggle.querySelectorAll('button')) {
      const key = btn.dataset.filter || _legacyFilterKeyFromLabel(btn.textContent.trim());
      btn.classList.toggle('active', key === filter);
    }
  }

  // Show/hide match cards based on data-status / data-disputed.
  for (const card of root.querySelectorAll('.match-card-wrap[data-status]')) {
    let show;
    if (filter === 'all') show = true;
    else if (filter === 'disputed') show = card.dataset.disputed === '1';
    else show = card.dataset.status === filter;
    card.style.display = show ? '' : 'none';
  }
}

/** Legacy fallback: derive a filter key from button text (older chip rows
 *  rendered before this refactor still match by translated label). */
function _legacyFilterKeyFromLabel(label) {
  if (label === t('txt_txt_filter_pending')) return 'pending';
  if (label === t('txt_txt_filter_completed')) return 'completed';
  if (label === t('txt_admin_filter_disputed')) return 'disputed';
  return 'all';
}

/** Scroll to a match card by ID, opening its parent <details> if collapsed, and flash-highlight it.
 *  With *focusInput*, also focus the row's first score box (court board clicks). */
function _scrollToMatch(matchId, focusInput = false) {
  const card = document.getElementById('mcard-' + matchId);
  if (!card) return;

  // Ensure any parent <details> is open
  const details = card.closest('details:not([open])');
  if (details) details.setAttribute('open', '');

  // Ensure the card is visible (undo any filter hiding)
  if (card.style.display === 'none') card.style.display = '';

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Flash highlight
  card.classList.remove('match-highlight');
  // Force reflow so re-adding the class restarts the animation
  void card.offsetWidth;
  card.classList.add('match-highlight');
  card.addEventListener('animationend', () => card.classList.remove('match-highlight'), { once: true });

  if (focusInput) {
    const box = document.getElementById('score-input-' + matchId);
    _focusFirstScoreInput(box, { preventScroll: true });
  }
}

// ─── Render Mexicano ──────────────────────────────────────

mountIsland('#match-format-popover', _mfStore);
document.addEventListener('app-language-changed', (ev) => {
  _mfStore.lang = ev?.detail?.lang || _mfStore.lang;
});
// Click outside the popover (and not on another format chip) closes it.
document.addEventListener('mousedown', (ev) => {
  if (!_mfStore.open) return;
  const target = ev.target;
  if (target.closest?.('#match-format-popover') || target.closest?.('.match-format-btn')) return;
  _closeMatchFormatPopover(false);
});
