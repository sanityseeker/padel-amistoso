const API = '';  // same origin

// Check if running in demo mode and show warning banner
(async function checkDemoMode() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (config && config.amistoso_domain) {
      window.__AMISTOSO_DOMAIN__ = String(config.amistoso_domain).toLowerCase();
    }
    const demoBanner = document.getElementById('demo-banner');
    if (config.demo_mode && demoBanner) {
      demoBanner.style.display = 'block';
    }
  } catch (err) {
    console.warn('Could not fetch config:', err);
  }
})();

// ─── Tab switching ─────────────────────────────────────────
function setActiveTab(tabName) {
  if (tabName === 'view' && !currentTid) return;
  // Deactivate main tabs (but not chips — they manage their own active state)
  document.querySelectorAll('.tab-btn:not(.tournament-chip)').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + tabName);
  if (!panel) return;
  panel.classList.add('active');
  const refreshBtn = document.getElementById('admin-refresh-btn');
  if (refreshBtn) refreshBtn.style.display = (tabName === 'view' && currentTid) ? '' : 'none';
  if (tabName === 'view') {
    _stopRegPoll();
    // Restart registration detail poll if currently viewing a registration
    if (currentType === 'registration') _startRegDetailPoll();
    // Highlight the chip for the currently active tournament
    document.querySelectorAll('.tournament-chip').forEach(b => b.classList.toggle('active', b.dataset.tid === currentTid));
  } else {
    document.querySelectorAll('.tournament-chip').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    }
    if (tabName === 'home' && isAuthenticated()) { loadTournaments(); _startRegPoll(); } else { _stopRegPoll(); }
    if (tabName === 'players-hub' && isAuthenticated()) { phSearch(); }
    if (tabName === 'user-mgmt' && isAuthenticated()) { loadUserMgmtList(); }
    if (tabName === 'communities' && isAuthenticated()) { loadCommunitiesPanel(); }
    if (tabName === 'clubs' && isAuthenticated()) { loadClubsPanel(); }
    _stopRegDetailPoll();
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const tab = btn.dataset.tab;
    setActiveTab(tab);
    if (!isAuthenticated() && (tab === 'home' || tab === 'create')) {
      showLoginDialog();
    }
  });
});

let _currentCreateMode = 'gp';

function setCreateMode(mode) {
  _currentCreateMode = mode;
  const isGp = mode === 'gp';
  const isMex = mode === 'mex';
  const isPo = mode === 'po';
  const isLobby = mode === 'lobby';
  document.getElementById('create-tab-gp')?.classList.toggle('active', isGp);
  document.getElementById('create-tab-mex')?.classList.toggle('active', isMex);
  document.getElementById('create-tab-po')?.classList.toggle('active', isPo);
  document.getElementById('create-tab-lobby')?.classList.toggle('active', isLobby);
  document.getElementById('create-panel-gp')?.classList.toggle('active', isGp);
  document.getElementById('create-panel-mex')?.classList.toggle('active', isMex);
  document.getElementById('create-panel-po')?.classList.toggle('active', isPo);
  document.getElementById('create-panel-lobby')?.classList.toggle('active', isLobby);
  document.getElementById('entry-toggle-gp-wrap')?.classList.toggle('hidden', !isGp);
  document.getElementById('entry-toggle-mex-wrap')?.classList.toggle('hidden', !isMex);
  document.getElementById('entry-toggle-po-wrap')?.classList.toggle('hidden', !isPo);
  if (typeof syncCreateEntryCardVisibility === 'function') syncCreateEntryCardVisibility();
  if (isLobby) showCreateRegistration();
}

// ─── Format info modal ─────────────────────────────────────
function openFormatInfo(format) {
  const mode = format || _currentCreateMode;
  let htmlFn;
  if (mode === 'lobby') htmlFn = _lobbyFormatInfoHtml;
  else if (mode === 'mex') htmlFn = _mexFormatInfoHtml;
  else if (mode === 'po') htmlFn = _poFormatInfoHtml;
  else htmlFn = _gpFormatInfoHtml;
  document.getElementById('format-info-content').innerHTML = htmlFn();
  document.getElementById('format-info-overlay').style.display = 'block';
  document.getElementById('format-info-dialog').style.display = 'block';
}

function closeFormatInfo() {
  document.getElementById('format-info-overlay').style.display = 'none';
  document.getElementById('format-info-dialog').style.display = 'none';
}

// ─── Context info modal (Communities / Clubs) ─────────────
function _commInfoHtml() {
  return `
    <h3 id="format-info-heading">${esc(t('txt_comm_info_panel_title'))}</h3>
    <p>${esc(t('txt_comm_info_panel_subtitle'))}</p>
    <h4>${esc(t('txt_comm_info_tip_scope_title'))}</h4>
    <p>${esc(t('txt_comm_info_tip_scope_desc'))}</p>
    <h4>${esc(t('txt_comm_info_tip_defaults_title'))}</h4>
    <p>${esc(t('txt_comm_info_tip_defaults_desc'))}</p>
    <h4>${esc(t('txt_comm_info_tip_reassign_title'))}</h4>
    <p>${esc(t('txt_comm_info_tip_reassign_desc'))}</p>
  `;
}

function _clubsInfoHtml() {
  return `
    <h3 id="format-info-heading">${esc(t('txt_clubs_info_panel_title'))}</h3>
    <p>${esc(t('txt_clubs_info_panel_subtitle'))}</p>
    <h4>${esc(t('txt_clubs_info_tip_upgrade_title'))}</h4>
    <p>${esc(t('txt_clubs_info_tip_upgrade_desc'))}</p>
    <h4>${esc(t('txt_clubs_info_tip_seasons_title'))}</h4>
    <p>${esc(t('txt_clubs_info_tip_seasons_desc'))}</p>
    <h4>${esc(t('txt_clubs_info_tip_roster_title'))}</h4>
    <p>${esc(t('txt_clubs_info_tip_roster_desc'))}</p>
  `;
}

function openContextInfo(scope) {
  const html = scope === 'clubs' ? _clubsInfoHtml() : _commInfoHtml();
  document.getElementById('format-info-content').innerHTML = html;
  document.getElementById('format-info-overlay').style.display = 'block';
  document.getElementById('format-info-dialog').style.display = 'block';
}

function _showToast(message, type) {
  if (!message) return;
  const isError = type === 'error';
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.top = '1rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = isError ? 'var(--danger, #d9534f)' : 'var(--green)';
  toast.style.color = '#fff';
  toast.style.padding = '0.7rem 1.2rem';
  toast.style.borderRadius = '8px';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '0.9rem';
  toast.style.zIndex = '9999';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  toast.style.maxWidth = '90vw';
  toast.style.textAlign = 'center';
  document.body.appendChild(toast);
  const duration = isError ? 3000 : 1800;
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

// Backward-compatible alias for any accidental lowercase call sites.
function _showtoast(message) {
  _showToast(message);
}

// ─── Abbreviation legend popup ────────────────────────────────────────────────
let _abbrevPopupBtn = null;

function _buildAbbrevLegend(type) {
  const rows = type === 'standings' ? [
    [t('txt_txt_p_abbrev'),    t('txt_txt_abbrev_mp_full')],
    [t('txt_txt_w_abbrev'),    t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),    t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),    t('txt_txt_abbrev_l_full')],
    [t('txt_txt_sw_abbrev'),   t('txt_txt_abbrev_sw_full')],
    [t('txt_txt_sl_abbrev'),   t('txt_txt_abbrev_sl_full')],
    [t('txt_txt_sd_abbrev'),   t('txt_txt_abbrev_sd_full')],
    [t('txt_txt_pf_abbrev'),   t('txt_txt_abbrev_pf_full')],
    [t('txt_txt_pa_abbrev'),   t('txt_txt_abbrev_pa_full')],
    [t('txt_txt_diff_abbrev'), t('txt_txt_abbrev_diff_full')],
  ] : [
    [t('txt_txt_total_pts_abbrev'), t('txt_txt_abbrev_total_pts_full')],
    [t('txt_txt_played_abbrev'),    t('txt_txt_abbrev_played_full')],
    [t('txt_txt_w_abbrev'),         t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),         t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),         t('txt_txt_abbrev_l_full')],
    [t('txt_txt_avg_pts_abbrev'),   t('txt_txt_abbrev_avg_pts_full')],
    [t('txt_txt_buchholz_abbrev'),  t('txt_txt_abbrev_buchholz_full')],
  ];
  return `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
}

function showAbbrevPopup(event, type) {
  event.stopPropagation();
  const popup = document.getElementById('abbrev-popup');
  const btn = event.currentTarget;
  if (popup.style.display === 'block' && _abbrevPopupBtn === btn) {
    popup.style.display = 'none';
    _abbrevPopupBtn = null;
    return;
  }
  _abbrevPopupBtn = btn;
  popup.innerHTML = _buildAbbrevLegend(type);
  popup.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  const pw = popup.offsetWidth || 210;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
  popup.style.left = left + 'px';
  popup.style.top = (rect.bottom + 6) + 'px';
}

document.addEventListener('click', () => {
  const p = document.getElementById('abbrev-popup');
  if (p) { p.style.display = 'none'; _abbrevPopupBtn = null; }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeFormatInfo();
    const p = document.getElementById('abbrev-popup');
    if (p) { p.style.display = 'none'; _abbrevPopupBtn = null; }
  }
});

function _gpFormatInfoHtml() {
  const s = _currentSport;
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_gp_title')}</h3>
    <p>${ts('txt_txt_fmt_gp_intro', s)}</p>
    <div class="info-block">
      <strong>${ts('txt_txt_fmt_gp_team_mode_title', s)}</strong>
      <p>${ts('txt_txt_fmt_gp_team_mode_desc', s)}</p>
    </div>
    <div class="info-block">
      <strong>${ts('txt_txt_fmt_gp_player_mode_title', s)}</strong>
      <p>${ts('txt_txt_fmt_gp_player_mode_desc', s)}</p>
    </div>
    ${_playoffsInfoHtml()}`;
}

function _mexFormatInfoHtml() {
  const s = _currentSport;
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_mex_title')}</h3>
    <p>${ts('txt_txt_fmt_mex_intro', s)}</p>
    <p>${ts('txt_txt_fmt_mex_rounds_desc', s)}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_mex_strength_title')}</strong>
      <p>${t('txt_txt_fmt_mex_strength_desc')}</p>
    </div>
    ${_playoffsInfoHtml()}`;
}

function _poFormatInfoHtml() {
  const s = _currentSport;
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_po_title')}</h3>
    <p>${ts('txt_txt_fmt_po_intro', s)}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_single_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_single_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_double_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_double_desc')}</p>
    </div>
    ${_adminFeaturesInfoHtml()}`;
}

function _lobbyFormatInfoHtml() {
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_lobby_title')}</h3>
    <p>${t('txt_txt_fmt_lobby_intro')}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_share_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_share_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_join_code_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_join_code_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_levels_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_levels_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_convert_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_convert_desc')}</p>
    </div>`;
}

function _playoffsInfoHtml() {
  return `
    <hr class="info-divider">
    <h3>${t('txt_txt_fmt_playoffs_title')}</h3>
    <p>${t('txt_txt_fmt_playoffs_intro')}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_single_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_single_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_double_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_double_desc')}</p>
    </div>
    ${_adminFeaturesInfoHtml()}`;
}

function _adminFeaturesInfoHtml() {
  return `
    <hr class="info-divider">
    <h3>${t('txt_txt_fmt_admin_title')}</h3>
    <p>${t('txt_txt_fmt_admin_intro')}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_comments_title')}</strong>
      <p>${t('txt_txt_fmt_comments_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_player_login_title')}</strong>
      <p>${t('txt_txt_fmt_player_login_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_banner_title')}</strong>
      <p>${t('txt_txt_fmt_banner_desc')}</p>
    </div>`;
}

function setTheme(theme) {
  const themeValue = _applyTheme(theme);
  _saveTheme(themeValue);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.textContent = themeValue === 'dark' ? '🌙' : '☀️';
    btn.title = t('txt_txt_toggle_light_dark_mode');
    btn.setAttribute('aria-label', themeValue === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('data-active-theme', themeValue);
  }
}

function initTheme() {
  const theme = _loadSavedTheme();
  _applyTheme(theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.textContent = theme === 'dark' ? '🌙' : '☀️';
    btn.title = t('txt_txt_toggle_light_dark_mode');
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('data-active-theme', theme);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function setLanguage(lang) {
  setAppLanguage(lang);
  _refreshLanguageToggleButton();
  if (typeof rerenderClubsPanelOnLanguageChange === 'function') {
    rerenderClubsPanelOnLanguageChange();
  }
  _applySportToCreatePanel();
  updateActiveTournamentUI();
  updateAuthUI();
  renderParticipantFields('gp');
  renderParticipantFields('mex');
  renderParticipantFields('po');
  if (typeof _loadCommunities === 'function') _loadCommunities().then(() => {
    if (typeof _loadClubs === 'function') _loadClubs();
  });
  if (_currentCreateMode === 'lobby') showCreateRegistration();
  refreshCourtDefaults('gp');
  refreshCourtDefaults('mex');
  refreshCourtDefaults('po');
  if (_convertFromRegistration) _showConvertBanner();
  if (currentTid) {
    if (currentType === 'group_playoff') renderGP();
    else if (currentType === 'playoff') renderPO();
    else if (currentType === 'mexicano') renderMex();
    else if (currentType === 'registration') {
      const inConvertPanel = _convRid === currentTid && !!document.getElementById('conv-name');
      if (inConvertPanel) _renderConvertPanel(currentTid, true);
      else _renderRegDetailInline(currentTid);
    }
  } else {
    loadTournaments();
  }
}

function toggleLanguage() {
  setLanguage(getAppLanguage() === 'es' ? 'en' : 'es');
}

function _refreshLanguageToggleButton() {
  const btn = document.getElementById('lang-toggle-btn');
  if (!btn) return;
  const current = getAppLanguage();
  const currentLabel = current === 'es' ? t('txt_txt_spanish') : t('txt_txt_english');
  btn.textContent = current === 'es' ? '🇪🇸' : '🇬🇧';
  btn.title = `${t('txt_txt_language')}: ${currentLabel}`;
  btn.setAttribute('aria-label', `${t('txt_txt_language')}: ${currentLabel}`);
}

function initLanguageSelector() {
  initLanguage();
  _refreshLanguageToggleButton();
}

// ─── Page selector (Admin / TV / Registrations) ───────────
const PAGE_SELECTOR_KEY = 'amistoso-last-page';

function togglePageSelector() {
  togglePageSelectorDropdown();
}

function _closePageSelector() {
  const el = document.getElementById('page-selector');
  if (el) el.classList.remove('open');
}

function _initPageSelector() {
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const sel = document.getElementById('page-selector');
    if (sel && !sel.contains(e.target)) sel.classList.remove('open');
  });
  // Save current page as last visited
  try { localStorage.setItem(PAGE_SELECTOR_KEY, 'admin'); } catch (_) {}
  // Intercept clicks to save target page
  document.querySelectorAll('.page-selector-item').forEach(a => {
    a.addEventListener('click', () => {
      const page = a.getAttribute('data-page');
      if (page) {
        try { localStorage.setItem(PAGE_SELECTOR_KEY, page); } catch (_) {}
      }
    });
  });
  // Refresh pin indicators and pin button state
  _refreshAdminPinState();
}

function _refreshAdminPinState() {
  const homePage = getHomePage();
  const isPinned = homePage === 'admin';
  // Update pin indicators on menu items
  document.querySelectorAll('.page-selector-item').forEach(a => {
    const page = a.getAttribute('data-page');
    const label = a.querySelector('[data-i18n]');
    if (label) {
      // Remove existing pin indicator
      const existing = a.querySelector('.pin-indicator');
      if (existing) existing.remove();
      // Add pin indicator if this is the home page
      if (page === homePage) {
        const pin = document.createElement('span');
        pin.className = 'pin-indicator';
        pin.textContent = ' 📌';
        label.after(pin);
      }
    }
  });
  // Update the pin button
  const btn = document.getElementById('admin-pin-home-btn');
  if (btn) {
    const icon = btn.querySelector('.pin-icon');
    const label = btn.querySelector('.pin-label');
    if (icon) icon.textContent = isPinned ? '📌' : '📍';
    if (label) {
      label.textContent = isPinned ? t('txt_nav_unset_home') : t('txt_nav_set_home');
      label.setAttribute('data-i18n', isPinned ? 'txt_nav_unset_home' : 'txt_nav_set_home');
    }
  }
}

function _toggleAdminHomePin() {
  if (getHomePage() === 'admin') {
    clearHomePage();
  } else {
    setHomePage('admin');
  }
  _refreshAdminPinState();
}

// ─── Schema preview ────────────────────────────────────────

/** Shared helper that powers all three schema download flows. */
async function _fetchSchema(prefix, apiUrl, defaultFilename) {
  const msg = document.getElementById(prefix + '-msg');
  const result = document.getElementById(prefix + '-result');
  if (!msg || !result) return;

  msg.classList.add('hidden');
  result.innerHTML = `<em>${t('txt_txt_generating')}</em>`;

  const fmt = document.getElementById(prefix + '-fmt').value;
  const boxScale = document.getElementById(prefix + '-box').value;
  const lineWidth = document.getElementById(prefix + '-lw').value;
  const arrowScale = document.getElementById(prefix + '-arrow').value;
  const titleFontScale = document.getElementById(prefix + '-title-scale')?.value || '1.0';
  const outputScale = document.getElementById(prefix + '-output-scale')?.value || '0.7';
  const title = document.getElementById(prefix + '-title').value.trim();

  let url = apiUrl + (apiUrl.includes('?') ? '&' : '?')
    + `fmt=${fmt}&box_scale=${boxScale}&line_width=${lineWidth}&arrow_scale=${arrowScale}&title_font_scale=${titleFontScale}&output_scale=${outputScale}`;
  if (title) url += `&title=${encodeURIComponent(title)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || t('txt_txt_failed_to_generate_schema'));
    }

    if (fmt === 'pdf') {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (title || defaultFilename) + '.pdf';
      a.click();
      result.innerHTML = `<em>${t('txt_txt_pdf_downloaded')}</em>`;
    } else if (fmt === 'svg') {
      // Inline the SVG, then strip its hardcoded width/height attributes and
      // tag it with .bracket-svg so the CSS fit-to-screen rules apply (the
      // backend emits explicit pixel dimensions that would otherwise overflow).
      result.innerHTML = await res.text();
      const svgEl = result.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.classList.add('bracket-svg');
      }
    } else {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      result.innerHTML = `<img src="${blobUrl}" class="bracket-img" alt="${t('txt_txt_schema')}" onclick="_openBracketLightbox('${blobUrl}')" title="${t('txt_txt_click_to_expand')}">`;
    }
  } catch (e) {
    result.innerHTML = '';
    msg.textContent = e.message;
    msg.classList.remove('hidden');
  }
}

function generateSchema() {
  const groups = document.getElementById('schema-groups').value.trim();
  const advance = document.getElementById('schema-advance').value;
  const elim = document.getElementById('schema-elim').value;
  const url = `/api/schema/preview?group_sizes=${encodeURIComponent(groups)}&advance_per_group=${advance}&elimination=${elim}`;
  _fetchSchema('schema', url, 'bracket');
}

const _SCHEMA_PRESETS = [
  { label: '2×4', groups: '4,4',     advance: 2, players: 8  },
  { label: '3×4', groups: '4,4,4',   advance: 2, players: 12 },
  { label: '4×4', groups: '4,4,4,4', advance: 2, players: 16 },
  { label: '2×6', groups: '6,6',     advance: 3, players: 12 },
  { label: '3×6', groups: '6,6,6',   advance: 2, players: 18 },
  { label: '4×6', groups: '6,6,6,6', advance: 2, players: 24 },
];

function _applySchemaPreset(label) {
  const preset = _SCHEMA_PRESETS.find(p => p.label === label);
  if (!preset) return;
  document.getElementById('schema-groups').value = preset.groups;
  document.getElementById('schema-advance').value = preset.advance;
  // Update active state on preset buttons
  document.querySelectorAll('.schema-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === label);
  });
  _updateSchemaSummary();
}

function _updateSchemaSummary() {
  const raw = document.getElementById('schema-groups').value.trim();
  const advance = parseInt(document.getElementById('schema-advance').value, 10);
  const elim = document.getElementById('schema-elim').value;
  const summaryEl = document.getElementById('schema-summary');
  if (!summaryEl) return;

  const groups = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
  if (!groups.length || isNaN(advance) || advance < 1) {
    summaryEl.textContent = '';
    // Deselect presets if user edited manually to non-matching value
    document.querySelectorAll('.schema-preset-btn').forEach(btn => btn.classList.remove('active'));
    return;
  }

  const totalPlayers = groups.reduce((a, b) => a + b, 0);
  const totalQualified = groups.length * advance;
  const elimLabel = elim === 'double' ? t('txt_txt_double_elimination') : t('txt_txt_single_elimination');

  // Group description: e.g. "3 × 4" if all same size, else "4+4+5"
  const allSame = groups.every(g => g === groups[0]);
  const groupDesc = allSame ? `${groups.length} × ${groups[0]}` : groups.join('+');

  summaryEl.textContent = `${groupDesc} = ${totalPlayers} ${t('txt_txt_players_lc')} · ${totalQualified} ${t('txt_txt_qualify')} → ${elimLabel}`;

  // Highlight matching preset if any
  const groupsStr = groups.join(',');
  const match = _SCHEMA_PRESETS.find(p => p.groups === groupsStr && p.advance === advance);
  document.querySelectorAll('.schema-preset-btn').forEach(btn => {
    btn.classList.toggle('active', !!match && btn.dataset.preset === match.label);
  });
}

// ─── Admin bracket plot driven by TV settings ──────────────
// The admin per-tournament view shows ONE bracket image whose rendering
// (format + box/line/arrow/header/output scales) follows the TV settings.
// This guarantees the public TV/spectator page and the admin preview stay
// in sync, so admins can tune readability and see the result everyone sees.

/**
 * Build the schema URL from a tvSettings object. Mirrors the URL
 * construction used by the public TV view (`tv.js`).
 */
function _adminBracketUrl(apiBase, tvSettings) {
  const s = tvSettings || {};
  const fmt = s.schema_format || 'svg';
  const bs  = s.schema_box_scale        ?? 1.0;
  const lw  = s.schema_line_width       ?? 1.0;
  const ar  = s.schema_arrow_scale      ?? 1.0;
  const tfs = s.schema_title_font_scale ?? 1.0;
  const os  = s.schema_output_scale     ?? 1.0;
  const params = `fmt=${fmt}&box_scale=${bs}&line_width=${lw}&arrow_scale=${ar}&title_font_scale=${tfs}&output_scale=${os}`;
  return `${apiBase}?${params}&_t=${Date.now()}`;
}

/**
 * Render the admin bracket card for a tournament view. Single source of
 * truth: any rendering tweak goes through TV settings, then this card
 * (and the public TV view) reflects it.
 */
function _renderAdminBracketCard(apiBase, tvSettings, opts = {}) {
  const title = opts.title || t('txt_txt_play_off_bracket');
  const url = _adminBracketUrl(apiBase, tvSettings);
  let h = `<div class="card admin-bracket-card" data-bracket-api="${apiBase}">`;
  h += `<div class="admin-bracket-header">`;
  h += `<h2 class="admin-bracket-title">${esc(title)}</h2>`;
  h += `<button type="button" class="btn btn-sm btn-muted" onclick="_jumpToSettings('tv')" title="${escAttr(t('txt_admin_bracket_open_settings_hint'))}">⚙ ${esc(t('txt_admin_bracket_tune_btn'))}</button>`;
  h += `</div>`;
  h += `<div class="bracket-scroll-wrapper">`;
  h += `<img id="admin-bracket-img" class="bracket-img" src="${url}" alt="${escAttr(title)}" onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}" onerror="this.style.display='none'">`;
  h += `</div>`;
  h += `<p class="settings-help admin-bracket-hint">${esc(t('txt_admin_bracket_settings_hint'))}</p>`;
  h += `</div>`;
  return h;
}

/**
 * Refresh the admin bracket image's `src` from current DOM TV settings
 * controls so a slider/format change updates the preview immediately
 * without re-rendering the whole view (preserves drafts/scroll).
 */
function _refreshAdminBracketPreview() {
  const img = document.getElementById('admin-bracket-img');
  if (!img) return;
  const card = img.closest('.admin-bracket-card');
  if (!card) return;
  const apiBase = card.dataset.bracketApi;
  if (!apiBase) return;
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? +el.value : fallback;
  };
  const fmtEl = document.getElementById('tv-schema-format');
  const tvSettings = {
    schema_format:           fmtEl ? fmtEl.value : 'svg',
    schema_box_scale:        num('tv-schema-box',         1.0),
    schema_line_width:       num('tv-schema-lw',          1.0),
    schema_arrow_scale:      num('tv-schema-arrow',       1.0),
    schema_title_font_scale: num('tv-schema-title-scale', 1.0),
    schema_output_scale:     num('tv-schema-output',      1.0),
  };
  img.style.display = '';
  img.src = _adminBracketUrl(apiBase, tvSettings);
}

async function generatePoPreviewSchema() {
  const names = getParticipantNames('po');
  const resultEl = document.getElementById('po-preview-result');
  const msgEl = document.getElementById('po-preview-msg');
  msgEl.classList.add('hidden');
  if (names.length < 2) {
    resultEl.innerHTML = '';
    return;
  }
  resultEl.innerHTML = `<em>${t('txt_txt_generating')}</em>`;
  try {
    const elim = document.getElementById('po-double-elim').checked ? 'double' : 'single';
    const params = new URLSearchParams({ participants: names.length, elimination: elim, fmt: 'png' });
    for (const n of names) params.append('names', n);
    const url = `/api/schema/playoff-preview?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');
    const blob = await res.blob();
    resultEl.innerHTML = `<details class="bracket-collapse bracket-collapse-left" open><summary class="bracket-collapse-summary"><span class="bracket-chevron bracket-chevron-anim">&#9654;</span>${t('txt_txt_play_off_bracket')}</summary><img class="bracket-img" src="${URL.createObjectURL(blob)}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="${t('txt_txt_click_to_expand')}"></details>`;
  } catch (e) {
    resultEl.innerHTML = '';
    msgEl.textContent = e.message;
    msgEl.classList.remove('hidden');
  }
}

// Removed `_schemaCardHtml` + `generate{Gp,Mex,Po}PlayoffSchema` (2026-04-30):
// the per-tournament admin views now render a single bracket plot via
// `_renderAdminBracketCard`, driven by TV settings, so the schema is always
// in sync with what the public TV/spectator page shows.

// ─── API helper ────────────────────────────────────────────
// Use authenticated API wrapper from auth.js

// ─── Language toggle (shared between registration & player codes) ──────────

/**
 * Render a compact EN/ES segmented toggle for email language.
 * @param {string} parentId - registration or tournament id
 * @param {string} playerId - player identifier
 * @param {string} currentLang - current lang value ('en' or 'es')
 * @param {string} context - 'reg' for registrants, 'sec' for player_secrets
 */
function _langToggle(parentId, playerId, currentLang, context) {
  const isEn = currentLang === 'en';
  const btnBase = 'display:inline-block;padding:0.08rem 0.35rem;font-size:0.7rem;font-weight:600;cursor:pointer;border:1px solid var(--border);line-height:1.3;';
  const activeStyle = 'background:var(--accent);color:#fff;border-color:var(--accent);';
  const inactiveStyle = 'background:var(--surface);color:var(--text-muted);';
  const enStyle = btnBase + (isEn ? activeStyle : inactiveStyle) + 'border-radius:4px 0 0 4px;border-right:none;';
  const esStyle = btnBase + (!isEn ? activeStyle : inactiveStyle) + 'border-radius:0 4px 4px 0;';
  const handler = context === 'reg' ? '_setRegLang' : '_setSecLang';
  return `<span style="display:inline-flex;white-space:nowrap">`
    + `<span style="${enStyle}" onclick="${handler}('${esc(parentId)}','${esc(playerId)}','en',this.parentElement)" title="${t('txt_txt_english')}">EN</span>`
    + `<span style="${esStyle}" onclick="${handler}('${esc(parentId)}','${esc(playerId)}','es',this.parentElement)" title="${t('txt_txt_spanish')}">ES</span>`
    + `</span>`;
}

/** Update a player_secrets lang preference (tournament context). */
async function _setSecLang(tid, pid, lang, toggleEl) {
  try {
    await api(`/api/tournaments/${tid}/player-secrets/${pid}/lang`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    });
    if (toggleEl) {
      toggleEl.outerHTML = _langToggle(tid, pid, lang, 'sec');
    }
    // Update local cache
    if (_playerSecrets && _playerSecrets[pid]) _playerSecrets[pid].lang = lang;
  } catch (e) { console.error('Failed to update player lang:', e.message); }
}

// ─── Admin toast / undo snackbar (#5) ─────────────────────────────────────
let _adminToastSeq = 0;

/**
 * Show an ephemeral snackbar at the bottom of the screen.
 *
 * @param {string} msg                 Message text to display.
 * @param {object} [opts]
 * @param {Function} [opts.onUndo]     If provided, an "Undo" button is shown.
 *                                     Click handler triggers this then closes.
 * @param {number}   [opts.duration]   ms before auto-dismiss (default 6000).
 */
function _showAdminToast(msg, opts = {}) {
  let stack = document.getElementById('admin-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'admin-toast-stack';
    stack.className = 'admin-toast-stack';
    document.body.appendChild(stack);
  }
  const id = `admin-toast-${++_adminToastSeq}`;
  const toast = document.createElement('div');
  toast.className = 'admin-toast';
  toast.id = id;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const msgSpan = document.createElement('span');
  msgSpan.className = 'admin-toast-msg';
  msgSpan.textContent = msg;
  toast.appendChild(msgSpan);

  if (typeof opts.onUndo === 'function') {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'admin-toast-undo';
    undoBtn.textContent = t('txt_admin_undo');
    undoBtn.onclick = async () => {
      _dismissAdminToast(id);
      try { await opts.onUndo(); } catch (e) { console.error('Undo failed:', e); }
    };
    toast.appendChild(undoBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'admin-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.onclick = () => _dismissAdminToast(id);
  toast.appendChild(closeBtn);
  stack.appendChild(toast);

  const duration = opts.duration ?? 6000;
  if (duration > 0) {
    setTimeout(() => _dismissAdminToast(id), duration);
  }
  return id;
}

function _dismissAdminToast(id) {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('is-leaving')) return;
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 220);
}

// ─── In-memory activity drawer (#19) ──────────────────────────────────────
const _ADMIN_ACTIVITY_MAX = 30;
const _adminActivityLog = [];

/**
 * Record an admin action so it shows up in the activity drawer. Pure
 * frontend / in-memory — cleared on full page reload.
 */
function _recordActivity(label) {
  if (!label) return;
  _adminActivityLog.unshift({ label: String(label), ts: Date.now() });
  if (_adminActivityLog.length > _ADMIN_ACTIVITY_MAX) _adminActivityLog.length = _ADMIN_ACTIVITY_MAX;
  _refreshAdminActivityDrawer();
}

function _formatActivityTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

function _ensureAdminActivityLauncher() {
  if (document.getElementById('admin-activity-launcher')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'admin-activity-launcher';
  btn.className = 'admin-activity-launcher';
  btn.setAttribute('aria-label', t('txt_admin_activity_open'));
  btn.title = t('txt_admin_activity_open');
  btn.textContent = '🕒';
  btn.onclick = _toggleAdminActivityDrawer;
  document.body.appendChild(btn);

  const drawer = document.createElement('div');
  drawer.id = 'admin-activity-drawer';
  drawer.className = 'admin-activity-drawer hidden';
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="admin-activity-head">
      <span>${esc(t('txt_admin_activity_title'))}</span>
      <button type="button" class="admin-toast-close" aria-label="${escAttr(t('txt_admin_activity_close'))}" onclick="_toggleAdminActivityDrawer(false)">×</button>
    </div>
    <ul class="admin-activity-list" id="admin-activity-list"></ul>
  `;
  document.body.appendChild(drawer);
  _refreshAdminActivityDrawer();
}

function _toggleAdminActivityDrawer(forceOpen) {
  const drawer = document.getElementById('admin-activity-drawer');
  if (!drawer) return;
  const willOpen = (typeof forceOpen === 'boolean') ? forceOpen : drawer.classList.contains('hidden');
  drawer.classList.toggle('hidden', !willOpen);
  drawer.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
  if (willOpen) _refreshAdminActivityDrawer();
}

function _refreshAdminActivityDrawer() {
  const list = document.getElementById('admin-activity-list');
  if (!list) return;
  if (_adminActivityLog.length === 0) {
    list.innerHTML = `<li class="admin-activity-empty">${esc(t('txt_admin_activity_empty'))}</li>`;
    return;
  }
  list.innerHTML = _adminActivityLog
    .map(e => `<li><span>${esc(e.label)}</span><span class="admin-activity-time">${esc(_formatActivityTime(e.ts))}</span></li>`)
    .join('');
}

// ─── Unified match filter (#6) ────────────────────────────────────────────
// Filter chip row applied to .match-card-wrap globally. Persisted per
// tournament in sessionStorage so reloads inside the same tab keep the
// admin's choice. Possible values: 'all' | 'pending' | 'completed' | 'disputed'.
const _MATCH_FILTER_VALUES = new Set(['all', 'pending', 'completed', 'disputed']);

function _matchFilterStorageKey(tid) {
  return `adminMatchFilter:${tid}`;
}

function _readPersistedMatchFilter(tid) {
  if (!tid) return 'all';
  try {
    const v = sessionStorage.getItem(_matchFilterStorageKey(tid));
    return _MATCH_FILTER_VALUES.has(v) ? v : 'all';
  } catch (_) { return 'all'; }
}

function _persistMatchFilter(tid, value) {
  if (!tid) return;
  try { sessionStorage.setItem(_matchFilterStorageKey(tid), value); } catch (_) { /* ignore */ }
}

/**
 * Render the unified match filter chip row. Rendered inside the status bar.
 * The disputed chip only appears when score confirmation is non-immediate
 * (the only context where disputes can exist).
 */
function _renderMatchFilterChips(tid) {
  const current = _readPersistedMatchFilter(tid);
  // _gpMatchFilterState is the legacy global used by _applyMatchFilter; keep in sync.
  if (typeof _gpMatchFilterState !== 'undefined') _gpMatchFilterState = current;
  const showDisputed = (typeof _scoreConfirmationMode !== 'undefined') && _scoreConfirmationMode !== 'immediate';
  const chip = (key, label) => {
    const active = current === key ? ' active' : '';
    return `<button type="button" class="${active}" data-filter="${key}" onclick="_applyMatchFilter('${key}')">${esc(label)}</button>`;
  };
  let html = `<div class="match-filter-row" id="admin-match-filter-row" role="tablist" aria-label="Match filter">`;
  html += `<div class="match-filter-toggle" id="gp-match-filter">`;
  html += chip('all', t('txt_txt_filter_all'));
  html += chip('pending', t('txt_txt_filter_pending'));
  html += chip('completed', t('txt_txt_filter_completed'));
  if (showDisputed) html += chip('disputed', t('txt_admin_filter_disputed'));
  html += `</div></div>`;
  return html;
}

// ─── Status-bar attention badge (#3) ──────────────────────────────────────
/**
 * Build the attention area inside the status bar. When there are review
 * items (disputes / pending confirmation), collapse the four pending stat
 * pills into one warning button that scrolls to the review queue. Other
 * stat pills are only emitted when their value is non-zero.
 *
 * @param {object} stats          From `_buildGpOpsStats` / `_buildMexOpsStats`.
 * @param {string} reviewCardId   DOM id of the review queue card to scroll to.
 */
function _renderStatusBarStats(stats, reviewCardId) {
  const reviewItems = (stats.disputesCount || 0) + (stats.pendingConfirmationCount || 0);
  let html = `<div class="gp-ops-stats-row">`;
  if (reviewItems > 0 && reviewCardId) {
    const label = reviewItems === 1
      ? t('txt_admin_status_attention_one')
      : t('txt_admin_status_attention', { n: reviewItems });
    html += `<button type="button" class="gp-ops-attention" onclick="document.getElementById('${reviewCardId}')?.scrollIntoView({behavior:'smooth', block:'center'})">`;
    html += `<span class="gp-ops-attention-icon" aria-hidden="true">⚠</span>${esc(label)}`;
    html += `</button>`;
  }
  if (stats.unresolvedCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_pending_matches')}</span><strong>${stats.unresolvedCount}</strong></div>`;
  }
  if (stats.unassignedCourtsCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_no_courts')}</span><strong>${stats.unassignedCourtsCount}</strong></div>`;
  }
  if (stats.escalatedCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_escalated')}</span><strong>${stats.escalatedCount}</strong></div>`;
  }
  html += `</div>`;
  return html;
}

/**
 * Build the disabled-with-reason attribute string for a decision button.
 * Returns either ` disabled title="..."` (when reason provided) or empty.
 */
function _decisionDisabledAttrs(reason) {
  if (!reason) return '';
  return ` disabled title="${escAttr(reason)}" aria-disabled="true"`;
}

/**
 * Pick the reason a "next round / start playoffs" button should be disabled,
 * or null if the action is currently allowed.
 */
function _decisionDisabledReason({ pendingMatches = 0, finished = false, hasMoreRounds = true } = {}) {
  if (finished) return t('txt_admin_decision_disabled_finished');
  if (pendingMatches > 0) {
    return t('txt_admin_decision_disabled_pending', { n: pendingMatches });
  }
  if (!hasMoreRounds) return t('txt_admin_decision_disabled_no_more_rounds');
  return null;
}
