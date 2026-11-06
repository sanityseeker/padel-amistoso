let _playerSecrets = {};

/**
 * Render the Hub link/unlink cell for a player row.
 * Three states:
 *   - linked to a real Hub profile  -> "Change" (opens search to re-link) + grey "Unlink"
 *   - linked to a ghost profile     -> blue  "Link" button (opens search; tooltip explains ghost status)
 *   - not linked                    -> blue  "Link" button
 * The same helper is used by the initial render and by the in-place DOM updates
 * after _hubLinkProfile / _hubUnlink so the markup stays consistent.
 */
function _renderHubLinkCellInner(pid, info) {
  // No Player Hub profiles on the demo instance: keep the column, grey it out.
  if (isDemoInstance()) {
    return `<button type="button" class="btn btn-sm player-codes-action-btn pc-hub-link-btn" disabled title="${escAttr(t('txt_demo_not_available'))}">${esc(t('txt_hub_link_btn'))}</button>`;
  }
  const _isLinked = Boolean(info && info.profile_id);
  const _isGhost  = _isLinked && String(info.profile_id).startsWith('ghost_');
  if (_isLinked && !_isGhost) {
    return `<span class="d-flex gap-1 justify-center">`
      + `<button type="button" class="btn btn-sm player-codes-action-btn pc-hub-link-btn" onclick="_hubOpenSearch('${escAttr(pid)}')" title="${escAttr(t('txt_hub_relink_help'))}">${esc(t('txt_hub_relink_btn'))}</button>`
      + `<button type="button" class="btn btn-sm btn-muted player-codes-action-btn" onclick="_hubUnlink('${escAttr(pid)}')" title="${escAttr(t('txt_hub_linked'))}">${esc(t('txt_hub_unlink_btn'))}</button>`
      + `</span>`;
  }
  const _title = _isGhost ? t('txt_pc_past_participant_tooltip') : t('txt_hub_link_help');
  return `<button type="button" class="btn btn-sm btn-primary player-codes-action-btn pc-hub-link-btn" onclick="_hubOpenSearch('${escAttr(pid)}')" title="${escAttr(_title)}">${esc(t('txt_hub_link_btn'))}</button>`;
}

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
 * Body-only player-codes panel for the unified Settings card.
 * Returns the inner table + per-row controls without the outer
 * `<details class="card">` wrapper. The bulk "Send all" action and the
 * organizer-message composer are intentionally omitted — they live in the
 * Communications sub-tab to avoid duplicated DOM ids.
 */
function _renderPlayerCodesBody(secrets) {
  if (!currentTid) return '';
  const entries = Object.entries(secrets || {});
  const _showEmail = window._emailConfigured;
  const _isMex = currentType === 'mexicano';
  const _isGP = currentType === 'group_playoff';

  let html = `<div class="player-codes-body">`;
  html += `<p class="player-codes-help settings-help--explain">${t('txt_txt_player_codes_help')}</p>`;

  if (entries.length > 0) {
    html += `<div class="settings-inline-row mb-2">`;
    html += `<button type="button" class="btn btn-sm player-codes-btn" onclick="_copyAllPlayerCodes(this)">${_ic('copy')} ${t('txt_txt_copy_all_codes')}</button>`;
    html += `<button type="button" class="btn btn-sm player-codes-btn" onclick="_printPlayerCodes()">${_ic('print')} ${t('txt_txt_print_all_codes')}</button>`;
    html += `</div>`;
  }

  if (entries.length === 0) {
    html += `<p class="player-codes-empty">${t('txt_txt_no_player_codes')}</p>`;
  } else {
    html += `<div class="player-codes-table-wrap">`;
    // Phones stack each row into a card (.table-stack): name on top,
    // passphrase + language, contact, then the row's buttons.
    html += `<table class="player-codes-table table-stack">`;
    html += `<thead><tr class="player-codes-head-row">`;
    html += `<th class="player-codes-th">${t('txt_txt_player')}</th>`;
    html += `<th class="player-codes-th">${t('txt_txt_passphrase')}</th>`;
    html += `<th class="player-codes-th">${t('txt_txt_contact')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_hub_link')}</th>`;
    if (_showEmail) html += `<th class="player-codes-th">${t('txt_email')}</th>`;
    html += `<th class="player-codes-th-center">${_ic('globe')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_txt_qr_code')}</th>`;
    html += `<th class="player-codes-th-center"></th>`;
    html += `<th class="player-codes-th-center"></th>`;
    html += `</tr></thead><tbody>`;
    const lblPass = escAttr(t('txt_txt_passphrase'));
    const lblContact = escAttr(t('txt_txt_contact'));
    const lblEmail = escAttr(t('txt_email'));
    const lblLang = escAttr(t('txt_txt_language'));
    for (const [pid, info] of entries) {
      const _wd = _withdrawalFor(pid);
      html += `<tr class="player-codes-row${_wd ? ' row-withdrawn' : ''}" id="pc-row-${pid}">`;
      html += `<td class="player-codes-name stack-title" id="pc-name-${pid}">${_wd ? `<span class="withdrawn-name">${esc(info.name)}</span> <span class="badge badge-withdrawn">${esc(t('txt_withdrawn_badge'))}</span>` : esc(info.name)}</td>`;
      html += `<td class="player-codes-cell stack-pri" data-label="${lblPass}"><code id="pc-pass-${pid}" class="player-codes-passphrase" onclick="const c=this;navigator.clipboard.writeText(c.textContent).then(()=>flashSuccess(c,'${escAttr(t('txt_txt_copied'))}'))" title="${t('txt_txt_click_to_copy')}">${esc(info.passphrase)}</code></td>`;
      html += `<td class="player-codes-cell stack-full" data-label="${lblContact}"><input type="text" id="pc-contact-${pid}" value="${escAttr(info.contact || '')}" data-orig="${escAttr(info.contact || '')}" placeholder="${t('txt_reg_contact_placeholder')}" class="player-codes-input" onblur="_savePlayerContact('${pid}')"></td>`;
      html += `<td class="player-codes-cell-center stack-act">${_renderHubLinkCellInner(pid, info)}</td>`;
      if (_showEmail) {
        html += `<td class="player-codes-cell stack-full" data-label="${lblEmail}"><span class="player-codes-edit-wrap"><input type="email" id="pc-email-${pid}" value="${escAttr(info.email || '')}" data-orig="${escAttr(info.email || '')}" placeholder="${t('txt_email_placeholder')}" class="player-codes-input player-codes-input-email" onblur="_savePlayerEmail('${pid}')">`;
        if (info.email) html += `<button type="button" class="btn btn-sm player-codes-icon-btn" onclick="_sendPlayerEmail('${pid}', this)" title="${t('txt_email_send')}">${_ic('mail')}</button>`;
        html += `</span></td>`;
      }
      html += `<td class="player-codes-cell-center stack-pri" data-label="${lblLang}">${_langToggle(currentTid, pid, info.lang || 'en', 'sec')}</td>`;
      html += `<td class="player-codes-cell-center stack-act"><button type="button" class="btn btn-sm player-codes-action-btn" onclick="_showPlayerQr('${escAttr(pid)}','${escAttr(info.name)}')">${_ic('qr')} ${t('txt_txt_qr_code')}</button></td>`;
      html += `<td class="player-codes-cell-center stack-act"><button type="button" class="btn btn-sm btn-muted player-codes-action-btn" onclick="_regeneratePlayerCode('${pid}')">${_ic('reset')} ${t('txt_txt_regenerate')}</button></td>`;
      html += `<td class="player-codes-cell-center stack-act">${_renderWithdrawCell(pid, info)}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;
  }

  if (_isMex || (_isGP && _gpCurrentPhase === 'groups')) {
    html += `<div class="player-codes-add-row"><button type="button" class="add-participant-btn" onclick="_addTournamentPlayer()">＋ ${t('txt_txt_add_player')}</button></div>`;
  }

  html += `</div>`;
  return html;
}

// ─── Withdrawals (Players tab) ────────────────────────────
// The status payload's ``withdrawals`` list is stored by renderGP / renderPO /
// renderMex before the settings card renders.  The row cell is legacy markup
// (inline onclick like the rest of this table); the confirm dialog is the
// ``#withdraw-overlay`` Petite-Vue island below.

/** Withdrawals of the open tournament (``WithdrawalSummary`` dicts). */
let _currentWithdrawals = [];

/** Store the open tournament's withdrawals from its status payload. */
function _setCurrentWithdrawals(status) {
  _currentWithdrawals = Array.isArray(status?.withdrawals) ? status.withdrawals : [];
  _wdUnavailableIds = new Set(Array.isArray(status?.withdraw_unavailable_ids) ? status.withdraw_unavailable_ids : []);
}

/** Person ids whose bracket run is over (or who never reached the play-offs): no Withdraw button. */
let _wdUnavailableIds = new Set();

/** The withdrawal covering player *pid* (an entry or a team member), or null. */
function _withdrawalFor(pid) {
  return _currentWithdrawals.find(w => (w.member_ids || []).includes(pid)) || null;
}

/** Phase of the open tournament ('groups', 'mexicano', 'playoffs', 'finished'). */
function _wdCurrentPhase() {
  if (currentType === 'group_playoff') return _gpCurrentPhase;
  if (currentType === 'playoff') return _poCurrentPhase;
  if (currentType === 'mexicano') return _mexCurrentPhase;
  return '';
}

/** True when *pid* is a member of a composite team (withdrawing takes the whole team). */
function _wdIsTeamMember(pid) {
  // Both rosters are implicit globals set by renderMex / renderGP.
  let rosters = {};
  if (currentType === 'mexicano' && typeof _mexTeamRoster !== 'undefined') rosters = _mexTeamRoster || {};
  else if (currentType === 'group_playoff' && typeof _gpTeamRoster !== 'undefined') rosters = _gpTeamRoster || {};
  return Object.values(rosters).some(ids => (ids || []).includes(pid));
}

/** Last cell of a Players-tab row: Withdraw / Withdrawn + Undo / Mexicano-rounds remove. */
function _renderWithdrawCell(pid, info) {
  const w = _withdrawalFor(pid);
  if (w) {
    if (!w.undo_allowed) return '';
    return `<button type="button" class="btn btn-sm player-codes-action-btn" onclick="_undoWithdrawal('${escAttr(w.entry_key)}','${escAttr(w.name)}')" title="${escAttr(t('txt_withdraw_undo'))}">${_ic('reset')} ${esc(t('txt_withdraw_undo'))}</button>`;
  }
  const phase = _wdCurrentPhase();
  if (phase === 'finished') return '';
  // Bracket over for this entry (e.g. it won or lost its last play-off match): nothing left to withdraw from.
  if (_wdUnavailableIds.has(pid)) return '';
  if (currentType === 'mexicano' && phase !== 'playoffs') {
    // Mexicano rounds keep the existing remove (results stay, login code is deleted).
    return `<button type="button" class="btn btn-danger btn-sm player-codes-icon-btn" onclick="_removeTournamentPlayer('${escAttr(pid)}','${escAttr(info.name)}')" title="${escAttr(t('txt_txt_remove_player'))}">${_ic('trash')}</button>`;
  }
  const label = _wdIsTeamMember(pid) ? t('txt_withdraw_team_btn') : t('txt_withdraw_btn');
  return `<button type="button" class="btn btn-sm btn-danger-outline player-codes-action-btn" onclick="_openWithdrawDialog('${escAttr(pid)}', this)">${_ic('userminus')} ${esc(label)}</button>`;
}

/** Ids of every withdrawn entry and its members (for bracket / match rows). */
function _wdWithdrawnIdSet() {
  const ids = new Set();
  for (const w of _currentWithdrawals) for (const id of (w.member_ids || [])) ids.add(id);
  return ids;
}

/** "W/O" badge for a walkover match; *loserNames* is the side that withdrew. */
function _renderWalkoverBadge(loserNames) {
  const tip = t('txt_walkover_tip', { name: loserNames });
  return `<span class="badge badge-walkover" title="${escAttr(tip)}" aria-label="${escAttr(tip)}">${esc(t('txt_walkover_short'))}</span>`;
}

/**
 * Footnote under a group's standings for entries whose results were annulled
 * (they no longer appear in the table).  With ``admin``, adds the Undo button.
 */
function _renderAnnulledWithdrawalNote(groupName, { admin = false } = {}) {
  const rows = _currentWithdrawals.filter(w => w.kind === 'annul' && w.group === groupName);
  if (!rows.length) return '';
  let html = '';
  for (const w of rows) {
    html += `<p class="withdrawn-annulled-note">${esc(t('txt_withdrawn_annulled_note', { names: w.name }))}`;
    if (admin && w.undo_allowed) {
      html += ` <button type="button" class="btn btn-sm" onclick="_undoWithdrawal('${escAttr(w.entry_key)}','${escAttr(w.name)}')">${_ic('reset')} ${esc(t('txt_withdraw_undo'))}</button>`;
    }
    html += `</p>`;
  }
  return html;
}

/** Undo a group-stage withdrawal after a confirm. */
async function _undoWithdrawal(entryKey, name) {
  if (!confirm(t('txt_withdraw_undo_confirm', { name }))) return;
  try {
    await api(`/api/tournaments/${currentTid}/withdrawals/${encodeURIComponent(entryKey)}`, { method: 'DELETE' });
    if (typeof _showAdminToast === 'function') _showAdminToast(t('txt_withdraw_undone'), { duration: 3000 });
    await _refreshCurrentView();
  } catch (e) { alert(e.message || t('txt_reg_error')); }
}

/** Element that opened the withdraw dialog; focus returns here on close. */
let _wdTrigger = null;

/** Server 409 messages mapped to translated text (raw message otherwise). */
function _wdErrorText(message) {
  const msg = String(message || '');
  // "eliminated" first: that message also says "has finished its bracket".
  if (/eliminated|not in the play-offs/i.test(msg)) return t('txt_withdraw_unavailable_eliminated');
  if (/finished/i.test(msg)) return t('txt_withdraw_unavailable_finished');
  if (/already withdrawn/i.test(msg)) return t('txt_withdraw_already');
  // Walkover-score validation (422): server text is English, so map it.
  if (/tie-break must be won/i.test(msg)) return t('txt_withdraw_err_tiebreak');
  if (/must win more sets/i.test(msg)) return t('txt_withdraw_err_winner_sets');
  if (/walkover winner must score|exactly two numbers/i.test(msg)) return t('txt_withdraw_err_winner_points');
  if (/cannot be a tie/i.test(msg)) return t('txt_withdraw_err_set_tied');
  if (/at least one set|more than 5 sets|exactly 2 scores|non-negative|must have a winner/i.test(msg)) return t('txt_withdraw_err_score');
  return msg || t('txt_reg_error');
}

/** Parse an <input type=number> value: an integer or NaN. */
function _wdInt(v) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  return Number.isInteger(n) ? n : NaN;
}

const _WD_EMPTY_PREVIEW = Object.freeze({
  kind: '', entry_name: '', member_names: [], played: 0, total: 0, group: null,
  annul_matches: [], walkover_matches: [], dropped_match: null, sit_out_names: [],
  pending_forfeit_match: null, advance_to: null, opponent_tbd: false, lb_drop: false,
  third_place_note: false, active_after: null, modes_needed: [], walkover_defaults: {},
  default_decider: 'full_set', deciders_needed: [], elo_recalc: false, undo_possible: false, blockers: [],
});

const _wdStore = reactiveStore({
  open: false,
  loading: false,
  saving: false,
  error: '',
  playerId: '',
  p: null,                 // WithdrawalPreviewResponse
  points: [6, 0],          // walkover score, winner first
  sets: [[6, 0], [6, 0], ['', '']],
  lang: 'en',              // tracked so t() bindings re-render on language switch

  // Lang-tracking t() wrapper (petite-vue only re-renders on reactive reads).
  t(key, params) { void this.lang; return window.t(key, params); },

  /** ``p`` or an empty preview, so bindings never read a null while ``v-if`` tears down. */
  get q() { return this.p || _WD_EMPTY_PREVIEW; },
  get title() {
    return this.p ? this.t('txt_withdraw_title', { name: this.p.entry_name }) : this.t('txt_withdraw_btn');
  },
  /** Partner names (the rest of the team), or ''. */
  get partnerNames() {
    const names = this.p?.member_names || [];
    if (names.length < 2) return '';
    const own = (_playerSecrets[this.playerId] || {}).name;
    const others = names.filter(n => n !== own);
    return (others.length ? others : names.slice(1)).join(', ');
  },
  get isGroupKind() { return this.p && (this.p.kind === 'annul' || this.p.kind === 'walkover'); },
  get listMatches() {
    if (!this.p) return [];
    return this.p.kind === 'annul' ? this.p.annul_matches : this.p.walkover_matches;
  },
  get ruleText() {
    if (!this.p) return '';
    if (this.p.kind === 'annul') {
      const n = this.p.annul_matches.length;
      return this.t(n === 1 ? 'txt_withdraw_rule_annul_one' : 'txt_withdraw_rule_annul', { n });
    }
    if (this.p.kind === 'walkover') {
      // Two clauses so each can be singular on its own (1 result stands; 1 remaining match).
      const { played } = this.p;
      const n = this.p.walkover_matches.length;
      const stand = this.t(played === 1 ? 'txt_withdraw_results_stand_one' : 'txt_withdraw_results_stand', { played });
      return `${stand} ${this.t(n === 1 ? 'txt_withdraw_remaining_wo_one' : 'txt_withdraw_remaining_wo', { n })}`;
    }
    if (this.p.kind === 'exclude') return this.t('txt_withdraw_rule_exclude', { name: this.p.entry_name });
    return this.t('txt_withdraw_rule_forfeit', { name: this.p.entry_name });
  },
  get droppedText() {
    const m = this.p?.dropped_match;
    if (!m) return '';
    const players = [...(m.team1 || []), ...(m.team2 || [])].join(', ');
    return this.t('txt_withdraw_dropped_match', { court: m.court || this.roundLabel(m.round_label), players });
  },
  get forfeitText() {
    const m = this.p?.pending_forfeit_match;
    if (!this.p || this.p.kind !== 'forfeit') return '';
    if (!m) return this.t('txt_withdraw_forfeit_tbd');
    if (this.p.advance_to) return this.t('txt_withdraw_forfeit_now', { opponent: m.opponent, round: this.roundPhrase(this.p.advance_to, 'to') });
    return this.t('txt_withdraw_forfeit_decides', { opponent: m.opponent, round: this.roundPhrase(m.round_label, 'match') });
  },
  /** Translated round label (bracket labels come from the engine in English). */
  roundLabel(label) { void this.lang; return trl(label || ''); },
  /** Round name with article for sentences (see ``trlPhrase``). */
  roundPhrase(label, kind) { void this.lang; return trlPhrase(label, kind); },
  get modes() { return this.p?.modes_needed || []; },
  get needsScore() { return this.modes.length > 0; },
  hasMode(mode) { return this.modes.includes(mode); },
  /** Filled set rows, as integers. */
  get setRows() {
    return this.sets
      .filter(([a, b]) => String(a ?? '').trim() !== '' || String(b ?? '').trim() !== '')
      .map(([a, b]) => [_wdInt(a), _wdInt(b)]);
  },
  get pointsError() {
    if (!this.hasMode('points')) return '';
    const [w, l] = [_wdInt(this.points[0]), _wdInt(this.points[1])];
    return Number.isInteger(w) && Number.isInteger(l) && l >= 0 && w > l && w <= 200 ? '' : this.t('txt_withdraw_score_invalid');
  },
  get setsError() {
    if (!this.hasMode('sets')) return '';
    const rows = this.setRows;
    const bad = this.t('txt_withdraw_score_invalid');
    if (rows.length === 0 || rows.some(([a, b]) => !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b)) return bad;
    const won = rows.filter(([a, b]) => a > b).length;
    if (won <= rows.length - won) return bad;
    if (isMatchTiebreakSet(rows, 2, this.thirdSetDecider)) {
      const [a, b] = rows[2];
      if (Math.max(a, b) < 10 || Math.abs(a - b) < 2) return bad;
    }
    return '';
  },
  get scoreError() { return this.pointsError || this.setsError; },
  /** Walkover score shown for match *m* (winner first), following the editor. */
  resultFor(m) {
    // Bracket each match's own decider: a full-set match shows "10-8" plain even when another match needs a tie-break.
    if (m.mode === 'sets') return this.setsError ? m.resulting_score : formatSetScore(this.setRows, m.decider || this.p?.default_decider, ' ');
    if (m.mode === 'points') return this.pointsError ? m.resulting_score : `${_wdInt(this.points[0])}-${_wdInt(this.points[1])}`;
    return m.resulting_score;
  },
  /**
   * Decider the single set editor is labelled and validated for.  The server
   * checks the score against every affected match's decider; a valid match
   * tie-break (10+, 2 ahead) is also a valid full set, so when the matches
   * disagree the editor requires the tie-break and satisfies all of them.
   */
  get thirdSetDecider() {
    const needed = this.p?.deciders_needed || [];
    if (needed.includes('match_tiebreak')) return 'match_tiebreak';
    return needed[0] || this.p?.default_decider || 'full_set';
  },
  get mixedDeciders() { return (this.p?.deciders_needed || []).length > 1; },
  setLabel(i) { return i === 2 && this.thirdSetDecider === 'match_tiebreak' ? this.t('txt_match_tb_label') : `S${i + 1}`; },
  blockerText(b) {
    const reason = this.t(`txt_withdraw_blocker_${b.reason}`);
    return b.round_label ? `${this.roundLabel(b.round_label)}: ${reason}` : reason;
  },
  get undoText() {
    if (!this.p) return '';
    if (!this.p.undo_possible) return this.t('txt_withdraw_no_undo');
    return this.p.kind === 'exclude' ? this.t('txt_withdraw_undo_until_next_round') : this.t('txt_withdraw_undo_possible');
  },
  get confirmLabel() { return this.p ? this.t(`txt_withdraw_confirm_${this.p.kind}`) : this.t('txt_withdraw_btn'); },
  get canConfirm() {
    return !!this.p && !this.loading && !this.saving && this.p.blockers.length === 0 && !(this.needsScore && this.scoreError);
  },
  load() { return _wdLoadPreview(); },
  confirm() { return _wdConfirm(); },
  close() { _closeWithdrawDialog(); },
  onKeydown(e) { _wdKeydown(e); },
});

/** Open the withdraw dialog for player *playerId* (a Players-tab row). */
async function _openWithdrawDialog(playerId, trigger) {
  _wdTrigger = trigger || null;
  if (typeof _currentLang !== 'undefined') _wdStore.lang = _currentLang;
  _wdStore.playerId = playerId;
  _wdStore.p = null;
  _wdStore.error = '';
  _wdStore.saving = false;
  _wdStore.points = [6, 0];
  _wdStore.sets = [[6, 0], [6, 0], ['', '']];
  _wdStore.open = true;
  const overlay = document.getElementById('withdraw-overlay');
  if (overlay) overlay.style.display = 'flex';
  await _wdLoadPreview();
  requestAnimationFrame(() => {
    overlay?.querySelector('.modal-dialog input:not([disabled]), .modal-dialog .modal-close-btn')?.focus();
  });
}

/** Fetch the dry-run preview into the store (keeps a previous error visible). */
async function _wdLoadPreview() {
  _wdStore.loading = true;
  try {
    const p = await api(`/api/tournaments/${currentTid}/withdrawals/preview?player_id=${encodeURIComponent(_wdStore.playerId)}`);
    _wdStore.p = p;
    const d = p.walkover_defaults || {};
    if (Array.isArray(d.points) && d.points.length === 2) _wdStore.points = [...d.points];
    if (Array.isArray(d.sets) && d.sets.length) {
      _wdStore.sets = d.sets.concat([['', ''], ['', ''], ['', '']]).slice(0, 3).map(s => [s[0], s[1]]);
    }
  } catch (e) {
    _wdStore.p = null;
    _wdStore.error = _wdErrorText(e.message);
  } finally {
    _wdStore.loading = false;
  }
}

/** POST the withdrawal; on failure show the message and re-read the preview. */
async function _wdConfirm() {
  const s = _wdStore;
  if (!s.canConfirm) return;
  const body = { player_id: s.playerId, expected_kind: s.p.kind };
  if (s.needsScore) {
    body.walkover = {};
    if (s.hasMode('points')) body.walkover.points = [_wdInt(s.points[0]), _wdInt(s.points[1])];
    if (s.hasMode('sets')) body.walkover.sets = s.setRows;
  }
  s.saving = true;
  s.error = '';
  try {
    await api(`/api/tournaments/${currentTid}/withdrawals`, { method: 'POST', body: JSON.stringify(body) });
    const name = s.p.entry_name;
    _closeWithdrawDialog();
    if (typeof _showAdminToast === 'function') _showAdminToast(t('txt_withdraw_done', { name }), { duration: 3000 });
    await _refreshCurrentView();
  } catch (e) {
    s.error = _wdErrorText(e.message);
    s.saving = false;
    const keep = s.error;
    await _wdLoadPreview();
    s.error = keep;
  }
}

/** Close the dialog; focus returns to the row button that opened it. */
function _closeWithdrawDialog() {
  _wdStore.open = false;
  _wdStore.saving = false;
  const overlay = document.getElementById('withdraw-overlay');
  if (overlay) overlay.style.display = 'none';
  if (_wdTrigger && document.body.contains(_wdTrigger)) _wdTrigger.focus();
  _wdTrigger = null;
}

/** Esc closes; Tab cycles inside the dialog (focus trap). */
function _wdKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    _closeWithdrawDialog();
    return;
  }
  if (e.key !== 'Tab') return;
  const root = document.querySelector('#withdraw-overlay .modal-dialog');
  const items = Array.from(root?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [])
    .filter(el => el.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

mountIsland('#withdraw-overlay .modal-dialog', _wdStore);
// Backdrop click closes (the overlay itself is outside the island).
document.getElementById('withdraw-overlay')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) _closeWithdrawDialog();
});

/** Show a QR code in a modal dialog */
async function _showPlayerQr(playerId, playerName) {
  const imgUrl = `/api/tournaments/${currentTid}/player-secrets/qr/${playerId}?origin=${encodeURIComponent(window.location.origin)}`;
  // Fetch with auth
  try {
    const resp = await fetch(API + imgUrl, {
      headers: { 'Authorization': 'Bearer ' + getAuthToken() }
    });
    if (!resp.ok) throw new Error(t('txt_txt_failed_load_qr_code'));
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Build modal
    const modal = document.createElement('div');
    modal.className = 'codes-modal-backdrop';
    modal.onclick = (e) => { if (e.target === modal) { modal.remove(); URL.revokeObjectURL(objectUrl); } };
    modal.innerHTML = `<div class="codes-qr-card">
      <h3 class="codes-qr-title">${esc(playerName)}</h3>
      <img src="${objectUrl}" alt="${t('txt_txt_qr_code')}" class="codes-qr-img">
      <p class="m-0 mt-3 fs-sm text-muted">${t('txt_txt_player_codes_help')}</p>
      <button type="button" class="btn btn-primary btn-sm mt-3" onclick="this.closest('.codes-modal-backdrop').remove()">${_ic('x')} ${t('txt_txt_close')}</button>
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


/** Add a new player to the running tournament — inline (no prompt) */
function _addTournamentPlayer() {
  // The codes panel lives inside .player-codes-body (the "codes" sub-tab of the settings card).
  // There is no element with id="player-codes-panel" in the DOM.
  const codesBody = document.querySelector('.player-codes-body');

  // If there's already a pending add row, just focus it
  if (document.getElementById('pc-new-row')) {
    document.getElementById('pc-new-name')?.focus();
    return;
  }

  let tbody = codesBody?.querySelector('table tbody');

  // If no table exists yet (0 players), create one
  if (!tbody) {
    const noMsg = codesBody?.querySelector('.player-codes-empty');
    if (noMsg) noMsg.remove();
    const wrapper = document.createElement('div');
    wrapper.className = 'player-codes-table-wrap';
    wrapper.innerHTML = `<table class="player-codes-table"><thead><tr><th>${t('txt_txt_player')}</th><th>${t('txt_txt_passphrase')}</th><th>${t('txt_txt_contact')}</th><th class="ta-center">${t('txt_txt_qr_code')}</th><th></th><th></th></tr></thead><tbody></tbody></table>`;
    const addBtnDiv = codesBody?.querySelector('.add-participant-btn')?.parentElement;
    if (addBtnDiv) addBtnDiv.before(wrapper);
    else codesBody?.appendChild(wrapper);
    tbody = wrapper.querySelector('tbody');
  }

  const isGP = currentType === 'group_playoff';
  const groupSelectHtml = isGP && _gpGroupNames.length
    ? `<label class="d-flex items-center gap-1 fs-sm nowrap text-muted">${t('txt_txt_select_group')}
        <select id="pc-new-group" class="codes-new-group-select">
          ${_gpGroupNames.map(g => `<option value="${escAttr(g)}">${esc(g)}</option>`).join('')}
        </select></label>`
    : '';

  const newRow = document.createElement('tr');
  newRow.id = 'pc-new-row';
  newRow.className = 'row-divider';
  newRow.innerHTML = `<td class="codes-new-cell" colspan="6">
    <span class="d-flex gap-1-5 items-center flex-wrap">
      <input type="text" id="pc-new-name" list="pc-new-suggestions" autocomplete="off"
        placeholder="${escAttr(t('txt_txt_add_player_prompt'))}"
        class="codes-new-name-input"
        maxlength="128">
      <datalist id="pc-new-suggestions"></datalist>
      ${groupSelectHtml}
      <button type="button" class="btn btn-primary btn-sm codes-new-save" onclick="_submitNewPlayer()" aria-label="${escAttr(t('txt_txt_save'))}" title="${escAttr(t('txt_txt_save'))}">${_ic('check')}</button>
      <button type="button" class="btn btn-sm btn-compact fs-sm" onclick="_pcNewPlayerPastId=null;document.getElementById('pc-new-row')?.remove()" aria-label="${escAttr(t('txt_txt_cancel'))}" title="${escAttr(t('txt_txt_cancel'))}">${_ic('x')}</button>
    </span></td>`;
  tbody.appendChild(newRow);

  const input = document.getElementById('pc-new-name');
  if (input) {
    _pcNewPlayerPastId = null;
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitNewPlayer();
      else if (e.key === 'Escape') { _pcNewPlayerPastId = null; newRow.remove(); }
    });
    // Debounced search: query both Player Hub profiles and past participants
    input.addEventListener('input', () => {
      _pcNewPlayerPastId = null; // clear selection on any free typing
      clearTimeout(_pcNewPlayerSearchTimer);
      _pcNewPlayerSearchTimer = setTimeout(() => _pcNewPlayerDoSearch(input.value), 320);
    });
    // Detect when the user picks a suggestion from the datalist
    input.addEventListener('change', () => {
      const dl = document.getElementById('pc-new-suggestions');
      if (!dl) return;
      const val = input.value;
      const opt = Array.from(dl.options).find(o => o.value === val);
      if (!opt) { _pcNewPlayerPastId = null; return; }
      if (opt.dataset.type === 'past') {
        _pcNewPlayerPastId = opt.dataset.pastPlayerId;
        // Restore the clean display name (strip the suffix that was added for disambiguation)
        if (opt.dataset.name) input.value = opt.dataset.name;
      } else {
        _pcNewPlayerPastId = null;
      }
    });
  }
}

/**
 * Populate the datalist for the new-player input row.
 *
 * Queries both Player Hub profiles and past tournament participants (no profile)
 * in parallel, then fills #pc-new-suggestions with labelled options.
 * Past-participant options carry a "(past participant)" suffix for disambiguation
 * and store the original name and player_id in dataset attributes.
 */
async function _pcNewPlayerDoSearch(q) {
  const dl = document.getElementById('pc-new-suggestions');
  if (!dl) return;
  const trimmed = q ? q.trim() : '';
  if (trimmed.length < 2) { dl.innerHTML = ''; return; }

  try {
    const [profiles, past] = await Promise.allSettled([
      apiAuth(`/api/admin/player-profiles?q=${encodeURIComponent(trimmed)}`),
      apiAuth(`/api/admin/player-profiles/past-participants?q=${encodeURIComponent(trimmed)}`),
    ]);

    const opts = [];
    const profileList = profiles.status === 'fulfilled' && Array.isArray(profiles.value) ? profiles.value : [];
    const pastList    = past.status === 'fulfilled'    && Array.isArray(past.value)    ? past.value    : [];

    for (const p of profileList) {
      if (!p.is_ghost) {
        opts.push(`<option value="${escAttr(p.name)}" data-type="hub" data-id="${escAttr(p.id)}"></option>`);
      }
    }
    const suffix = ` (${t('txt_pc_past_participant')})`;
    for (const p of pastList) {
      // Add suffix so the datalist shows it as a distinct entry even if name matches a Hub profile
      const displayVal = escAttr(p.name + suffix);
      opts.push(
        `<option value="${displayVal}" data-type="past" data-past-player-id="${escAttr(p.player_id)}" data-name="${escAttr(p.name)}" title="${escAttr(t('txt_pc_past_participant_tooltip'))}"></option>`
      );
    }
    dl.innerHTML = opts.join('');
  } catch (_) { /* search is best-effort */ }
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
    if (_pcNewPlayerPastId) body.past_player_id = _pcNewPlayerPastId;
    _pcNewPlayerPastId = null;

    await api(`/api/tournaments/${currentTid}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Refresh view, keeping the player-codes panel open
    const drafts = _captureViewDrafts();
    drafts['details:player-codes-panel'] = true;
    if (currentType === 'group_playoff') await renderGP();
    else await renderMex();
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
  } catch (e) {
    alert(/withdrawal during play-offs/i.test(e.message || '') ? t('txt_mex_use_withdraw_in_playoffs') : (e.message || t('txt_reg_error')));
  }
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
async function _copyAllPlayerCodes(btn) {
  const lines = Object.values(_playerSecrets)
    .map(p => `${p.name}: ${p.passphrase}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(lines);
    flashSuccess(btn, t('txt_txt_copied'));
  } catch { /* ignore */ }
}

/** Auto-save the contact string for a single player on blur */
async function _savePlayerContact(playerId) {
  const input = document.getElementById(`pc-contact-${playerId}`);
  if (!input || input.value === input.dataset.orig) return;
  try {
    await api(`/api/tournaments/${currentTid}/player-secrets/${playerId}/contact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: input.value }),
    });
    if (_playerSecrets[playerId]) _playerSecrets[playerId].contact = input.value;
    input.dataset.orig = input.value;
    flashSuccess(input, t('txt_txt_saved'));
  } catch (e) {
    alert(e.message);
  }
}

/** Auto-save the email address for a single player on blur */
async function _savePlayerEmail(playerId) {
  const input = document.getElementById(`pc-email-${playerId}`);
  if (!input || input.value === input.dataset.orig) return;
  try {
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
    // Update the Hub link cell in-place to reflect new linked/unlinked state.
    const row = document.getElementById(`pc-row-${playerId}`);
    const cell = row?.querySelector('.pc-hub-link-btn')?.closest('td')
              || row?.querySelector('.player-codes-cell-center');
    if (cell) {
      cell.innerHTML = _renderHubLinkCellInner(playerId, _playerSecrets[playerId] || { profile_id: result.profile_linked ? 'linked' : null });
    }
    input.dataset.orig = input.value;
    flashSuccess(input, t('txt_txt_saved'));
  } catch (e) {
    alert(e.message);
  }
}

/** Send credentials email to a single tournament player */
async function _sendPlayerEmail(playerId, btn) {
  try {
    await api(`/api/tournaments/${currentTid}/send-email/${playerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    flashSuccess(btn, t('txt_email_sent'));
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

// ─── Hub link search modal ────────────────────────────────────────────────

let _hubSearchTimer = null;
let _hubCurrentPlayerId = null;

// ─── New-player row: past-participant lookup ──────────────────────────────

let _pcNewPlayerSearchTimer = null;
/** player_id of a past participant selected from the suggestion list */
let _pcNewPlayerPastId = null;
let _hubSearchScope = 'club'; // 'club' | 'community' | 'all'

/** Resolve the default search scope for the current tournament. */
function _hubResolveDefaultScope() {
  const meta = (typeof _tournamentMeta !== 'undefined' && _tournamentMeta[currentTid]) || {};
  if (meta.club_id) return 'club';
  if (meta.community_id && meta.community_id !== 'open') return 'community';
  return 'all';
}

/** Switch scope from the modal radio chips and re-run the search. */
function _hubSetScope(scope) {
  _hubSearchScope = scope;
  const buttons = document.querySelectorAll('#pc-hub-modal .pc-hub-scope-btn');
  buttons.forEach(b => {
    const active = b.dataset.scope === scope;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  _hubDoSearch();
}

function _hubEnsureModal() {
  if (document.getElementById('pc-hub-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'pc-hub-modal';
  overlay.className = 'pc-hub-modal-overlay';
  overlay.innerHTML = `<div class="pc-hub-modal-box">`
    + `<div class="pc-hub-modal-header">`
    + `<span class="pc-hub-modal-title">${_ic('link')} ${t('txt_hub_link')}</span>`
    + `<button type="button" class="pc-hub-close-btn" onclick="_hubCloseModal()" aria-label="${escAttr(t('txt_txt_close'))}">${_ic('x')}</button>`
    + `</div>`
    + `<div id="pc-hub-modal-scope" class="pc-hub-scope-row" role="group" aria-label="${escAttr(t('txt_hub_scope_label'))}"></div>`
    + `<input type="text" id="pc-hub-modal-q" class="player-codes-input" placeholder="${t('txt_hub_search_placeholder')}" oninput="_hubDebouncedSearch()">`
    + `<div id="pc-hub-modal-results" class="pc-hub-results"></div>`
    + `</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) _hubCloseModal(); });
  document.body.appendChild(overlay);
}

/** Render the scope toggle chips inside the modal based on tournament context. */
function _hubRenderScopeChips() {
  const host = document.getElementById('pc-hub-modal-scope');
  if (!host) return;
  const meta = (typeof _tournamentMeta !== 'undefined' && _tournamentMeta[currentTid]) || {};
  const club = meta.club_id ? (_adminClubs || []).find(c => c.id === meta.club_id) : null;
  const communityId = meta.community_id;
  const community = (communityId && communityId !== 'open')
    ? (_adminCommunities || []).find(c => c.id === communityId)
    : null;
  const chips = [];
  if (club) {
    chips.push({ scope: 'club', label: t('txt_hub_scope_club', { name: club.name }) });
  }
  if (community) {
    chips.push({ scope: 'community', label: t('txt_hub_scope_community', { name: community.name }) });
  }
  chips.push({ scope: 'all', label: t('txt_hub_scope_all') });
  host.innerHTML = chips.map(c =>
    `<button type="button" class="pc-hub-scope-btn${c.scope === _hubSearchScope ? ' active' : ''}"`
    + ` data-scope="${escAttr(c.scope)}" aria-pressed="${c.scope === _hubSearchScope ? 'true' : 'false'}"`
    + ` onclick="_hubSetScope('${escAttr(c.scope)}')">${esc(c.label)}</button>`
  ).join('');
}

/** Open the hub profile search modal for a player */
function _hubOpenSearch(playerId) {
  _hubCurrentPlayerId = playerId;
  _hubSearchScope = _hubResolveDefaultScope();
  _hubEnsureModal();
  _hubRenderScopeChips();
  const modal = document.getElementById('pc-hub-modal');
  const input = document.getElementById('pc-hub-modal-q');
  const results = document.getElementById('pc-hub-modal-results');
  modal.classList.add('active');
  input.value = '';
  results.innerHTML = '';
  // Pre-fill search with player name for convenience
  const name = _playerSecrets[playerId]?.name || '';
  if (name) { input.value = name; }
  _hubDoSearch();
  input.focus();
}

function _hubCloseModal() {
  const modal = document.getElementById('pc-hub-modal');
  if (modal) modal.classList.remove('active');
  _hubCurrentPlayerId = null;
}

function _hubDebouncedSearch() {
  clearTimeout(_hubSearchTimer);
  _hubSearchTimer = setTimeout(() => _hubDoSearch(), 250);
}

async function _hubDoSearch() {
  const input = document.getElementById('pc-hub-modal-q');
  const results = document.getElementById('pc-hub-modal-results');
  if (!input || !results) return;
  const q = input.value.trim();
  results.innerHTML = '<em class="fs-sm text-muted">…</em>';
  const params = new URLSearchParams({ q });
  const meta = (typeof _tournamentMeta !== 'undefined' && _tournamentMeta[currentTid]) || {};
  if (_hubSearchScope === 'club' && meta.club_id) {
    params.set('club_id', meta.club_id);
  } else if (_hubSearchScope === 'community' && meta.community_id && meta.community_id !== 'open') {
    params.set('community_id', meta.community_id);
  }
  try {
    const profiles = await api(`/api/admin/player-profiles?${params.toString()}`);
    const realProfiles = profiles.filter(p => !p.is_ghost);
    if (realProfiles.length === 0) {
      const noResultsKey = _hubSearchScope === 'all' ? 'txt_hub_no_results' : 'txt_hub_no_results_scoped';
      results.innerHTML = `<div class="empty-results-note">${esc(t(noResultsKey))}</div>`;
      return;
    }
    let html = '';
    for (const p of realProfiles) {
      html += `<div class="pc-hub-result-item" onclick="_hubLinkProfile('${escAttr(p.id)}')">`;
      html += `<span class="pc-hub-result-name">${esc(p.name || '—')}</span>`;
      if (p.email) html += `<span class="pc-hub-result-email">${esc(p.email)}</span>`;
      html += `</div>`;
    }
    results.innerHTML = html;
  } catch (e) {
    results.innerHTML = `<div class="fs-sm text-error">${esc(e.message)}</div>`;
  }
}

async function _hubLinkProfile(profileId) {
  const playerId = _hubCurrentPlayerId;
  if (!playerId) return;
  // Re-linking a player owned by another real Hub profile moves the link away from it.
  const currentProfileId = _playerSecrets[playerId]?.profile_id;
  if (currentProfileId && currentProfileId !== profileId && !String(currentProfileId).startsWith('ghost_')
      && !confirm(t('txt_hub_relink_confirm'))) return;
  // A profile is one participant per tournament: its other link here gets removed.
  const otherPid = Object.keys(_playerSecrets).find(pid => pid !== playerId && _playerSecrets[pid]?.profile_id === profileId);
  if (otherPid && !confirm(t('txt_hub_profile_moves_confirm', { value: _playerSecrets[otherPid].name || otherPid }))) return;
  try {
    const res = await api(`/api/admin/player-profiles/${profileId}/link/${currentTid}/${playerId}`, { method: 'POST' });
    if (_playerSecrets[playerId]) _playerSecrets[playerId].profile_id = profileId;
    _hubCloseModal();
    for (const pid of res.unlinked_player_ids || []) {
      if (_playerSecrets[pid]) _playerSecrets[pid].profile_id = null;
      const otherCell = document.getElementById(`pc-row-${pid}`)?.querySelector('.player-codes-cell-center');
      if (otherCell) otherCell.innerHTML = _renderHubLinkCellInner(pid, _playerSecrets[pid] || { profile_id: null });
    }
    // Update the cell to show the Unlink button (re-uses the shared renderer)
    const row = document.getElementById(`pc-row-${playerId}`);
    const cell = row?.querySelector('.player-codes-cell-center');
    if (cell) {
      cell.innerHTML = _renderHubLinkCellInner(playerId, _playerSecrets[playerId] || { profile_id: profileId });
    }
    // Populate name/contact/email from hub profile if returned
    if (res.populated) {
      if (res.populated.name) {
        const nameCell = document.getElementById(`pc-name-${playerId}`);
        if (nameCell) nameCell.textContent = res.populated.name;
        if (_playerSecrets[playerId]) _playerSecrets[playerId].name = res.populated.name;
      }
      if (res.populated.contact) {
        const cInput = document.getElementById(`pc-contact-${playerId}`);
        if (cInput) cInput.value = res.populated.contact;
        if (_playerSecrets[playerId]) _playerSecrets[playerId].contact = res.populated.contact;
      }
      if (res.populated.email) {
        const eInput = document.getElementById(`pc-email-${playerId}`);
        if (eInput) eInput.value = res.populated.email;
        if (_playerSecrets[playerId]) _playerSecrets[playerId].email = res.populated.email;
      }
    }
  } catch (e) {
    alert(e.message);
  }
}

async function _hubUnlink(playerId) {
  if (!confirm(t('txt_hub_unlink_confirm'))) return;
  try {
    await api(`/api/admin/player-profiles/link/${currentTid}/${playerId}`, { method: 'DELETE' });
    if (_playerSecrets[playerId]) _playerSecrets[playerId].profile_id = null;
    // Update the cell to show the Link button (re-uses the shared renderer)
    const row = document.getElementById(`pc-row-${playerId}`);
    const cell = row?.querySelector('.pc-hub-link-btn')?.closest('td')
              || row?.querySelector('.pc-hub-badge')?.closest('td');
    if (cell) {
      cell.innerHTML = _renderHubLinkCellInner(playerId, _playerSecrets[playerId] || { profile_id: null });
    }
  } catch (e) {
    alert(e.message);
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


