const API = '';  // same origin

// Check if running in demo mode and show warning banner
(async function checkDemoMode() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
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

function _showToast(message) {
  if (!message) return;
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.top = '1rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'var(--green)';
  toast.style.color = '#fff';
  toast.style.padding = '0.7rem 1.2rem';
  toast.style.borderRadius = '8px';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '0.9rem';
  toast.style.zIndex = '9999';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  }, 1800);
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
  _applySportToCreatePanel();
  updateActiveTournamentUI();
  updateAuthUI();
  renderParticipantFields('gp');
  renderParticipantFields('mex');
  renderParticipantFields('po');
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
      result.innerHTML = await res.text();
    } else {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      result.innerHTML = `<img src="${blobUrl}" class="bracket-img" alt="Schema" onclick="_openBracketLightbox('${blobUrl}')" title="Click to expand">`;
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

function generateGpPlayoffSchema() {
  if (!currentTid) return;
  _fetchSchema('gp-playoff-schema', `/api/tournaments/${currentTid}/gp/playoffs-schema`, 'playoffs');
}

function generateMexPlayoffSchema() {
  if (!currentTid) return;
  _fetchSchema('mex-playoff-schema', `/api/tournaments/${currentTid}/mex/playoffs-schema`, 'mex-playoffs');
}

function generatePoPlayoffSchema() {
  if (!currentTid) return;
  _fetchSchema('po-playoff-schema', `/api/tournaments/${currentTid}/po/playoffs-schema`, 'po-playoffs');
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
    resultEl.innerHTML = `<details class="bracket-collapse bracket-collapse-left" open><summary class="bracket-collapse-summary"><span class="bracket-chevron bracket-chevron-anim">&#9654;</span>${t('txt_txt_play_off_bracket')}</summary><img class="bracket-img" src="${URL.createObjectURL(blob)}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand"></details>`;
  } catch (e) {
    resultEl.innerHTML = '';
    msgEl.textContent = e.message;
    msgEl.classList.remove('hidden');
  }
}

/** Build the collapsible Play-offs Schema card HTML. */
function _schemaCardHtml(prefix, placeholder, generateFn) {
  let h = `<details id="${prefix}-card" class="card">`;
  h += `<summary>${t('txt_txt_play_offs_schema')}</summary>`;
  h += `<div class="schema-card-body">`;
  h += `<div class="form-grid">`;
  h += `<label>${t('txt_txt_title')}</label><input id="${prefix}-title" type="text" placeholder="${placeholder}">`;
  h += `<label>${t('txt_txt_format')}</label><select id="${prefix}-fmt"><option value="png">PNG</option><option value="svg">SVG</option><option value="pdf">PDF</option></select>`;
  h += `</div>`;
  h += `<details class="schema-options-details">`;
  h += `<summary class="schema-options-summary">⚙ ${t('txt_txt_rendering_options')}</summary>`;
  h += `<div class="schema-options-body">`;
  h += `<label>${t('txt_txt_box_size')} <span id="${prefix}-box-val" class="schema-range-value">1.0</span></label>`;
  h += `<input id="${prefix}-box" type="range" min="0.3" max="3.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-box-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_line_width')} <span id="${prefix}-lw-val" class="schema-range-value">1.0</span></label>`;
  h += `<input id="${prefix}-lw" type="range" min="0.3" max="5.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-lw-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_arrow_size')} <span id="${prefix}-arrow-val" class="schema-range-value">1.0</span></label>`;
  h += `<input id="${prefix}-arrow" type="range" min="0.3" max="5.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-arrow-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_header_size')} <span id="${prefix}-title-scale-val" class="schema-range-value">1.0</span></label>`;
  h += `<input id="${prefix}-title-scale" type="range" min="0.3" max="3.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-title-scale-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_output_scale')} <span id="${prefix}-output-scale-val" class="schema-range-value">0.7</span></label>`;
  h += `<input id="${prefix}-output-scale" type="range" min="0.5" max="3.0" step="0.1" value="0.7" oninput="document.getElementById('${prefix}-output-scale-val').textContent=this.value">`;
  h += `</div>`;
  h += `</details>`;
  h += `<button type="button" class="btn btn-primary" onclick="${generateFn}()">${t('txt_txt_generate_playoffs_schema')}</button>`;
  h += `<div id="${prefix}-msg" class="alert alert-error hidden schema-card-msg"></div>`;
  h += `<div id="${prefix}-result" class="schema-card-result"></div>`;
  h += `</div>`;
  h += `</details>`;
  return h;
}

// ─── API helper ────────────────────────────────────────────
// Use authenticated API wrapper from auth.js
