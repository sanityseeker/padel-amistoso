// ─── Unified per-tournament Settings card ─────────────────────────────────
//
// Renders all per-tournament configuration into a single collapsible card
// with sub-tabs: Public view & sharing, Scoring, Communications, Player codes,
// Payments, Access & scope, Export. The active sub-tab is persisted per tournament in
// localStorage under `adminSettingsSubtab:<tid>`.

const SETTINGS_SUBTAB_DEFAULT = 'tv';
const SETTINGS_SUBTABS = ['tv', 'scoring', 'comms', 'codes', 'payments', 'access', 'export'];

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
 *   - exportPanel:   `_renderExportPanel` context; omit to hide the Export tab
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
    exportPanel = null,
  } = ctx || {};

  const active = _getSettingsSubtab(currentTid);
  const commsBody = _renderCommsBody(emailSettings);
  const accessBody = _renderAccessScopeBody(collaborators);
  const codesBody = _renderPlayerCodesBody(playerSecrets);

  // Sub-tab definitions; entries with empty body are skipped.
  const subtabs = [
    { key: 'tv',      label: t('txt_admin_settings_tab_tv'),      icon: _ic('monitor'), body: _renderTvSharingBody(tvSettings, hasCourts, isMexicano, scoringStages.some(s => /playoff/i.test(s.key))) },
    { key: 'scoring', label: t('txt_admin_settings_tab_scoring'), icon: _ic('clipboard'), body: _renderScoringRulesBody(tvSettings, scoringStages) },
    { key: 'comms',   label: t('txt_admin_settings_tab_comms'),   icon: _ic('mail'), body: commsBody },
    { key: 'codes',   label: t('txt_admin_settings_tab_codes'),   icon: _ic('key'), body: codesBody },
    { key: 'payments', label: t('txt_pay_tab'),                   icon: _ic('wallet'), body: _renderPaymentsIsland('tournament', currentTid) },
    { key: 'access',  label: t('txt_admin_settings_tab_access'),  icon: _ic('shield'), body: accessBody },
    { key: 'export',  label: t('txt_admin_settings_tab_export'),  icon: _ic('download'), body: exportPanel ? _renderExportPanel(exportPanel) : '' },
  ].filter(st => st.body && st.body.trim());

  if (subtabs.length === 0) return '';

  // Ensure the persisted active sub-tab is still available; fall back to first.
  const activeKey = subtabs.some(st => st.key === active) ? active : subtabs[0].key;

  const helpOn = _getSettingsHelpOn();
  let html = `<div class="card admin-settings-card${helpOn ? ' is-help-on' : ''}" id="admin-settings-card">`;
  const isOpen = _getSettingsOpen(currentTid);
  html += `<details class="admin-settings-details"${isOpen ? ' open' : ''} ontoggle="_setSettingsOpen(currentTid, this.open)">`;
  html += `<summary class="admin-settings-summary">`;
  html += `<span class="admin-settings-title"><span class="tv-chevron admin-settings-chevron">▸</span> ${_ic('settings')} ${t('txt_admin_settings_title')}</span>`;
  html += _renderSettingsHelpToggle(helpOn);
  html += `</summary>`;

  html += `<div class="admin-settings-body">`;
  html += `<div class="settings-subtabs" role="tablist" aria-label="${escAttr(t('txt_admin_settings_title'))}">`;
  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<button type="button" class="settings-subtab-btn${isActive ? ' active' : ''}" role="tab"`;
    html += ` aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? 0 : -1}"`;
    html += ` data-subtab="${escAttr(st.key)}" aria-label="${escAttr(st.label)}" title="${escAttr(st.label)}"`;
    html += ` onclick="setSettingsSubtab(currentTid,'${escAttr(st.key)}')">`;
    html += `<span class="settings-subtab-icon" aria-hidden="true">${st.icon}</span>`;
    html += `<span class="settings-subtab-label">${esc(st.label)}</span>`;
    html += `</button>`;
  }
  html += `</div>`;

  for (const st of subtabs) {
    const isActive = st.key === activeKey;
    html += `<div class="settings-subpanel${isActive ? '' : ' hidden'}" role="tabpanel" data-subtab="${escAttr(st.key)}">`;
    // Phones show icon-only tabs; this heading names the open tab.
    html += `<h4 class="settings-subpanel-title">${esc(st.label)}</h4>`;
    html += _renderSubtabHelpCard(st, helpOn);
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
function _renderSubtabHelpCard(st, helpOn = false) {
  if (!st) return '';
  const descKeyByTab = {
    tv: 'txt_admin_settings_help_tv',
    scoring: 'txt_admin_settings_help_scoring',
    comms: 'txt_admin_settings_help_comms',
    codes: 'txt_admin_settings_help_codes',
    payments: 'txt_admin_settings_help_payments',
    access: 'txt_admin_settings_help_access',
    export: 'txt_admin_settings_help_export',
  };
  const descKey = descKeyByTab[st.key];
  if (!descKey) return '';
  return `<div class="settings-subpanel-help-wrap">`
    + `<div class="settings-subpanel-help${helpOn ? '' : ' hidden'}">`
    +   `<p class="settings-subpanel-help-text" data-i18n="${descKey}">${esc(t(descKey))}</p>`
    + `</div>`
    + `</div>`;
}

const _SETTINGS_HELP_STORAGE_KEY = 'adminSettingsHelp';

/** Help toggle state, kept for the tab session so live re-renders keep it. */
function _getSettingsHelpOn() {
  try { return sessionStorage.getItem(_SETTINGS_HELP_STORAGE_KEY) === '1'; } catch (_) { return false; }
}

function _setSettingsHelpOn(on) {
  try { sessionStorage.setItem(_SETTINGS_HELP_STORAGE_KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
}

/**
 * Compact toggle rendered inline at the right of the Settings summary row.
 * Toggling it shows/hides the per-tab help description across all subpanels
 * at once, and on phones also the explanatory `.settings-help--explain`
 * paragraphs inside the tabs (hidden there by default to save space). Icon-only
 * on phones; the label stays the accessible name.
 */
function _renderSettingsHelpToggle(helpOn = false) {
  const showKey = 'txt_admin_settings_help_show';
  const hideKey = 'txt_admin_settings_help_hide';
  const key = helpOn ? hideKey : showKey;
  const label = escAttr(t(key));
  return `<button type="button" class="btn btn-sm btn-muted settings-help-master-toggle"`
    + ` aria-expanded="${helpOn ? 'true' : 'false'}" aria-label="${label}" title="${label}"`
    + ` data-show-key="${showKey}" data-hide-key="${hideKey}"`
    + ` onclick="_toggleSettingsHelp(this)">`
    + `<span class="settings-help-icon" aria-hidden="true">${_ic('info')}</span>`
    + `<span class="settings-help-master-label" data-i18n="${key}">${esc(t(key))}</span>`
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
  const willShow = !card.classList.contains('is-help-on');
  card.classList.toggle('is-help-on', willShow);
  card.querySelectorAll('.settings-subpanel-help').forEach(p => p.classList.toggle('hidden', !willShow));
  _setSettingsHelpOn(willShow);
  btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
  const key = willShow ? btn.dataset.hideKey : btn.dataset.showKey;
  btn.setAttribute('aria-label', t(key));
  btn.setAttribute('title', t(key));
  const labelEl = btn.querySelector('.settings-help-master-label');
  if (labelEl) {
    labelEl.setAttribute('data-i18n', key);
    labelEl.textContent = t(key);
  }
}
