const SPORT_KEY = 'amistoso-sport';
const COMMUNITY_KEY = 'amistoso-community';
const CLUB_KEY = 'amistoso-club';
let _currentSport = 'padel';
try { _currentSport = localStorage.getItem(SPORT_KEY) || 'padel'; } catch (_) {}
let _clubs = [];
let _onCommunityChange = null;

// ─── Community selector ───────────────────────────────────
function _getCommunitySelects() {
  return Array.from(document.querySelectorAll('.create-community-select'));
}

function _getSelectedCommunityId() {
  const activeEl = document.querySelector('.subtab-panel.active .create-community-select');
  if (activeEl) return activeEl.value;
  const [first] = _getCommunitySelects();
  return first ? first.value : 'open';
}

async function _loadCommunities() {
  const selects = _getCommunitySelects();
  if (!selects.length) return;
  try {
    const communities = await api('/api/communities');
    for (const el of selects) {
      el.innerHTML = '';
      for (const c of communities) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.is_builtin ? t('txt_comm_global_default') : c.name;
        el.appendChild(opt);
      }
    }
    // Use explicit localStorage override, then user's server default, then 'open'
    const saved = localStorage.getItem(COMMUNITY_KEY);
    const userDefault = getAuthDefaultCommunity ? getAuthDefaultCommunity() : 'open';
    const firstSelect = selects[0];
    const preferred = (saved && [...firstSelect.options].some(o => o.value === saved)) ? saved : userDefault;
    if ([...firstSelect.options].some(o => o.value === preferred)) {
      for (const el of selects) el.value = preferred;
    }
    // Persist on change
    selects.forEach(el => {
      if (el.dataset.communitySyncBound === '1') return;
      el.addEventListener('change', () => {
        const next = el.value;
        for (const other of _getCommunitySelects()) {
          if (other !== el) other.value = next;
        }
        try { localStorage.setItem(COMMUNITY_KEY, next); } catch (_) {}
        if (_onCommunityChange) _onCommunityChange(next);
      });
      el.dataset.communitySyncBound = '1';
    });
    // Backward compatibility for any code expecting #create-community
    const legacyEl = document.getElementById('create-community');
    if (!legacyEl) {
      const primary = selects[0];
      if (primary) primary.id = 'create-community';
    }
  } catch (e) {
    console.warn('Failed to load communities:', e);
  }
}

// Load communities once the scripts are ready (called from bottom of file)

// ─── Club selector ────────────────────────────────────────
function _getClubSelects() {
  return Array.from(document.querySelectorAll('.create-club-select'));
}

async function _loadClubs() {
  const clubSelects = _getClubSelects();
  if (!clubSelects.length) return;
  try {
    _clubs = await api('/api/clubs');
  } catch (e) {
    console.warn('Failed to load clubs:', e);
    return;
  }

  function _populateClubSelects(communityId) {
    const filtered = _clubs.filter(c => c.community_id === communityId);
    document.querySelectorAll('.create-club-wrapper').forEach(el => {
      el.style.display = filtered.length ? '' : 'none';
    });
    if (!filtered.length) return;
    for (const el of _getClubSelects()) {
      const prev = el.value;
      el.innerHTML = '';
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '\u2014';
      el.appendChild(noneOpt);
      for (const c of filtered) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        el.appendChild(opt);
      }
      if (prev && [...el.options].some(o => o.value === prev)) el.value = prev;
    }
  }

  _populateClubSelects(_getSelectedCommunityId());

  const savedClub = localStorage.getItem(CLUB_KEY) || '';
  if (savedClub && _clubs.some(c => c.id === savedClub)) {
    const club = _clubs.find(c => c.id === savedClub);
    if (club) {
      _populateClubSelects(club.community_id);
      for (const el of _getClubSelects()) el.value = savedClub;
      for (const commEl of _getCommunitySelects()) commEl.value = club.community_id;
      try { localStorage.setItem(COMMUNITY_KEY, club.community_id); } catch (_) {}
    }
  }

  _onCommunityChange = (communityId) => {
    _populateClubSelects(communityId);
    try { localStorage.setItem(CLUB_KEY, ''); } catch (_) {}
  };

  clubSelects.forEach(el => {
    if (el.dataset.clubSyncBound === '1') return;
    el.addEventListener('change', () => {
      const nextClubId = el.value;
      for (const other of _getClubSelects()) {
        if (other !== el) other.value = nextClubId;
      }
      try { localStorage.setItem(CLUB_KEY, nextClubId); } catch (_) {}
      if (nextClubId) {
        const club = _clubs.find(c => c.id === nextClubId);
        if (club) {
          for (const commEl of _getCommunitySelects()) commEl.value = club.community_id;
          try { localStorage.setItem(COMMUNITY_KEY, club.community_id); } catch (_) {}
        }
      }
    });
    el.dataset.clubSyncBound = '1';
  });
}

function setSport(sport) {
  _currentSport = sport;
  try { localStorage.setItem(SPORT_KEY, sport); } catch (_) {}
  // Update toggle UI
  const toggle = document.getElementById('sport-toggle');
  if (toggle) toggle.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.sport === sport));
  // When tennis: force entry modes to use the right defaults
  _applySportToCreatePanel();
}

function syncCreateEntryCardVisibility() {
  const entryCard = document.getElementById('create-entry-card');
  if (!entryCard) return;
  const lobbyTabActive = document.getElementById('create-tab-lobby')?.classList.contains('active');
  const poWrapVisible = !document.getElementById('entry-toggle-po-wrap')?.classList.contains('hidden');
  const poToggle = document.getElementById('po-entry-mode-toggle');
  const poToggleVisible = !!poToggle && poToggle.style.display !== 'none';
  const shouldHide = lobbyTabActive || (poWrapVisible && !poToggleVisible);
  entryCard.classList.toggle('hidden', shouldHide);
}

function _applySportToCreatePanel() {
  const isTennis = _currentSport === 'tennis';
  // gp and mex entry-mode toggles: always visible
  for (const mode of ['gp', 'mex']) {
    const toggle = document.getElementById(`${mode}-entry-mode-toggle`);
    if (!toggle) continue;
    toggle.style.display = '';
    const btns = toggle.querySelectorAll('button');
    btns[0].textContent = t('txt_txt_individual_mode');
    btns[1].textContent = t('txt_txt_team_mode_short');
  }
  // po entry-mode toggle: visible for tennis (default individual), hidden for padel (locked to team)
  const poToggle = document.getElementById('po-entry-mode-toggle');
  if (poToggle) {
    if (isTennis) {
      poToggle.style.display = '';
      setEntryMode('po', 'individual');
    } else {
      poToggle.style.display = 'none';
      setEntryMode('po', 'team');
    }
  }
  // Update lobby name if it still has a default value
  const regNameEl = document.getElementById('reg-new-name');
  if (regNameEl) {
    const defaults = ['My Padel Tournament', 'My Tennis Tournament', 'My Tournament'];
    if (defaults.includes(regNameEl.value.trim())) {
      regNameEl.value = _defaultLobbyName();
    }
  }
  syncCreateEntryCardVisibility();
}

// ─── Participant Manager ──────────────────────────────────
const _EMPTY_ENTRIES = { team: ['', '', '', ''], individual: ['', '', '', '', '', '', '', ''] };
// gp defaults to team mode; mex defaults to individual mode; po always team
const _entryMode = { gp: 'team', mex: 'individual', po: 'team' };
const _participantEntries = {
  gp:  [..._EMPTY_ENTRIES.team],
  mex: [..._EMPTY_ENTRIES.individual],
  po:  [..._EMPTY_ENTRIES.team],
};
const _participantPasteMode = { gp: false, mex: false, po: false };
const _participantEmails = { gp: {}, mex: {}, po: {} };  // name → email
const _participantContacts = { gp: {}, mex: {}, po: {} };  // name → contact info
const _participantProfileIds = { gp: {}, mex: {}, po: {} };  // name → profile_id (from hub link)

// ─── Team Builder State (for team mode direct create) ─────
const _EMPTY_TEAMS = [['', ''], ['', '']];
const _createTeams = {
  gp:  _EMPTY_TEAMS.map(t => [...t]),
  mex: _EMPTY_TEAMS.map(t => [...t]),
  po:  _EMPTY_TEAMS.map(t => [...t]),
};
const _createTeamNames = { gp: [], mex: [], po: [] };

function _entryModeIsTeam(mode) { return _entryMode[mode] === 'team'; }

/** Whether team builder should be used (team mode + not converting from registration).
 *  Tennis mexicano always uses individual inputs (never team builder). */
function _useTeamBuilder(mode) {
  if (mode === 'mex' && _currentSport === 'tennis') return false;
  return _entryModeIsTeam(mode) && !_convertFromRegistration;
}

function renderParticipantFields(mode) {
  if (_useTeamBuilder(mode)) {
    _renderTeamBuilder(mode);
    return;
  }
  const grid = document.getElementById(`${mode}-participant-grid`);
  const addBtn = document.getElementById(`${mode}-add-btn`);
  const countEl = document.getElementById(`${mode}-participant-count`);
  if (!grid) return;
  const entries = _participantEntries[mode];
  // Tennis mexicano always shows individual-style placeholders regardless of toggle
  const isTeam = _entryModeIsTeam(mode) && !(mode === 'mex' && _currentSport === 'tennis');
  grid.innerHTML = '';
  entries.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'participant-entry';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = val;
    inp.placeholder = isTeam ? 'e.g. Alice & Bob' : `e.g. Player ${i + 1}`;
    inp.addEventListener('input', e => {
      _participantEntries[mode][i] = e.target.value;
      _updateParticipantCount(mode);
    });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'participant-remove-btn';
    rm.textContent = '×';
    rm.title = t('txt_txt_remove');
    rm.addEventListener('click', () => removeParticipantField(mode, i));
    row.appendChild(inp);
    row.appendChild(rm);
    grid.appendChild(row);
  });
  const addLabel = isTeam ? t('txt_txt_add_team') : t('txt_txt_add_player');
  if (addBtn) addBtn.textContent = `+ ${addLabel}`;
  // Show paste toggle (may have been hidden by team builder)
  const pasteToggle = document.getElementById(`${mode}-paste-toggle`);
  if (pasteToggle) pasteToggle.style.display = '';
  _updateParticipantCount(mode);
}

// ─── Team Builder Rendering ─────────────────────────────────
function _renderTeamBuilder(mode) {
  const grid = document.getElementById(`${mode}-participant-grid`);
  const addBtn = document.getElementById(`${mode}-add-btn`);
  const pasteToggle = document.getElementById(`${mode}-paste-toggle`);
  if (!grid) return;
  // Hide paste toggle in team builder mode
  if (pasteToggle) pasteToggle.style.display = 'none';

  const teams = _createTeams[mode];
  grid.innerHTML = '';
  teams.forEach((members, ti) => {
    const teamRow = document.createElement('div');
    teamRow.className = 'team-builder-row';

    const teamLabel = document.createElement('div');
    teamLabel.className = 'team-builder-label';
    teamLabel.textContent = `${t('txt_team_builder_team')} ${ti + 1}`;
    teamRow.appendChild(teamLabel);

    const membersDiv = document.createElement('div');
    membersDiv.className = 'team-builder-members';

    members.forEach((name, mi) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = name;
      inp.placeholder = `${t('txt_team_builder_player')} ${mi + 1}`;
      inp.addEventListener('input', e => {
        _createTeams[mode][ti][mi] = e.target.value;
        _updateParticipantCount(mode);
      });
      membersDiv.appendChild(inp);
    });

    // Optional team name
    const labelInp = document.createElement('input');
    labelInp.type = 'text';
    labelInp.className = 'team-builder-name-input';
    labelInp.value = _createTeamNames[mode][ti] || '';
    labelInp.placeholder = t('txt_team_builder_team_name_optional');
    labelInp.addEventListener('input', e => {
      if (!_createTeamNames[mode]) _createTeamNames[mode] = [];
      _createTeamNames[mode][ti] = e.target.value;
    });
    membersDiv.appendChild(labelInp);

    teamRow.appendChild(membersDiv);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'participant-remove-btn';
    rm.textContent = '×';
    rm.title = t('txt_txt_remove');
    rm.addEventListener('click', () => _removeTeamBuilderRow(mode, ti));
    teamRow.appendChild(rm);

    grid.appendChild(teamRow);
  });

  if (addBtn) addBtn.textContent = `+ ${t('txt_txt_add_team')}`;
  _updateParticipantCount(mode);
}

function addParticipantField(mode) {
  if (_useTeamBuilder(mode)) {
    _createTeams[mode].push(['', '']);
    _renderTeamBuilder(mode);
    // Focus last team's first input
    const grid = document.getElementById(`${mode}-participant-grid`);
    if (grid) {
      const rows = grid.querySelectorAll('.team-builder-row');
      if (rows.length) {
        const inputs = rows[rows.length - 1].querySelectorAll('.team-builder-members input');
        if (inputs.length) inputs[0].focus();
      }
    }
    return;
  }
  _participantEntries[mode].push('');
  renderParticipantFields(mode);
  const grid = document.getElementById(`${mode}-participant-grid`);
  if (grid) {
    const inputs = grid.querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }
}

function _removeTeamBuilderRow(mode, index) {
  if (_createTeams[mode].length <= 1) return;
  _createTeams[mode].splice(index, 1);
  _createTeamNames[mode].splice(index, 1);
  _renderTeamBuilder(mode);
}

function _updateParticipantCount(mode) {
  const el = document.getElementById(`${mode}-participant-count`);
  if (!el) return;
  let n;
  if (_useTeamBuilder(mode)) {
    n = _createTeams[mode].filter(team => team.some(m => m.trim())).length;
  } else if (_participantPasteMode[mode]) {
    n = (document.getElementById(`${mode}-players`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean).length;
  } else {
    n = _participantEntries[mode].filter(Boolean).length;
  }
  el.textContent = `(${n})`;
  // Refresh contact fields and strength bubbles when their sections are open
  if (document.getElementById(`${mode}-contact-section`)?.open) renderContactFields(mode);
  if (document.getElementById(`${mode}-strength-section`)?.open) renderStrengthBubbles(mode);
}

function removeParticipantField(mode, index) {
  if (_participantEntries[mode].length <= 1) return;
  _participantEntries[mode].splice(index, 1);
  renderParticipantFields(mode);
}

function togglePasteMode(mode) {
  const panel  = document.getElementById(`${mode}-paste-panel`);
  const fields = document.getElementById(`${mode}-participant-fields`);
  const btn    = document.getElementById(`${mode}-paste-toggle`);
  const isPaste = _participantPasteMode[mode];
  if (!isPaste) {
    // Switch to paste mode — pre-fill textarea from individual fields
    const ta = document.getElementById(`${mode}-players`);
    if (ta) {
      ta.value = _participantEntries[mode].filter(Boolean).join('\n');
      ta.oninput = () => _updateParticipantCount(mode);
    }
    panel?.classList.remove('hidden');
    fields?.classList.add('hidden');
    _participantPasteMode[mode] = true;
    if (btn) btn.innerHTML = `↩ <span data-i18n="txt_txt_use_individual_fields">${t('txt_txt_use_individual_fields')}</span>`;
  } else {
    // Switch back to fields — sync entries from textarea
    const ta = document.getElementById(`${mode}-players`);
    if (ta) {
      const names = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      _participantEntries[mode] = names.length ? names : [''];
    }
    panel?.classList.add('hidden');
    fields?.classList.remove('hidden');
    _participantPasteMode[mode] = false;
    renderParticipantFields(mode);
    if (btn) btn.innerHTML = `📋 <span data-i18n="txt_txt_paste_a_list">${t('txt_txt_paste_a_list')}</span>`;
  }
  _updateParticipantCount(mode);
}

function getParticipantNames(mode) {
  if (_useTeamBuilder(mode)) {
    // In team builder: return team labels (for group preview, count, etc.)
    return _createTeams[mode]
      .filter(team => team.some(m => m.trim()))
      .map((members, i) => {
        const label = (_createTeamNames[mode] || [])[i];
        return (label && label.trim()) ? label.trim() : members.map(m => m.trim()).filter(Boolean).join(' & ');
      })
      .filter(Boolean);
  }
  if (_participantPasteMode[mode]) {
    const ta = document.getElementById(`${mode}-players`);
    if (!ta) return [];
    return ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return _participantEntries[mode].map(s => s.trim()).filter(Boolean);
}

/** Get flat list of all individual player names from the team builder. */
function _getTeamBuilderPlayerNames(mode) {
  const seen = new Set();
  const names = [];
  for (const team of _createTeams[mode]) {
    for (const member of team) {
      const name = member.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/** Get teams array for the backend ([[name1, name2], ...]). */
function _getTeamBuilderTeams(mode) {
  return _createTeams[mode]
    .filter(team => team.some(m => m.trim()))
    .map(members => members.map(m => m.trim()).filter(Boolean));
}

/** Get team_names array for the backend.
 * Uses Array.from to densify sparse arrays — holes become '' — so that
 * JSON.stringify never emits null entries that Pydantic would reject.
 */
function _getTeamBuilderTeamNames(mode) {
  return Array.from(_createTeamNames[mode] || []).map(n => (n || '').trim());
}

function _setCreateMessage(mode, text, isError = false) {
  const msg = document.getElementById(`${mode}-msg`);
  if (!msg) return;
  msg.className = isError ? 'alert alert-error' : 'alert alert-info';
  msg.textContent = text;
  msg.classList.remove('hidden');
}

function _mergeFromClubIntoTeamBuilder(mode, players) {
  const currentNames = new Set(_getTeamBuilderPlayerNames(mode));
  const incoming = players
    .map(p => (p.name || '').trim())
    .filter(Boolean)
    .filter(name => !currentNames.has(name));
  if (!incoming.length) return 0;

  let nextIndex = 0;
  // Fill existing empty slots first to preserve current manual edits.
  for (const team of _createTeams[mode]) {
    for (let memberIndex = 0; memberIndex < team.length && nextIndex < incoming.length; memberIndex += 1) {
      if (!team[memberIndex].trim()) {
        team[memberIndex] = incoming[nextIndex];
        nextIndex += 1;
      }
    }
    if (nextIndex >= incoming.length) break;
  }
  // Append new 2-player rows for any remaining names.
  while (nextIndex < incoming.length) {
    _createTeams[mode].push([
      incoming[nextIndex] || '',
      incoming[nextIndex + 1] || '',
    ]);
    nextIndex += 2;
  }
  return incoming.length;
}

function _mergeFromClubIntoParticipants(mode, players) {
  if (_useTeamBuilder(mode)) {
    return _mergeFromClubIntoTeamBuilder(mode, players);
  }

  const existing = getParticipantNames(mode);
  const existingSet = new Set(existing);
  const incoming = players
    .map(p => (p.name || '').trim())
    .filter(Boolean)
    .filter(name => !existingSet.has(name));
  const merged = existing.concat(incoming);

  _participantEntries[mode] = merged.length ? merged : [''];
  if (_participantPasteMode[mode]) {
    const ta = document.getElementById(`${mode}-players`);
    if (ta) ta.value = merged.join('\n');
  }
  return incoming.length;
}

const _createClubPicker = {
  mode: null,
  players: [],
  query: '',
  selectedKeys: new Set(),
  pendingTeams: [],
};

function _createClubPlayerKey(player) {
  const profileId = (player.profile_id || '').trim();
  if (profileId) return `profile:${profileId}`;
  return `name:${(player.name || '').trim().toLowerCase()}`;
}

function _createClubCurrentNameSet(mode) {
  const names = _useTeamBuilder(mode) ? _getTeamBuilderPlayerNames(mode) : getParticipantNames(mode);
  return new Set(names.map(n => n.trim()).filter(Boolean));
}

function _createClubEnsurePickerModal() {
  if (document.getElementById('create-club-picker-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'create-club-picker-modal';
  overlay.className = 'pc-hub-modal-overlay';
  overlay.innerHTML = `<div class="pc-hub-modal-box create-club-picker-modal-box">`
    + `<div class="pc-hub-modal-header">`
    + `<span class="pc-hub-modal-title">${t('txt_create_pick_from_club_title')}</span>`
    + `<button type="button" class="pc-hub-close-btn" onclick="_createClubClosePicker()">✕</button>`
    + `</div>`
    + `<input type="text" id="create-club-picker-q" class="player-codes-input" placeholder="${t('txt_create_pick_from_club_search')}" oninput="_createClubPickerSearch()">`
    + `<div id="create-club-picker-results" class="pc-hub-results create-club-picker-results"></div>`
    + `<div id="create-club-picker-toolbar" class="create-club-picker-toolbar"></div>`
    + `</div>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) _createClubClosePicker();
  });
  document.body.appendChild(overlay);
}

function _createClubOpenPicker(mode, players) {
  _createClubPicker.mode = mode;
  _createClubPicker.players = Array.isArray(players) ? players : [];
  _createClubPicker.query = '';
  _createClubPicker.selectedKeys.clear();
  _createClubPicker.pendingTeams = [];
  _createClubEnsurePickerModal();
  const modal = document.getElementById('create-club-picker-modal');
  const input = document.getElementById('create-club-picker-q');
  if (modal) modal.classList.add('active');
  if (input) input.value = '';
  _createClubRenderPicker();
  if (input) input.focus();
}

function _createClubClosePicker() {
  const modal = document.getElementById('create-club-picker-modal');
  if (modal) modal.classList.remove('active');
  _createClubPicker.mode = null;
  _createClubPicker.players = [];
  _createClubPicker.query = '';
  _createClubPicker.selectedKeys.clear();
  _createClubPicker.pendingTeams = [];
}

function _createClubPickerSearch() {
  const input = document.getElementById('create-club-picker-q');
  _createClubPicker.query = (input?.value || '').trim().toLowerCase();
  _createClubRenderPicker();
}

function _createClubPickerToggle(key, checked) {
  if (checked) _createClubPicker.selectedKeys.add(key);
  else _createClubPicker.selectedKeys.delete(key);
  _createClubRenderPickerCount();
}

function _createClubRenderPickerCount() {
  const countEl = document.getElementById('create-club-picker-count');
  if (!countEl) return;
  countEl.textContent = t('txt_create_pick_from_club_selected_count', { n: _createClubPicker.selectedKeys.size });
}

function _createClubRenderPicker() {
  const resultsEl = document.getElementById('create-club-picker-results');
  const toolbarEl = document.getElementById('create-club-picker-toolbar');
  if (!resultsEl || !_createClubPicker.mode) return;

  const mode = _createClubPicker.mode;
  const isTeam = _useTeamBuilder(mode);
  const box = resultsEl.closest('.create-club-picker-modal-box');
  if (box) box.classList.toggle('is-team-mode', isTeam);
  resultsEl.classList.toggle('create-club-picker-results--team', isTeam);
  resultsEl.classList.toggle('create-club-picker-results--individual', !isTeam);

  if (toolbarEl) {
    toolbarEl.innerHTML = '';
    toolbarEl.style.display = 'none';
  }

  const nameSet = _createClubCurrentNameSet(mode);
  const query = _createClubPicker.query;
  const filtered = _createClubPicker.players.filter(p => {
    if (!query) return true;
    const text = `${(p.name || '').toLowerCase()} ${(p.email || '').toLowerCase()}`;
    return text.includes(query);
  });

  if (isTeam) {
    _createClubRenderPickerTeamMode(resultsEl, filtered, nameSet);
  } else {
    _createClubRenderPickerIndividualMode(resultsEl, filtered, nameSet);
  }
}

function _createClubRenderPickerIndividualMode(resultsEl, filtered, nameSet) {
  if (!filtered.length) {
    resultsEl.innerHTML = `<div class="create-club-picker-empty">${t('txt_create_pick_from_club_none')}</div>`;
    return;
  }
  let html = '';
  for (const p of filtered) {
    const key = _createClubPlayerKey(p);
    const name = (p.name || '').trim();
    const alreadyAdded = !!name && nameSet.has(name);
    const elo = _createClubEloForCurrentSport(p);
    const eloDisplay = elo !== null ? Math.round(elo) : null;
    html += `<div class="cpk-row${alreadyAdded ? ' cpk-row--added' : ''}">`;
    html += `<span class="cpk-row-name">${esc(name || '\u2014')}`;
    if (alreadyAdded) html += ` <span class="create-club-picker-added">${t('txt_create_pick_from_club_already_added')}</span>`;
    html += `</span>`;
    html += `<span class="cpk-row-elo">${eloDisplay !== null ? eloDisplay : ''}</span>`;
    html += `<button type="button" class="btn btn-sm" onclick="_createClubPickerAddSingle('${escAttr(key)}')" ${alreadyAdded ? 'disabled' : ''}>${t('txt_create_pick_from_club_add_one')}</button>`;
    html += `</div>`;
  }
  resultsEl.innerHTML = html;
}

function _createClubRenderPickerTeamMode(resultsEl, filtered, nameSet) {
  const pendingKeys = new Set(_createClubPicker.pendingTeams.flat());
  let playersHtml = '';
  if (!filtered.length) {
    playersHtml = `<div class="create-club-picker-empty">${t('txt_create_pick_from_club_none')}</div>`;
  } else {
    for (const p of filtered) {
      const key = _createClubPlayerKey(p);
      const name = (p.name || '').trim();
      const alreadyAdded = !!name && nameSet.has(name);
      const inPending = pendingKeys.has(key);
      const disabled = alreadyAdded || inPending;
      const elo = _createClubEloForCurrentSport(p);
      const eloDisplay = elo !== null ? Math.round(elo) : null;
      playersHtml += `<div class="create-club-picker-row${disabled ? ' is-added' : ''}">`;
      playersHtml += `<span class="create-club-picker-name">${esc(name || '\u2014')}`;
      if (alreadyAdded) playersHtml += ` <span class="create-club-picker-added">${t('txt_create_pick_from_club_already_added')}</span>`;
      else if (inPending) playersHtml += ` <span class="create-club-picker-added">${t('txt_create_pick_from_club_in_team')}</span>`;
      playersHtml += `</span>`;
      if (eloDisplay !== null) playersHtml += `<span class="create-club-picker-elo">${eloDisplay}</span>`;
      playersHtml += `<button type="button" class="btn btn-sm" onclick="_createClubPickerAddSingle('${escAttr(key)}')" ${disabled ? 'disabled' : ''} title="${t('txt_create_pick_from_club_add_one')}">${t('txt_create_pick_from_club_add_one')}</button>`;
      playersHtml += `<button type="button" class="btn btn-sm btn-primary ccpicker-add-btn" onclick="_createClubPickerTeamAdd('${escAttr(key)}')" ${disabled ? 'disabled' : ''} title="${t('txt_create_pick_from_club_pair')}">+</button>`;
      playersHtml += `</div>`;
    }
  }
  let teamsHtml = '';
  if (_createClubPicker.pendingTeams.length === 0) {
    teamsHtml = `<div class="ccpicker-team-empty">${t('txt_create_pick_from_club_team_hint')}</div>`;
  } else {
    for (let ti = 0; ti < _createClubPicker.pendingTeams.length; ti++) {
      const team = _createClubPicker.pendingTeams[ti];
      teamsHtml += `<div class="ccpicker-team-card">`;
      teamsHtml += `<div class="ccpicker-team-label">${t('txt_team_builder_team')} ${ti + 1}</div>`;
      for (let mi = 0; mi < 2; mi++) {
        if (mi < team.length) {
          const playerObj = _createClubFindPlayerByKey(team[mi]);
          const pName = playerObj ? esc((playerObj.name || '').trim() || '\u2014') : '\u2014';
          teamsHtml += `<div class="ccpicker-team-slot ccpicker-team-slot--filled">`;
          teamsHtml += `<span>${pName}</span>`;
          teamsHtml += `<button type="button" class="ccpicker-remove-btn" onclick="_createClubPickerTeamRemove(${ti}, ${mi})">\u00d7</button>`;
          teamsHtml += `</div>`;
        } else {
          teamsHtml += `<div class="ccpicker-team-slot ccpicker-team-slot--empty"><span>${t('txt_create_pick_from_club_empty_slot')}</span></div>`;
        }
      }
      teamsHtml += `</div>`;
    }
  }
  const n = _createClubPicker.pendingTeams.length;
  const confirmLabel = n > 0 ? t('txt_create_pick_from_club_confirm_teams', { n }) : t('txt_create_pick_from_club_add_teams');
  const confirmBtn = `<div class="ccpicker-confirm-row"><button type="button" class="btn btn-sm btn-primary" ${n === 0 ? 'disabled' : ''} onclick="_createClubPickerConfirmTeams()">${confirmLabel}</button></div>`;
  resultsEl.innerHTML = `<div class="ccpicker-team-layout">`
    + `<div class="ccpicker-team-players">`
    + `<div class="ccpicker-panel-header">${t('txt_create_pick_from_club_players_panel')}</div>`
    + playersHtml
    + `</div>`
    + `<div class="ccpicker-team-panel">`
    + `<div class="ccpicker-panel-header">${t('txt_create_pick_from_club_teams_panel')}</div>`
    + `<div class="ccpicker-team-list">${teamsHtml}</div>`
    + confirmBtn
    + `</div>`
    + `</div>`;
}

function _createClubPickerTeamAdd(key) {
  const teams = _createClubPicker.pendingTeams;
  const last = teams[teams.length - 1];
  if (!last || last.length >= 2) {
    teams.push([key]);
  } else {
    last.push(key);
  }
  _createClubRenderPicker();
}

function _createClubPickerTeamRemove(teamIdx, memberIdx) {
  const teams = _createClubPicker.pendingTeams;
  if (!teams[teamIdx]) return;
  teams[teamIdx].splice(memberIdx, 1);
  if (teams[teamIdx].length === 0) teams.splice(teamIdx, 1);
  _createClubRenderPicker();
}

function _createClubPickerConfirmTeams() {
  const mode = _createClubPicker.mode;
  if (!mode || !_createClubPicker.pendingTeams.length) return;
  const players = [];
  for (const teamKeys of _createClubPicker.pendingTeams) {
    for (const key of teamKeys) {
      const p = _createClubFindPlayerByKey(key);
      if (p) players.push(p);
    }
  }
  if (!players.length) return;
  const addedCount = _createClubImportPlayers(mode, players);
  if (addedCount > 0) {
    _setCreateMessage(mode, t('txt_create_added_from_club', { added: addedCount, total: players.length }), false);
  }
  _createClubClosePicker();
}

function _createClubGetSelectedPlayers() {
  if (!_createClubPicker.mode) return [];
  const nameSet = _createClubCurrentNameSet(_createClubPicker.mode);
  return _createClubPicker.players.filter(p => {
    const key = _createClubPlayerKey(p);
    const name = (p.name || '').trim();
    if (!name || nameSet.has(name)) return false;
    return _createClubPicker.selectedKeys.has(key);
  });
}

function _createClubFindPlayerByKey(key) {
  return _createClubPicker.players.find(p => _createClubPlayerKey(p) === key) || null;
}

function _createClubEloForCurrentSport(player) {
  const raw = _currentSport === 'tennis' ? player.elo_tennis : player.elo_padel;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function _createClubImportPlayers(mode, players) {
  const addedCount = _mergeFromClubIntoParticipants(mode, players);
  for (const p of players) {
    const playerName = (p.name || '').trim();
    if (!playerName) continue;
    if (p.email) _participantEmails[mode][playerName] = p.email;
    if (p.has_hub_profile !== false && p.profile_id) {
      _participantProfileIds[mode][playerName] = p.profile_id;
    }
    const elo = _createClubEloForCurrentSport(p);
    if (elo !== null) _createStrengths[mode][playerName] = elo;
  }
  renderParticipantFields(mode);
  _updateParticipantCount(mode);
  return addedCount;
}

function _createClubPickerAddSelected() {
  const mode = _createClubPicker.mode;
  if (!mode) return;
  const selectedPlayers = _createClubGetSelectedPlayers();
  if (!selectedPlayers.length) {
    _setCreateMessage(mode, t('txt_create_club_no_new_players'));
    return;
  }
  const addedCount = _createClubImportPlayers(mode, selectedPlayers);
  _setCreateMessage(mode, t('txt_create_added_from_club', { added: addedCount, total: selectedPlayers.length }), false);
  for (const p of selectedPlayers) {
    _createClubPicker.selectedKeys.delete(_createClubPlayerKey(p));
  }
  _createClubRenderPicker();
}

function _createClubPickerAddSingle(key) {
  const mode = _createClubPicker.mode;
  if (!mode) return;
  const player = _createClubFindPlayerByKey(key);
  if (!player) return;
  const addedCount = _createClubImportPlayers(mode, [player]);
  if (addedCount > 0) {
    _setCreateMessage(mode, t('txt_create_added_one_from_club', { name: player.name }), false);
  } else {
    _setCreateMessage(mode, t('txt_create_club_no_new_players'));
  }
  _createClubPicker.selectedKeys.delete(key);
  _createClubRenderPicker();
}

async function addPlayersFromClub(mode) {
  try {
    const clubEl = document.getElementById(`create-club-${mode}`);
    const clubId = (clubEl?.value || '').trim();
    if (!clubId) {
      _setCreateMessage(mode, t('txt_create_select_club_first'), true);
      return;
    }

    const players = await api(`/api/clubs/${encodeURIComponent(clubId)}/players`);
    if (!Array.isArray(players) || players.length === 0) {
      _setCreateMessage(mode, t('txt_create_club_has_no_players'));
      return;
    }
    _createClubOpenPicker(mode, players);
  } catch (e) {
    _setCreateMessage(mode, e.message || t('txt_txt_something_went_wrong'), true);
  }
}

/** Collect player_emails dict from contact details section (name → email, only non-empty). */
function getPlayerEmails(mode) {
  const emails = {};
  for (const [name, email] of Object.entries(_participantEmails[mode])) {
    if (name && email) emails[name] = email;
  }
  return Object.keys(emails).length > 0 ? emails : null;
}

/** Collect player_contacts dict from contact details section (name → contact, only non-empty). */
function getPlayerContacts(mode) {
  const contacts = {};
  for (const [name, contact] of Object.entries(_participantContacts[mode])) {
    if (name && contact) contacts[name] = contact;
  }
  return Object.keys(contacts).length > 0 ? contacts : null;
}

/** Collect player_profile_ids dict from hub link selections (name → profile_id, only non-empty). */
function getPlayerProfileIds(mode) {
  const ids = {};
  for (const [name, pid] of Object.entries(_participantProfileIds[mode])) {
    if (name && pid) ids[name] = pid;
  }
  return Object.keys(ids).length > 0 ? ids : null;
}

function setEntryMode(mode, entryMode) {
  const prev = _entryMode[mode];
  _entryMode[mode] = entryMode;
  const toggle = document.getElementById(`${mode}-entry-mode-toggle`);
  if (toggle) {
    toggle.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === entryMode);
    });
  }
  // Reset to empty entries when mode changes — but keep entries during convert mode
  if (prev !== entryMode && !_convertFromRegistration) {
    // Tennis mexicano always uses individual-sized entry slots
    const entryKey = (mode === 'mex' && _currentSport === 'tennis') ? 'individual' : (entryMode === 'team' ? 'team' : 'individual');
    _participantEntries[mode] = [..._EMPTY_ENTRIES[entryKey]];
    // Also reset team builder state
    _createTeams[mode] = _EMPTY_TEAMS.map(t => [...t]);
    _createTeamNames[mode] = [];
    if (_participantPasteMode[mode]) {
      const ta = document.getElementById(`${mode}-players`);
      if (ta) ta.value = _participantEntries[mode].join('\n');
    }
  }
  renderParticipantFields(mode);
  if (mode === 'mex') {
    // Partner balance is relevant when backend team_mode=false (2v2 dynamic pairing).
    // For tennis the mapping is inverted: UI "Team" → backend team_mode=false.
    const backendTeamMode = _currentSport === 'tennis' ? entryMode !== 'team' : entryMode === 'team';
    const pbwField = document.getElementById('mex-partner-balance-wt-field');
    if (pbwField) pbwField.style.display = backendTeamMode ? 'none' : '';
  }
}

function clearParticipants(mode) {
  _participantEntries[mode] = [];
  _participantEmails[mode] = {};
  _participantContacts[mode] = {};
  _participantProfileIds[mode] = {};
  _createStrengths[mode] = {};
  _createTeams[mode] = _EMPTY_TEAMS.map(t => [...t]);
  _createTeamNames[mode] = [];
  if (_participantPasteMode[mode]) {
    const ta = document.getElementById(`${mode}-players`);
    if (ta) ta.value = _participantEntries[mode].join('\n');
    _updateParticipantCount(mode);
  } else {
    renderParticipantFields(mode);
  }
}

// ─── Initial strength (create panels) ─────────────────────
const _createStrengths = { gp: {}, mex: {}, po: {} };

function renderStrengthBubbles(mode) {
  const container = document.getElementById(`${mode}-strength-container`);
  if (!container) return;
  // In team-builder mode use individual player names — backend aggregates per-individual
  // strengths into team-level strength, so the keys must be individual names.
  const names = _useTeamBuilder(mode) ? _getTeamBuilderPlayerNames(mode) : getParticipantNames(mode);
  // Prune stale keys
  for (const k of Object.keys(_createStrengths[mode])) {
    if (!names.includes(k)) delete _createStrengths[mode][k];
  }
  if (!names.length) { container.innerHTML = ''; return; }
  let html = '<div class="conv-strength-grid">';
  names.forEach(name => {
    const val = _createStrengths[mode][name] ?? '';
    html += `<div class="conv-strength-entry">`;
    html += `<label>${esc(name)}</label>`;
    html += `<input type="number" class="create-strength-input" data-mode="${mode}" data-key="${esc(name)}" value="${val}" placeholder="0" min="0" step="1" oninput="_createStrengths['${mode}'][this.dataset.key]=this.value?+this.value:undefined">`;
    html += `</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function _getCreateStrengths(mode) {
  const result = {};
  const names = _useTeamBuilder(mode) ? _getTeamBuilderPlayerNames(mode) : getParticipantNames(mode);
  for (const name of names) {
    const raw = _createStrengths[mode][name];
    if (raw === undefined || raw === null || raw === '') continue;
    const val = Number(raw);
    if (Number.isFinite(val)) result[name] = val;
  }
  return Object.keys(result).length ? result : null;
}

// ─── Contact details (create panels) ─────────────────────
function renderContactFields(mode) {
  const container = document.getElementById(`${mode}-contact-container`);
  if (!container) return;
  // In team-builder mode use individual player names so each person gets their own
  // email/contact entry — the backend maps these by individual name, not team label.
  const names = _useTeamBuilder(mode) ? _getTeamBuilderPlayerNames(mode) : getParticipantNames(mode);
  // Prune stale keys
  for (const k of Object.keys(_participantEmails[mode])) {
    if (!names.includes(k)) delete _participantEmails[mode][k];
  }
  for (const k of Object.keys(_participantContacts[mode])) {
    if (!names.includes(k)) delete _participantContacts[mode][k];
  }
  for (const k of Object.keys(_participantProfileIds[mode])) {
    if (!names.includes(k)) delete _participantProfileIds[mode][k];
  }
  if (!names.length) { container.innerHTML = ''; return; }
  let html = '<div class="contact-grid">';
  names.forEach(name => {
    const emailVal = _participantEmails[mode][name] || '';
    const contactVal = _participantContacts[mode][name] || '';
    const escaped = esc(name);
    html += `<div class="contact-entry">`;
    html += `<label title="${escaped}">${escaped}</label>`;
    html += `<input type="email" class="create-contact-email" data-mode="${mode}" data-key="${escaped}" value="${esc(emailVal)}" placeholder="${t('txt_contact_email_placeholder')}" oninput="_participantEmails['${mode}'][this.dataset.key]=this.value.trim()">`;
    html += `<input type="text" class="create-contact-info" data-mode="${mode}" data-key="${escaped}" value="${esc(contactVal)}" placeholder="${t('txt_contact_info_placeholder')}" oninput="_participantContacts['${mode}'][this.dataset.key]=this.value.trim()">`;
    html += `<button type="button" class="contact-hub-btn" title="${t('txt_hub_link')}" onclick="_createHubOpen('${escAttr(mode)}','${escAttr(name)}')">🔗</button>`;
    html += `</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}
// ─── Court name helpers ───────────────────────────────────
function _defaultCourtName(n) {
  return `${t('txt_txt_court')} ${n}`;
}

function renderCourtInputs(prefix) {
  const countEl = document.getElementById(`${prefix}-court-count`);
  const container = document.getElementById(`${prefix}-court-names-container`);
  if (!countEl || !container) return;
  const count = Math.max(1, Math.min(20, parseInt(countEl.value, 10) || 1));
  const existing = Array.from(container.querySelectorAll('input'));
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const newDefault = _defaultCourtName(i);
    const oldInput = existing[i - 1];
    const value = oldInput
      ? (oldInput.value === oldInput.dataset.default ? newDefault : oldInput.value)
      : newDefault;
    const row = document.createElement('div');
    row.className = 'court-row';
    const lbl = document.createElement('span');
    lbl.className = 'court-row-label';
    lbl.textContent = `${i}.`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.placeholder = newDefault;
    inp.setAttribute('aria-label', newDefault);
    inp.dataset.default = newDefault;
    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  }
}

function getCourtNames(prefix) {
  const cb = document.getElementById(`${prefix}-assign-courts`);
  if (cb && !cb.checked) return [];
  const container = document.getElementById(`${prefix}-court-names-container`);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input')).map(el => el.value.trim()).filter(Boolean);
}

function refreshCourtDefaults(prefix) {
  const container = document.getElementById(`${prefix}-court-names-container`);
  if (!container) return;
  container.querySelectorAll('input').forEach((inp, i) => {
    const newDefault = _defaultCourtName(i + 1);
    if (inp.value === inp.dataset.default) inp.value = newDefault;
    inp.placeholder = newDefault;
    inp.setAttribute('aria-label', newDefault);
    inp.dataset.default = newDefault;
  });
}

function toggleCourtSection(prefix) {
  const cb = document.getElementById(`${prefix}-assign-courts`);
  const detail = document.getElementById(`${prefix}-courts-detail`);
  if (detail) detail.style.display = (cb && !cb.checked) ? 'none' : '';
}

function _defaultGroupName(n) {
  return String.fromCharCode(64 + n); // A, B, C…
}

function renderGroupInputs() {
  const countEl = document.getElementById('gp-num-groups');
  const container = document.getElementById('gp-group-names-container');
  if (!countEl || !container) return;
  // Re-render participants so group slot badges update
  renderParticipantFields('gp');
  const count = Math.max(1, parseInt(countEl.value, 10) || 1);
  const existing = Array.from(container.querySelectorAll('input'));
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const newDefault = _defaultGroupName(i);
    const oldInput = existing[i - 1];
    const value = oldInput
      ? (oldInput.value === oldInput.dataset.default ? newDefault : oldInput.value)
      : newDefault;
    const row = document.createElement('div');
    row.className = 'court-row';
    const lbl = document.createElement('span');
    lbl.className = 'court-row-label';
    lbl.textContent = `${i}.`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.placeholder = newDefault;
    inp.setAttribute('aria-label', newDefault);
    inp.dataset.default = newDefault;
    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  }
}

function getGroupNames() {
  const container = document.getElementById('gp-group-names-container');
  if (!container) return [];
  return Array.from(container.querySelectorAll('input')).map(el => el.value.trim());
}

function _initParticipantFields() {
  renderParticipantFields('gp');
  renderParticipantFields('mex');
  renderParticipantFields('po');
  renderCourtInputs('gp');
  renderCourtInputs('mex');
  renderCourtInputs('po');
  renderGroupInputs();
  // Render contact fields and strength bubbles when their sections are toggled open
  for (const mode of ['gp', 'mex', 'po']) {
    const contactSection = document.getElementById(`${mode}-contact-section`);
    if (contactSection) contactSection.addEventListener('toggle', () => { if (contactSection.open) renderContactFields(mode); });
    const section = document.getElementById(`${mode}-strength-section`);
    if (section) section.addEventListener('toggle', () => { if (section.open) renderStrengthBubbles(mode); });
  }
}

// ─── Group Preview & Assignment ─────────────────────────────
let _gpGroupPreview = null; // { groups: { name: string, players: string[] }[] } | null

function _distributePlayersToGroups(names, numGroups, groupNames, strengths) {
  /**
   * Client-side distribution matching backend logic.
   * If strengths provided → sort by strength desc then snake-draft.
   * Otherwise → shuffle then deal.
   */
  let ordered = [...names];
  const hasStrengths = strengths && Object.keys(strengths).length > 0;
  if (hasStrengths) {
    ordered.sort((a, b) => (strengths[b] || 0) - (strengths[a] || 0));
  } else {
    // Fisher-Yates shuffle
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  const buckets = Array.from({ length: numGroups }, () => []);
  if (hasStrengths) {
    // Snake draft
    let idx = 0, dir = 1;
    for (const p of ordered) {
      buckets[idx].push(p);
      const next = idx + dir;
      if (next >= numGroups || next < 0) dir *= -1;
      else idx = next;
    }
  } else {
    ordered.forEach((p, i) => buckets[i % numGroups].push(p));
  }
  return buckets.map((players, i) => ({
    name: (groupNames && groupNames[i]?.trim()) || String.fromCharCode(65 + i),
    players,
  }));
}

function previewGPGroups() {
  const msg = document.getElementById('gp-msg');
  try {
    const names = getParticipantNames('gp');
    if (names.length < 2) throw new Error(t('txt_txt_need_at_least_2_players'));
    const numGroups = Math.max(1, +document.getElementById('gp-num-groups').value || 2);
    if (numGroups <= 1) {
      _gpGroupPreview = null;
      msg.classList.add('hidden');
      return createGP();
    }
    const groupNames = getGroupNames();
    const strengths = _getCreateStrengths('gp');
    _gpGroupPreview = {
      groups: _distributePlayersToGroups(names, numGroups, groupNames, strengths),
      strengths,
    };
    _renderGPGroupPreview();
    msg.classList.add('hidden');
  } catch (e) { msg.className = 'alert alert-error'; msg.textContent = e.message; msg.classList.remove('hidden'); }
}

function _renderGPGroupPreview() {
  const container = document.getElementById('gp-group-preview');
  const buttonsEl = document.getElementById('gp-create-buttons');
  if (!container || !_gpGroupPreview) return;

  const groups = _gpGroupPreview.groups;
  const canAdjustGroups = groups.length > 1;
  const str = _gpGroupPreview.strengths;
  let html = `<div class="gp-group-preview-title-row">`;
  html += `<div class="field-section-title field-section-title-inline">📋 ${t('txt_gp_group_assignments')}</div>`;
  html += `<button type="button" class="gp-preview-close" onclick="_cancelGPPreview()" title="${t('txt_txt_back')}">&times;</button>`;
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
        html += `<select class="gp-group-preview-move" data-from="${gi}" data-pidx="${pi}" onchange="_moveGPPlayer(this)">`;
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
    html += `<div class="gp-preview-shuffle-row"><button type="button" class="btn-outline-muted" onclick="_shuffleGPGroups()">🔀 ${t('txt_gp_shuffle')}</button></div>`;
  }

  container.innerHTML = html;
  container.style.display = '';

  // Centered confirm button
  buttonsEl.innerHTML = `<div class="gp-preview-actions">`
    + `<button type="button" class="btn btn-success btn-mid-action" data-action="withLoading" data-handler="createGP">🏆 ${t('txt_gp_confirm_create')}</button>`
    + `</div>`;
}

function _moveGPPlayer(selectEl) {
  const fromGroup = +selectEl.dataset.from;
  const playerIdx = +selectEl.dataset.pidx;
  const toGroup = +selectEl.value;
  if (isNaN(toGroup)) return;
  const groups = _gpGroupPreview.groups;
  const player = groups[fromGroup].players.splice(playerIdx, 1)[0];
  groups[toGroup].players.push(player);
  _renderGPGroupPreview();
}

function _shuffleGPGroups() {
  const names = _gpGroupPreview.groups.flatMap(g => g.players);
  const numGroups = _gpGroupPreview.groups.length;
  const groupNames = _gpGroupPreview.groups.map(g => g.name);
  _gpGroupPreview.groups = _distributePlayersToGroups(names, numGroups, groupNames, null);
  _renderGPGroupPreview();
}

function _cancelGPPreview() {
  _gpGroupPreview = null;
  const container = document.getElementById('gp-group-preview');
  const buttonsEl = document.getElementById('gp-create-buttons');
  if (container) { container.innerHTML = ''; container.style.display = 'none'; }
  if (buttonsEl) {
    buttonsEl.innerHTML = `<button type="button" class="btn btn-success btn-lg-action" data-action="withLoading" data-handler="previewGPGroups" data-i18n="txt_txt_create_tournament">${t('txt_txt_create_tournament')}</button>`;
  }
}

// ─── Create Group+Playoff ─────────────────────────────────
async function createGP() {
  const msg = document.getElementById('gp-msg');
  try {
    const names = getParticipantNames('gp');
    if (names.length < 2) throw new Error(t('txt_txt_need_at_least_2_players'));
    const useBuilder = _useTeamBuilder('gp');
    const body = {
      name: document.getElementById('gp-name').value,
      player_names: useBuilder ? _getTeamBuilderPlayerNames('gp') : getParticipantNames('gp'),
      team_mode: _currentSport === 'tennis' ? true : _entryModeIsTeam('gp'),
      assign_courts: document.getElementById('gp-assign-courts')?.checked !== false,
      court_names: getCourtNames('gp'),
      num_groups: +document.getElementById('gp-num-groups').value,
      group_names: getGroupNames(),
      public: document.getElementById('gp-public').checked,
      sport: _currentSport,
      community_id: _getSelectedCommunityId(),
    };
    if (useBuilder) {
      body.teams = _getTeamBuilderTeams('gp');
      body.team_names = _getTeamBuilderTeamNames('gp');
    }
    const gpStr = _getCreateStrengths('gp');
    if (gpStr) body.player_strengths = gpStr;
    const gpEmails = getPlayerEmails('gp');
    if (gpEmails) body.player_emails = gpEmails;
    const gpContacts = getPlayerContacts('gp');
    if (gpContacts) body.player_contacts = gpContacts;
    const gpProfileIds = getPlayerProfileIds('gp');
    if (gpProfileIds) body.player_profile_ids = gpProfileIds;
    // Validate group sizes in individual mode
    if (!body.team_mode) {
      const previewGroups = _gpGroupPreview?.groups;
      if (previewGroups) {
        const tooSmall = previewGroups.find(g => g.players.length < 4);
        if (tooSmall) throw new Error(t('txt_err_group_too_small', { n: names.length, g: body.num_groups, min: 4 * body.num_groups }));
      } else if (names.length < 4 * body.num_groups) {
        throw new Error(t('txt_err_group_too_small', { n: names.length, g: body.num_groups, min: 4 * body.num_groups }));
      }
    }
    // Attach custom group assignments if the preview was used
    if (_gpGroupPreview) {
      body.group_assignments = {};
      for (const g of _gpGroupPreview.groups) {
        body.group_assignments[g.name] = g.players;
      }
      _gpGroupPreview = null;
    }
    if (_convertFromRegistration) {
      body.tournament_type = 'group_playoff';
      const rid = _convertFromRegistration.rid;
      const res = await api(`/api/registrations/${rid}/convert`, { method: 'POST', body: JSON.stringify(body) });
      _cancelConvertMode();
      _openTournaments = _openTournaments.filter(t => t.id !== rid);
      await loadRegistrations();
      openTournament(res.tournament_id, 'group_playoff', body.name || t('txt_txt_group_playoff_tournament'));
    } else {
      const res = await api('/api/tournaments/group-playoff', { method: 'POST', body: JSON.stringify(body) });
      openTournament(res.id, 'group_playoff', body.name || t('txt_txt_group_playoff_tournament'));
    }
  } catch (e) { msg.className = 'alert alert-error'; msg.textContent = e.message; msg.classList.remove('hidden'); }
}

// ─── Create Mexicano ──────────────────────────────────────
async function createMex() {
  const msg = document.getElementById('mex-msg');
  try {
    const names = getParticipantNames('mex');
    // For tennis the mapping is inverted: UI "Individual" → backend team_mode=true (1v1)
    const isTeam = _currentSport === 'tennis' ? !_entryModeIsTeam('mex') : _entryModeIsTeam('mex');
    const useBuilder = _useTeamBuilder('mex');
    if (isTeam && names.length < 2) throw new Error(t('txt_txt_need_at_least_2_teams'));
    if (!isTeam && names.length < 4) throw new Error(t('txt_txt_need_at_least_4_players_individual_mex'));
    const skillGapRaw = document.getElementById('mex-skill-gap').value.trim();
    const rolling = document.getElementById('mex-rounds-toggle').querySelectorAll('button')[0].classList.contains('active');
    const body = {
      name: document.getElementById('mex-name').value,
      player_names: useBuilder ? _getTeamBuilderPlayerNames('mex') : getParticipantNames('mex'),
      assign_courts: document.getElementById('mex-assign-courts')?.checked !== false,
      court_names: getCourtNames('mex'),
      total_points_per_match: +document.getElementById('mex-pts').value,
      num_rounds: rolling ? 0 : +document.getElementById('mex-rounds').value,
      team_mode: _currentSport === 'tennis' ? !_entryModeIsTeam('mex') : _entryModeIsTeam('mex'),
      skill_gap: skillGapRaw === '' ? null : +skillGapRaw,
      win_bonus: +document.getElementById('mex-win-bonus').value,
      strength_weight: +document.getElementById('mex-strength-weight').value,
      strength_min_matches: +document.getElementById('mex-strength-min-matches').value,
      strength_win_factor: +document.getElementById('mex-strength-win-factor').value,
      strength_draw_factor: +document.getElementById('mex-strength-draw-factor').value,
      strength_loss_factor: +document.getElementById('mex-strength-loss-factor').value,
      loss_discount: +document.getElementById('mex-loss-discount').value,
      balance_tolerance: +document.getElementById('mex-balance-tol').value,
      teammate_repeat_weight: +document.getElementById('mex-teammate-repeat-wt').value,
      opponent_repeat_weight: +document.getElementById('mex-opponent-repeat-wt').value,
      repeat_decay: +document.getElementById('mex-repeat-decay').value,
      partner_balance_weight: +document.getElementById('mex-partner-balance-wt').value,
      public: document.getElementById('mex-public').checked,
      sport: _currentSport,
      community_id: _getSelectedCommunityId(),
    };
    if (useBuilder) {
      body.teams = _getTeamBuilderTeams('mex');
      body.team_names = _getTeamBuilderTeamNames('mex');
    }
    const mexStr = _getCreateStrengths('mex');
    if (mexStr) body.player_strengths = mexStr;
    const mexEmails = getPlayerEmails('mex');
    if (mexEmails) body.player_emails = mexEmails;
    const mexContacts = getPlayerContacts('mex');
    if (mexContacts) body.player_contacts = mexContacts;
    const mexProfileIds = getPlayerProfileIds('mex');
    if (mexProfileIds) body.player_profile_ids = mexProfileIds;
    if (_convertFromRegistration) {
      body.tournament_type = 'mexicano';
      const rid = _convertFromRegistration.rid;
      const res = await api(`/api/registrations/${rid}/convert`, { method: 'POST', body: JSON.stringify(body) });
      _cancelConvertMode();
      _openTournaments = _openTournaments.filter(t => t.id !== rid);
      await loadRegistrations();
      openTournament(res.tournament_id, 'mexicano', body.name || t('txt_txt_mexicano_tournament'));
    } else {
      const res = await api('/api/tournaments/mexicano', { method: 'POST', body: JSON.stringify(body) });
      openTournament(res.id, 'mexicano', body.name || t('txt_txt_mexicano_tournament'));
    }
  } catch (e) { msg.className = 'alert alert-error'; msg.textContent = e.message; msg.classList.remove('hidden'); }
}

// ─── Create Playoff-only ──────────────────────────────────
async function createPO() {
  const msg = document.getElementById('po-msg');
  try {
    const names = getParticipantNames('po');
    const useBuilder = _useTeamBuilder('po');
    if (names.length < 2) throw new Error(t('txt_txt_need_at_least_2_participants'));
    const body = {
      name: document.getElementById('po-name').value,
      participant_names: useBuilder ? _getTeamBuilderPlayerNames('po') : getParticipantNames('po'),
      assign_courts: document.getElementById('po-assign-courts')?.checked !== false,
      court_names: getCourtNames('po'),
      team_mode: _currentSport === 'tennis' ? _entryModeIsTeam('po') : true,
      double_elimination: document.getElementById('po-double-elim').checked,
      public: document.getElementById('po-public').checked,
      sport: _currentSport,
      community_id: _getSelectedCommunityId(),
    };
    if (useBuilder) {
      body.teams = _getTeamBuilderTeams('po');
      body.team_names = _getTeamBuilderTeamNames('po');
    }
    const poStr = _getCreateStrengths('po');
    if (poStr) body.player_strengths = poStr;
    const poEmails = getPlayerEmails('po');
    if (poEmails) body.player_emails = poEmails;
    const poContacts = getPlayerContacts('po');
    if (poContacts) body.player_contacts = poContacts;
    const poProfileIds = getPlayerProfileIds('po');
    if (poProfileIds) body.player_profile_ids = poProfileIds;
    if (_convertFromRegistration) {
      body.tournament_type = 'playoff';
      body.player_names = body.participant_names;
      delete body.participant_names;
      const rid = _convertFromRegistration.rid;
      const res = await api(`/api/registrations/${rid}/convert`, { method: 'POST', body: JSON.stringify(body) });
      _cancelConvertMode();
      _openTournaments = _openTournaments.filter(t => t.id !== rid);
      await loadRegistrations();
      openTournament(res.tournament_id, 'playoff', body.name || t('txt_txt_play_off_only_tournament'));
    } else {
      const res = await api('/api/tournaments/playoff', { method: 'POST', body: JSON.stringify(body) });
      openTournament(res.id, 'playoff', body.name || t('txt_txt_play_off_only_tournament'));
    }
  } catch (e) { msg.className = 'alert alert-error'; msg.textContent = e.message; msg.classList.remove('hidden'); }
}

// ─── Hub profile search for contact fields ────────────────
let _createHubTimer = null;
let _createHubMode = null;
let _createHubName = null;

function _createHubEnsureModal() {
  if (document.getElementById('create-hub-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'create-hub-modal';
  overlay.className = 'pc-hub-modal-overlay';
  overlay.innerHTML = `<div class="pc-hub-modal-box">`
    + `<div class="pc-hub-modal-header">`
    + `<span class="pc-hub-modal-title">🔗 ${t('txt_hub_link')}</span>`
    + `<button type="button" class="pc-hub-close-btn" onclick="_createHubClose()">✕</button>`
    + `</div>`
    + `<input type="text" id="create-hub-q" class="player-codes-input" placeholder="${t('txt_hub_search_placeholder')}" oninput="_createHubDebouncedSearch()">`
    + `<div id="create-hub-results" class="pc-hub-results"></div>`
    + `</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) _createHubClose(); });
  document.body.appendChild(overlay);
}

function _createHubOpen(mode, playerName) {
  _createHubMode = mode;
  _createHubName = playerName;
  _createHubEnsureModal();
  const modal = document.getElementById('create-hub-modal');
  const input = document.getElementById('create-hub-q');
  modal.classList.add('active');
  input.value = playerName || '';
  document.getElementById('create-hub-results').innerHTML = '';
  _createHubDoSearch();
  input.focus();
}

function _createHubClose() {
  const modal = document.getElementById('create-hub-modal');
  if (modal) modal.classList.remove('active');
  _createHubMode = null;
  _createHubName = null;
}

function _createHubDebouncedSearch() {
  clearTimeout(_createHubTimer);
  _createHubTimer = setTimeout(() => _createHubDoSearch(), 250);
}

async function _createHubDoSearch() {
  const input = document.getElementById('create-hub-q');
  const results = document.getElementById('create-hub-results');
  if (!input || !results) return;
  const q = input.value.trim();
  results.innerHTML = '<em style="font-size:0.8rem;color:var(--text-muted)">…</em>';
  try {
    const profiles = await api(`/api/admin/player-profiles?q=${encodeURIComponent(q)}`);
    if (profiles.length === 0) {
      results.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);padding:0.3rem 0">${t('txt_hub_no_results')}</div>`;
      return;
    }
    let html = '';
    for (const p of profiles) {
      if (p.is_ghost) continue;
      html += `<div class="pc-hub-result-item" onclick="_createHubSelect('${escAttr(p.id)}')">`;
      html += `<span class="pc-hub-result-name">${esc(p.name || '—')}</span>`;
      if (p.email) html += `<span class="pc-hub-result-email">${esc(p.email)}</span>`;
      html += `</div>`;
    }
    results.innerHTML = html;
  } catch (e) {
    results.innerHTML = `<div style="font-size:0.8rem;color:var(--danger)">${esc(e.message)}</div>`;
  }
}

async function _createHubSelect(profileId) {
  try {
    const profile = await api(`/api/admin/player-profiles/${profileId}`);
    const mode = _createHubMode;
    const name = _createHubName;
    if (!mode || !name) return;
    if (profile.email) {
      _participantEmails[mode][name] = profile.email;
      const el = document.querySelector(`.create-contact-email[data-mode="${mode}"][data-key="${CSS.escape(name)}"]`);
      if (el) el.value = profile.email;
    }
    if (profile.contact) {
      _participantContacts[mode][name] = profile.contact;
      const el = document.querySelector(`.create-contact-info[data-mode="${mode}"][data-key="${CSS.escape(name)}"]`);
      if (el) el.value = profile.contact;
    }
    _participantProfileIds[mode][name] = profile.id;
    _createHubClose();
  } catch (e) {
    alert(e.message);
  }
}

// ─── Community + Club list bootstrap ─────────────────────
_loadCommunities().then(() => _loadClubs());

// ─── Render Group+Playoff ─────────────────────────────────
