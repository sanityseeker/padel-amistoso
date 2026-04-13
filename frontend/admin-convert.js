async function _startConvertFromReg(rid) {
  try {
    const fresh = await api(`/api/registrations/${rid}`);
    _regDetails[rid] = fresh;
    _currentRegDetail = fresh;
    if (fresh.archived) {
      _renderRegDetailInline(rid);
      return;
    }
  } catch (_) {
    const cached = _regDetails[rid];
    if (!cached) return;
    if (cached.archived) {
      _renderRegDetailInline(rid);
      return;
    }
    _currentRegDetail = cached;
  }
  _stopRegDetailPoll();   // stop polling so it doesn't overwrite the conversion panel
  _renderConvertPanel(rid);
}

// ─── Convert registration → tournament (dedicated panel) ──────────────

let _convertFromRegistration = null;  // kept for backwards compat with createGP/createMex/createPO checks
window._emailConfigured = false;  // set on startup via /api/tournaments/email-status

// Internal state for the conversion panel
let _convRid = null;       // registration id being converted
let _convType = 'group_playoff';
let _convTeamMode = false;
let _convTeams = [];       // [[name1, name2], ...]
let _convTeamNames = [];   // [label1, label2, ...]
let _convStrengths = {};   // {playerName: score}
let _convExtraPlayers = []; // extra player names added during conversion
let _convSelectedPlayers = new Set(); // set of player_ids selected for conversion

function _getRegistrationSport(rid = _convRid) {
  return _regDetails[rid]?.sport || _currentRegDetail?.sport || _currentSport || 'padel';
}

function _isTennisRegistration(rid = _convRid) {
  return _getRegistrationSport(rid) === 'tennis';
}

function _usesConvTeamBuilder(rid = _convRid) {
  return !_isTennisRegistration(rid) && _convTeamMode;
}

function _getConvEffectiveTeamMode(rid = _convRid) {
  return _isTennisRegistration(rid) ? true : _convTeamMode;
}

function _renderConvertPanel(rid, preserveState = false) {
  const r = _regDetails[rid];
  if (!r) return;
  const el = document.getElementById('view-content');
  const isTennis = _isTennisRegistration(rid);

  // Reset state only for fresh opens; keep state when refreshing UI (e.g. language change)
  if (!preserveState) {
    _convRid = rid;
    _convType = 'group_playoff';
    _convTeamMode = false;
    _convTeams = [];
    _convTeamNames = [];
    _convStrengths = {};
    _convExtraPlayers = [];
    _convGroupPreview = null;

    // Initialize selection: all players selected by default (including previously-assigned).
    _convSelectedPlayers = new Set();
    for (const reg of r.registrants) {
      _convSelectedPlayers.add(reg.player_id);
    }
  } else {
    _convRid = rid;
  }

  const openDetails = new Set();
  const savedInputs = {};
  const openAnswers = new Set();
  if (preserveState && el) {
    el.querySelectorAll('details').forEach((d, i) => { if (d.open) openDetails.add(i); });
    el.querySelectorAll('input[id], textarea[id], select[id]').forEach(inp => {
      if (inp.type === 'checkbox') savedInputs[inp.id] = { checked: inp.checked };
      else savedInputs[inp.id] = { value: inp.value };
    });
    el.querySelectorAll('.conv-answers-detail[id]').forEach(panel => {
      if (panel.style.display !== 'none') openAnswers.add(panel.id);
    });
  }

  let html = `<div class="card">`;
  // Header
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">`;
  html += `<h2 style="margin:0">${t('txt_reg_convert_title')}</h2>`;
  html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_cancelConvert('${esc(rid)}')">${t('txt_txt_cancel')}</button>`;
  html += `</div>`;

  // Player selection section
  html += `<div class="field-section" style="margin-bottom:0.75rem">`;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.3rem">`;
  html += `<div class="field-section-title" style="margin-bottom:0">${t('txt_conv_select_players')}</div>`;
  html += `<div style="display:flex;gap:0.4rem;align-items:center">`;
  html += `<span class="participant-count" id="conv-selected-count">(${_convSelectedPlayers.size}/${r.registrants.length})</span>`;
  html += `<button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.15rem 0.4rem" onclick="_convSelectAll()">${t('txt_conv_select_all')}</button>`;
  html += `<button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.15rem 0.4rem;background:var(--border);color:var(--text)" onclick="_convDeselectAll()">${t('txt_conv_deselect_all')}</button>`;
  html += `</div></div>`;
  html += `<div id="conv-player-list" class="conv-player-list"></div>`;
  html += `</div>`;

  // Tournament name
  html += `<div class="field-section" style="margin-bottom:0.75rem">`;
  html += `<input id="conv-name" value="${esc(r.name)}" class="tournament-name-input" placeholder="${t('txt_txt_my_tournament_placeholder')}" style="width:100%">`;
  html += `</div>`;

  // Tournament type + team mode
  html += `<div class="field-section" style="margin-bottom:0.75rem">`;
  html += `<div class="field-section-title">${t('txt_txt_format')}</div>`;
  html += `<div class="score-mode-toggle" id="conv-type-toggle" style="margin-bottom:0.5rem">`;
  html += `<button type="button" class="active" onclick="_setConvType('group_playoff')">${t('txt_txt_group_play_off')}</button>`;
  html += `<button type="button" onclick="_setConvType('mexicano')">${t('txt_txt_mexicano_play_offs')}</button>`;
  html += `<button type="button" onclick="_setConvType('playoff')">${t('txt_txt_play_offs_only')}</button>`;
  html += `</div>`;
  if (!isTennis) {
    html += `<div style="margin-top:0.5rem">`;
    html += `<div class="score-mode-toggle" id="conv-team-toggle">`;
    html += `<button type="button" class="active" onclick="_setConvTeamMode(false)">${t('txt_txt_individual_mode')}</button>`;
    html += `<button type="button" onclick="_setConvTeamMode(true)">${t('txt_txt_team_mode_short')}</button>`;
    html += `</div>`;
    html += `</div>`;
  }
  html += `</div>`;

  // Extra players (individual mode only)
  html += `<div id="conv-extra-players-section" class="field-section" style="margin-bottom:0.75rem">`;
  html += `<div class="field-section-title">${t('txt_conv_extra_players')}</div>`;
  html += `<div id="conv-extra-players-container"></div>`;
  html += `<button type="button" class="add-participant-btn" style="width:100%;margin-top:0.4rem" onclick="_addConvExtraPlayer()">${t('txt_txt_add_player')}</button>`;
  html += `</div>`;

  // Team formation (hidden unless team mode)
  html += `<div id="conv-teams-section" class="field-section" style="margin-bottom:0.75rem;display:none">`;
  html += `<div class="field-section-title">${t('txt_conv_team_formation')}</div>`;
  html += `<div id="conv-teams-container"></div>`;
  html += `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem">`;
  html += `<button type="button" class="add-participant-btn" style="flex:1" onclick="_addConvTeam()">${t('txt_txt_add_team')}</button>`;
  html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_autoConvTeams()">${t('txt_conv_auto_pair')}</button>`;
  html += `</div>`;
  html += `</div>`;

  // Strength (collapsible)
  html += `<details class="field-section" style="margin-bottom:0.75rem" id="conv-strength-section">`;
  html += `<summary style="cursor:pointer;font-weight:700;font-size:0.85rem">${t('txt_conv_initial_strength')}</summary>`;
  html += `<p style="font-size:0.78rem;color:var(--text-muted);margin:0.3rem 0 0.5rem">${t('txt_conv_strength_help')}</p>`;
  html += `<div id="conv-strength-container"></div>`;
  html += `</details>`;

  // Settings area (dynamic per type)
  html += `<div id="conv-settings"></div>`;

  // Group preview (GP only, hidden initially)
  html += `<div id="conv-group-preview" class="field-section" style="display:none;margin-top:0.75rem"></div>`;

  // Message area + submit
  html += `<div id="conv-msg" class="alert alert-error hidden" style="margin-top:0.75rem"></div>`;
  html += `<div id="conv-create-buttons" style="text-align:center;margin-top:1rem">`;
  html += `<button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,()=>_previewOrSubmitConvert('${esc(rid)}'))">${t('txt_reg_convert_to_tournament')}</button>`;
  html += `</div>`;

  html += `</div>`;
  el.innerHTML = html;

  _renderConvSettings(rid);
  _renderConvStrength(rid);
  _renderConvPlayerList(rid);

  if (preserveState) {
    el.querySelectorAll('details').forEach((d, i) => { if (openDetails.has(i)) d.open = true; });
    for (const [id, state] of Object.entries(savedInputs)) {
      const inp = document.getElementById(id);
      if (!inp) continue;
      if ('checked' in state) inp.checked = state.checked;
      else inp.value = state.value;
    }
    for (const panelId of openAnswers) {
      const panel = document.getElementById(panelId);
      if (!panel) continue;
      panel.style.display = '';
      const pid = panelId.replace('conv-answers-', '');
      const btn = el.querySelector(`.conv-answers-btn[onclick*="_toggleConvAnswers('${pid}')"]`);
      if (btn) btn.classList.add('active');
    }
  }

  // Re-render strength bubbles when the details section is opened
  document.getElementById('conv-strength-section')?.addEventListener('toggle', e => {
    if (e.target.open) _renderConvStrength(_convRid);
  });
}

function _cancelConvert(rid) {
  _renderRegDetailInline(rid);
  _startRegDetailPoll();  // resume polling after leaving the conversion panel
}

function _renderConvPlayerList(rid) {
  const container = document.getElementById('conv-player-list');
  if (!container) return;
  const r = _regDetails[rid];
  if (!r) return;
  const assignedSet = new Set(r.assigned_player_ids || []);
  const playerTournamentMap = r.player_tournament_map || {};
  const linkedById = new Map((r.linked_tournaments || []).map(lt => [lt.id, lt]));
  const questions = r.questions || [];
  const hasQuestions = questions.length > 0;

  // Remember which answer panels are open so we can restore after re-render
  const openAnswers = new Set();
  container.querySelectorAll('.conv-answers-detail').forEach(el => {
    if (el.style.display !== 'none') openAnswers.add(el.id);
  });

  let h = '';
  // All registrants — previously-assigned are now selectable too (with a warning dot)
  for (const reg of r.registrants) {
    const isAssigned = assignedSet.has(reg.player_id);
    const checked = _convSelectedPlayers.has(reg.player_id);
    const pid = esc(reg.player_id);
    const answersId = 'conv-answers-' + pid;
    const wasOpen = openAnswers.has(answersId);

    // Build the overlap warning tooltip text
    let overlapTooltip = '';
    if (isAssigned) {
      const tids = playerTournamentMap[reg.player_id] || [];
      const tnames = tids.map(tid => {
        const lt = linkedById.get(tid);
        return lt ? lt.name : tid;
      });
      overlapTooltip = t('txt_reg_player_in_tournaments', { tournaments: tnames.join(', ') });
    }

    h += `<div class="conv-player-item">`;
    h += `<div class="conv-player-row${checked ? ' selected' : ''}${isAssigned ? ' conv-player-overlap' : ''}" onclick="_toggleConvPlayer('${pid}')">`;
    h += `<label class="conv-player-check" onclick="event.stopPropagation()">`;
    h += `<input type="checkbox" ${checked ? 'checked' : ''} onchange="_toggleConvPlayer('${pid}')">`;
    h += `</label>`;
    h += `<span class="conv-player-name">${esc(reg.player_name)}</span>`;
    if (isAssigned) {
      h += `<span class="conv-player-overlap-dot" title="${esc(overlapTooltip)}">⚠</span>`;
    }
    if (hasQuestions) {
      h += `<button type="button" class="conv-answers-btn${wasOpen ? ' active' : ''}" onclick="event.stopPropagation();_toggleConvAnswers('${pid}')" title="${t('txt_conv_show_answers')}">\ud83d\udccb</button>`;
    }
    h += `</div>`;
    if (isAssigned && overlapTooltip) {
      h += `<div class="conv-player-overlap-hint">${esc(overlapTooltip)}</div>`;
    }
    if (hasQuestions) {
      h += `<div class="conv-answers-detail" id="${answersId}" style="display:${wasOpen ? '' : 'none'}">`;
      for (const q of questions) {
        const a = reg.answers?.[q.key];
        h += `<div class="conv-answers-detail-row">`;
        h += `<span class="conv-answers-detail-label">${esc(q.label)}</span>`;
        if (a) {
          if (q.type === 'choice') {
            h += `<span class="conv-answer-badge">${esc(a)}</span>`;
          } else {
            h += `<span class="conv-answers-detail-value">${esc(a)}</span>`;
          }
        } else {
          h += `<span class="conv-answers-detail-value empty">${t('txt_conv_no_answer')}</span>`;
        }
        h += `</div>`;
      }
      h += `</div>`;
    }
    h += `</div>`;
  }
  container.innerHTML = h;
  _updateConvSelectedCount();
}

function _toggleConvAnswers(pid) {
  const el = document.getElementById('conv-answers-' + pid);
  if (!el) return;
  const btn = el.previousElementSibling?.querySelector('.conv-answers-btn');
  if (el.style.display === 'none') {
    el.style.display = '';
    if (btn) btn.classList.add('active');
  } else {
    el.style.display = 'none';
    if (btn) btn.classList.remove('active');
  }
}

function _toggleConvPlayer(pid) {
  if (_convSelectedPlayers.has(pid)) _convSelectedPlayers.delete(pid);
  else _convSelectedPlayers.add(pid);
  _renderConvPlayerList(_convRid);
  _renderConvStrength(_convRid);
  if (_usesConvTeamBuilder()) _renderConvTeams(_convRid);
}

function _convSelectAll() {
  const r = _regDetails[_convRid];
  if (!r) return;
  for (const reg of r.registrants) {
    _convSelectedPlayers.add(reg.player_id);
  }
  _renderConvPlayerList(_convRid);
  _renderConvStrength(_convRid);
  if (_usesConvTeamBuilder()) _renderConvTeams(_convRid);
}

function _convDeselectAll() {
  _convSelectedPlayers.clear();
  _renderConvPlayerList(_convRid);
  _renderConvStrength(_convRid);
  if (_usesConvTeamBuilder()) _renderConvTeams(_convRid);
}

function _updateConvSelectedCount() {
  const el = document.getElementById('conv-selected-count');
  if (!el) return;
  const r = _regDetails[_convRid];
  const total = r ? r.registrants.length : 0;
  el.textContent = `(${_convSelectedPlayers.size}/${total})`;
}

function _setConvType(type) {
  _convType = type;
  if (!_isTennisRegistration() && _convType === 'playoff') {
    _setConvTeamMode(true);
  }
  const toggle = document.getElementById('conv-type-toggle');
  if (toggle) toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.textContent.trim() === {
    group_playoff: t('txt_txt_group_play_off'),
    mexicano: t('txt_txt_mexicano_play_offs'),
    playoff: t('txt_txt_play_offs_only'),
  }[type]));
  const teamToggle = document.getElementById('conv-team-toggle');
  if (teamToggle) {
    const btns = teamToggle.querySelectorAll('button');
    const lockToTeam = !_isTennisRegistration() && _convType === 'playoff';
    if (btns[0]) btns[0].disabled = lockToTeam;
    if (lockToTeam) {
      btns[0]?.classList.remove('active');
      btns[1]?.classList.add('active');
    }
  }
  // Find the rid from the submit button onclick
  const submitBtn = document.querySelector('#conv-msg')?.parentElement?.querySelector('.btn-success');
  const rid = submitBtn ? submitBtn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1] : null;
  _renderConvSettings(rid);
  _renderConvStrength(rid);
}

function _setConvTeamMode(isTeam) {
  if (_isTennisRegistration()) isTeam = false;
  if (!_isTennisRegistration() && _convType === 'playoff') isTeam = true;
  _convTeamMode = isTeam;
  const toggle = document.getElementById('conv-team-toggle');
  if (toggle) {
    const btns = toggle.querySelectorAll('button');
    btns[0].classList.toggle('active', !isTeam);
    btns[1].classList.toggle('active', isTeam);
  }
  const section = document.getElementById('conv-teams-section');
  if (section) section.style.display = _usesConvTeamBuilder() ? '' : 'none';
  const extraSection = document.getElementById('conv-extra-players-section');
  if (extraSection) extraSection.style.display = _usesConvTeamBuilder() ? 'none' : '';
  if (_usesConvTeamBuilder() && _convTeams.length === 0) {
    // Auto-form teams from first available players
    _autoConvTeams();
  }
  _renderConvStrength(_convRid);
}

function _addConvExtraPlayer() {
  _convExtraPlayers.push('');
  _renderConvExtraPlayers();
  // Focus the new input
  setTimeout(() => {
    const inputs = document.querySelectorAll('.conv-extra-player-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 0);
}

function _removeConvExtraPlayer(idx) {
  // Sync current values from DOM first
  document.querySelectorAll('.conv-extra-player-input').forEach(inp => {
    _convExtraPlayers[+inp.dataset.idx] = inp.value;
  });
  _convExtraPlayers.splice(idx, 1);
  _renderConvExtraPlayers();
  _renderConvStrength(_convRid);
}

function _renderConvExtraPlayers() {
  const container = document.getElementById('conv-extra-players-container');
  if (!container) return;
  // Sync current values from DOM before re-building
  container.querySelectorAll('.conv-extra-player-input').forEach(inp => {
    _convExtraPlayers[+inp.dataset.idx] = inp.value;
  });
  let html = '';
  _convExtraPlayers.forEach((name, i) => {
    html += `<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem">`;
    html += `<input type="text" class="conv-extra-player-input" data-idx="${i}" value="${esc(name)}" placeholder="${t('txt_reg_name_placeholder')}" style="flex:1" oninput="_convExtraPlayers[${i}]=this.value;_debouncedConvStrength()">`;
    html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem" onclick="_removeConvExtraPlayer(${i})">✕</button>`;
    html += `</div>`;
  });
  container.innerHTML = html;
}

function _getConvPlayerNames(rid) {
  const r = _regDetails[rid];
  // Include any registrant that is selected (including those already in a previous tournament)
  const registered = r
    ? r.registrants.filter(function(reg) { return _convSelectedPlayers.has(reg.player_id); }).map(function(reg) { return reg.player_name; })
    : [];
  // Include extra players (non-empty, non-duplicate)
  const nameSet = new Set(registered);
  for (const ep of _convExtraPlayers) {
    const trimmed = ep?.trim();
    if (trimmed && !nameSet.has(trimmed)) { registered.push(trimmed); nameSet.add(trimmed); }
  }
  return registered;
}

let _convStrengthTimer = null;
function _debouncedConvStrength() {
  clearTimeout(_convStrengthTimer);
  _convStrengthTimer = setTimeout(() => _renderConvStrength(_convRid), 400);
}

function _renderConvTeams(rid) {
  const container = document.getElementById('conv-teams-container');
  if (!container) return;
  // Preserve any team names typed into the DOM before re-rendering
  container.querySelectorAll('.conv-team-name-input').forEach(inp => {
    const idx = +inp.dataset.idx;
    _convTeamNames[idx] = inp.value;
  });
  const allNames = _getConvPlayerNames(rid);
  const assignedNames = new Set(_convTeams.flat());

  let html = '';
  _convTeams.forEach((team, idx) => {
    html += `<div class="conv-team-row" style="margin-bottom:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg)">`;
    html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem">`;
    html += `<span style="font-size:0.78rem;font-weight:700;color:var(--text-muted)">${t('txt_conv_team')} ${idx + 1}</span>`;
    html += `<input type="text" class="conv-team-name-input" data-idx="${idx}" value="${esc(_convTeamNames[idx] || '')}" placeholder="${team.join(' & ')}" style="flex:1;font-size:0.85rem;padding:0.25rem 0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">`;
    html += `<button type="button" class="participant-remove-btn" onclick="_removeConvTeam(${idx})" title="${t('txt_txt_remove')}">×</button>`;
    html += `</div>`;
    html += `<div style="display:flex;gap:0.4rem;flex-wrap:wrap">`;
    team.forEach((member, mi) => {
      html += `<select class="conv-team-select" data-team="${idx}" data-slot="${mi}" onchange="_onConvTeamSelect(${idx},${mi},this.value)" style="flex:1;min-width:120px;font-size:0.85rem;padding:0.3rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">`;
      html += `<option value="">—</option>`;
      for (const name of allNames) {
        const taken = assignedNames.has(name) && name !== member;
        html += `<option value="${esc(name)}" ${name === member ? 'selected' : ''} ${taken ? 'disabled style="color:var(--text-muted)"' : ''}>${esc(name)}</option>`;
      }
      html += `</select>`;
    });
    html += `</div>`;
    html += `</div>`;
  });

  // Show unassigned players
  const unassigned = allNames.filter(n => !assignedNames.has(n));
  if (unassigned.length > 0) {
    html += `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem">${t('txt_conv_unassigned')}: ${unassigned.map(n => `<span style="font-weight:600">${esc(n)}</span>`).join(', ')}</div>`;
  }
  container.innerHTML = html;
}

function _addConvTeam() {
  const submitBtn = document.querySelector('#conv-msg')?.parentElement?.querySelector('.btn-success');
  const rid = submitBtn?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  const allNames = rid ? _getConvPlayerNames(rid) : [];
  const assigned = new Set(_convTeams.flat());
  const available = allNames.filter(n => !assigned.has(n));
  const t1 = available[0] || '';
  const t2 = available[1] || '';
  _convTeams.push([t1, t2].filter(Boolean));
  _convTeamNames.push('');
  _renderConvTeams(rid);
  _renderConvStrength(rid);
}

function _removeConvTeam(idx) {
  _convTeams.splice(idx, 1);
  _convTeamNames.splice(idx, 1);
  const submitBtn = document.querySelector('#conv-msg')?.parentElement?.querySelector('.btn-success');
  const rid = submitBtn?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  _renderConvTeams(rid);
  _renderConvStrength(rid);
}


function _onConvTeamSelect(teamIdx, slotIdx, value) {
  const submitBtn = document.querySelector('#conv-msg')?.parentElement?.querySelector('.btn-success');
  const rid = submitBtn?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  // Check for duplicate within the SAME team (if someone picks a player already in another slot)
  const old = _convTeams[teamIdx][slotIdx];
  _convTeams[teamIdx][slotIdx] = value;
  _renderConvTeams(rid);
  _renderConvStrength(rid);
}

function _autoConvTeams() {
  const submitBtn = document.querySelector('#conv-msg')?.parentElement?.querySelector('.btn-success');
  const rid = submitBtn?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  // Sync current team name inputs before modifying
  document.querySelectorAll('.conv-team-name-input').forEach(inp => {
    _convTeamNames[+inp.dataset.idx] = inp.value;
  });
  const allNames = new Set(rid ? _getConvPlayerNames(rid) : []);
  // Separate extra teams (contain members not in the registered player list)
  const extraTeams = [];
  const extraNames = [];
  for (let i = 0; i < _convTeams.length; i++) {
    const hasNonRegistered = _convTeams[i].some(m => m && !allNames.has(m));
    if (hasNonRegistered) {
      extraTeams.push(_convTeams[i]);
      extraNames.push(_convTeamNames[i] || '');
    }
  }
  // Auto-pair only the registered players
  const registeredNames = rid ? _getConvPlayerNames(rid) : [];
  _convTeams = [];
  _convTeamNames = [];
  for (let i = 0; i + 1 < registeredNames.length; i += 2) {
    _convTeams.push([registeredNames[i], registeredNames[i + 1]]);
    _convTeamNames.push('');
  }
  // Re-append the extra teams
  _convTeams.push(...extraTeams);
  _convTeamNames.push(...extraNames);
  _renderConvTeams(rid);
  _renderConvStrength(rid);
}

function _renderConvStrength(rid) {
  const container = document.getElementById('conv-strength-container');
  if (!container) return;
  // Sync team names from DOM inputs before building entries
  document.querySelectorAll('.conv-team-name-input').forEach(inp => {
    const idx = +inp.dataset.idx;
    _convTeamNames[idx] = inp.value;
  });
  let entries = [];
  if (_usesConvTeamBuilder(rid) && _convTeams.length) {
    entries = _convTeams.map((team, i) => {
      const memberLabel = team.filter(Boolean).join(' & ');
      const label = _convTeamNames[i]?.trim() || memberLabel;
      return { key: label, label: label || `${t('txt_conv_team')} ${i + 1}`, isTeam: true, teamIdx: i };
    });
  } else {
    const names = rid ? _getConvPlayerNames(rid) : [];
    entries = names.map(n => ({ key: n, label: n, isTeam: false }));
  }

  let html = `<div class="conv-strength-grid">`;
  entries.forEach(({ key, label }) => {
    const val = _convStrengths[key] ?? '';
    html += `<div class="conv-strength-entry">`;
    html += `<label>${esc(label)}</label>`;
    html += `<input type="number" class="conv-strength-input" data-key="${esc(key)}" value="${val}" placeholder="0" min="0" step="1" oninput="_convStrengths[this.dataset.key]=this.value?+this.value:undefined">`;
    html += `</div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

function _renderConvSettings(rid) {
  const el = document.getElementById('conv-settings');
  if (!el) return;
  let html = '';

  // Courts (common to all types)
  html += `<div class="field-section" style="margin-bottom:0.75rem">`;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.55rem">`;
  html += `<div class="field-section-title" style="margin-bottom:0">${t('txt_txt_courts')}</div>`;
  html += `<label class="switch-label"><input type="checkbox" id="conv-assign-courts" checked onchange="_toggleConvCourts()"><span class="switch-track"></span><span>${t('txt_txt_assign_courts')}</span></label>`;
  html += `</div>`;
  html += `<div id="conv-courts-detail">`;
  html += `<div class="num-field" style="margin-bottom:0.55rem"><label>${t('txt_txt_number_of_courts')}</label><input id="conv-court-count" type="number" value="2" min="1" max="20" oninput="_renderConvCourtNames()"></div>`;
  html += `<div class="court-names-grid" id="conv-court-names"></div>`;
  html += `</div>`;
  html += `</div>`;

  // Type-specific settings
  if (_convType === 'group_playoff') {
    html += `<div class="field-section" style="margin-bottom:0.75rem">`;
    html += `<div class="field-section-title">${t('txt_txt_groups')}</div>`;
    html += `<div class="num-field" style="margin-bottom:0.55rem"><label>${t('txt_txt_number_of_groups')}</label><input id="conv-num-groups" type="number" value="2" min="1"></div>`;
    html += `</div>`;
  } else if (_convType === 'mexicano') {
    html += `<div class="field-section" style="margin-bottom:0.75rem">`;
    html += `<div class="field-section-title">${t('txt_txt_parameters')}</div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem 1.25rem">`;
    html += `<div style="display:flex;flex-direction:column;gap:0.3rem"><label style="font-size:0.8rem;color:var(--text-muted)">${t('txt_txt_total_points_per_match')}</label><input id="conv-mex-pts" type="number" value="26" min="1" style="width:80px"></div>`;
    html += `<div style="display:flex;flex-direction:column;gap:0.3rem"><label style="font-size:0.8rem;color:var(--text-muted)">${t('txt_txt_number_of_rounds')}</label>`;
    html += `<div style="display:flex;align-items:center;gap:0.6rem">`;
    html += `<div class="score-mode-toggle" id="conv-mex-rounds-toggle" style="flex-shrink:0">`;
    html += `<button type="button" class="active" onclick="_setConvMexRounds('unlimited')">∞</button>`;
    html += `<button type="button" onclick="_setConvMexRounds('fixed')">${t('txt_txt_fixed')}</button>`;
    html += `</div>`;
    html += `<input id="conv-mex-rounds" type="number" value="8" min="1" style="width:64px;display:none">`;
    html += `</div></div>`;
    html += `</div>`;
    html += `<details class="advanced-section" style="margin-top:0.5rem;margin-bottom:0;border-radius:6px">`;
    html += `<summary>${t('txt_txt_advanced_settings')}</summary>`;
    html += `<div class="advanced-grid">`;
    html += `<div class="adv-field"><label>${t('txt_txt_skill_gap_label')}</label><input id="conv-mex-skill-gap" type="number" placeholder="e.g. 50" min="0"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_win_bonus_label')}</label><input id="conv-mex-win-bonus" type="number" value="0" min="0"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_rival_strength_label')}</label><input id="conv-mex-strength-weight" type="number" value="0" min="0" max="1" step="0.05"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_strength_min_matches_label')}</label><input id="conv-mex-strength-min-matches" type="number" value="4" min="0" step="1"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_strength_win_factor_label')}</label><input id="conv-mex-strength-win-factor" type="number" value="1" min="0" max="1" step="0.05"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_strength_draw_factor_label')}</label><input id="conv-mex-strength-draw-factor" type="number" value="0.75" min="0" max="1" step="0.05"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_strength_loss_factor_label')}</label><input id="conv-mex-strength-loss-factor" type="number" value="0.5" min="0" max="1" step="0.05"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_loss_discount_label')}</label><input id="conv-mex-loss-discount" type="number" value="1" min="0" max="1" step="0.05"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_balance_tolerance_label')}</label><input id="conv-mex-balance-tol" type="number" value="0.2" min="0" max="2" step="0.1"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_teammate_repeat_weight_label')}</label><input id="conv-mex-teammate-repeat-wt" type="number" value="2" min="0" step="0.1"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_opponent_repeat_weight_label')}</label><input id="conv-mex-opponent-repeat-wt" type="number" value="1" min="0" step="0.1"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_repeat_decay_label')}</label><input id="conv-mex-repeat-decay" type="number" value="0.5" min="0" step="0.1"></div>`;
    if (!_getConvEffectiveTeamMode(rid)) {
      html += `<div class="adv-field"><label>${t('txt_txt_partner_balance_weight_label')}</label><input id="conv-mex-partner-balance-wt" type="number" value="0" min="0" step="0.1"></div>`;
    }
    html += `</div></details>`;
    html += `</div>`;
  } else if (_convType === 'playoff') {
    html += `<div class="field-section" style="margin-bottom:0.75rem">`;
    html += `<div class="field-section-title">${t('txt_txt_play_off_format')}</div>`;
    html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.2rem">`;
    html += `<input type="checkbox" id="conv-double-elim" style="width:1rem;height:1rem;cursor:pointer">`;
    html += `<label for="conv-double-elim" style="font-size:0.85rem;cursor:pointer">${t('txt_txt_double_elimination')}</label>`;
    html += `</div></div>`;
  }

  // Public checkbox
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.25rem">`;
  html += `<input type="checkbox" id="conv-public" checked style="width:1rem;height:1rem;cursor:pointer">`;
  html += `<label for="conv-public" style="font-size:0.85rem;cursor:pointer">${t('txt_txt_public_tournament')}</label>`;
  html += `</div>`;
  if (window._emailConfigured) {
    html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.25rem">`;
    html += `<input type="checkbox" id="conv-notify-players" checked style="width:1rem;height:1rem;cursor:pointer">`;
    html += `<label for="conv-notify-players" style="font-size:0.85rem;cursor:pointer">${t('txt_email_notify_players')}</label>`;
    html += `</div>`;
  }

  el.innerHTML = html;
  _renderConvCourtNames();
}

function _toggleConvCourts() {
  const checked = document.getElementById('conv-assign-courts')?.checked;
  const detail = document.getElementById('conv-courts-detail');
  if (detail) detail.style.display = checked ? '' : 'none';
}

function _renderConvCourtNames() {
  const count = Math.max(1, +(document.getElementById('conv-court-count')?.value || 2));
  const container = document.getElementById('conv-court-names');
  if (!container) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="court-row">`;
    html += `<span class="court-row-label">${i + 1}</span>`;
    html += `<input type="text" class="conv-court-input" value="Court ${i + 1}" placeholder="Court ${i + 1}">`;
    html += `</div>`;
  }
  container.innerHTML = html;
}

function _setConvMexRounds(mode) {
  const toggle = document.getElementById('conv-mex-rounds-toggle');
  if (toggle) toggle.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', (mode === 'unlimited') === (i === 0)));
  const inp = document.getElementById('conv-mex-rounds');
  if (inp) inp.style.display = mode === 'fixed' ? '' : 'none';
}

let _convGroupPreview = null;  // { groups: { name, players }[] } | null

function _previewOrSubmitConvert(rid) {
  if (_convType === 'group_playoff' && !_convGroupPreview) {
    // Show group preview first
    const names = _usesConvTeamBuilder(rid)
      ? _convTeams.filter(t => t.some(Boolean)).map((team, i) => {
          const label = _convTeamNames[i]?.trim() || team.filter(Boolean).join(' & ');
          return label || `${t('txt_conv_team')} ${i + 1}`;
        })
      : _getConvPlayerNames(rid);
    const numGroups = Math.max(1, +(document.getElementById('conv-num-groups')?.value || 2));
    if (numGroups <= 1) {
      _convGroupPreview = null;
      return _submitConvert(rid);
    }
    // Collect strengths for seeding
    const strengths = {};
    document.querySelectorAll('.conv-strength-input').forEach(inp => {
      if (inp.value !== '') strengths[inp.dataset.key] = +inp.value;
    });
    const groupNames = [];
    for (let i = 0; i < numGroups; i++) groupNames.push(String.fromCharCode(65 + i));
    const strMap = Object.keys(strengths).length ? strengths : null;
    _convGroupPreview = {
      groups: _distributePlayersToGroups(names, numGroups, groupNames, strMap),
      strengths: strMap,
    };
    _renderConvGroupPreview(rid);
    return;
  }
  return _submitConvert(rid);
}

function _renderConvGroupPreview(rid) {
  const container = document.getElementById('conv-group-preview');
  const buttonsEl = document.getElementById('conv-create-buttons');
  if (!container || !_convGroupPreview) return;

  const groups = _convGroupPreview.groups;
  const canAdjustGroups = groups.length > 1;
  const str = _convGroupPreview.strengths;
  let html = `<div class="gp-group-preview-title-row">`;
  html += `<div class="field-section-title" style="margin:0">${t('txt_gp_group_assignments')}</div>`;
  html += `<button type="button" class="gp-preview-close" onclick="_cancelConvGroupPreview('${esc(rid)}')" title="${t('txt_txt_back')}">&times;</button>`;
  html += `</div>`;
  html += `<div class="gp-group-preview-grid">`;
  groups.forEach((g, gi) => {
    html += `<div class="gp-group-preview-col">`;
    html += `<div class="gp-group-preview-header">${esc(g.name)} <span class="gp-group-preview-count">(${g.players.length})</span></div>`;
    g.players.forEach((p, pi) => {
      html += `<div class="gp-group-preview-player">`;
      html += `<span class="gp-group-preview-name">${esc(p)}`;
      if (str && str[p] != null) html += `<span class="gp-group-preview-strength">${str[p]}</span>`;
      html += `</span>`;
      if (canAdjustGroups) {
        html += `<select class="gp-group-preview-move" data-from="${gi}" data-pidx="${pi}" onchange="_moveConvGroupPlayer(this,'${esc(rid)}')">`;
        html += `<option value="" selected></option>`;
        groups.forEach((og, ogi) => {
          if (ogi !== gi) html += `<option value="${ogi}">→ ${esc(og.name)}</option>`;
        });
        html += `</select>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  if (canAdjustGroups) {
    html += `<div class="gp-preview-shuffle-row"><button type="button" class="btn-outline-muted" onclick="_shuffleConvGroups('${esc(rid)}')">${t('txt_gp_shuffle')}</button></div>`;
  }
  container.innerHTML = html;
  container.style.display = '';

  if (buttonsEl) {
    buttonsEl.innerHTML = `<div class="gp-preview-actions">`
      + `<button type="button" class="btn btn-success" style="padding:0.65rem 1.4rem;font-size:1.05rem" onclick="withLoading(this,()=>_submitConvert('${esc(rid)}'))">${t('txt_gp_confirm_create')}</button>`
      + `</div>`;
  }
}

function _moveConvGroupPlayer(selectEl, rid) {
  const fromGroup = +selectEl.dataset.from;
  const playerIdx = +selectEl.dataset.pidx;
  const toGroup = +selectEl.value;
  if (isNaN(toGroup)) return;
  const groups = _convGroupPreview.groups;
  const player = groups[fromGroup].players.splice(playerIdx, 1)[0];
  groups[toGroup].players.push(player);
  _renderConvGroupPreview(rid);
}

function _shuffleConvGroups(rid) {
  const names = _convGroupPreview.groups.flatMap(g => g.players);
  const numGroups = _convGroupPreview.groups.length;
  const groupNames = _convGroupPreview.groups.map(g => g.name);
  _convGroupPreview.groups = _distributePlayersToGroups(names, numGroups, groupNames, null);
  _renderConvGroupPreview(rid);
}

function _cancelConvGroupPreview(rid) {
  _convGroupPreview = null;
  const container = document.getElementById('conv-group-preview');
  const buttonsEl = document.getElementById('conv-create-buttons');
  if (container) { container.innerHTML = ''; container.style.display = 'none'; }
  if (buttonsEl) {
    buttonsEl.innerHTML = `<button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,()=>_previewOrSubmitConvert('${esc(rid)}'))">${t('txt_reg_convert_to_tournament')}</button>`;
  }
}

async function _submitConvert(rid) {
  const msg = document.getElementById('conv-msg');
  try {
    const r = _regDetails[rid];
    if (!r) throw new Error('Registration not found');
    const names = _getConvPlayerNames(rid);

    const body = {
      tournament_type: _convType,
      name: document.getElementById('conv-name')?.value || r.name,
      player_names: names,
      team_mode: _getConvEffectiveTeamMode(rid),
      sport: _getRegistrationSport(rid),
      assign_courts: document.getElementById('conv-assign-courts')?.checked !== false,
      court_names: [...document.querySelectorAll('.conv-court-input')].map(el => el.value || el.placeholder),
      public: document.getElementById('conv-public')?.checked !== false,
    };

    // Team formation
    if (_usesConvTeamBuilder(rid) && _convTeams.length) {
      // Read latest team names from inputs
      document.querySelectorAll('.conv-team-name-input').forEach(inp => {
        const idx = +inp.dataset.idx;
        _convTeamNames[idx] = inp.value;
      });
      body.teams = _convTeams.filter(t => t.some(Boolean));
      body.team_names = _convTeamNames;
      // Include extra team members (not in registrants) in player_names
      const nameSet = new Set(names);
      for (const team of body.teams) {
        for (const m of team) {
          if (m && !nameSet.has(m)) { names.push(m); nameSet.add(m); }
        }
      }
    }

    // Player strengths
    const strengths = {};
    document.querySelectorAll('.conv-strength-input').forEach(inp => {
      if (inp.value !== '') strengths[inp.dataset.key] = +inp.value;
    });
    if (Object.keys(strengths).length) {
      // For team mode, we need to map team labels back to individual member names
      if (_usesConvTeamBuilder(rid) && _convTeams.length) {
        for (let i = 0; i < _convTeams.length; i++) {
          const teamKey = _convTeamNames[i]?.trim() || _convTeams[i].join(' & ');
          if (teamKey in strengths) {
            // Spread team strength equally across members
            const perMember = strengths[teamKey] / _convTeams[i].length;
            for (const member of _convTeams[i]) {
              if (member) body.player_strengths = body.player_strengths || {};
              body.player_strengths[member] = perMember;
            }
          }
        }
      } else {
        body.player_strengths = strengths;
      }
    }

    // Type-specific settings
    if (_convType === 'group_playoff') {
      body.num_groups = +(document.getElementById('conv-num-groups')?.value || 2);
      if (!body.team_mode) {
        const previewGroups = _convGroupPreview?.groups;
        if (previewGroups) {
          const tooSmall = previewGroups.find(g => g.players.length < 4);
          if (tooSmall) throw new Error(`Group '${tooSmall.name}' has only ${tooSmall.players.length} player(s) — individual mode requires at least 4 per group.`);
        } else if (names.length < 4 * body.num_groups) {
          throw new Error(t('txt_err_group_too_small', { n: names.length, g: body.num_groups, min: 4 * body.num_groups }));
        }
      }
      // Attach custom group assignments if previewed
      if (_convGroupPreview) {
        body.group_assignments = {};
        for (const g of _convGroupPreview.groups) {
          body.group_assignments[g.name] = g.players;
        }
        _convGroupPreview = null;
      }
    } else if (_convType === 'mexicano') {
      body.total_points_per_match = +(document.getElementById('conv-mex-pts')?.value || 26);
      const unlimitedBtn = document.getElementById('conv-mex-rounds-toggle')?.querySelector('button');
      const isUnlimited = unlimitedBtn?.classList.contains('active');
      body.num_rounds = isUnlimited ? 0 : +(document.getElementById('conv-mex-rounds')?.value || 8);
      const sg = document.getElementById('conv-mex-skill-gap')?.value?.trim();
      body.skill_gap = sg === '' || sg == null ? null : +sg;
      body.win_bonus = +(document.getElementById('conv-mex-win-bonus')?.value || 0);
      body.strength_weight = +(document.getElementById('conv-mex-strength-weight')?.value || 0);
      body.strength_min_matches = +(document.getElementById('conv-mex-strength-min-matches')?.value ?? 4);
      body.strength_win_factor = +(document.getElementById('conv-mex-strength-win-factor')?.value ?? 1);
      body.strength_draw_factor = +(document.getElementById('conv-mex-strength-draw-factor')?.value ?? 0.75);
      body.strength_loss_factor = +(document.getElementById('conv-mex-strength-loss-factor')?.value ?? 0.5);
      body.loss_discount = +(document.getElementById('conv-mex-loss-discount')?.value || 1);
      body.balance_tolerance = +(document.getElementById('conv-mex-balance-tol')?.value || 0.2);
      body.teammate_repeat_weight = +(document.getElementById('conv-mex-teammate-repeat-wt')?.value || 2);
      body.opponent_repeat_weight = +(document.getElementById('conv-mex-opponent-repeat-wt')?.value || 1);
      body.repeat_decay = +(document.getElementById('conv-mex-repeat-decay')?.value || 0.5);
      body.partner_balance_weight = +(document.getElementById('conv-mex-partner-balance-wt')?.value || 0);
    } else if (_convType === 'playoff') {
      body.double_elimination = document.getElementById('conv-double-elim')?.checked || false;
    }

    const res = await api(`/api/registrations/${rid}/convert`, { method: 'POST', body: JSON.stringify(body) });
    await loadRegistrations();
    // Refresh the cached registration detail so the user can return to it
    try {
      const updated = await api(`/api/registrations/${rid}`);
      _regDetails[rid] = updated;
    } catch (_) { /* registration may have auto-closed; not critical */ }
    // Warn if any selected players were already in a previous tournament
    if (res.overlapping_players?.length) {
      const names = res.overlapping_players.join(', ');
      if (msg) {
        msg.className = 'alert alert-warning';
        msg.textContent = t('txt_reg_overlap_notice', { names });
        msg.classList.remove('hidden');
      }
    }
    // Notify players via email if configured and the toggle is checked
    if (window._emailConfigured && res.tournament_id && document.getElementById('conv-notify-players')?.checked) {
      _notifyTournamentPlayers(res.tournament_id);
    }
    openTournament(res.tournament_id, _convType, body.name || r.name);
  } catch (e) {
    if (msg) { msg.className = 'alert alert-error'; msg.textContent = e.message; msg.classList.remove('hidden'); }
  }
}

// Legacy stubs — kept so createGP/createMex/createPO don't break if _convertFromRegistration was somehow set
function _showConvertBanner() {}
function _cancelConvertMode() {
  _convertFromRegistration = null;
}

// ─── Initialisation ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLanguageSelector();
  _initPageSelector();
  // Restore sport selector from localStorage
  setSport(_currentSport);
  _initParticipantFields();
  initAuth();
  initPersistedForms();
  _updateSchemaSummary();
  if (!isAuthenticated()) {
    setActiveTab('info');
  } else {
    // Check if email sending is configured on the server
    api('/api/tournaments/email-status').then(d => {
      window._emailConfigured = !!d.configured;
    }).catch(() => {});
    loadTournaments();
  }
});

// ─── Registration Collaborators / Sharing ────────────────

/**
 * Render the Collaborators management card for a registration.
 * Only visible to the registration owner and site admins.
 */
