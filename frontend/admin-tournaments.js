async function api(path, opts = {}) {
  return apiAuth(API + path, opts);
}

// ─── Button loading state helper ──────────────────────────
async function withLoading(btn, asyncFn) {
  if (!btn || btn.classList.contains('loading')) return;
  const origText = btn.textContent;
  btn.classList.add('loading');
  try { await asyncFn(); }
  finally { btn.classList.remove('loading'); }
}

// ─── Home: list tournaments ───────────────────────────────
function _phaseLabel(phase) {
  const map = {
    setup: t('txt_txt_setup'), groups: t('txt_txt_group_stage'), playoffs: t('txt_txt_play_offs'),
    finished: t('txt_txt_finished'), mexicano: t('txt_txt_mexicano'),
  };
  return map[phase] || phase;
}

async function loadTournaments() {
  try {
    const registrationsPath = '/api/registrations?include_archived=1';
    const [list, regList] = await Promise.all([
      api('/api/tournaments'),
      isAuthenticated() ? api(registrationsPath).catch(() => []) : Promise.resolve([]),
    ]);
    const visibleRegList = _showArchivedRegistrations
      ? regList
      : regList.filter(r => !r.archived);
    _tournamentMeta = {};
    for (const tournament of list) _tournamentMeta[tournament.id] = tournament;
    _registrations = visibleRegList;
    const el = document.getElementById('tournament-list');
    const archivedToggleEl = document.getElementById('archived-lobbies-toggle');
    const finEl = document.getElementById('finished-tournament-list');
    const finCard = document.getElementById('finished-tournaments-card');
    const active = list.filter(tr => tr.phase !== 'finished');
    const finished = list.filter(tr => tr.phase === 'finished');
    // Active section: open lobbies and closed, never-converted lobbies (unless archived view is enabled).
    // Finished section: converted and archived lobbies are always shown.
    const lobbies = visibleRegList.filter(
      r => r.open || (!r.open && !(r.converted_to_tids?.length) && !_showArchivedRegistrations)
    );
    const finishedLobbies = regList.filter(
      r => !r.open && ((r.converted_to_tids?.length || 0) > 0 || r.archived)
    );
    const closedLobbiesCount = regList.filter(r => !r.open).length;
    const renderTournamentCard = (tournament) => {
      const canEdit = isAdmin() || getAuthUsername() === tournament.owner || tournament.shared === true;
      const canDelete = isAdmin() || getAuthUsername() === tournament.owner;
      const isPublic = tournament.public !== false;
      const visBtn = canEdit
        ? `<button type="button" class="btn btn-sm btn-visibility" title="${t('txt_txt_visibility')}" onclick="togglePublic('${tournament.id}',${isPublic})">${isPublic ? '🌍 ' + t('txt_txt_public') : '🔒 ' + t('txt_txt_private')}</button>`
        : '';
      const deleteBtn = canDelete
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteTournament('${tournament.id}')">✕</button>`
        : '';
      const actionBtns = (canEdit || canDelete) ? `${visBtn}${deleteBtn}` : '';
      const isTennis = tournament.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const sharedBadge = tournament.shared ? `<span class="badge badge-shared">${t('txt_badge_shared')}</span>` : '';
      return `
      <div class="match-card tournament-list-card${tournament.id === currentTid ? ' active-tournament' : ''}">
        <div class="match-teams">
          <a class="tournament-name-link" href="#" onclick="openTournament('${tournament.id}','${tournament.type}');return false">${esc(tournament.name)}</a>
          <span class="badge badge-sport">${esc(sportLabel)}</span>
          ${!isTennis ? `<span class="badge badge-type">${tournament.team_mode ? t('txt_txt_team_mode_short') : t('txt_txt_individual_mode')}</span>` : ''}
          <span class="badge badge-phase">${_phaseLabel(tournament.phase)}</span>
          ${sharedBadge}
        </div>
        <div class="tournament-actions">${actionBtns}</div>
      </div>
    `;
    };
    // Render lobby cards in the same list style
    const _renderLobbyCard = (r) => {
      const rid = r.id;
      const isOpen = r.open;
      const count = r.registrant_count || 0;
      const isTennis = (r.sport || 'padel') === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const phaseBadge = isOpen
        ? `<span class="badge badge-lobby-open">${t('txt_reg_registration_open')}</span>`
        : `<span class="badge badge-lobby-closed">${r.archived ? t('txt_reg_registration_archived') : t('txt_reg_registration_closed')}</span>`;
      const countLabel = `<span class="reg-lobby-count">(${count})</span>`;
      const isListed = r.listed !== false && r.listed !== 0;
      const visBtn = `<button type="button" class="btn btn-sm btn-visibility" title="${t('txt_txt_visibility')}" onclick="_toggleRegListed('${esc(rid)}',${isListed})">${isListed ? '🌍 ' + t('txt_txt_public') : '🔒 ' + t('txt_txt_private')}</button>`;
      const actionBtns = `
        ${visBtn}
        <button type="button" class="btn btn-danger btn-sm" onclick="_deleteRegistration('${esc(rid)}')" title="${t('txt_reg_delete')}">✕</button>
      `;
      return `
      <div class="match-card tournament-list-card reg-lobby-card">
        <div class="match-teams">
          <a class="tournament-name-link" href="#" onclick="openRegistration('${escAttr(rid)}','${escAttr(r.name)}');return false">${esc(r.name)}</a>
          <span class="badge badge-sport">${esc(sportLabel)}</span>
          ${phaseBadge} ${countLabel}
        </div>
        <div class="tournament-actions">
          ${actionBtns}
        </div>
      </div>
    `;
    };
    const _renderFinishedSection = () => {
      const finishedTournamentsHtml = finished.map(renderTournamentCard).join('');
      const convertedLobbies = finishedLobbies.filter(r => (r.converted_to_tids?.length || 0) > 0 && !r.archived);
      const archivedLobbies = finishedLobbies.filter(r => r.archived);
      const convertedLobbiesHtml = convertedLobbies.map(_renderLobbyCard).join('');
      const archivedCount = archivedLobbies.length;
      const archivedTabHtml = archivedCount > 0
        ? `<details class="card archived-lobbies-panel">
            <summary class="archived-lobbies-summary">${t('txt_reg_show_archived')} (${archivedCount})</summary>
            <div class="archived-lobbies-body">${archivedLobbies.map(_renderLobbyCard).join('')}</div>
          </details>`
        : '';
      return {
        hasContent: Boolean(finishedTournamentsHtml || convertedLobbiesHtml || archivedTabHtml),
        html: `${finishedTournamentsHtml}${convertedLobbiesHtml}${archivedTabHtml}`,
      };
    };
    if (!active.length && !lobbies.length) {
      el.innerHTML = `<div class="tournaments-empty-state"><div class="tournaments-empty-icon">🏆</div><div class="tournaments-empty-title">${t('txt_txt_no_tournaments_yet')}</div><div class="tournaments-empty-hint">${t('txt_txt_no_tournaments_hint')}</div><button type="button" class="btn btn-primary btn-sm" onclick="setActiveTab('create')">${t('txt_txt_create_first')}</button></div>`;
      const finishedSection = _renderFinishedSection();
      if (finishedSection.hasContent) {
        finCard.style.display = '';
        finEl.innerHTML = finishedSection.html;
      } else {
        finCard.style.display = 'none';
      }
      return;
    }
    const archivedToggle = isAuthenticated() && closedLobbiesCount > 0 ? `
      <div class="archived-lobbies-toggle-wrap">
        <button
          type="button"
          class="archived-lobbies-toggle${_showArchivedRegistrations ? ' active' : ''}"
          onclick="_setShowArchivedRegistrations(${_showArchivedRegistrations ? 'false' : 'true'})"
          aria-pressed="${_showArchivedRegistrations ? 'true' : 'false'}"
        >
          <span>${t('txt_reg_show_archived')}</span>
          <span class="archived-lobbies-count">${closedLobbiesCount}</span>
        </button>
      </div>
    ` : '';
    // Lobbies first, then active tournaments
    let html = lobbies.map(_renderLobbyCard).join('');
    html += active.map(renderTournamentCard).join('');
    el.innerHTML = html || `<em>${t('txt_txt_no_tournaments_yet')}</em>`;
    if (archivedToggleEl) archivedToggleEl.innerHTML = archivedToggle;
    const finishedSection = _renderFinishedSection();
    if (finishedSection.hasContent) {
      finCard.style.display = '';
      finEl.innerHTML = finishedSection.html;
    } else {
      finCard.style.display = 'none';
    }
  } catch (e) { console.error(e); }
}

async function deleteTournament(id) {
  if (!confirm(t('txt_txt_delete_this_tournament'))) return;
  await api('/api/tournaments/' + id, { method: 'DELETE' });
  _openTournaments = _openTournaments.filter(tournament => tournament.id !== id);
  if (id === currentTid) {
    _stopAdminVersionPoll();
    currentTid = null;
    currentType = null;
    currentTournamentName = null;
    updateActiveTournamentUI();
    setActiveTab('home');
  } else {
    updateActiveTournamentUI();
  }
  loadTournaments();
}

async function togglePublic(id, currentlyPublic) {
  try {
    await api(`/api/tournaments/${id}/public`, {
      method: 'PATCH',
      body: JSON.stringify({ public: !currentlyPublic }),
    });
    loadTournaments();
  } catch (e) { console.error('togglePublic failed:', e); }
}

// ─── Open a tournament ────────────────────────────────────
let currentTid = null, currentType = null;
let currentTournamentName = null;
let _tournamentMeta = {};
let _openTournaments = [];  // [{id, type, name}] for quick-switch chips
let _totalPts = 0;  // set per Mexicano tournament for auto-fill
let _gpScoreMode = { 'gp-group': 'points', 'gp-playoff': 'points', 'mex-playoff': 'points', 'po-playoff': 'points' };
let _scoreConfirmationMode = 'immediate';  // mirrors tvSettings.score_confirmation for matchRow badge display
let _mexPlayers = [];  // [{id, name}] for manual editor
let _mexBreakdowns = {};  // {match_id: {player_id: {raw, strength_mult, loss_disc, win_bonus, final}}}
let _mexStrengthWeight = 0;
let _mexPlayerMap = {};  // {player_id: player_name}
let _mexTeamMode = false;  // true when each participant is a pre-formed pair
let _mexSortCol = null;      // null = server default order; otherwise a leaderboard field key
let _mexSortDir = 'desc';    // 'asc' | 'desc'

// ─── Admin live-refresh (version polling) ─────────────────
let _adminVersionPollTimer = null;
let _adminLastKnownVersion = null;
let _adminVersionEtag = null;
let _adminVersionFetching = false;
const _ADMIN_POLL_INTERVAL_MS = 30000;

function _startAdminVersionPoll() {
  _stopAdminVersionPoll();
  if (!currentTid) return;
  // Seed the version so the first poll doesn't trigger a spurious reload.
  // Capture tid locally so the async callbacks don't clobber state for a
  // different tournament if the user switches before the fetch resolves.
  const _seedTid = currentTid;
  fetch(`/api/tournaments/${_seedTid}/version`)
    .then((r) => {
      if (r.status === 304) return null;
      const etag = r.headers.get('etag');
      return r.json().then((d) => ({ etag, version: d.version }));
    })
    .then((d) => {
      if (!d || currentTid !== _seedTid) return;
      if (d.etag) _adminVersionEtag = d.etag;
      _adminLastKnownVersion = d.version;
    })
    .catch(() => {});
  _adminVersionPollTimer = setInterval(async () => {
    if (!currentTid || _adminVersionFetching || document.hidden) return;
    _adminVersionFetching = true;
    try {
      const d = await fetch(`/api/tournaments/${currentTid}/version`, {
        headers: _adminVersionEtag ? { 'If-None-Match': _adminVersionEtag } : undefined,
      }).then((r) => {
        if (r.status === 304) return null;
        const etag = r.headers.get('etag');
        if (etag) _adminVersionEtag = etag;
        return r.json();
      });
      if (!d) return; // 304 — version unchanged
      if (_adminLastKnownVersion !== null && d.version !== _adminLastKnownVersion) {
        _adminLastKnownVersion = d.version;
        await _rerenderCurrentViewPreserveDrafts();
      } else {
        _adminLastKnownVersion = d.version;
      }
    } catch (_) { /* network blip — ignore */ }
    finally { _adminVersionFetching = false; }
  }, _ADMIN_POLL_INTERVAL_MS);
}

function _stopAdminVersionPoll() {
  if (_adminVersionPollTimer) { clearInterval(_adminVersionPollTimer); _adminVersionPollTimer = null; }
  _adminLastKnownVersion = null;
  _adminVersionEtag = null;
  _adminVersionFetching = false;
}

function _refreshCurrentView() {
  if (!currentTid) return;
  if (currentType === 'registration') renderRegistration();
  else if (currentType === 'group_playoff') renderGP();
  else if (currentType === 'playoff') renderPO();
  else renderMex();
}

function updateActiveTournamentUI() {
  const indicator = document.getElementById('active-tournament-indicator');
  const hasActive = Boolean(currentTid);
  const refreshBtn = document.getElementById('admin-refresh-btn');
  if (refreshBtn) refreshBtn.style.display = hasActive ? '' : 'none';
  if (hasActive) {
    const shownName = currentTournamentName || `#${String(currentTid).slice(0, 8)}`;
    indicator.innerHTML = `${t('txt_txt_active_tournament')} <strong>${esc(shownName)}</strong>`;
    indicator.style.display = '';
  } else {
    indicator.innerHTML = `${t('txt_txt_active_tournament')} <strong>${t('txt_txt_none_selected')}</strong>`;
    indicator.style.display = 'none';
  }
  _renderTournamentChips();
}

function _renderTournamentChips() {
  const container = document.getElementById('tournament-chips');
  if (!container) return;
  container.innerHTML = _openTournaments.map(tournament =>
    `<button type="button" class="tab-btn tournament-chip${tournament.id === currentTid ? ' active' : ''}" data-tid="${tournament.id}" data-type="${tournament.type}" title="${esc(tournament.name)}">
      <span class="chip-check">✓</span>${esc(tournament.name)}
      <span class="chip-close" data-close-tid="${tournament.id}" title="${t('txt_txt_remove')}">×</span>
    </button>`
  ).join('');
  container.querySelectorAll('.tournament-chip').forEach(btn => {
    btn.addEventListener('click', e => {
      const closeTid = e.target.closest('[data-close-tid]')?.dataset.closeTid;
      if (closeTid) { _unpinTournament(closeTid); return; }
      const tournament = _openTournaments.find(entry => entry.id === btn.dataset.tid);
      if (!tournament) return;
      if (tournament.type === 'registration') openRegistration(tournament.id, tournament.name);
      else openTournament(tournament.id, tournament.type, tournament.name);
    });
  });
}

function _unpinTournament(id) {
  _openTournaments = _openTournaments.filter(tournament => tournament.id !== id);
  if (id === currentTid) {
    if (_openTournaments.length > 0) {
      const next = _openTournaments[_openTournaments.length - 1];
      if (next.type === 'registration') openRegistration(next.id, next.name);
      else openTournament(next.id, next.type, next.name);
    } else {
      _stopAdminVersionPoll();
      currentTid = null; currentType = null; currentTournamentName = null;
      updateActiveTournamentUI();
      setActiveTab('home');
    }
  } else {
    _renderTournamentChips();
  }
}

function _isNotFoundError(error) {
  const msg = String(error?.message || '');
  return /not\s*found/i.test(msg);
}

function _recoverFromMissingOpenTournament(renderTid, error) {
  if (!_isNotFoundError(error)) return false;
  _openTournaments = _openTournaments.filter(tournament => tournament.id !== renderTid);
  if (currentTid !== renderTid) {
    _renderTournamentChips();
    return true;
  }

  _stopAdminVersionPoll();
  _stopRegDetailPoll();
  currentTid = null;
  currentType = null;
  currentTournamentName = null;
  updateActiveTournamentUI();

  if (_openTournaments.length > 0) {
    const next = _openTournaments[_openTournaments.length - 1];
    if (next.type === 'registration') openRegistration(next.id, next.name);
    else openTournament(next.id, next.type, next.name);
  } else {
    setActiveTab('home');
  }
  return true;
}

function _autoFillScore(matchId, total) {
  const s1El = document.getElementById('s1-' + matchId);
  const s2El = document.getElementById('s2-' + matchId);
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

/** Auto-fill complementary score in the dispute resolution custom inputs (Mexicano). */
function _autoFillDisputeCustom(matchId, total) {
  const s1El = document.getElementById('drs1-' + matchId);
  const s2El = document.getElementById('drs2-' + matchId);
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

function openTournament(id, type, name = null) {
  if (id !== currentTid) {
    _playoffTeams = [];
    _mexPlayoffTeamCount = 4;
    _savedPlayoffTeams = {};
    _mexExternalParticipants = [];
    _mexExtCounter = 0;
    _playoffScoreMap = {};
  }
  currentTid = id;
  currentType = type;
  currentTournamentName = name || _tournamentMeta[id]?.name || null;
  // Track in the open-tournament list for quick-switch chips
  const existing = _openTournaments.find(t => t.id === id);
  if (existing) {
    existing.name = currentTournamentName || existing.name;
  } else {
    _openTournaments.push({ id, type, name: currentTournamentName || id });
  }
  updateActiveTournamentUI();
  setActiveTab('view');
  if (type === 'group_playoff') renderGP();
  else if (type === 'playoff') renderPO();
  else renderMex();
  _stopRegDetailPoll();
  _startAdminVersionPoll();
}

function openRegistration(rid, name) {
  currentTid = rid;
  currentType = 'registration';
  currentTournamentName = name || rid;
  const existing = _openTournaments.find(t => t.id === rid);
  if (existing) {
    existing.name = name || existing.name;
  } else {
    _openTournaments.push({ id: rid, type: 'registration', name: name || rid });
  }
  updateActiveTournamentUI();
  setActiveTab('view');
  renderRegistration();
  _stopAdminVersionPoll();
  _startRegDetailPoll();
}

async function renderRegistration() {
  const el = document.getElementById('view-content');
  if (!el || !currentTid) return;
  const _renderTid = currentTid;
  el.innerHTML = `<div class="card"><em>${t('txt_txt_loading')}</em></div>`;
  try {
    const [data, collabResult, emailSettingsResult] = await Promise.all([
      api(`/api/registrations/${_renderTid}`),
      getAuthUsername()
        ? api(`/api/registrations/${_renderTid}/collaborators`).catch(() => null)
        : Promise.resolve(null),
      window._emailConfigured && getAuthUsername()
        ? api(`/api/registrations/${_renderTid}/email-settings`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (currentTid !== _renderTid) return;
    _regDetails[_renderTid] = data;
    _currentRegDetail = data;
    if (collabResult) _regCollaborators[_renderTid] = collabResult.collaborators || [];
    if (emailSettingsResult) _regEmailSettings[_renderTid] = emailSettingsResult;
    _renderRegDetailInline(_renderTid);
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`;
  }
}

// ─── Sport selector ──────────────────────────────────────
