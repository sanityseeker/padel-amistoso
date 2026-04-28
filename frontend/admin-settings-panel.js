// ─── Unified per-tournament Settings card ─────────────────────────────────
//
// Renders all per-tournament configuration into a single collapsible card
// with five sub-tabs: TV & sharing, Scoring, Communications, Player codes,
// Access & scope. The active sub-tab is persisted per tournament in
// localStorage under `adminSettingsSubtab:<tid>`.

const SETTINGS_SUBTAB_DEFAULT = 'tv';
const SETTINGS_SUBTABS = ['tv', 'scoring', 'comms', 'codes', 'access'];

function _settingsSubtabStorageKey(tid) {
  return `adminSettingsSubtab:${tid}`;
}

function _settingsOpenStorageKey(tid) {
  return `adminSettingsOpen:${tid}`;
}

function _getSettingsOpen(tid) {
  try {
    return localStorage.getItem(_settingsOpenStorageKey(tid)) === '1';
  } catch (_) {
    return false;
  }
}

function _setSettingsOpen(tid, open) {
  try { localStorage.setItem(_settingsOpenStorageKey(tid), open ? '1' : '0'); } catch (_) { /* ignore */ }
}

function _getSettingsSubtab(tid) {
  try {
    const v = localStorage.getItem(_settingsSubtabStorageKey(tid));
    return SETTINGS_SUBTABS.includes(v) ? v : SETTINGS_SUBTAB_DEFAULT;
  } catch (_) {
    return SETTINGS_SUBTAB_DEFAULT;
  }
}

/**
 * Switch the active sub-tab inside the settings card.
 * Updates aria attributes, show/hide state, and persists to localStorage.
 */
function setSettingsSubtab(tid, key) {
  if (!SETTINGS_SUBTABS.includes(key)) return;
  try { localStorage.setItem(_settingsSubtabStorageKey(tid), key); } catch (_) { /* ignore */ }
  const root = document.getElementById('admin-settings-card');
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
 * Open the settings card (if collapsed) and jump to a specific sub-tab.
 * Used by the status-bar shortcut buttons.
 */
function _jumpToSettings(subtab) {
  const card = document.getElementById('admin-settings-card');
  if (!card) return;
  const details = card.querySelector('details.admin-settings-details');
  if (details && !details.open) {
    details.open = true;
    if (currentTid) _setSettingsOpen(currentTid, true);
  }
  if (subtab && currentTid) setSettingsSubtab(currentTid, subtab);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Render the unified Settings card.
 *
 * ctx fields:
 *   - tvSettings:    object from GET /tv-settings
 *   - emailSettings: object from GET /email-settings (may be null)
 *   - hasCourts:     boolean
 *   - isMexicano:    boolean
 *   - scoringStages: [{ key, label }] entries for the points/sets toggles
 *   - playerSecrets: object map from `_loadPlayerSecrets`
 *   - collaborators: array of usernames
 */
function _renderSettingsCard(ctx) {
  if (!currentTid) return '';
  const {
    tvSettings = {},
    emailSettings = null,
    hasCourts = false,
    isMexicano = false,
    scoringStages = [],
    playerSecrets = {},
    collaborators = [],
  } = ctx || {};

  const active = _getSettingsSubtab(currentTid);
  const commsBody = _renderCommsBody(emailSettings);
  const accessBody = _renderAccessScopeBody(collaborators);
  const codesBody = _renderPlayerCodesBody(playerSecrets);

  // Sub-tab definitions; entries with empty body are skipped.
  const subtabs = [
    { key: 'tv',      label: t('txt_admin_settings_tab_tv'),      icon: '📺', body: _renderTvSharingBody(tvSettings, hasCourts, isMexicano, scoringStages.some(s => /playoff/i.test(s.key))) },
    { key: 'scoring', label: t('txt_admin_settings_tab_scoring'), icon: '🎯', body: _renderScoringRulesBody(tvSettings, scoringStages) },
    { key: 'comms',   label: t('txt_admin_settings_tab_comms'),   icon: '📧', body: commsBody },
    { key: 'codes',   label: t('txt_admin_settings_tab_codes'),   icon: '🔑', body: codesBody },
    { key: 'access',  label: t('txt_admin_settings_tab_access'),  icon: '🛡', body: accessBody },
  ].filter(st => st.body && st.body.trim());

  if (subtabs.length === 0) return '';

  // Ensure the persisted active sub-tab is still available; fall back to first.
  const activeKey = subtabs.some(st => st.key === active) ? active : subtabs[0].key;

  let html = `<div class="card admin-settings-card" id="admin-settings-card">`;
  const isOpen = _getSettingsOpen(currentTid);
  html += `<details class="admin-settings-details"${isOpen ? ' open' : ''} ontoggle="_setSettingsOpen(currentTid, this.open)">`;
  html += `<summary class="admin-settings-summary">`;
  html += `<span class="admin-settings-title"><span class="tv-chevron admin-settings-chevron">▸</span> ⚙ ${t('txt_admin_settings_title')}</span>`;
  html += _renderSettingsHelpToggle();
  html += `</summary>`;

  html += `<div class="admin-settings-body">`;
  html += `<div class="settings-subtabs" role="tablist" aria-label="${escAttr(t('txt_admin_settings_title'))}">`;
  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<button type="button" class="settings-subtab-btn${isActive ? ' active' : ''}" role="tab"`;
    html += ` aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? 0 : -1}"`;
    html += ` data-subtab="${escAttr(st.key)}"`;
    html += ` onclick="setSettingsSubtab(currentTid,'${escAttr(st.key)}')">`;
    html += `<span class="settings-subtab-icon" aria-hidden="true">${st.icon}</span>`;
    html += `<span class="settings-subtab-label">${esc(st.label)}</span>`;
    html += `</button>`;
  }
  html += `</div>`;

  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<div class="settings-subpanel${isActive ? '' : ' hidden'}" role="tabpanel" data-subtab="${escAttr(st.key)}">`;
    html += _renderSubtabHelpCard(st);
    html += st.body;
    html += `</div>`;
  }

  html += `</div>`;   // body
  html += `</details>`;
  html += `</div>`;   // card
  return html;
}

/**
 * Render a small descriptive header inside a Settings subpanel summarising
 * what the tab contains. Helps admins confirm they're in the right place
 * without having to scan the whole form.
 */
function _renderSubtabHelpCard(st) {
  if (!st) return '';
  const descKeyByTab = {
    tv: 'txt_admin_settings_help_tv',
    scoring: 'txt_admin_settings_help_scoring',
    comms: 'txt_admin_settings_help_comms',
    codes: 'txt_admin_settings_help_codes',
    access: 'txt_admin_settings_help_access',
  };
  const descKey = descKeyByTab[st.key];
  if (!descKey) return '';
  return `<div class="settings-subpanel-help-wrap">`
    + `<div class="settings-subpanel-help hidden">`
    +   `<p class="settings-subpanel-help-text" data-i18n="${descKey}">${esc(t(descKey))}</p>`
    + `</div>`
    + `</div>`;
}

/**
 * Compact toggle rendered inline at the right of the Settings subtabs row.
 * Toggling it shows/hides the per-tab help description across all subpanels
 * at once, so the toggle's state stays consistent regardless of which tab
 * the admin is viewing.
 */
function _renderSettingsHelpToggle() {
  const showKey = 'txt_admin_settings_help_show';
  const hideKey = 'txt_admin_settings_help_hide';
  return `<button type="button" class="btn btn-sm btn-muted settings-help-master-toggle"`
    + ` aria-expanded="false"`
    + ` data-show-key="${showKey}" data-hide-key="${hideKey}"`
    + ` onclick="_toggleSettingsHelp(this)">`
    + `<span class="settings-help-icon" aria-hidden="true">i</span>`
    + `<span class="settings-help-master-label" data-i18n="${showKey}">${esc(t(showKey))}</span>`
    + `</button>`;
}

function _toggleSettingsHelp(btn) {
  if (!btn) return;
  // Stop the click from bubbling into <summary> and toggling the panel.
  if (typeof event !== 'undefined' && event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
    event.preventDefault();
  }
  const card = document.getElementById('admin-settings-card');
  if (!card) return;
  const panels = card.querySelectorAll('.settings-subpanel-help');
  if (!panels.length) return;
  const willShow = panels[0].classList.contains('hidden');
  panels.forEach(p => p.classList.toggle('hidden', !willShow));
  btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
  const labelEl = btn.querySelector('.settings-help-master-label');
  if (labelEl) {
    const key = willShow ? btn.dataset.hideKey : btn.dataset.showKey;
    labelEl.setAttribute('data-i18n', key);
    labelEl.textContent = t(key);
  }
}

/**
 * Render a collapsed-by-default help block listing the visible Settings
 * sub-tabs and a one-line description of what each contains. Helps admins
 * quickly find where to change a given setting without opening every tab.
 */
function _renderSettingsHelpBlock(subtabs) {
  if (!subtabs || subtabs.length === 0) return '';
  const descByKey = {
    tv: t('txt_admin_settings_help_tv'),
    scoring: t('txt_admin_settings_help_scoring'),
    comms: t('txt_admin_settings_help_comms'),
    codes: t('txt_admin_settings_help_codes'),
    access: t('txt_admin_settings_help_access'),
  };
  let html = `<details class="settings-help-block">`;
  html += `<summary class="settings-help-summary">`;
  html += `<span class="settings-help-icon" aria-hidden="true">i</span>`;
  html += `<span>${esc(t('txt_admin_settings_help_title'))}</span>`;
  html += `</summary>`;
  html += `<div class="settings-help-body">`;
  html += `<p class="settings-help-intro">${esc(t('txt_admin_settings_help_intro'))}</p>`;
  html += `<ul class="settings-help-list">`;
  for (const st of subtabs) {
    const desc = descByKey[st.key];
    if (!desc) continue;
    html += `<li class="settings-help-item">`;
    html += `<span class="settings-help-tab"><span aria-hidden="true">${st.icon}</span> ${esc(st.label)}</span>`;
    html += `<span class="settings-help-desc">${esc(desc)}</span>`;
    html += `</li>`;
  }
  html += `</ul></div></details>`;
  return html;
}
