// ─── Unified per-club Settings card ───────────────────────────────────────
//
// Mirrors the per-tournament (admin-settings-panel.js) and per-lobby
// (admin-lobby-settings-panel.js) Settings cards: a single collapsible card
// with sub-tabs for all per-club configuration. Operational content
// (Players + Leaderboard) stays in primary cards above the Settings card.
//
// Sub-tabs: general | tiers | seasons | comms | access
// Active sub-tab persists per-clubId in `adminClubSettingsSubtab:<clubId>`,
// open/closed state in `adminClubSettingsOpen:<clubId>`. Empty bodies are
// skipped (e.g. comms/access for non-owners).

const CLUB_SUBTAB_DEFAULT = 'general';
const CLUB_SUBTABS = ['general', 'tiers', 'seasons', 'assignments', 'comms', 'access'];

function _clubSubtabStorageKey(clubId) {
  return `adminClubSettingsSubtab:${clubId}`;
}

function _clubSettingsOpenStorageKey(clubId) {
  return `adminClubSettingsOpen:${clubId}`;
}

function _getClubSettingsOpen(clubId) {
  try {
    return localStorage.getItem(_clubSettingsOpenStorageKey(clubId)) === '1';
  } catch (_) {
    return false;
  }
}

function _setClubSettingsOpen(clubId, open) {
  try { localStorage.setItem(_clubSettingsOpenStorageKey(clubId), open ? '1' : '0'); } catch (_) { /* ignore */ }
}

function _getClubSubtab(clubId) {
  try {
    const v = localStorage.getItem(_clubSubtabStorageKey(clubId));
    return CLUB_SUBTABS.includes(v) ? v : CLUB_SUBTAB_DEFAULT;
  } catch (_) {
    return CLUB_SUBTAB_DEFAULT;
  }
}

/**
 * Switch active sub-tab inside the club Settings card and persist.
 */
function setClubSubtab(clubId, key) {
  if (!CLUB_SUBTABS.includes(key)) return;
  try { localStorage.setItem(_clubSubtabStorageKey(clubId), key); } catch (_) { /* ignore */ }
  const root = document.getElementById('club-settings-card');
  if (!root) return;
  root.querySelectorAll('.settings-subtab-btn').forEach(btn => {
    const isActive = btn.dataset.subtab === key;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
  });
  root.querySelectorAll('.settings-subpanel').forEach(panel => {
    const isActive = panel.dataset.subtab === key;
    panel.classList.toggle('hidden', !isActive);
  });
}

/**
 * Open the club Settings card (if collapsed) and jump to a sub-tab.
 * Used by the club status-bar shortcut button.
 */
function _jumpToClubSettings(clubId, subtab) {
  const card = document.getElementById('club-settings-card');
  if (!card) return;
  const details = card.querySelector('details.admin-settings-details');
  if (details && !details.open) {
    details.open = true;
    if (clubId) _setClubSettingsOpen(clubId, true);
  }
  if (subtab && clubId) setClubSubtab(clubId, subtab);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Status bar ───────────────────────────────────────────────────────────

/**
 * Render the club detail status bar: back button, name + logo, community
 * label, a compact player-count badge, an inline sport toggle, and the
 * Settings shortcut. Replaces both the old freeform header card and the
 * standalone sticky sport bar.
 */
function _renderClubStatusBar(club, comm) {
  const playerCount = Array.isArray(_clubPlayers) ? _clubPlayers.length : 0;
  const activeSeasons = Array.isArray(_clubSeasons) ? _clubSeasons.filter(s => s.active) : [];

  const logoImg = club.has_logo
    ? `<img src="/api/clubs/${esc(club.id)}/logo?_=${Date.now()}" alt="" class="club-status-bar-logo">`
    : '';

  // Compact season chip: shown only when there are 2+ active seasons (the
  // single-active case is already obvious from the leaderboard scope dropdown).
  const seasonChip = activeSeasons.length > 1
    ? `<span class="badge badge-open" title="${escAttr(activeSeasons.map(s => s.name).join(', '))}">📅 ${activeSeasons.length} ${esc(t('txt_clubs_status_seasons_active'))}</span>`
    : '';

  const sportToggle = `
    <div class="clubs-sport-toggle clubs-sport-toggle--inline" role="group" aria-label="${escAttr(t('txt_txt_sport'))}">
      <button type="button" class="clubs-sport-pill${_clubsSport === 'padel' ? ' clubs-sport-pill--active' : ''}" data-sport="padel" onclick="setClubsSport('padel')">${t('txt_txt_sport_padel')}</button>
      <button type="button" class="clubs-sport-pill${_clubsSport === 'tennis' ? ' clubs-sport-pill--active' : ''}" data-sport="tennis" onclick="setClubsSport('tennis')">${t('txt_txt_sport_tennis')}</button>
    </div>
  `;

  // Settings shortcut: scroll to (and expand) the Settings card.
  const settingsMenu = `
    <button type="button" class="btn btn-sm btn-muted status-bar-settings-btn"
      title="${escAttr(t('txt_admin_status_jump_settings'))}"
      aria-label="${escAttr(t('txt_admin_status_jump_settings'))}"
      onclick="_jumpToClubSettings('${esc(club.id)}')">⚙</button>`;

  return `
    <div class="card club-status-bar tournament-status-bar" id="club-status-bar-${esc(club.id)}">
      <div class="club-status-bar-row">
        <button class="btn btn-sm club-status-bar-back" onclick="clubsBackToOverview()" aria-label="${escAttr(t('txt_txt_back'))}">←</button>
        ${logoImg}
        <h3 class="club-status-bar-title">${esc(club.name)}${comm ? `<span class="muted-note club-status-bar-comm">· ${esc(comm.name)}</span>` : ''}</h3>
        <span class="badge badge-count club-status-bar-count">${playerCount} ${t(playerCount === 1 ? 'txt_clubs_player_singular' : 'txt_clubs_players_plural')}</span>
        ${seasonChip}
        <span class="club-status-bar-spacer"></span>
        ${sportToggle}
        ${settingsMenu}
      </div>
    </div>
  `;
}

// ─── Body renderers (one per sub-tab) ─────────────────────────────────────

/**
 * General sub-tab: rename + logo upload/delete. Containers reuse the same
 * IDs the old inline header used so existing handlers (`clubsRename`,
 * `clubsUploadLogo`, `clubsDeleteLogo`) keep working unchanged.
 */
function _renderClubGeneralBody(club) {
  let html = `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_clubs_name')}</label>`;
  html += `<div class="settings-inline-row">`;
  html += `<input type="text" id="clubs-rename-input" value="${escAttr(club.name)}" placeholder="${escAttr(t('txt_clubs_name'))}" style="flex:1;min-width:140px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">`;
  html += `<button class="btn btn-sm btn-primary" onclick="clubsRename()">${t('txt_txt_save')}</button>`;
  html += `<span id="clubs-rename-msg" style="font-size:0.84rem"></span>`;
  html += `</div>`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_clubs_upload_logo')}</label>`;
  html += `<p class="settings-help">${t('txt_clubs_logo_max_size_hint')}</p>`;
  html += `<div class="settings-inline-row clubs-logo-row">`;
  if (club.has_logo) {
    html += `<img src="/api/clubs/${esc(club.id)}/logo?_=${Date.now()}" alt="" class="clubs-logo-preview">`;
  } else {
    html += `<span class="clubs-logo-preview clubs-logo-preview--empty" aria-hidden="true">📷</span>`;
  }
  html += `<label class="btn btn-sm" style="cursor:pointer;margin:0">📷 ${t('txt_clubs_upload_logo')}`;
  html += `<input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="clubsUploadLogo(this)">`;
  html += `</label>`;
  if (club.has_logo) {
    html += `<button class="btn btn-sm btn-danger" onclick="clubsDeleteLogo()">🗑 ${t('txt_clubs_remove_logo')}</button>`;
  }
  html += `<span id="clubs-logo-msg" style="font-size:0.84rem"></span>`;
  html += `</div>`;
  html += `</div>`;

  return html;
}

/**
 * Tiers sub-tab: tier list + create form. Containers reuse the same IDs the
 * old inline card used so `_clubsRenderTiers`, `clubsCreateTier`, and
 * `clubsDeleteTier` keep working unchanged.
 */
function _renderClubTiersBody() {
  let html = `<div class="settings-block">`;
  html += `<p class="settings-help">${t('txt_clubs_tiers_help')}</p>`;
  html += `<div id="clubs-tiers-list"></div>`;
  html += `<div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center">`;
  html += `<input type="text" id="clubs-tier-name" placeholder="${escAttr(t('txt_clubs_tier_name_placeholder'))}" style="flex:1;min-width:120px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off">`;
  html += `<label style="font-size:0.82rem;display:flex;align-items:center;gap:0.25rem">${t('txt_clubs_tier_base_elo')}`;
  html += `<input type="number" id="clubs-tier-elo" value="1000" min="0" max="3000" step="50" style="width:70px;padding:0.35rem 0.4rem;font-size:0.85rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);text-align:center">`;
  html += `</label>`;
  html += `<button class="btn btn-sm btn-success" onclick="clubsCreateTier()">+ ${t('txt_txt_add')}</button>`;
  html += `</div>`;
  html += `<div id="clubs-tiers-msg" style="margin-top:0.4rem;font-size:0.84rem"></div>`;
  html += `</div>`;
  return html;
}

/**
 * Seasons sub-tab: seasons list + create form. Containers reuse the same
 * IDs the old inline card used so `_clubsRenderSeasons` and the existing
 * season handlers keep working unchanged.
 */
function _renderClubSeasonsBody() {
  let html = `<div class="settings-block">`;
  html += `<div id="clubs-seasons-list"></div>`;
  html += `<div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center">`;
  html += `<input type="text" id="clubs-season-name" placeholder="${escAttr(t('txt_clubs_season_name_placeholder'))}" style="flex:1;min-width:180px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off">`;
  html += `<button class="btn btn-sm btn-success" onclick="clubsCreateSeason()">+ ${t('txt_txt_add')}</button>`;
  html += `</div>`;
  html += `<div id="clubs-seasons-msg" style="margin-top:0.4rem;font-size:0.84rem"></div>`;
  html += `</div>`;
  return html;
}

/**
 * Assignments sub-tab: tournament-to-season + lobby-to-season assignment
 * tables. Container reuses the same `clubs-season-assign` id so
 * `_clubsRenderSeasonAssignment` keeps working unchanged.
 */
function _renderClubAssignmentsBody() {
  let html = `<div class="settings-block">`;
  html += `<p class="settings-help">${t('txt_clubs_assignments_help')}</p>`;
  html += `<div id="clubs-season-assign"></div>`;
  html += `</div>`;
  return html;
}

/**
 * Comms sub-tab: email branding (sender + reply-to) + bulk messaging
 * (lobby invites + announcements). Owner/admin only — returns empty
 * string when the user can't edit so the sub-tab is skipped.
 */
function _renderClubCommsBody(club) {
  if (!(isAdmin() || club.created_by === getAuthUsername())) return '';
  const reply = (club.email_settings && club.email_settings.reply_to) || '';
  const sender = (club.email_settings && club.email_settings.sender_name) || '';
  let html = `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_clubs_comms_section_branding')}</label>`;
  html += `<p class="settings-help">${t('txt_clubs_email_settings_help')}</p>`;
  html += `<label class="settings-label" style="margin-top:0.4rem">${t('txt_clubs_email_reply_to')}</label>`;
  html += `<input type="email" id="clubs-email-reply-to" value="${escAttr(reply)}" placeholder="${escAttr(t('txt_clubs_email_reply_to_placeholder'))}" style="width:100%;max-width:420px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin-bottom:0.6rem">`;
  html += `<label class="settings-label">${t('txt_clubs_email_sender_name')}</label>`;
  html += `<input type="text" id="clubs-email-sender-name" value="${escAttr(sender)}" placeholder="${escAttr(club.name)}" style="width:100%;max-width:420px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin-bottom:0.6rem">`;
  html += `<div style="display:flex;align-items:center;gap:0.5rem">`;
  html += `<button class="btn btn-sm btn-primary" onclick="clubsSaveEmailSettings()">${t('txt_txt_save')}</button>`;
  html += `<span id="clubs-email-settings-msg" style="font-size:0.84rem"></span>`;
  html += `</div>`;
  html += `</div>`;

  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_clubs_comms_section_messaging')}</label>`;
  html += `<p class="settings-help">${t('txt_clubs_comms_messaging_help')}</p>`;
  html += `<div id="clubs-messaging-panel"></div>`;
  html += `</div>`;
  return html;
}

/**
 * Access sub-tab: collaborators list + add form. Owner/admin only.
 * Returns empty string when the user can't edit so the sub-tab is skipped.
 * Containers reuse the same IDs the old inline card used.
 */
function _renderClubAccessBody(club) {
  if (!(isAdmin() || club.created_by === getAuthUsername())) return '';
  let html = `<div class="settings-block">`;
  html += `<p class="settings-help">${t('txt_clubs_collaborators_help')}</p>`;
  html += `<div id="clubs-collabs-list"></div>`;
  html += `<div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center">`;
  html += `<input type="text" id="clubs-collab-input" placeholder="${escAttr(t('txt_clubs_add_collab_placeholder'))}" style="flex:1;min-width:160px;padding:0.35rem 0.5rem;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" autocomplete="off" oninput="_clubsCollabInputChange(this.value)" list="clubs-collab-suggestions">`;
  html += `<datalist id="clubs-collab-suggestions"></datalist>`;
  html += `<button class="btn btn-sm btn-primary" onclick="clubsAddCollaborator()">${t('txt_clubs_add_collab_btn')}</button>`;
  html += `</div>`;
  html += `<div id="clubs-collab-msg" style="margin-top:0.4rem;font-size:0.84rem"></div>`;
  html += `</div>`;
  return html;
}

// ─── Card orchestrator ────────────────────────────────────────────────────

/**
 * Render the unified per-club Settings card. Sub-tabs with empty bodies
 * are skipped automatically (used to hide comms/access for non-owners).
 */
function _renderClubSettingsCard(club) {
  if (!club) return '';
  const active = _getClubSubtab(club.id);

  const subtabs = [
    { key: 'general',     label: t('txt_club_settings_tab_general'),     icon: '⚙',  body: _renderClubGeneralBody(club) },
    { key: 'tiers',       label: t('txt_club_settings_tab_tiers'),       icon: '🏷', body: _renderClubTiersBody() },
    { key: 'seasons',     label: t('txt_club_settings_tab_seasons'),     icon: '📅', body: _renderClubSeasonsBody() },
    { key: 'assignments', label: t('txt_club_settings_tab_assignments'), icon: '🔗', body: _renderClubAssignmentsBody() },
    { key: 'comms',       label: t('txt_club_settings_tab_comms'),       icon: '📧', body: _renderClubCommsBody(club) },
    { key: 'access',      label: t('txt_club_settings_tab_access'),      icon: '🛡', body: _renderClubAccessBody(club) },
  ].filter(st => st.body && st.body.trim());

  if (subtabs.length === 0) return '';
  const activeKey = subtabs.some(st => st.key === active) ? active : subtabs[0].key;

  let html = `<div class="card admin-settings-card club-settings-card" id="club-settings-card">`;
  const isOpen = _getClubSettingsOpen(club.id);
  html += `<details class="admin-settings-details"${isOpen ? ' open' : ''} ontoggle="_setClubSettingsOpen('${esc(club.id)}', this.open)">`;
  html += `<summary class="admin-settings-summary">`;
  html += `<span class="admin-settings-title"><span class="tv-chevron admin-settings-chevron">▸</span> ⚙ ${t('txt_club_settings_title')}</span>`;
  html += `</summary>`;

  html += `<div class="admin-settings-body">`;
  html += `<div class="settings-subtabs" role="tablist" aria-label="${escAttr(t('txt_club_settings_title'))}">`;
  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<button type="button" class="settings-subtab-btn${isActive ? ' active' : ''}" role="tab"`;
    html += ` aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? 0 : -1}"`;
    html += ` data-subtab="${escAttr(st.key)}"`;
    html += ` onclick="setClubSubtab('${esc(club.id)}','${escAttr(st.key)}')">`;
    html += `<span class="settings-subtab-icon" aria-hidden="true">${st.icon}</span>`;
    html += `<span class="settings-subtab-label">${esc(st.label)}</span>`;
    html += `</button>`;
  }
  html += `</div>`;

  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<div class="settings-subpanel${isActive ? '' : ' hidden'}" role="tabpanel" data-subtab="${escAttr(st.key)}">`;
    html += st.body;
    html += `</div>`;
  }

  html += `</div>`;   // body
  html += `</details>`;
  html += `</div>`;   // card
  return html;
}
