const SPORT_KEY = 'amistoso-sport';
let _currentSport = 'padel';
try { _currentSport = localStorage.getItem(SPORT_KEY) || 'padel'; } catch (_) {}

function setSport(sport) {
  _currentSport = sport;
  try { localStorage.setItem(SPORT_KEY, sport); } catch (_) {}
  // Update toggle UI
  const toggle = document.getElementById('sport-toggle');
  if (toggle) toggle.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.sport === sport));
  // When tennis: force entry modes to use the right defaults
  _applySportToCreatePanel();
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

// ─── Team Builder State (for team mode direct create) ─────
const _EMPTY_TEAMS = [['', ''], ['', '']];
const _createTeams = {
  gp:  _EMPTY_TEAMS.map(t => [...t]),
  mex: _EMPTY_TEAMS.map(t => [...t]),
  po:  _EMPTY_TEAMS.map(t => [...t]),
};
const _createTeamNames = { gp: [], mex: [], po: [] };

function _entryModeIsTeam(mode) { return _entryMode[mode] === 'team'; }

/** Whether team builder should be used (team mode + not converting from registration). */
function _useTeamBuilder(mode) {
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
  const isTeam = _entryModeIsTeam(mode);
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
    _participantEntries[mode] = [..._EMPTY_ENTRIES[entryMode === 'team' ? 'team' : 'individual']];
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
    const pbwField = document.getElementById('mex-partner-balance-wt-field');
    if (pbwField) pbwField.style.display = entryMode === 'team' ? 'none' : '';
  }
}

function clearParticipants(mode) {
  _participantEntries[mode] = [];
  _participantEmails[mode] = {};
  _participantContacts[mode] = {};
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
  document.querySelectorAll(`.create-strength-input[data-mode="${mode}"]`).forEach(inp => {
    if (inp.value !== '') result[inp.dataset.key] = +inp.value;
  });
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
    if (names.length < 2) throw new Error(t('txt_txt_need_at_least_2_players') || 'Need at least 2 players');
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
    if (names.length < 2) throw new Error('Need at least 2 players');
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
    // Validate group sizes in individual mode
    if (!body.team_mode) {
      const previewGroups = _gpGroupPreview?.groups;
      if (previewGroups) {
        const tooSmall = previewGroups.find(g => g.players.length < 4);
        if (tooSmall) throw new Error(`Group '${tooSmall.name}' has only ${tooSmall.players.length} player(s) — individual mode requires at least 4 per group.`);
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
    const isTeam = _currentSport === 'tennis' || _entryModeIsTeam('mex');
    const useBuilder = _useTeamBuilder('mex');
    if (isTeam && names.length < 2) throw new Error('Need at least 2 teams');
    if (!isTeam && names.length < 4) throw new Error('Need at least 4 players for individual Mexicano');
    const skillGapRaw = document.getElementById('mex-skill-gap').value.trim();
    const rolling = document.getElementById('mex-rounds-toggle').querySelectorAll('button')[0].classList.contains('active');
    const body = {
      name: document.getElementById('mex-name').value,
      player_names: useBuilder ? _getTeamBuilderPlayerNames('mex') : getParticipantNames('mex'),
      assign_courts: document.getElementById('mex-assign-courts')?.checked !== false,
      court_names: getCourtNames('mex'),
      total_points_per_match: +document.getElementById('mex-pts').value,
      num_rounds: rolling ? 0 : +document.getElementById('mex-rounds').value,
      team_mode: _currentSport === 'tennis' ? true : _entryModeIsTeam('mex'),
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
    if (names.length < 2) throw new Error('Need at least 2 participants');
    const body = {
      name: document.getElementById('po-name').value,
      participant_names: useBuilder ? _getTeamBuilderPlayerNames('po') : getParticipantNames('po'),
      assign_courts: document.getElementById('po-assign-courts')?.checked !== false,
      court_names: getCourtNames('po'),
      team_mode: _currentSport === 'tennis' ? _entryModeIsTeam('po') : true,
      double_elimination: document.getElementById('po-double-elim').checked,
      public: document.getElementById('po-public').checked,
      sport: _currentSport,
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
    _createHubClose();
  } catch (e) {
    alert(e.message);
  }
}

// ─── Render Group+Playoff ─────────────────────────────────
