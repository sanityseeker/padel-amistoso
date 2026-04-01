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
  refreshCourtDefaults('gp');
  refreshCourtDefaults('mex');
  refreshCourtDefaults('po');
  if (_convertFromRegistration) _showConvertBanner();
  if (currentTid) {
    if (currentType === 'group_playoff') renderGP();
    else if (currentType === 'playoff') renderPO();
    else if (currentType === 'mexicano') renderMex();
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
    resultEl.innerHTML = `<details class="bracket-collapse" open style="text-align:left"><summary style="cursor:pointer;user-select:none;font-size:0.82rem;color:var(--text-muted);padding:0.2rem 0;list-style:none;display:flex;align-items:center;gap:0.35rem"><span class="bracket-chevron" style="display:inline-block;transition:transform 0.15s">&#9654;</span>${t('txt_txt_play_off_bracket')}</summary><img class="bracket-img" src="${URL.createObjectURL(blob)}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand"></details>`;
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
  h += `<div style="margin-top:0.6rem">`;
  h += `<div class="form-grid">`;
  h += `<label>${t('txt_txt_title')}</label><input id="${prefix}-title" type="text" placeholder="${placeholder}">`;
  h += `<label>${t('txt_txt_format')}</label><select id="${prefix}-fmt"><option value="png">PNG</option><option value="svg">SVG</option><option value="pdf">PDF</option></select>`;
  h += `</div>`;
  h += `<details style="margin-bottom:0.75rem">`;
  h += `<summary style="cursor:pointer;color:var(--text-muted);font-size:0.85rem;user-select:none">⚙ ${t('txt_txt_rendering_options')}</summary>`;
  h += `<div style="margin-top:0.5rem">`;
  h += `<label>${t('txt_txt_box_size')} <span id="${prefix}-box-val" style="color:var(--text-muted)">1.0</span></label>`;
  h += `<input id="${prefix}-box" type="range" min="0.3" max="3.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-box-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_line_width')} <span id="${prefix}-lw-val" style="color:var(--text-muted)">1.0</span></label>`;
  h += `<input id="${prefix}-lw" type="range" min="0.3" max="5.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-lw-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_arrow_size')} <span id="${prefix}-arrow-val" style="color:var(--text-muted)">1.0</span></label>`;
  h += `<input id="${prefix}-arrow" type="range" min="0.3" max="5.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-arrow-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_header_size')} <span id="${prefix}-title-scale-val" style="color:var(--text-muted)">1.0</span></label>`;
  h += `<input id="${prefix}-title-scale" type="range" min="0.3" max="3.0" step="0.1" value="1.0" oninput="document.getElementById('${prefix}-title-scale-val').textContent=this.value">`;
  h += `<label>${t('txt_txt_output_scale')} <span id="${prefix}-output-scale-val" style="color:var(--text-muted)">0.7</span></label>`;
  h += `<input id="${prefix}-output-scale" type="range" min="0.5" max="3.0" step="0.1" value="0.7" oninput="document.getElementById('${prefix}-output-scale-val').textContent=this.value">`;
  h += `</div>`;
  h += `</details>`;
  h += `<button type="button" class="btn btn-primary" onclick="${generateFn}()">${t('txt_txt_generate_playoffs_schema')}</button>`;
  h += `<div id="${prefix}-msg" class="alert alert-error hidden" style="margin-top:0.75rem"></div>`;
  h += `<div id="${prefix}-result" style="margin-top:1rem; text-align:center"></div>`;
  h += `</div>`;
  h += `</details>`;
  return h;
}

// ─── API helper ────────────────────────────────────────────
// Use authenticated API wrapper from auth.js
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
    // Active section: open lobbies and (when archive toggle is off) closed, never-converted lobbies.
    // Finished section: all closed lobbies when archive toggle is on.
    const lobbies = visibleRegList.filter(r => r.open || (!r.open && !(r.converted_to_tids?.length) && !_showArchivedRegistrations));
    const finishedLobbies = _showArchivedRegistrations
      ? visibleRegList.filter(r => !r.open)
      : [];
    const closedLobbiesCount = regList.filter(r => !r.open).length;
    if (!active.length && !lobbies.length) {
      el.innerHTML = `<div style="text-align:center;padding:2rem 1rem;color:var(--text-muted)"><div style="font-size:2.2rem;margin-bottom:0.5rem">🏆</div><div style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:0.35rem">${t('txt_txt_no_tournaments_yet')}</div><div style="font-size:0.85rem;margin-bottom:1rem">${t('txt_txt_no_tournaments_hint')}</div><button type="button" class="btn btn-primary btn-sm" onclick="setActiveTab('create')">${t('txt_txt_create_first')}</button></div>`;
      const finishedHtml = finished.map(renderTournamentCard).join('') + finishedLobbies.map(_renderLobbyCard).join('');
      if (finishedHtml) {
        finCard.style.display = '';
        finEl.innerHTML = finishedHtml;
      } else {
        finCard.style.display = 'none';
      }
      return;
    }
    const renderTournamentCard = (tournament) => {
      const canEdit = isAdmin() || getAuthUsername() === tournament.owner || tournament.shared === true;
      const canDelete = isAdmin() || getAuthUsername() === tournament.owner;
      const isPublic = tournament.public !== false;
      const visBtn = canEdit
        ? `<button type="button" class="btn btn-sm" title="${t('txt_txt_visibility')}" onclick="togglePublic('${tournament.id}',${isPublic})" style="padding:0.25rem 0.5rem;font-size:0.75rem">${isPublic ? '🌍 ' + t('txt_txt_public') : '🔒 ' + t('txt_txt_private')}</button>`
        : '';
      const deleteBtn = canDelete
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteTournament('${tournament.id}')">✕</button>`
        : '';
      const actionBtns = (canEdit || canDelete) ? `${visBtn}${deleteBtn}` : '';
      const isTennis = tournament.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      const sharedBadge = tournament.shared ? `<span class="badge" style="background:var(--info,#3b82f6);color:#fff;font-size:0.72rem">${t('txt_badge_shared')}</span>` : '';
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
      const countLabel = `<span style="font-size:0.8rem;color:var(--text-muted)">(${count})</span>`;
      const isListed = r.listed !== false && r.listed !== 0;
      const visBtn = `<button type="button" class="btn btn-sm" title="${t('txt_txt_visibility')}" onclick="_toggleRegListed('${esc(rid)}',${isListed})" style="padding:0.25rem 0.5rem;font-size:0.75rem">${isListed ? '🌍 ' + t('txt_txt_public') : '🔒 ' + t('txt_txt_private')}</button>`;
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
    const finishedHtml = finished.map(renderTournamentCard).join('') + finishedLobbies.map(_renderLobbyCard).join('');
    if (finishedHtml) {
      finCard.style.display = '';
      finEl.innerHTML = finishedHtml;
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
let _mexPlayers = [];  // [{id, name}] for manual editor
let _mexBreakdowns = {};  // {match_id: {player_id: {raw, strength_mult, loss_disc, win_bonus, final}}}
let _mexPlayerMap = {};  // {player_id: player_name}
let _mexTeamMode = false;  // true when each participant is a pre-formed pair

// ─── Admin live-refresh (version polling) ─────────────────
let _adminVersionPollTimer = null;
let _adminLastKnownVersion = null;
let _adminVersionEtag = null;
let _adminVersionFetching = false;
const _ADMIN_POLL_INTERVAL_MS = 15000;

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
    const [data, collabResult] = await Promise.all([
      api(`/api/registrations/${_renderTid}`),
      getAuthUsername()
        ? api(`/api/registrations/${_renderTid}/collaborators`).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (currentTid !== _renderTid) return;
    _regDetails[_renderTid] = data;
    _currentRegDetail = data;
    if (collabResult) _regCollaborators[_renderTid] = collabResult.collaborators || [];
    _renderRegDetailInline(_renderTid);
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`;
  }
}

// ─── Sport selector ──────────────────────────────────────
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
  // gp and mex have a visible entry-mode toggle to hide
  for (const mode of ['gp', 'mex']) {
    const toggle = document.getElementById(`${mode}-entry-mode-toggle`);
    if (!toggle) continue;
    if (isTennis) {
      toggle.style.display = 'none';
      setEntryMode(mode, 'individual');
    } else {
      toggle.style.display = '';
      const btns = toggle.querySelectorAll('button');
      btns[0].textContent = t('txt_txt_individual_mode');
      btns[1].textContent = t('txt_txt_team_mode_short');
    }
  }
  // po has no toggle but needs individual-style defaults for tennis
  if (isTennis) {
    setEntryMode('po', 'individual');
  } else {
    setEntryMode('po', 'team');
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

function _entryModeIsTeam(mode) { return _entryMode[mode] === 'team'; }

const _gpGroupColors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#84cc16'];
function _gpGroupIndexForSlot(slotIndex, total, numGroups) {
  const base = Math.floor(total / numGroups);
  const rem = total % numGroups;
  let cum = 0;
  for (let g = 0; g < numGroups; g++) {
    cum += base + (g < rem ? 1 : 0);
    if (slotIndex < cum) return g;
  }
  return numGroups - 1;
}

function renderParticipantFields(mode) {
  const grid = document.getElementById(`${mode}-participant-grid`);
  const addBtn = document.getElementById(`${mode}-add-btn`);
  const countEl = document.getElementById(`${mode}-participant-count`);
  if (!grid) return;
  const entries = _participantEntries[mode];
  const isTeam = _entryModeIsTeam(mode);
  const numGroups = mode === 'gp' ? Math.max(1, parseInt(document.getElementById('gp-num-groups')?.value || '1', 10)) : 0;
  grid.innerHTML = '';
  entries.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'participant-entry';
    if (mode === 'gp' && numGroups > 1) {
      const gIdx = _gpGroupIndexForSlot(i, entries.length, numGroups);
      const dot = document.createElement('span');
      dot.className = 'participant-group-dot';
      dot.style.background = _gpGroupColors[gIdx % _gpGroupColors.length];
      dot.title = `Group ${gIdx + 1}`;
      dot.textContent = gIdx + 1;
      row.appendChild(dot);
    }
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
  _updateParticipantCount(mode);
}

function _updateParticipantCount(mode) {
  const el = document.getElementById(`${mode}-participant-count`);
  if (!el) return;
  const n = _participantPasteMode[mode]
    ? (document.getElementById(`${mode}-players`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean).length
    : _participantEntries[mode].filter(Boolean).length;
  el.textContent = `(${n})`;
  // Refresh strength bubbles when the section is open
  if (document.getElementById(`${mode}-strength-section`)?.open) renderStrengthBubbles(mode);
}

function addParticipantField(mode) {
  _participantEntries[mode].push('');
  renderParticipantFields(mode);
  const grid = document.getElementById(`${mode}-participant-grid`);
  if (grid) {
    const inputs = grid.querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }
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
  if (_participantPasteMode[mode]) {
    const ta = document.getElementById(`${mode}-players`);
    return ta ? ta.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
  }
  return _participantEntries[mode].map(s => s.trim()).filter(Boolean);
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
    if (_participantPasteMode[mode]) {
      const ta = document.getElementById(`${mode}-players`);
      if (ta) ta.value = _participantEntries[mode].join('\n');
    }
  }
  renderParticipantFields(mode);
}

function clearParticipants(mode) {
  _participantEntries[mode] = [];
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
  const names = getParticipantNames(mode);
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
  // Render strength bubbles when their section is toggled open
  for (const mode of ['gp', 'mex', 'po']) {
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
  html += `<div class="field-section-title" style="margin:0">📋 ${t('txt_gp_group_assignments')}</div>`;
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
    + `<button type="button" class="btn btn-success" style="padding:0.65rem 1.4rem;font-size:1.05rem" data-action="withLoading" data-handler="createGP">🏆 ${t('txt_gp_confirm_create')}</button>`
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
    buttonsEl.innerHTML = `<button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" data-action="withLoading" data-handler="previewGPGroups" data-i18n="txt_txt_create_tournament">${t('txt_txt_create_tournament')}</button>`;
  }
}

// ─── Create Group+Playoff ─────────────────────────────────
async function createGP() {
  const msg = document.getElementById('gp-msg');
  try {
    const names = getParticipantNames('gp');
    if (names.length < 2) throw new Error('Need at least 2 players');
    const body = {
      name: document.getElementById('gp-name').value,
      player_names: getParticipantNames('gp'),
      team_mode: _currentSport === 'tennis' ? true : _entryModeIsTeam('gp'),
      assign_courts: document.getElementById('gp-assign-courts')?.checked !== false,
      court_names: getCourtNames('gp'),
      num_groups: +document.getElementById('gp-num-groups').value,
      group_names: getGroupNames(),
      public: document.getElementById('gp-public').checked,
      sport: _currentSport,
    };
    const gpStr = _getCreateStrengths('gp');
    if (gpStr) body.player_strengths = gpStr;
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
    if (isTeam && names.length < 2) throw new Error('Need at least 2 teams');
    if (!isTeam && names.length < 4) throw new Error('Need at least 4 players for individual Mexicano');
    const skillGapRaw = document.getElementById('mex-skill-gap').value.trim();
    const rolling = document.getElementById('mex-rounds-toggle').querySelectorAll('button')[0].classList.contains('active');
    const body = {
      name: document.getElementById('mex-name').value,
      player_names: getParticipantNames('mex'),
      assign_courts: document.getElementById('mex-assign-courts')?.checked !== false,
      court_names: getCourtNames('mex'),
      total_points_per_match: +document.getElementById('mex-pts').value,
      num_rounds: rolling ? 0 : +document.getElementById('mex-rounds').value,
      team_mode: _currentSport === 'tennis' ? true : _entryModeIsTeam('mex'),
      skill_gap: skillGapRaw === '' ? null : +skillGapRaw,
      win_bonus: +document.getElementById('mex-win-bonus').value,
      strength_weight: +document.getElementById('mex-strength-weight').value,
      loss_discount: +document.getElementById('mex-loss-discount').value,
      balance_tolerance: +document.getElementById('mex-balance-tol').value,
      public: document.getElementById('mex-public').checked,
      sport: _currentSport,
    };
    const mexStr = _getCreateStrengths('mex');
    if (mexStr) body.player_strengths = mexStr;
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
    if (names.length < 2) throw new Error('Need at least 2 participants');
    const body = {
      name: document.getElementById('po-name').value,
      participant_names: getParticipantNames('po'),
      assign_courts: document.getElementById('po-assign-courts')?.checked !== false,
      court_names: getCourtNames('po'),
      team_mode: true,
      double_elimination: document.getElementById('po-double-elim').checked,
      public: document.getElementById('po-public').checked,
      sport: _currentSport,
    };
    const poStr = _getCreateStrengths('po');
    if (poStr) body.player_strengths = poStr;
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

// ─── Render Group+Playoff ─────────────────────────────────
async function renderGP() {
  _totalPts = 0;  // GP matches have no fixed total
  const _renderTid = currentTid;
  const el = document.getElementById('view-content');
  try {
    const [status, groups, playoffs, tvSettings, playerSecrets, collabData] = await Promise.all([
      api(`/api/tournaments/${currentTid}/gp/status`),
      api(`/api/tournaments/${currentTid}/gp/groups`),
      api(`/api/tournaments/${currentTid}/gp/playoffs`).catch(()=>null),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/collaborators`).catch(() => null),
    ]);

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }
    _gpCurrentCourts = status.courts || [];
    _gpGroupNames = Object.keys(groups.standings);
    _gpCurrentPhase = status.phase;

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderPlayerCodes(playerSecrets);
    html += _renderCollaboratorsSection(collabData?.collaborators || []);
    if (status.phase === 'playoffs') {
      html += `<div class="alert alert-info">${t('txt_txt_phase')}: <span class="badge badge-phase">${t('txt_txt_play_offs')}</span></div>`;
    }

    const groupPending = _sortTbdLast(Object.values(groups.matches)
      .flat()
      .filter(m => m.status !== 'completed'));
    const playoffPending = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));
    const assignmentMatches = (status.phase === 'groups') ? groupPending : playoffPending;
    html += _renderCourtAssignmentsCard(
      assignmentMatches,
      status.phase === 'groups' ? t('txt_txt_court_assignments_group_stage') : t('txt_txt_court_assignments_play_offs'),
      status.assign_courts !== false,
    );

    const groupFormatLabel = _gpScoreMode['gp-group'] === 'sets' ? `🎾 ${t('txt_txt_sets')}` : t('txt_txt_points_label');
    if (status.phase === 'groups') {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_group_stage_input_format')}</h3>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${_gpScoreMode['gp-group'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('gp-group','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${_gpScoreMode['gp-group'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('gp-group','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    if (status.champion) {
      html += `<div class="alert alert-success">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
    }

    if (status.phase === 'finished') {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_export_outcome')}</h3>`;
      html += `<label class="switch-label"><input type="checkbox" id="export-include-history" checked><span class="switch-track"></span>${t('txt_txt_include_match_history')}</label>`;
      html += `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.6rem">`;
      html += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
      html += `<button type="button" class="btn" style="background:var(--border);color:var(--text)" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    const shouldCollapseGroups = status.phase !== 'groups';
    if (shouldCollapseGroups) {
      html += `<details class="card"><summary>${t('txt_txt_group_stage_results_format_value', { value: groupFormatLabel })}</summary>`;
    }

    // Group standings
    for (const [gName, rows] of Object.entries(groups.standings)) {
      html += `<div class="card" id="gp-group-card-${escAttr(gName)}"><h3 class="card-heading-row">${t('txt_txt_group_name_value', { value: esc(gName) })} <button class="format-info-btn" onclick="showAbbrevPopup(event,'standings')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></h3>`;
      const hParticipant = status.team_mode ? t('txt_txt_team') : t('txt_txt_player');
      const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
      html += `<table><thead><tr><th>${hParticipant}</th><th>${t('txt_txt_p_abbrev')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th>`;
      if (hasSets) html += `<th>${t('txt_txt_sw_abbrev')}</th><th>${t('txt_txt_sl_abbrev')}</th><th>${t('txt_txt_sd_abbrev')}</th>`;
      html += `<th>${t('txt_txt_pf_abbrev')}</th><th>${t('txt_txt_pa_abbrev')}</th><th>${t('txt_txt_diff_abbrev')}</th></tr></thead><tbody>`;
      for (const r of rows) {
        html += `<tr><td>${esc(r.player)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>`;
        if (hasSets) html += `<td>${r.sets_won}</td><td>${r.sets_lost}</td><td>${r.sets_diff}</td>`;
        html += `<td>${r.points_for}</td><td>${r.points_against}</td><td>${r.point_diff}</td></tr>`;
      }
      html += `</tbody></table>`;

      // Group matches
      const gMatches = _sortTbdLast(groups.matches[gName] || []);
      if (gMatches.length > 0) {
        html += `<h4 style="margin:1rem 0 0.4rem;color:var(--text-muted);font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em">${t('txt_txt_matches')}</h4>`;
      }
      for (const m of gMatches) {
        html += matchRow(m, 'gp-group');
      }

      if (status.phase === 'groups' && !status.team_mode) {
        html += `<div id="gp-add-player-area-${escAttr(gName)}" style="margin-top:0.5rem">`;
        html += `<button type="button" class="add-participant-btn" onclick="_addPlayerToGroup(${JSON.stringify(gName)})">＋ ${t('txt_txt_add_player')}</button>`;
        html += `</div>`;
      }

      html += `</div>`;
    }

    if (shouldCollapseGroups) {
      html += `</details>`;
    }

    // Next round / Start playoffs controls
    if (status.phase === 'groups') {
      const allGroupMatches = Object.values(groups.matches).flat();
      const pending = allGroupMatches.filter(m => m.status !== 'completed');
      if (pending.length === 0) {
        html += `<div id="gp-playoffs-section">`;
        html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/gp/courts`);
        html += `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;justify-content:center;margin-top:0.75rem">`;
        if (groups.has_more_rounds) {
          html += `<button type="button" class="btn btn-primary" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,nextGpGroupRound)">⚡ ${t('txt_txt_generate_next_group_round')}</button>`;
        }
        html += `<button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,proposeGpPlayoffs)">🏆 ${t('txt_txt_start_playoffs')} →</button>`;
        html += `</div>`;
        html += `</div>`;
      } else {
        const total = allGroupMatches.length;
        const done = total - pending.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        html += `<div class="alert alert-info">${t('txt_txt_n_match_remaining', { n: pending.length })} (${done}/${total})<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div></div>`;
      }
    }

    // Playoff bracket
    if (status.phase === 'playoffs' || status.phase === 'finished') {
      html += _schemaCardHtml('gp-playoff-schema', t('txt_txt_play_off_bracket'), 'generateGpPlayoffSchema');

      html += `<div class="card"><h2>${t('txt_txt_play_offs')}</h2>`;
      html += `<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem">`;
      html += `<span style="font-size:0.82rem;color:var(--text-muted)">${t('txt_txt_score_format')}:</span>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${_gpScoreMode['gp-playoff'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('gp-playoff','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${_gpScoreMode['gp-playoff'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('gp-playoff','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div></div>`;
      if (playoffs && playoffs.matches) {
        for (const m of _sortTbdLast(playoffs.matches)) {
          html += matchRow(m, 'gp-playoff');
        }
      }
      html += `</div>`;
    }

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

// ─── Render Standalone Playoff ────────────────────────────
async function renderPO() {
  _totalPts = 0;
  const _renderTid = currentTid;
  const el = document.getElementById('view-content');
  try {
    const [status, playoffs, tvSettings, playerSecrets, collabData] = await Promise.all([
      api(`/api/tournaments/${currentTid}/po/status`),
      api(`/api/tournaments/${currentTid}/po/playoffs`),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/collaborators`).catch(() => null),
    ]);

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderPlayerCodes(playerSecrets);
    html += _renderCollaboratorsSection(collabData?.collaborators || []);

    if (status.champion) {
      html += `<div class="alert alert-success">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
    }

    if (status.phase === 'finished') {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_export_outcome')}</h3>`;
      html += `<label class="switch-label"><input type="checkbox" id="export-include-history" checked><span class="switch-track"></span>${t('txt_txt_include_match_history')}</label>`;
      html += `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.6rem">`;
      html += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
      html += `<button type="button" class="btn" style="background:var(--border);color:var(--text)" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    const pending = _sortTbdLast((playoffs.pending || []).filter(m => m.status !== 'completed'));
    html += _renderCourtAssignmentsCard(pending, t('txt_txt_court_assignments_play_offs'), status.assign_courts !== false);

    html += _schemaCardHtml('po-playoff-schema', t('txt_txt_play_off_bracket'), 'generatePoPlayoffSchema');

    html += `<div class="card"><h2>${t('txt_txt_play_offs')}</h2>`;
    html += `<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem">`;
    html += `<span style="font-size:0.82rem;color:var(--text-muted)">${t('txt_txt_score_format')}:</span>`;
    html += `<div class="score-mode-toggle">`;
    html += `<button type="button" class="${_gpScoreMode['po-playoff'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('po-playoff','points')">${t('txt_txt_points_label')}</button>`;
    html += `<button type="button" class="${_gpScoreMode['po-playoff'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('po-playoff','sets')">🎾 ${t('txt_txt_sets')}</button>`;
    html += `</div></div>`;
    html += `<details id="po-inline-bracket" class="bracket-collapse" open style="margin:0.5rem 0"><summary style="cursor:pointer;user-select:none;font-size:0.82rem;color:var(--text-muted);padding:0.2rem 0;list-style:none;display:flex;align-items:center;gap:0.35rem"><span class="bracket-chevron" style="display:inline-block;transition:transform 0.15s">▶</span>${t('txt_txt_play_off_bracket')}</summary>`;
    html += `<img class="bracket-img" src="/api/tournaments/${currentTid}/po/playoffs-schema?fmt=png&_t=${Date.now()}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand" onerror="this.style.display='none'">`;
    html += `</details>`;
    if (playoffs.matches) {
      for (const m of _sortTbdLast(playoffs.matches)) {
        html += matchRow(m, 'po-playoff');
      }
    }
    html += `</div>`;

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

function matchRow(m, ctx) {
  const t1 = m.team1.join(' & ') || 'TBD';
  const t2 = m.team2.join(' & ') || 'TBD';
  const court = m.court ? `<span class="match-court">${esc(m.court)}</span>` : '';
  const roundLabel = m.round_label ? `<span class="badge badge-scheduled">${esc(m.round_label)}</span>` : '';

  if (m.status === 'completed') {
    // Score display — show sets if available, else plain score
    const sc = m.score || [0, 0];
    let scoreDisplay;
    let scoreClass = 'match-score';
    if (m.sets && m.sets.length > 0) {
      scoreClass = 'match-score sets-stack';
      scoreDisplay = m.sets
        .map(s => `<span class="set-row">${s[0]}-${s[1]}</span>`)
        .join('');
    } else {
      scoreDisplay = `${sc[0]} – ${sc[1]}`;
    }

    const w1 = sc[0] > sc[1];
    const w2 = sc[1] > sc[0];
    const t1Class = w1 ? ' team-winner' : (w2 ? ' team-loser' : '');
    const t2Class = w2 ? ' team-winner' : (w1 ? ' team-loser' : '');
    let html = `<div class="match-card" style="flex-wrap:wrap">`;
    html += `${roundLabel} <div class="match-teams"><span class="${t1Class}">${esc(t1)}</span> <span class="vs">vs</span> <span class="${t2Class}">${esc(t2)}</span></div> ${court}`;
    html += ` <span class="${scoreClass}" id="mscore-${m.id}">${scoreDisplay}</span>`;
    html += ` <span class="badge badge-completed">✓</span>`;
    const _editSetsJson = JSON.stringify(m.sets || []);
    html += `<button type="button" class="match-edit-btn" id="medit-btn-${m.id}" data-sets='${_editSetsJson}' onclick="_toggleEditMatch('${m.id}','${ctx}',${sc[0]},${sc[1]})">${t('txt_txt_edit')}</button>`;

    // Inline edit form (hidden)
    const isSetScoringCtxEdit = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
    const autoCalc = _totalPts > 0 && ctx === 'mex';
    const onInput = autoCalc ? `oninput="_autoFillScore('${m.id}', ${_totalPts})"` : '';
    html += `<div class="match-actions hidden" id="medit-${m.id}">`;
    if (isSetScoringCtxEdit) {
      const stageMode = _gpScoreMode[ctx] || 'points';
      html += `<div id="score-normal-${m.id}" class="${stageMode === 'sets' ? 'hidden' : ''}">`;
      html += `<input type="number" id="s1-${m.id}" min="0" value="${sc[0]}" style="width:50px" ${onInput}>`;
      html += `<span>–</span>`;
      html += `<input type="number" id="s2-${m.id}" min="0" value="${sc[1]}" style="width:50px" ${onInput}>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
      html += `</div>`;
      html += `<div id="score-tennis-${m.id}" class="${stageMode === 'sets' ? '' : 'hidden'}">`;
      html += `<div class="tennis-sets" id="tennis-sets-${m.id}">`;
      html += _renderTennisSetInputs(m.id, 3);
      html += `</div>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitTennisScore('${m.id}','${ctx}')">${t('txt_txt_save_sets')}</button>`;
      html += `</div>`;
    } else {
      html += `<input type="number" id="s1-${m.id}" min="0" value="${sc[0]}" style="width:50px" ${onInput}>`;
      html += `<span>–</span>`;
      html += `<input type="number" id="s2-${m.id}" min="0" value="${sc[1]}" style="width:50px" ${onInput}>`;
      html += `<button type="button" class="btn btn-success btn-sm" onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    }
    html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_cancelEditMatch('${m.id}')">✕</button>`;
    html += `</div>`;

    // Breakdown toggle for Mexicano matches
    const isMex = ctx === 'mex' || ctx === 'mex-playoff';
    const bd = isMex ? _mexBreakdowns[m.id] : null;
    if (bd && Object.keys(bd).length > 0) {
      html += `<details class="breakdown-details">`;
      html += `<summary>📊 ${t('txt_txt_score_breakdown')}</summary>`;
      html += `<div class="breakdown-panel">`;
      html += `<table class="breakdown-table"><thead><tr><th>${t('txt_txt_player')}</th><th>${t('txt_txt_raw')}</th><th>${t('txt_txt_strength_multiplier')}</th><th>${t('txt_txt_loss_disc_multiplier')}</th><th>${t('txt_txt_win_bonus_header')}</th><th>${t('txt_txt_final')}</th></tr></thead><tbody>`;
      for (const [pid, d] of Object.entries(bd)) {
        const pname = _mexPlayerMap[pid] || pid;
        html += `<tr><td>${esc(pname)}</td><td>${d.raw}</td><td>${d.strength_mult !== 1 ? '×' + d.strength_mult.toFixed(2) : '—'}</td><td>${d.loss_disc !== 1 ? '×' + d.loss_disc.toFixed(2) : '—'}</td><td>${d.win_bonus > 0 ? '+' + d.win_bonus : '—'}</td><td><strong>${d.final}</strong></td></tr>`;
      }
      html += `</tbody></table></div>`;
      html += `</details>`;
    }

    // Comment banner (completed match)
    html += `<div class="match-comment-banner">`;
    if (m.comment) {
      html += `<span class="match-comment-text" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_click_to_edit')}">💬 ${esc(m.comment)}</span>`;
    } else {
      html += `<span class="match-comment-add" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_comment_placeholder')}">💬 ${t('txt_match_add_comment')}</span>`;
    }
    html += `<div class="match-comment-edit hidden" id="mc-row-${m.id}">`;
    html += `<input type="text" id="mc-${m.id}" value="${m.comment ? esc(m.comment) : ''}" placeholder="${t('txt_match_comment_placeholder')}" maxlength="500" onkeydown="if(event.key==='Enter')_setMatchComment('${m.id}')">` ;
    html += `<button type="button" class="btn-comment-save" onclick="_setMatchComment('${m.id}')">${t('txt_txt_save')}</button>`;
    if (m.comment) html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearMatchComment('${m.id}')">✕</button>`;
    html += `<button type="button" class="btn-comment-cancel" aria-label="${t('txt_txt_cancel')}" onclick="_closeCommentEdit('${m.id}')">✕</button>`;
    html += `</div></div>`;

    html += `</div>`;
    return html;
  }

  // Not yet completed — show input form
  const isMex = ctx === 'mex' || ctx === 'mex-playoff';
  const isSetScoringCtx = ctx === 'gp-group' || ctx === 'gp-playoff' || ctx === 'mex-playoff' || ctx === 'po-playoff';
  const autoCalc = _totalPts > 0 && ctx === 'mex';
  const onInput = autoCalc
    ? `oninput="_autoFillScore('${m.id}', ${_totalPts})"`
    : '';
  const hasTbd = !m.team1?.join('').trim() || !m.team2?.join('').trim();
  const tbdAttr = hasTbd ? ` disabled title="${t('txt_txt_players_not_yet_determined')}"` : '';
  const tbdStyle = hasTbd ? ' style="opacity:0.45;cursor:not-allowed"' : '';

  let html = `<div class="match-card" style="flex-wrap:wrap">${roundLabel} <div class="match-teams">${esc(t1)} <span class="vs">vs</span> ${esc(t2)}</div> ${court}`;

  // Points / tennis-set scoring toggle for playoff/group contexts
  if (isSetScoringCtx) {
    const stageMode = _gpScoreMode[ctx] || 'points';
    html += `<div class="match-actions" id="score-input-${m.id}">`;
    html += `<div id="score-normal-${m.id}" class="${stageMode === 'sets' ? 'hidden' : ''}">`;
    html += `<input type="number" id="s1-${m.id}" min="0" value="" placeholder="0" style="width:50px" ${onInput}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="s2-${m.id}" min="0" value="" placeholder="${autoCalc ? _totalPts : 0}" style="width:50px" ${onInput}>`;
    html += `<button type="button" class="btn btn-success btn-sm"${tbdAttr}${tbdStyle} onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    html += `</div>`;
    html += `<div id="score-tennis-${m.id}" class="${stageMode === 'sets' ? '' : 'hidden'}">`;
    html += `<div class="tennis-sets" id="tennis-sets-${m.id}">`;
    html += _renderTennisSetInputs(m.id, 3);
    html += `</div>`;
    html += `<button type="button" class="btn btn-success btn-sm"${tbdAttr}${tbdStyle} onclick="submitTennisScore('${m.id}','${ctx}')">${t('txt_txt_save_sets')}</button>`;
    html += `</div>`;
    html += `</div>`;
  } else {
    html += `<div class="match-actions">`;
    html += `<input type="number" id="s1-${m.id}" min="0" value="" placeholder="0" style="width:50px" ${onInput}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="s2-${m.id}" min="0" value="" placeholder="${autoCalc ? _totalPts : 0}" style="width:50px" ${onInput}>`;
    html += `<button type="button" class="btn btn-success btn-sm"${tbdAttr}${tbdStyle} onclick="submitScore('${m.id}','${ctx}')">${t('txt_txt_save')}</button>`;
    html += `</div>`;
  }

  // Comment banner (pending match)
  html += `<div class="match-comment-banner">`;
  if (m.comment) {
    html += `<span class="match-comment-text" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_click_to_edit')}">💬 ${esc(m.comment)}</span>`;
  } else {
    html += `<span class="match-comment-add" onclick="_openCommentEdit('${m.id}')" title="${t('txt_match_comment_placeholder')}">💬 ${t('txt_match_add_comment')}</span>`;
  }
  html += `<div class="match-comment-edit hidden" id="mc-row-${m.id}">`;
  html += `<input type="text" id="mc-${m.id}" value="${m.comment ? esc(m.comment) : ''}" placeholder="${t('txt_match_comment_placeholder')}" maxlength="500" onkeydown="if(event.key==='Enter')_setMatchComment('${m.id}')">`;
  html += `<button type="button" class="btn-comment-save" onclick="_setMatchComment('${m.id}')">${t('txt_txt_save')}</button>`;
  if (m.comment) html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearMatchComment('${m.id}')">✕</button>`;
  html += `<button type="button" class="btn-comment-cancel" aria-label="${t('txt_txt_cancel')}" onclick="_closeCommentEdit('${m.id}')">✕</button>`;
  html += `</div></div>`;

  html += `</div>`;
  return html;
}

function _captureViewDrafts() {
  const root = document.getElementById('view-content');
  if (!root) return {};

  const drafts = {};
  root.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'button' || el.type === 'submit') return;

    let key = '';
    if (el.id) {
      key = `id:${el.id}`;
    } else if (el.dataset?.match !== undefined && el.dataset?.slot !== undefined) {
      key = `manual:${el.dataset.match}:${el.dataset.slot}`;
    } else {
      return;
    }

    drafts[key] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });

  // Preserve open/closed state of identified <details> elements
  root.querySelectorAll('details[id]').forEach(el => {
    drafts[`details:${el.id}`] = el.open;
  });

  return drafts;
}

function _restoreViewDrafts(drafts) {
  const root = document.getElementById('view-content');
  if (!root || !drafts) return;

  for (const [key, value] of Object.entries(drafts)) {
    if (key.startsWith('details:')) {
      const el = document.getElementById(key.slice(8));
      if (el && el.tagName === 'DETAILS') {
        if (value) el.setAttribute('open', ''); else el.removeAttribute('open');
      }
      continue;
    }
    let el = null;
    if (key.startsWith('id:')) {
      el = document.getElementById(key.slice(3));
    } else if (key.startsWith('manual:')) {
      const [, match, slot] = key.split(':');
      el = root.querySelector(`.manual-sel[data-match="${match}"][data-slot="${slot}"]`);
    }
    if (!el) continue;

    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = Boolean(value);
    } else {
      el.value = value;
    }
  }
}

async function _rerenderCurrentViewPreserveDrafts() {
  const drafts = _captureViewDrafts();
  if (currentType === 'registration') {
    await renderRegistration();
  } else if (currentType === 'group_playoff') {
    await renderGP();
  } else if (currentType === 'playoff') {
    await renderPO();
  } else {
    await renderMex();
  }
  _restoreViewDrafts(drafts);
  // Reseed the version so the poll doesn't trigger a redundant re-render
  // right after an admin-initiated mutation or an already-handled poll update.
  if (currentTid) {
    fetch(`/api/tournaments/${currentTid}/version`)
      .then(r => r.json())
      .then(d => { _adminLastKnownVersion = d.version; })
      .catch(() => {});
  }
}

/** Map scoring context to API path suffix. */
const _SCORE_ENDPOINTS = {
  'gp-group':   { points: 'gp/record-group',           tennis: 'gp/record-group-tennis' },
  'gp-playoff': { points: 'gp/record-playoff',         tennis: 'gp/record-playoff-tennis' },
  'mex-playoff':{ points: 'mex/record-playoff',        tennis: 'mex/record-playoff-tennis' },
  'mex':        { points: 'mex/record',                 tennis: null },
  'po-playoff': { points: 'po/record',                  tennis: 'po/record-tennis' },
};

function _scoreApiPath(ctx, isTennis) {
  const entry = _SCORE_ENDPOINTS[ctx] || _SCORE_ENDPOINTS['mex'];
  return `/api/tournaments/${currentTid}/${isTennis ? entry.tennis : entry.points}`;
}

async function submitScore(matchId, ctx) {
  const s1 = +document.getElementById('s1-' + matchId).value;
  const s2 = +document.getElementById('s2-' + matchId).value;
  try {
    await api(_scoreApiPath(ctx, false), {
      method: 'POST', body: JSON.stringify({ match_id: matchId, score1: s1, score2: s2 })
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) { alert(e.message); }
}

function _renderTennisSetInputs(matchId, numSets) {
  let html = '';
  for (let i = 0; i < numSets; i++) {
    html += `<div class="tennis-set-row">`;
    html += `<span class="tennis-set-label">S${i + 1}:</span>`;
    html += `<input class="tennis-set-input" type="number" id="ts1-${matchId}-${i}" min="0" max="13" value="" placeholder="0">`;
    html += `<span class="tennis-set-sep">-</span>`;
    html += `<input class="tennis-set-input" type="number" id="ts2-${matchId}-${i}" min="0" max="13" value="" placeholder="0">`;
    html += `</div>`;
  }
  return html;
}

async function _setStageScoreMode(ctx, mode) {
  if (!(ctx in _gpScoreMode)) return;
  _gpScoreMode[ctx] = mode;
  _updateTvSetting('score_mode', { [ctx]: mode });
  if (currentType === 'group_playoff' || currentType === 'mexicano' || currentType === 'playoff') {
    await _rerenderCurrentViewPreserveDrafts();
  }
}

async function submitTennisScore(matchId, ctx) {
  // Gather set scores
  const sets = [];
  for (let i = 0; i < 10; i++) {
    const e1 = document.getElementById('ts1-' + matchId + '-' + i);
    const e2 = document.getElementById('ts2-' + matchId + '-' + i);
    if (!e1 || !e2) break;
    const v1 = +e1.value || 0;
    const v2 = +e2.value || 0;
    if (v1 === 0 && v2 === 0) continue;  // skip empty sets
    sets.push([v1, v2]);
  }
  if (sets.length === 0) { alert(t('txt_txt_enter_at_least_one_set_score')); return; }

  try {
    await api(_scoreApiPath(ctx, true), {
      method: 'POST', body: JSON.stringify({ match_id: matchId, sets })
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) { alert(e.message); }
}

// ─── GP Playoff Configuration ─────────────────────────────
let _gpRecommended = [];
let _gpAdvancingIds = new Set();
let _gpExternalParticipants = [];
let _gpCurrentCourts = [];
let _gpGroupNames = [];
let _gpCurrentPhase = '';

async function nextGpGroupRound() {
  try {
    await api(`/api/tournaments/${currentTid}/gp/next-group-round`, { method: 'POST' });
    renderGP();
  } catch (e) { alert(e.message); }
}

async function proposeGpPlayoffs() {
  try {
    const data = await api(`/api/tournaments/${currentTid}/gp/recommend-playoffs`);
    _gpRecommended = data.recommended_participants || [];
    _gpAdvancingIds = new Set(_gpRecommended.map(r => r.player_id));
    _gpExternalParticipants = [];
    const section = document.getElementById('gp-playoffs-section');
    if (section) section.innerHTML = _renderGpPlayoffEditor();
  } catch (e) { alert(e.message); }
}

function _renderGpPlayoffEditor() {
  let html = `<div class="card">`;
  html += `<h2>${t('txt_txt_configure_gp_playoffs')}</h2>`;
  html += `<p class="gp-editor-intro">${t('txt_txt_select_advancing_players')}</p>`;

  // Participant checkboxes grouped by group — grid layout
  const byGroup = {};
  for (const r of _gpRecommended) {
    if (!byGroup[r.group]) byGroup[r.group] = [];
    byGroup[r.group].push(r);
  }
  html += `<div class="gp-groups-container">`;
  for (const [gName, rows] of Object.entries(byGroup)) {
    html += `<div class="gp-group-box">`;
    html += `<div class="gp-group-title">${esc(gName)}</div>`;
    for (const r of rows) {
      const checked = _gpAdvancingIds.has(r.player_id) ? ' checked' : '';
      html += `<label class="gp-player-row">`;
      html += `<input type="checkbox" value="${r.player_id}" class="gp-advancing-cb"${checked} onchange="_gpToggleAdvancing(this)">`;
      html += `<span class="gp-player-name">${esc(r.player)}</span>`;
      const _usesSets = r.sets_won > 0 || r.sets_lost > 0;
      const _diffPart = _usesSets
        ? `${t('txt_txt_sd_abbrev')}: ${r.sets_diff >= 0 ? '+' : ''}${r.sets_diff}, diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}`
        : `diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}`;
      html += `<span class="gp-player-stats">${r.wins} ${t('txt_txt_w_abbrev')}, ${_diffPart}</span>`;
      html += `</label>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  // External participants section
  html += `<div class="gp-external-section">`;
  html += `<h3>${t('txt_txt_external_participants')}</h3>`;
  html += `<p class="gp-external-hint">${t('txt_txt_external_participants_hint')}</p>`;
  html += `<div id="gp-external-list">`;
  for (let i = 0; i < _gpExternalParticipants.length; i++) {
    const ep = _gpExternalParticipants[i];
    html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem">`;
    html += `<span style="min-width:140px">★ ${esc(ep.name)}</span>`;
    html += `<input type="number" value="${ep.score}" style="width:70px" onchange="_gpUpdateExternalScore(${i}, this.value)">`;
    html += `<button type="button" class="btn btn-sm" style="padding:0.15rem 0.5rem;background:var(--border);color:var(--text)" onclick="_gpRemoveExternal(${i})">✕</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `<div style="display:flex;align-items:center;gap:0.5rem">`;
  html += `<input type="text" id="gp-external-name" placeholder="${t('txt_txt_add_external_participant')}" onkeydown="if(event.key==='Enter')_gpAddExternal()">`;
  html += `<input type="number" id="gp-external-score" placeholder="${t('txt_txt_score')}" value="0" style="width:70px">`;
  html += `<button type="button" class="btn btn-sm btn-primary" onclick="_gpAddExternal()">+</button>`;
  html += `</div>`;
  html += `</div>`;

  // Format selector
  html += `<div class="gp-format-row">`;
  html += `<div class="form-group"><label>${t('txt_txt_format')}</label><select id="gp-playoff-format"><option value="single">${t('txt_txt_single_elimination')}</option><option value="double">${t('txt_txt_double_elimination')}</option></select></div>`;
  html += `</div>`;

  // Courts + action buttons
  html += _renderCourtsSection(_gpCurrentCourts, `/api/tournaments/${currentTid}/gp/courts`);
  html += `<div class="proposal-actions" style="margin-top:0.75rem">`;
  html += `<button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,_confirmGpPlayoffs)">✓ ${t('txt_txt_start_playoffs')}</button>`;
  html += `<button type="button" class="btn" style="padding:0.75rem 1.5rem;font-size:1.1rem;background:var(--border);color:var(--text)" onclick="renderGP()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _gpToggleAdvancing(cb) {
  if (cb.checked) _gpAdvancingIds.add(cb.value);
  else _gpAdvancingIds.delete(cb.value);
}

function _gpAddExternal() {
  const input = document.getElementById('gp-external-name');
  const scoreInput = document.getElementById('gp-external-score');
  const name = (input?.value || '').trim();
  if (!name) return;
  const score = parseInt(scoreInput?.value || '0', 10) || 0;
  _gpExternalParticipants.push({ name, score });
  input.value = '';
  if (scoreInput) scoreInput.value = '0';
  const section = document.getElementById('gp-playoffs-section');
  if (section) section.innerHTML = _renderGpPlayoffEditor();
}

function _gpRemoveExternal(idx) {
  _gpExternalParticipants.splice(idx, 1);
  const section = document.getElementById('gp-playoffs-section');
  if (section) section.innerHTML = _renderGpPlayoffEditor();
}

function _gpUpdateExternalScore(idx, value) {
  if (idx >= 0 && idx < _gpExternalParticipants.length) {
    _gpExternalParticipants[idx].score = parseInt(value, 10) || 0;
  }
}

async function _confirmGpPlayoffs() {
  const ids = [..._gpAdvancingIds];
  const fmt = document.getElementById('gp-playoff-format')?.value || 'single';
  const extra = _gpExternalParticipants.length > 0
    ? _gpExternalParticipants.map(ep => ({ name: ep.name, score: ep.score }))
    : null;
  const totalParticipants = ids.length + (extra ? extra.length : 0);
  if (totalParticipants < 2) {
    alert(t('txt_txt_team_n_select_both_players', { n: 1 }));
    return;
  }
  try {
    await api(`/api/tournaments/${currentTid}/gp/start-playoffs`, {
      method: 'POST',
      body: JSON.stringify({
        advancing_player_ids: ids.length > 0 ? ids : null,
        extra_participants: extra,
        double_elimination: fmt === 'double',
      }),
    });
    _gpRecommended = [];
    _gpAdvancingIds = new Set();
    _gpExternalParticipants = [];
    renderGP();
  } catch (e) { alert(e.message); }
}

async function startPlayoffs() {
  // Direct start (backwards compat) — delegates to confirm flow
  await _confirmGpPlayoffs();
}

// ─── Render Mexicano ──────────────────────────────────────
async function renderMex() {
  const _renderTid = currentTid;
  const el = document.getElementById('view-content');
  try {
    const [status, matches, tvSettings, playerSecrets, playoffsData, collabData] = await Promise.all([
      api(`/api/tournaments/${currentTid}/mex/status`),
      api(`/api/tournaments/${currentTid}/mex/matches`),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/mex/playoffs`).catch(() => ({ matches: [], pending: [] })),
      api(`/api/tournaments/${currentTid}/collaborators`).catch(() => null),
    ]);

    _totalPts = status.total_points_per_match || 0;
    _mexPlayers = status.players || [];
    _mexTeamMode = status.team_mode || false;
    _mexBreakdowns = matches.breakdowns || {};
    _mexPlayerMap = {};
    for (const p of _mexPlayers) _mexPlayerMap[p.id] = p.name;
    window._mexStatusLeaderboard = status.leaderboard || [];

    // Store data needed by the manual pairing editor's round stats card
    window._mexAllMatches = matches.all_matches || [];
    window._mexSkillGap = status.skill_gap ?? null;

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderPlayerCodes(playerSecrets);
    html += _renderCollaboratorsSection(collabData?.collaborators || []);

    // Phase-aware header
    const isPlayoffs = status.phase === 'playoffs';
    const isFinished = status.phase === 'finished';
    const isRolling = status.rolling;
    const mexicanoEnded = Boolean(status.mexicano_ended);
    const mexRoundsDone = !isRolling && status.current_round >= status.num_rounds && matches.pending.length === 0;
    const hasPlayoffBracket = (playoffsData.matches || []).length > 0;

    if (isPlayoffs) {
      html += `<div class="alert alert-info">${t('txt_txt_phase')}: <span class="badge badge-phase">${t('txt_txt_play_offs')}</span></div>`;
    } else if (isFinished && hasPlayoffBracket) {
      html += `<div class="alert alert-info">${t('txt_txt_tournament_finished_after_playoffs')}</div>`;
    } else if (isFinished) {
      html += `<div class="alert alert-info">${t('txt_txt_tournament_finished_no_playoffs')}</div>`;
    } else if (mexicanoEnded) {
      html += `<div class="alert alert-info">${t('txt_txt_mexicano_phase_ended')}</div>`;
    } else if (!isPlayoffs && isRolling) {
      html += `<div class="alert alert-info">${t('txt_txt_mexicano_round_n', { n: status.current_round })} <span class="badge badge-phase">${t('txt_txt_rolling')}</span></div>`;
    } else if (!isPlayoffs) {
      html += `<div class="alert alert-info">${t('txt_txt_mexicano_round_n_of_m', { n: status.current_round, m: status.num_rounds })}${mexRoundsDone ? ` — <strong>${t('txt_txt_mexicano_rounds_complete_ready_for_play_offs')}</strong>` : ''}</div>`;
    }

    if (status.champion) {
      html += `<div class="alert alert-success">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
    }

    if (isFinished) {
      html += `<div class="card">`;
      html += `<h3>${t('txt_txt_export_outcome')}</h3>`;
      html += `<label class="switch-label"><input type="checkbox" id="export-include-history" checked><span class="switch-track"></span>${t('txt_txt_include_match_history')}</label>`;
      html += `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.6rem">`;
      html += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
      html += `<button type="button" class="btn" style="background:var(--border);color:var(--text)" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
      html += `</div>`;
      html += `</div>`;
    }

    if (isPlayoffs || hasPlayoffBracket) {
      const pendingPo = (playoffsData.pending || []).filter(m => m.status !== 'completed');
      html += _renderCourtAssignmentsCard(pendingPo, t('txt_txt_court_assignments_mexicano_play_offs'), status.assign_courts !== false);

      html += _schemaCardHtml('mex-playoff-schema', t('txt_txt_mexicano_play_offs_bracket'), 'generateMexPlayoffSchema');

      html += `<div class="card"><h2>${t('txt_txt_mexicano_play_off_bracket')}</h2>`;
      html += `<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem">`;
      html += `<span style="font-size:0.82rem;color:var(--text-muted)">${t('txt_txt_score_format')}:</span>`;
      html += `<div class="score-mode-toggle">`;
      html += `<button type="button" class="${_gpScoreMode['mex-playoff'] === 'points' ? 'active' : ''}" onclick="_setStageScoreMode('mex-playoff','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${_gpScoreMode['mex-playoff'] === 'sets' ? 'active' : ''}" onclick="_setStageScoreMode('mex-playoff','sets')">🎾 ${t('txt_txt_sets')}</button>`;
      html += `</div></div>`;
      html += `<details id="mex-inline-bracket" class="bracket-collapse" open style="margin:0.5rem 0"><summary style="cursor:pointer;user-select:none;font-size:0.82rem;color:var(--text-muted);padding:0.2rem 0;list-style:none;display:flex;align-items:center;gap:0.35rem"><span class="bracket-chevron" style="display:inline-block;transition:transform 0.15s">▶</span>${t('txt_txt_mexicano_play_offs_bracket')}</summary>`;
      html += `<img class="bracket-img" src="/api/tournaments/${currentTid}/mex/playoffs-schema?fmt=png&_t=${Date.now()}" alt="${t('txt_txt_mexicano_play_offs_bracket')}" onclick="_openBracketLightbox(this.src)" title="Click to expand" onerror="this.style.display='none'">`;
      html += `</details>`;
      for (const m of _sortTbdLast(playoffsData.matches)) {
        html += matchRow(m, 'mex-playoff');
      }
      html += `</div>`;
    } else {
      html += _renderCourtAssignmentsCard(matches.current_matches, t('txt_txt_court_assignments_current_round'), status.assign_courts !== false);
    }

    // Leaderboard
    html += `<div class="card"><h2 class="card-heading-row">${t('txt_txt_leaderboard')} <button class="format-info-btn" onclick="showAbbrevPopup(event,'leaderboard')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></h2>`;
    const byAvg = status.leaderboard.length > 0 && status.leaderboard[0].ranked_by_avg;
    const hTotal = byAvg ? t('txt_txt_total_pts_abbrev') : `<strong>${t('txt_txt_total_pts_abbrev')} ↓</strong>`;
    const hAvg   = byAvg ? `<strong>${t('txt_txt_avg_pts_abbrev')} ↓</strong>` : t('txt_txt_avg_pts_abbrev');
    html += `<table><thead><tr><th>${t('txt_txt_rank')}</th><th>${_mexTeamMode ? t('txt_txt_team') : t('txt_txt_player')}</th><th>${hTotal}</th><th>${t('txt_txt_played_abbrev')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th><th>${hAvg}</th></tr></thead><tbody>`;
    for (const r of status.leaderboard) {
      const totalCell = byAvg ? r.total_points : `<strong>${r.total_points}</strong>`;
      const avgCell   = byAvg ? `<strong>${r.avg_points.toFixed(2)}</strong>` : r.avg_points.toFixed(2);
      const removedStyle = r.removed ? ' style="opacity:0.45"' : '';
      const rankCell = r.removed ? `<span style="color:var(--text-muted)">—</span>` : r.rank;
      const nameCell = r.removed ? `${esc(r.player)} <span class="badge badge-closed" style="font-size:0.7em;vertical-align:middle">${t('txt_txt_removed')}</span>` : esc(r.player);
      html += `<tr${removedStyle}><td>${rankCell}</td><td>${nameCell}</td><td>${totalCell}</td><td>${r.matches_played}</td><td>${r.wins || 0}</td><td>${r.draws || 0}</td><td>${r.losses || 0}</td><td>${avgCell}</td></tr>`;
    }
    html += `</tbody></table></div>`;

    // Phase: Mexicano rounds
    if (!(isPlayoffs || isFinished)) {
      // Phase: Mexicano rounds
      if (matches.current_matches.length > 0) {
        html += `<div class="card"><h2>${t('txt_txt_current_round_matches')}</h2>`;
        for (const m of matches.current_matches) {
          html += matchRow(m, 'mex');
        }
        html += `</div>`;
      }

      // Next round / end / playoffs controls
      const pending = matches.pending.length;
      const canGenerateRound = isRolling || status.current_round < status.num_rounds;

      if (pending === 0 && !mexicanoEnded && canGenerateRound) {
        // Missed games / sit-out management panel
        if (status.sit_out_count > 0 && status.missed_games) {
          html += `<div class="card" id="mex-sitout-panel">`;
          html += `<h3>🪑 ${t('txt_txt_missed_games_sitout')}</h3>`;
          html += `<p style="color:var(--text-muted);font-size:0.82rem">${t('txt_txt_sitout_instructions', { n: status.sit_out_count })}</p>`;
          html += `<div class="sitout-grid">`;
          // Sort by most missed first
          const mgList = Object.entries(status.missed_games)
            .map(([id, d]) => ({id, name: d.name, sat_out: d.sat_out, played: d.matches_played}))
            .sort((a, b) => b.sat_out - a.sat_out || a.played - b.played);
          for (const mg of mgList) {
            const forced = _forcedSitOuts.has(mg.id);
            html += `<div class="sitout-item${forced ? ' forced' : ''}" onclick="_toggleForcedSitOut('${mg.id}', ${status.sit_out_count})">`;
            html += `<span class="missed-badge">${t('txt_txt_n_missed', { n: mg.sat_out })}</span>`;
            html += `<span>${esc(mg.name)}</span>`;
            html += `<span style="color:var(--text-muted);font-size:0.72rem">${t('txt_txt_n_played', { n: mg.played })}</span>`;
            html += `</div>`;
          }
          html += `</div>`;
          html += `<div id="sitout-selection-info" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem"></div>`;
          html += `</div>`;
        }

        html += `<div id="mex-next-section">`;
        html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/mex/courts`);
        html += `<div style="margin-top:0.5rem">`;
        html += `<button type="button" class="btn btn-success" onclick="withLoading(this,proposeMexPairings)">⚡ ${t('txt_txt_propose_next_round')}</button>`;
        if (status.current_round > 0) {
          html += ` <button type="button" class="btn btn-primary" onclick="withLoading(this,endMexicano)" style="margin-left:0.5rem">🛑 ${t('txt_txt_end_mexicano')}</button>`;
        }
        html += `</div>`;
        html += `</div>`;
      } else if (pending > 0) {
        const totalMex = matches.current_matches.length;
        const doneMex = totalMex - pending;
        const pctMex = totalMex > 0 ? Math.round((doneMex / totalMex) * 100) : 0;
        html += `<div class="alert alert-info">${t('txt_txt_n_match_remaining', { n: pending })} (${doneMex}/${totalMex})<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pctMex}%"></div></div></div>`;
      } else if (pending === 0 && !mexicanoEnded && !canGenerateRound) {
        html += `<div id="mex-next-section">`;
        html += `<button type="button" class="btn btn-primary" onclick="withLoading(this,endMexicano)">🛑 ${t('txt_txt_end_mexicano')}</button>`;
        html += `</div>`;
      }

      if (mexicanoEnded && !isPlayoffs && !isFinished) {
        html += `<div id="mex-playoffs-section" class="card">`;
        html += `<h3>${t('txt_txt_post_mexicano_decision')}</h3>`;
        html += `<p style="color:var(--text-muted);font-size:0.85rem">${t('txt_txt_post_mexicano_instructions')}</p>`;
        html += _renderCourtsSection(status.courts, `/api/tournaments/${currentTid}/mex/courts`);
        html += `<div class="proposal-actions" style="gap:1rem;margin-top:0.75rem">`;
        html += `<button type="button" class="btn btn-success" style="padding:0.85rem 2rem;font-size:1.1rem" onclick="withLoading(this,proposeMexPlayoffs)">🏆 ${t('txt_txt_start_optional_playoffs')}</button>`;
        html += `<button type="button" class="btn" style="padding:0.85rem 2rem;font-size:1.1rem;background:var(--border);color:var(--text)" onclick="withLoading(this,finishMexicanoAsIs)">✓ ${t('txt_txt_finish_as_is')}</button>`;
        html += `</div>`;
        html += `</div>`;
      }

      // History — grouped by round as collapsible accordion
      if (matches.all_matches.length > matches.current_matches.length) {
        html += `<div class="card"><h3>${t('txt_txt_previous_rounds')}</h3>`;
        const prev = matches.all_matches.filter(m => !matches.current_matches.some(c => c.id === m.id));
        // Group by round_number
        const byRound = {};
        for (const m of prev) {
          const rn = m.round_number || 0;
          if (!byRound[rn]) byRound[rn] = [];
          byRound[rn].push(m);
        }
        // Sort rounds descending (most recent first)
        const roundNums = Object.keys(byRound).map(Number).sort((a, b) => b - a);
        for (let ri = 0; ri < roundNums.length; ri++) {
          const rn = roundNums[ri];
          const rMatches = byRound[rn];
          const label = rMatches[0]?.round_label || `Round ${rn}`;
          const openAttr = ri === 0 ? ' open' : '';
          html += `<details class="round-group"${openAttr}>`;
          html += `<summary>${esc(label)} — ${rMatches.length} ${rMatches.length > 1 ? t('txt_txt_matches') : t('txt_txt_match')}</summary>`;
          for (const m of rMatches) {
            html += matchRow(m, 'mex');
          }
          html += `</details>`;
        }
        html += `</div>`;
      }
    }

    if (currentTid !== _renderTid) return;
    el.innerHTML = html;
  } catch (e) {
    if (currentTid !== _renderTid) return;
    if (_recoverFromMissingOpenTournament(_renderTid, e)) return;
    el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

function _renderCourtAssignmentsCard(matches, title, assignCourts = true) {
  if (!assignCourts) {
    // Courts disabled — group by round, defined players first, multi-column grid
    if (!matches || matches.length === 0) {
      return `<div class="card"><h3>${t('txt_txt_pending_matches')}</h3><em>${t('txt_txt_no_pending_assignments')}</em></div>`;
    }
    const _tl = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
    const _hasTbd = (m) => !m.team1?.join('').trim() || !m.team2?.join('').trim();
    // Group by round_label, preserving first-seen order
    const _byRound = {};
    const _roundOrder = [];
    for (const m of matches) {
      const key = m.round_label || '';
      if (!_byRound[key]) { _byRound[key] = []; _roundOrder.push(key); }
      _byRound[key].push(m);
    }
    // Within each round: defined-player matches first, TBD last
    for (const key of _roundOrder) {
      _byRound[key].sort((a, b) => _hasTbd(a) - _hasTbd(b));
    }
    let html = `<div class="card"><h3>${t('txt_txt_pending_matches')}</h3>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.5rem 1.25rem">`;
    for (const key of _roundOrder) {
      html += `<div>`;
      if (key) html += `<div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:0.35rem">${esc(key)}</div>`;
      for (const m of _byRound[key]) {
        const tbd = _hasTbd(m);
        const _cmt = m.comment ? `<div class="match-comment-text" style="cursor:default">💬 ${esc(m.comment)}</div>` : '';
        html += `<div class="match-card" style="margin-bottom:0.25rem${tbd ? ';opacity:0.5' : ''}"><div class="match-teams">${esc(_tl(m.team1))} <span class="vs">vs</span> ${esc(_tl(m.team2))}</div>${_cmt}</div>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  if (!matches || matches.length === 0) {
    return `<div class="card"><h3>${esc(title)}</h3><em>${t('txt_txt_no_pending_assignments')}</em></div>`;
  }

  // For each court, find the match with the lowest slot_number (the current one).
  const currentByCourt = {};
  for (const m of matches) {
    if (!m.court) continue;
    const s = m.slot_number ?? 0;
    if (!(m.court in currentByCourt) || s < currentByCourt[m.court].slot_number) {
      currentByCourt[m.court] = m;
    }
  }

  const courtNames = Object.keys(currentByCourt).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (courtNames.length === 0) {
    return `<div class="card"><h3>${esc(title)}</h3><em>${t('txt_txt_no_pending_assignments')}</em></div>`;
  }

  const _teamLabel = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';

  let html = `<div class="card"><h3>${esc(title)}</h3><div class="court-board">`;
  for (const courtName of courtNames) {
    const m = currentByCourt[courtName];
    const t1 = _teamLabel(m.team1);
    const t2 = _teamLabel(m.team2);
    const r = m.round_label ? `<span class="court-round">${esc(m.round_label)}</span>` : '';
    html += `<div class="court-column">`;
    html += `<div class="court-title">${esc(courtName)}</div>`;
    html += `<div class="court-match-item">${esc(t1)} <span style="color:var(--text-muted)">vs</span> ${esc(t2)}${r}</div>`;
    if (m.comment) html += `<div class="court-match-item" style="border-top:none"><span class="match-comment-text" style="cursor:default">💬 ${esc(m.comment)}</span></div>`;
    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}

async function nextMexRound() {
  try {
    await api(`/api/tournaments/${currentTid}/mex/next-round`, { method: 'POST' });
    renderMex();
  } catch (e) { alert(e.message); }
}

// ─── Pairing proposal picker ──────────────────────────────
let _selectedOptionId = null;
let _currentPlayerStats = null;
let _forcedSitOuts = new Set();
let _currentPairingProposals = [];
let _showRepeatDetails = false;
let _mexProposalRequestedCount = 3;

// ─── Sit-out override toggle ──────────────────────────────
async function _toggleForcedSitOut(playerId, maxSitOuts) {
  if (_forcedSitOuts.has(playerId)) {
    _forcedSitOuts.delete(playerId);
  } else {
    if (_forcedSitOuts.size >= maxSitOuts) {
      // Remove the first one added
      const first = _forcedSitOuts.values().next().value;
      _forcedSitOuts.delete(first);
    }
    _forcedSitOuts.add(playerId);
  }
  // Update visual state without full re-render
  document.querySelectorAll('.sitout-item').forEach(el => {
    const onclick = el.getAttribute('onclick');
    const match = onclick && onclick.match(/_toggleForcedSitOut\('([^']+)'/);
    if (match) {
      el.classList.toggle('forced', _forcedSitOuts.has(match[1]));
    }
  });
  const info = document.getElementById('sitout-selection-info');
  if (info) {
    if (_forcedSitOuts.size > 0) {
      const names = [..._forcedSitOuts].map(id => {
        const p = _mexPlayers.find(x => x.id === id);
        return p ? p.name : id;
      });
      info.innerHTML = `<strong>${t('txt_txt_forced_sitout')}</strong> ${esc(names.join(', '))} (${_forcedSitOuts.size}/${maxSitOuts})`;
    } else {
      info.innerHTML = `<em>${t('txt_txt_no_override_automatic')}</em>`;
    }
  }

  const nextSection = document.getElementById('mex-next-section');
  const remaining = maxSitOuts - _forcedSitOuts.size;
  if (_forcedSitOuts.size > 0 && remaining > 0) {
    // Partial selection — wait for all required sit-outs before calling the API
    if (nextSection) {
      nextSection.innerHTML = `<em style="color:var(--text-muted)">${t('txt_txt_select_more_sitouts', {n: remaining})}</em>`;
    }
    return;
  }
  if (nextSection) {
    nextSection.innerHTML = _renderProposalProgressBar();
  }
  try {
    await proposeMexPairings(_mexProposalRequestedCount);
  } catch (e) {
    if (nextSection) {
      nextSection.innerHTML = `<div class="alert alert-error">${esc(e.message || t('txt_txt_failed_refresh_proposals'))}</div>`;
    }
  }
}

// ─── Edit completed match ─────────────────────────────────
function _toggleEditMatch(matchId, ctx, s1, s2) {
  const editDiv = document.getElementById('medit-' + matchId);
  const scoreSpan = document.getElementById('mscore-' + matchId);
  const editBtn = document.getElementById('medit-btn-' + matchId);
  if (!editDiv) return;

  editDiv.classList.remove('hidden');

  // Populate plain-score inputs
  const s1El = document.getElementById('s1-' + matchId);
  const s2El = document.getElementById('s2-' + matchId);
  if (s1El) s1El.value = s1;
  if (s2El) s2El.value = s2;

  // Pre-populate tennis set inputs with existing set data (stored on the button)
  const setsRaw = editBtn ? editBtn.dataset.sets : null;
  if (setsRaw) {
    try {
      const sets = JSON.parse(setsRaw);
      for (let i = 0; i < 3; i++) {
        const e1 = document.getElementById('ts1-' + matchId + '-' + i);
        const e2 = document.getElementById('ts2-' + matchId + '-' + i);
        if (e1) e1.value = (sets[i] !== undefined) ? sets[i][0] : '';
        if (e2) e2.value = (sets[i] !== undefined) ? sets[i][1] : '';
      }
    } catch (_) {}
  }

  if (scoreSpan) scoreSpan.classList.add('hidden');
  if (editBtn) editBtn.classList.add('hidden');
}

function _cancelEditMatch(matchId) {
  const editDiv = document.getElementById('medit-' + matchId);
  const scoreSpan = document.getElementById('mscore-' + matchId);
  const editBtn = document.getElementById('medit-btn-' + matchId);
  if (editDiv) editDiv.classList.add('hidden');
  if (scoreSpan) scoreSpan.classList.remove('hidden');
  if (editBtn) editBtn.classList.remove('hidden');
}

async function proposeMexPairings(requestedCount = 3) {
  try {
    _mexProposalRequestedCount = requestedCount;
    let url = `/api/tournaments/${currentTid}/mex/propose-pairings?n=${requestedCount}`;
    if (_forcedSitOuts.size > 0) {
      url += `&sit_out_ids=${[..._forcedSitOuts].join(',')}`;
    }
    const data = await api(url);
    const proposals = data.proposals;
    _currentPairingProposals = proposals;
    _currentPlayerStats = data.player_stats || null;
    _selectedOptionId = (proposals.find(p => p.recommended) || proposals[0])?.option_id || null;

    // Replace only the next-section div so the rest of the view stays intact
    const section = document.getElementById('mex-next-section');
    if (section) {
      section.innerHTML = _renderProposalPicker(proposals);
    }
  } catch (e) { alert(e.message); }
}

async function _loadMoreMexPairings(btn) {
  if (btn && btn.classList.contains('loading')) return;
  if (btn) btn.classList.add('loading');
  try {
    const previousSelected = _selectedOptionId;
    await proposeMexPairings(10);
    if (previousSelected && _currentPairingProposals.some(p => p.option_id === previousSelected)) {
      _selectedOptionId = previousSelected;
    }
    const section = document.getElementById('mex-next-section');
    if (section && _currentPairingProposals.length > 0) {
      section.innerHTML = _renderProposalPicker(_currentPairingProposals);
    }
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

function _renderProposalProgressBar() {
  return `<div class="proposal-progress-bar-container">
    <div class="proposal-progress-bar"></div>
  </div>
  <p style="text-align:center;color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">${t('txt_txt_generating_proposals')}</p>`;
}

function _renderProposalPicker(proposals) {
  let html = `<div class="card">`;
  html += `<div class="proposal-header-row">`;
  html += `<h2>${t('txt_txt_choose_pairings')}</h2>`;
  html += `<button type="button" class="btn btn-outline-muted" onclick="_showManualEditor()">✏️ ${t('txt_txt_manual_override')}</button>`;
  html += `</div>`;
  html += `<div class="proposal-display-controls">`;  

  if (_currentPlayerStats) {
    html += `<details class="proposal-display-history">`;
    html += `<summary>${t('txt_txt_player_match_history')}</summary>`;
    html += `<div id="stats-panel">${_renderPlayerStats(_currentPlayerStats)}</div>`;
    html += `</details>`;
  }

  html += `<label class="proposal-display-toggle"><input type="checkbox" ${_showRepeatDetails ? 'checked' : ''} onchange="_toggleRepeatDetails(this.checked)"><span class="switch-track"></span>${t('txt_txt_show_repeat_details')}</label>`;
  html += `</div>`;

  const bestOption = proposals.find(p => p.recommended) || proposals[0] || null;
  const allAlternatives = proposals
    .filter(p => !bestOption || p.option_id !== bestOption.option_id);

  const proposalLabelNumber = (proposal) => {
    const match = String(proposal?.label || '').match(/(\d+)\s*$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };

  const sortByLabelNumber = (left, right) => {
    const numDiff = proposalLabelNumber(left) - proposalLabelNumber(right);
    if (numDiff !== 0) return numDiff;
    return String(left.label || '').localeCompare(String(right.label || ''));
  };

  const allBalancedOptions = allAlternatives.filter(p => p.strategy === 'balanced').sort(sortByLabelNumber);
  const allSeededOptions = allAlternatives.filter(p => p.strategy === 'seeded').sort(sortByLabelNumber);

  const balancedOptions = allBalancedOptions;
  const seededOptions = allSeededOptions;
  const hasLoadedMore = _mexProposalRequestedCount >= 10;

  const renderProposalCard = (p) => {
    const fmt2 = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num.toFixed(2) : '0.00';
    };
    const sel = p.option_id === _selectedOptionId;
    let card = `<div class="proposal-card${sel ? ' selected' : ''}" onclick="_selectProposal('${p.option_id}')">`;
    card += `<div class="proposal-card-header">`;
    card += `<h4>${esc(p.label)}</h4>`;
    if (p.strategy === 'seeded') {
      card += `<span class="badge badge-scheduled">${t('txt_txt_seeded')}</span>`;
    }
    if (p.recommended) card += `<span class="badge badge-best">★ ${t('txt_txt_best')}</span>`;
    card += `</div>`;
    card += `<div class="proposal-metrics">`;
    card += `⚖️ ${t('txt_txt_score_gap')}: <strong>${fmt2(p.score_imbalance)} pts</strong><br>`;
    const repLabel = p.repeat_count === 0
      ? `✅ ${t('txt_txt_no_repeated_matchups')}`
      : `⚠️ ${t('txt_txt_n_repeats', { n: p.repeat_count })}`;
    card += `${repLabel}`;
    if ((p.exact_prev_round_repeats || 0) > 0) {
      card += `<br>🔁 ${t('txt_txt_exact_rematch_warning', { n: p.exact_prev_round_repeats })}`;
    }
    if ((p.skill_gap_violations || 0) > 0) {
      const excess = fmt2(p.skill_gap_worst_excess || 0);
      card += `<br>🚫 ${t('txt_txt_skill_gap_violation', { n: p.skill_gap_violations, excess })}`;
    }
    if (p.sit_out_names && p.sit_out_names.length > 0) {
      card += `<br>🪑 ${t('txt_txt_sitting_out')}: <em>${esc(p.sit_out_names.join(', '))}</em>`;
    }
    card += `</div>`;

    for (const m of p.matches) {
      const t1 = m.team1_names.join(' & ');
      const t2 = m.team2_names.join(' & ');
      const court = m.court_name ? ` <span class="court-tag">[${esc(m.court_name)}]</span>` : '';
      card += `<div class="proposal-match">${esc(t1)} <span style="color:var(--text-muted)">vs</span> ${esc(t2)}${court}</div>`;
    }

    // Per-person repeat details
    if (_showRepeatDetails && p.per_person_repeats && p.repeat_count > 0) {
      card += `<div class="repeat-detail">`;
      for (const [name, detail] of Object.entries(p.per_person_repeats)) {
        const parts = [];
        for (const pr of (detail.partner_repeats || [])) {
          parts.push(esc(t('txt_txt_partner_n_times', { player: pr.player, count: pr.count })));
        }
        for (const or_ of (detail.opponent_repeats || [])) {
          parts.push(esc(t('txt_txt_vs_n_times', { player: or_.player, count: or_.count })));
        }
        if (parts.length > 0) {
          card += `<span class="rp-name">${esc(name)}</span>: ${parts.join(', ')}<br>`;
        }
      }
      card += `</div>`;
    }

    card += `</div>`;
    return card;
  };

  if (bestOption) {
    html += `<h3 style="margin-top:0.2rem">${t('txt_txt_best')}</h3>`;
    html += `<p style="margin:0.1rem 0 0.5rem;color:var(--text-muted);font-size:0.82rem">${t('txt_txt_best_description')}</p>`;
    html += `<div class="proposal-cards">`;
    html += renderProposalCard(bestOption);
    html += `</div>`;
  }

  if (allAlternatives.length > 0) {
    html += `<div class="proposal-section-row">`;
    html += `<h3>${t('txt_txt_alternatives')}</h3>`;
    html += `<div class="proposal-inline-actions">`;
    if (!hasLoadedMore) {
      html += `<button class="proposal-inline-action" type="button" onclick="_loadMoreMexPairings(this)">⬇ ${t('txt_txt_load_more_combos')}</button>`;
    } else {
      html += `<button class="proposal-inline-action" type="button" onclick="_loadMoreMexPairings(this)">🔄 ${t('txt_txt_refresh_proposals')}</button>`;
    }
    html += `</div>`;
    html += `</div>`;
  }

  if (balancedOptions.length > 0) {
    html += `<h3 style="margin-top:0.3rem">${t('txt_txt_balanced')}</h3>`;
    html += `<p style="margin:0.1rem 0 0.5rem;color:var(--text-muted);font-size:0.82rem">${t('txt_txt_balanced_description')}</p>`;
    html += `<div class="proposal-cards">`;
    for (const p of balancedOptions) {
      html += renderProposalCard(p);
    }
    html += `</div>`;
  }

  if (seededOptions.length > 0) {
    html += `<h3 style="margin-top:0.4rem">${t('txt_txt_seeded')}</h3>`;
    html += `<p style="margin:0.1rem 0 0.5rem;color:var(--text-muted);font-size:0.82rem">${t('txt_txt_seeded_description')}</p>`;
    if (seededOptions.length > 0) {
      html += `<div class="proposal-cards">`;
      for (const p of seededOptions) {
        html += renderProposalCard(p);
      }
      html += `</div>`;
    } else {
      html += `<p style="margin:0.1rem 0 0.5rem;color:var(--text-muted);font-size:0.82rem"><em>${t('txt_txt_no_seeded_alternatives')}</em></p>`;
    }
  }

  html += `<div class="proposal-action-bar">`;
  html += `<button type="button" class="btn btn-success" onclick="_confirmMexRound()">✓ ${t('txt_txt_confirm_selection')}</button>`;
  html += `<button type="button" class="btn btn-ghost" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`; // .card
  return html;
}

function _toggleRepeatDetails(show) {
  _showRepeatDetails = Boolean(show);
  const section = document.getElementById('mex-next-section');
  if (section && _currentPairingProposals.length > 0) {
    section.innerHTML = _renderProposalPicker(_currentPairingProposals);
  }
}

function _selectProposal(optionId) {
  _selectedOptionId = optionId;
  document.querySelectorAll('.proposal-card').forEach(c => {
    c.classList.toggle('selected', c.getAttribute('onclick') === `_selectProposal('${optionId}')`);
  });
}

async function _confirmMexRound() {
  if (!_selectedOptionId) { alert(t('txt_txt_select_a_pairing_option_first')); return; }
  try {
    await api(`/api/tournaments/${currentTid}/mex/next-round`, {
      method: 'POST',
      body: JSON.stringify({ option_id: _selectedOptionId }),
    });
    _selectedOptionId = null;
    _currentPlayerStats = null;
    renderMex();
  } catch (e) { alert(e.message); }
}

// ─── Court editor ─────────────────────────────────────────
let _courtEditorItems = [];
let _courtEditorOpen = false;
let _courtEditorPatchUrl = '';

function _renderCourtsSection(courts, patchUrl) {
  const names = (courts || []).map(c => typeof c === 'string' ? c : (c.name || ''));
  return `<div id="courts-editor-section" class="courts-section">${_courtsInnerHtml(names, patchUrl)}</div>`;
}

function _courtsInnerHtml(names, patchUrl) {
  if (_courtEditorOpen && _courtEditorPatchUrl === patchUrl) {
    const patchAttr = patchUrl.replace(/'/g, "\\'");
    let html = `<div class="courts-editor-list">`;
    for (let i = 0; i < _courtEditorItems.length; i++) {
      html += `<div class="court-editor-chip"><span class="court-row-label">${i + 1}.</span><input class="courts-editor-input" type="text" value="${esc(_courtEditorItems[i])}" oninput="_updateCourtEditorName(${i}, this.value)" placeholder="${t('txt_txt_court')} ${i + 1}"><button type="button" class="court-chip-delete" onclick="_deleteEditorCourt(${i}, '${patchAttr}')" aria-label="Remove">&times;</button></div>`;
    }
    html += `</div>`;
    html += `<div class="courts-editor-actions">`;
    html += `<button type="button" class="btn btn-sm btn-ghost" onclick="_addEditorCourt('${patchAttr}')">+ ${t('txt_txt_add_court')}</button>`;
    html += `<button type="button" class="btn btn-sm btn-success" onclick="_saveCourtEditor('${patchAttr}')" style="margin-left:auto">${t('txt_txt_save')}</button>`;
    html += `<button type="button" class="btn-outline-muted" onclick="_cancelCourtEditor()">${t('txt_txt_cancel')}</button>`;
    html += `</div>`;
    return html;
  }
  const label = names.length > 0
    ? names.map(n => esc(n)).join(', ')
    : `<em>${t('txt_txt_no_courts')}</em>`;
  const namesAttr = JSON.stringify(names).replace(/"/g, '&quot;');
  return `\uD83C\uDFDF\uFE0F ${t('txt_txt_courts')}: <span class="courts-summary-names">${label}</span>&ensp;<button type="button" class="btn-outline-muted" onclick="_openCourtEditor(${namesAttr}, '${patchUrl}')">${t('txt_txt_edit')}</button>`;
}

function _openCourtEditor(names, patchUrl) {
  _courtEditorItems = Array.isArray(names) ? [...names] : [];
  _courtEditorOpen = true;
  _courtEditorPatchUrl = patchUrl;
  _refreshCourtsSection(patchUrl);
}

function _refreshCourtsSection(patchUrl) {
  const el = document.getElementById('courts-editor-section');
  if (el) el.innerHTML = _courtsInnerHtml(_courtEditorItems, patchUrl);
}

function _addEditorCourt(patchUrl) {
  _courtEditorItems.push('');
  _refreshCourtsSection(patchUrl);
}

function _removeEditorCourt(patchUrl) {
  if (_courtEditorItems.length > 1) {
    _courtEditorItems.pop();
    _refreshCourtsSection(patchUrl);
  }
}

function _deleteEditorCourt(idx, patchUrl) {
  if (_courtEditorItems.length > 1) {
    _courtEditorItems.splice(idx, 1);
  } else {
    _courtEditorItems[0] = '';
  }
  _refreshCourtsSection(patchUrl);
}

function _updateCourtEditorName(idx, value) {
  _courtEditorItems[idx] = value;
}

async function _saveCourtEditor(patchUrl) {
  const names = _courtEditorItems.map((n, i) => (n || '').trim() || `Court ${i + 1}`);
  try {
    await api(patchUrl, {
      method: 'PATCH',
      body: JSON.stringify({ court_names: names }),
    });
    _courtEditorOpen = false;
    _courtEditorPatchUrl = '';
    if (currentType === 'mexicano') renderMex();
    else if (currentType === 'group_playoff') renderGP();
  } catch (e) { alert(e.message); }
}

function _cancelCourtEditor() {
  _courtEditorOpen = false;
  _courtEditorPatchUrl = '';
  if (currentType === 'mexicano') renderMex();
  else if (currentType === 'group_playoff') renderGP();
}

// ─── Manual pairing editor ───────────────────────────────
let _manualMatchCount = 0;
let _manualLockedMatches = new Set();  // indices of locked matches
let _manualLeaderboard = {};           // player_id → {rank, avg_points, total_points}

function _showManualEditor() {
  const section = document.getElementById('mex-next-section');
  if (!section) return;

  const numCourts = Math.floor(_mexPlayers.length / 4);
  _manualMatchCount = numCourts;
  _manualLockedMatches = new Set();

  // Build leaderboard lookup from status data stored during renderMex
  _manualLeaderboard = {};
  if (window._mexStatusLeaderboard) {
    for (const r of window._mexStatusLeaderboard) {
      _manualLeaderboard[r.player_id] = {
        rank: r.rank,
        avg_points: r.avg_points,
        total_points: r.total_points,
      };
    }
  }

  // Check if we can pre-fill from the selected proposal
  let prefillProposal = null;
  if (_selectedOptionId && _currentPairingProposals.length > 0) {
    prefillProposal = _currentPairingProposals.find(p => p.option_id === _selectedOptionId) || null;
  }
  if (prefillProposal) {
    _manualMatchCount = Math.max(numCourts, prefillProposal.matches.length);
  }

  let html = `<div class="card manual-editor-card">`;
  html += `<div class="manual-editor-header">`;
  html += `<h2>✏️ ${t('txt_txt_manual_pairing_editor')}</h2>`;
  html += `<div class="manual-editor-actions">`;
  html += `<button type="button" class="btn btn-sm btn-outline-muted" onclick="proposeMexPairings()">← ${t('txt_txt_back_to_proposals')}</button>`;
  html += `<button type="button" class="btn btn-sm btn-outline-muted" onclick="_manualClearAll()">✕ ${t('txt_txt_manual_clear_all')}</button>`;
  html += `</div>`;
  html += `</div>`;

  if (prefillProposal) {
    html += `<p class="manual-prefill-hint">${t('txt_txt_manual_editor_prefill_hint')}</p>`;
  } else {
    html += `<p class="manual-prefill-hint">${t('txt_txt_manual_editor_instructions')}</p>`;
  }

  html += `<div id="manual-matches" class="manual-matches-grid">`;
  for (let i = 0; i < _manualMatchCount; i++) {
    html += _renderManualMatch(i);
  }
  html += `</div>`;

  html += `<div style="margin: 0.5rem 0; display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center">`;
  html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_addManualMatch()">+ ${t('txt_txt_add_match')}</button>`;
  html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_removeManualMatch()">− ${t('txt_txt_remove_match')}</button>`;
  html += `</div>`;

  html += `<div id="manual-sitout" class="manual-sitout-bar"></div>`;

  html += `<div id="manual-round-stats"></div>`;

  html += `<div class="proposal-action-bar">`;
  html += `<button type="button" class="btn btn-success" onclick="_commitManualRound()">✓ ${t('txt_txt_commit_manual_round')}</button>`;
  html += `<button type="button" class="btn btn-ghost" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;

  section.innerHTML = html;

  // Pre-fill dropdowns from proposal if available
  if (prefillProposal) {
    for (let i = 0; i < prefillProposal.matches.length; i++) {
      const m = prefillProposal.matches[i];
      const setVal = (slot, val) => {
        const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
        if (sel) sel.value = val;
      };
      setVal('t1a', m.team1_ids[0]);
      setVal('t1b', m.team1_ids[1]);
      setVal('t2a', m.team2_ids[0]);
      setVal('t2b', m.team2_ids[1]);
    }
  }

  _updateManualSitout();
}

function _manualGetAvailablePlayers(matchIdx) {
  // Players not locked in other matches are available for this match
  const lockedByOthers = new Set();
  if (_manualLockedMatches.size > 0) {
    for (const lockedIdx of _manualLockedMatches) {
      if (lockedIdx === matchIdx) continue;
      document.querySelectorAll(`.manual-sel[data-match="${lockedIdx}"]`).forEach(sel => {
        if (sel.value) lockedByOthers.add(sel.value);
      });
    }
  }
  return _mexPlayers.filter(p => !lockedByOthers.has(p.id));
}

function _manualPlayerLabel(p) {
  const lb = _manualLeaderboard[p.id];
  if (!lb) return esc(p.name);
  return `${esc(p.name)} (${t('txt_txt_manual_rank', { n: lb.rank })} · ${t('txt_txt_manual_avg_pts')} ${lb.avg_points.toFixed(1)})`;
}

function _renderManualMatch(idx) {
  const available = _manualGetAvailablePlayers(idx);
  const isLocked = _manualLockedMatches.has(idx);

  const opts = available.map(p =>
    `<option value="${p.id}">${_manualPlayerLabel(p)}</option>`
  ).join('');
  const blank = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;

  let card = `<div class="manual-match-card${isLocked ? ' locked' : ''}" id="manual-card-${idx}">`;
  card += `<div class="manual-match-header">`;
  card += `<div class="manual-match-title">${t('txt_txt_match_n', { n: idx + 1 })}</div>`;
  if (isLocked) {
    card += `<button type="button" class="btn btn-sm manual-lock-btn locked" onclick="_manualUnlockMatch(${idx})">🔒 ${t('txt_txt_manual_unlock_match')}</button>`;
  } else {
    card += `<button type="button" class="btn btn-sm manual-lock-btn" onclick="_manualLockMatch(${idx})">🔓 ${t('txt_txt_manual_lock_match')}</button>`;
  }
  card += `</div>`;

  if (isLocked) {
    card += `<div class="manual-locked-hint">${t('txt_txt_manual_match_locked')}</div>`;
  }

  const disabled = isLocked ? ' disabled' : '';
  card += `<div class="manual-team-block">`;
  card += `<div class="manual-team-label">${t('txt_txt_team')} 1</div>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t1a" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t1b" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `</div>`;

  card += `<div class="manual-vs-divider">vs</div>`;

  card += `<div class="manual-team-block">`;
  card += `<div class="manual-team-label">${t('txt_txt_team')} 2</div>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t2a" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `<select class="manual-sel" data-match="${idx}" data-slot="t2b" onchange="_onManualSelChange()"${disabled}>${blank}${opts}</select>`;
  card += `</div>`;

  card += `</div>`;
  return card;
}

function _manualLockMatch(idx) {
  // Validate that all 4 slots are filled
  const slots = ['t1a', 't1b', 't2a', 't2b'];
  const ids = slots.map(slot => {
    const sel = document.querySelector(`.manual-sel[data-match="${idx}"][data-slot="${slot}"]`);
    return sel ? sel.value : '';
  });
  if (ids.some(id => !id)) {
    alert(t('txt_txt_match_n_slots_required', { n: idx + 1 }));
    return;
  }
  // Check no duplicates within this match
  const unique = new Set(ids);
  if (unique.size < 4) {
    alert(t('txt_txt_a_player_is_assigned_to_multiple_teams_please_fix_duplicates'));
    return;
  }

  _manualLockedMatches.add(idx);
  _refreshAllManualMatches();
}

function _manualUnlockMatch(idx) {
  _manualLockedMatches.delete(idx);
  _refreshAllManualMatches();
}

function _refreshAllManualMatches() {
  // Save current selections
  const selections = {};
  for (let i = 0; i < _manualMatchCount; i++) {
    selections[i] = {};
    for (const slot of ['t1a', 't1b', 't2a', 't2b']) {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      selections[i][slot] = sel ? sel.value : '';
    }
  }

  // Re-render all match cards
  const container = document.getElementById('manual-matches');
  if (!container) return;
  let html = '';
  for (let i = 0; i < _manualMatchCount; i++) {
    html += _renderManualMatch(i);
  }
  container.innerHTML = html;

  // Restore selections
  for (let i = 0; i < _manualMatchCount; i++) {
    for (const slot of ['t1a', 't1b', 't2a', 't2b']) {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      if (sel && selections[i][slot]) {
        // Only restore if the option is still available
        const opt = sel.querySelector(`option[value="${selections[i][slot]}"]`);
        if (opt) sel.value = selections[i][slot];
      }
    }
  }

  _updateManualSitout();
  _updateManualRoundStats();
}

function _onManualSelChange() {
  _updateManualSitout();
  _updateManualRoundStats();
}

function _manualClearAll() {
  _manualLockedMatches.clear();
  document.querySelectorAll('.manual-sel').forEach(sel => { sel.value = ''; });
  _refreshAllManualMatches();
}

function _addManualMatch() {
  _manualMatchCount++;
  _refreshAllManualMatches();
}

function _removeManualMatch() {
  if (_manualMatchCount <= 1) return;
  // Unlock the last match if it was locked
  _manualLockedMatches.delete(_manualMatchCount - 1);
  _manualMatchCount--;
  _refreshAllManualMatches();
}

function _updateManualSitout() {
  const used = new Set();
  document.querySelectorAll('.manual-sel').forEach(sel => {
    if (sel.value) used.add(sel.value);
  });
  const sitting = _mexPlayers.filter(p => !used.has(p.id));
  const el = document.getElementById('manual-sitout');
  if (el) {
    if (sitting.length > 0) {
      const names = sitting.map(p => {
        const lb = _manualLeaderboard[p.id];
        const stats = lb ? ` (${t('txt_txt_manual_avg_pts')} ${lb.avg_points.toFixed(1)})` : '';
        return `${esc(p.name)}${stats}`;
      }).join(', ');
      el.innerHTML = `🪑 ${t('txt_txt_sitting_out')}: <em>${names}</em>`;
    } else {
      el.innerHTML = t('txt_txt_all_players_assigned');
    }
  }
}

// ─── Manual round stats card ─────────────────────────────
function _getManualMatches() {
  const matchSpecs = [];
  for (let i = 0; i < _manualMatchCount; i++) {
    const get = (slot) => {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      return sel ? sel.value : '';
    };
    const t1a = get('t1a'), t1b = get('t1b'), t2a = get('t2a'), t2b = get('t2b');
    if (t1a && t1b && t2a && t2b) {
      matchSpecs.push({ team1_ids: [t1a, t1b], team2_ids: [t2a, t2b] });
    }
  }
  return matchSpecs;
}

function _pairRepeatCount(idA, idB, counts) {
  return (counts[idA] || {})[idB] || 0;
}

function _matchFingerprint(t1, t2) {
  const a = [...t1].sort().join(',');
  const b = [...t2].sort().join(',');
  return [a, b].sort().join('|');
}

function _getPreviousRoundFingerprints() {
  const fps = new Set();
  const allMatches = window._mexAllMatches || [];
  if (allMatches.length === 0) return fps;
  let maxRound = 0;
  for (const m of allMatches) {
    if ((m.round_number || 0) > maxRound) maxRound = m.round_number;
  }
  if (maxRound === 0) return fps;
  for (const m of allMatches) {
    if (m.round_number === maxRound && m.team1_ids && m.team2_ids) {
      fps.add(_matchFingerprint(m.team1_ids, m.team2_ids));
    }
  }
  return fps;
}

function _computeManualRoundStats() {
  const matches = _getManualMatches();
  if (matches.length === 0) return null;

  const stats = _currentPlayerStats || {};
  const lb = _manualLeaderboard;

  // Build partner/opponent count lookups keyed by player ID
  const partnerCounts = {};
  const opponentCounts = {};
  for (const [, data] of Object.entries(stats)) {
    const pid = data.player_id;
    partnerCounts[pid] = {};
    opponentCounts[pid] = {};
    for (const pr of (data.partners || [])) {
      const pObj = _mexPlayers.find(p => p.name === pr.player);
      if (pObj) partnerCounts[pid][pObj.id] = pr.count;
    }
    for (const opp of (data.opponents || [])) {
      const pObj = _mexPlayers.find(p => p.name === opp.player);
      if (pObj) opponentCounts[pid][pObj.id] = opp.count;
    }
  }

  let totalScoreImbalance = 0;
  let totalRepeatCount = 0;
  let exactPrevRoundRepeats = 0;
  let skillGapViolations = 0;
  let skillGapWorstExcess = 0;
  const perPersonRepeats = {};

  const prevRoundFps = _getPreviousRoundFingerprints();
  const skillGap = window._mexSkillGap;

  for (const m of matches) {
    // Score imbalance
    const t1Score = m.team1_ids.reduce((s, id) => s + (lb[id]?.avg_points || 0), 0);
    const t2Score = m.team2_ids.reduce((s, id) => s + (lb[id]?.avg_points || 0), 0);
    totalScoreImbalance += Math.abs(t1Score - t2Score);

    const t1a = m.team1_ids[0], t1b = m.team1_ids[1];
    const t2a = m.team2_ids[0], t2b = m.team2_ids[1];

    // Partner repeats
    totalRepeatCount += _pairRepeatCount(t1a, t1b, partnerCounts);
    totalRepeatCount += _pairRepeatCount(t2a, t2b, partnerCounts);
    // Opponent repeats
    totalRepeatCount += _pairRepeatCount(t1a, t2a, opponentCounts);
    totalRepeatCount += _pairRepeatCount(t1a, t2b, opponentCounts);
    totalRepeatCount += _pairRepeatCount(t1b, t2a, opponentCounts);
    totalRepeatCount += _pairRepeatCount(t1b, t2b, opponentCounts);

    // Per-person repeat detail
    const allIds = [...m.team1_ids, ...m.team2_ids];
    for (const pid of allIds) {
      const name = _mexPlayerMap[pid] || pid;
      if (!perPersonRepeats[name]) perPersonRepeats[name] = { partner_repeats: [], opponent_repeats: [] };
      const det = perPersonRepeats[name];
      const isT1 = m.team1_ids.includes(pid);
      const teammates = isT1 ? m.team1_ids : m.team2_ids;
      const opponents = isT1 ? m.team2_ids : m.team1_ids;
      for (const tid of teammates) {
        if (tid === pid) continue;
        const cnt = _pairRepeatCount(pid, tid, partnerCounts);
        if (cnt > 0) det.partner_repeats.push({ player: _mexPlayerMap[tid] || tid, count: cnt });
      }
      for (const oid of opponents) {
        const cnt = _pairRepeatCount(pid, oid, opponentCounts);
        if (cnt > 0) det.opponent_repeats.push({ player: _mexPlayerMap[oid] || oid, count: cnt });
      }
    }

    // Exact previous round rematch
    if (prevRoundFps.has(_matchFingerprint(m.team1_ids, m.team2_ids))) {
      exactPrevRoundRepeats++;
    }

    // Skill gap violation
    if (skillGap != null && skillGap > 0) {
      const t1Est = m.team1_ids.reduce((s, id) => s + (lb[id]?.total_points || 0), 0);
      const t2Est = m.team2_ids.reduce((s, id) => s + (lb[id]?.total_points || 0), 0);
      const gap = Math.abs(t1Est - t2Est);
      if (gap > skillGap) {
        skillGapViolations++;
        skillGapWorstExcess = Math.max(skillGapWorstExcess, gap - skillGap);
      }
    }
  }

  return {
    score_imbalance: totalScoreImbalance,
    repeat_count: totalRepeatCount,
    exact_prev_round_repeats: exactPrevRoundRepeats,
    skill_gap_violations: skillGapViolations,
    skill_gap_worst_excess: skillGapWorstExcess,
    per_person_repeats: perPersonRepeats,
    match_count: matches.length,
  };
}

function _updateManualRoundStats() {
  const el = document.getElementById('manual-round-stats');
  if (!el) return;
  const stats = _computeManualRoundStats();
  if (!stats || stats.match_count === 0) { el.innerHTML = ''; return; }

  const fmt2 = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '0.00';

  let html = `<div class="manual-stats-card">`;
  html += `<div class="manual-stats-title">${t('txt_txt_round_summary')}</div>`;
  html += `<div class="proposal-metrics">`;
  html += `⚖️ ${t('txt_txt_score_gap')}: <strong>${fmt2(stats.score_imbalance)} pts</strong><br>`;

  if (stats.repeat_count === 0) {
    html += `✅ ${t('txt_txt_no_repeated_matchups')}`;
  } else {
    html += `⚠️ ${t('txt_txt_n_repeats', { n: stats.repeat_count })}`;
  }
  if (stats.exact_prev_round_repeats > 0) {
    html += `<br>🔁 ${t('txt_txt_exact_rematch_warning', { n: stats.exact_prev_round_repeats })}`;
  }
  if (stats.skill_gap_violations > 0) {
    html += `<br>🚫 ${t('txt_txt_skill_gap_violation', { n: stats.skill_gap_violations, excess: fmt2(stats.skill_gap_worst_excess) })}`;
  }
  html += `</div>`;

  // Per-person repeat details
  if (stats.repeat_count > 0 && stats.per_person_repeats) {
    html += `<div class="repeat-detail">`;
    for (const [name, detail] of Object.entries(stats.per_person_repeats)) {
      const parts = [];
      for (const pr of (detail.partner_repeats || [])) {
        parts.push(esc(t('txt_txt_partner_n_times', { player: pr.player, count: pr.count })));
      }
      for (const or_ of (detail.opponent_repeats || [])) {
        parts.push(esc(t('txt_txt_vs_n_times', { player: or_.player, count: or_.count })));
      }
      if (parts.length > 0) {
        html += `<span class="rp-name">${esc(name)}</span>: ${parts.join(', ')}<br>`;
      }
    }
    html += `</div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
}

async function _commitManualRound() {
  const matches = [];
  const allUsed = new Set();
  const errors = [];

  for (let i = 0; i < _manualMatchCount; i++) {
    const get = (slot) => {
      const sel = document.querySelector(`.manual-sel[data-match="${i}"][data-slot="${slot}"]`);
      return sel ? sel.value : '';
    };
    const t1a = get('t1a'), t1b = get('t1b'), t2a = get('t2a'), t2b = get('t2b');
    const ids = [t1a, t1b, t2a, t2b];

    if (ids.some(id => !id)) {
      errors.push(t('txt_txt_match_n_slots_required', { n: i + 1 }));
      continue;
    }
    for (const id of ids) {
      if (allUsed.has(id)) {
        const name = _mexPlayers.find(p => p.id === id)?.name || id;
        errors.push(t('txt_txt_player_assigned_multiple', { value: name }));
      }
      allUsed.add(id);
    }

    matches.push({ team1_ids: [t1a, t1b], team2_ids: [t2a, t2b] });
  }

  if (errors.length > 0) {
    alert(errors.join('\n'));
    return;
  }

  try {
    await api(`/api/tournaments/${currentTid}/mex/custom-round`, {
      method: 'POST',
      body: JSON.stringify({ matches }),
    });
    renderMex();
  } catch (e) { alert(e.message); }
}

function _renderPlayerStats(stats) {
  const names = Object.keys(stats).sort();
  let opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  let html = `<h4>${t('txt_txt_partner_opponent_history')}</h4>`;
  html += `<div class="player-stats-dropdown">`;
  html += `<select onchange="_showPlayerDetail(this.value)" id="stats-player-select"><option value="">${t('txt_txt_select_player')}</option>${opts}</select>`;
  html += `</div>`;
  html += `<div id="stats-player-detail"></div>`;
  return html;
}

function _showPlayerDetail(name) {
  const el = document.getElementById('stats-player-detail');
  if (!el || !name || !_currentPlayerStats || !_currentPlayerStats[name]) {
    if (el) el.innerHTML = '';
    return;
  }
  const data = _currentPlayerStats[name];
  const partnerList = data.partners.map(x => `${esc(x.player)} (×${x.count})`).join(', ') || t('txt_txt_none_yet');
  const opponentList = data.opponents.map(x => `${esc(x.player)} (×${x.count})`).join(', ') || t('txt_txt_none_yet');
  el.innerHTML = `<div class="player-stats-detail">
    <div class="stat-row"><span class="stat-label">${t('txt_txt_partners')}:</span> ${partnerList}</div>
    <div class="stat-row"><span class="stat-label">${t('txt_txt_opponents')}:</span> ${opponentList}</div>
    <div class="stat-row"><span class="stat-label">${t('txt_txt_partner_repeats')}:</span> ${data.total_partner_repeats}</div>
    <div class="stat-row"><span class="stat-label">${t('txt_txt_opponent_repeats')}:</span> ${data.total_opponent_repeats}</div>
  </div>`;
}

// ─── Mexicano Playoffs ───────────────────────────────
let _playoffTeams = [];
let _mexPlayoffTeamCount = 4;
let _playoffScoreMap = {};  // player_id → total_points
let _savedPlayoffTeams = {};  // teamIndex → { a: playerId, b: playerId }
let _mexExternalParticipants = [];  // {name, score, id}[] external participants for mex playoffs
let _mexExtCounter = 0;  // counter for generating unique temp IDs
let _teamCountDebounceTimer = null;

async function proposeMexPlayoffs(teamCount = null) {
  try {
    const regularCount = (_mexPlayers || []).length;
    const extCount = _mexExternalParticipants.length;
    const totalPool = regularCount + extCount;
    const maxTeams = _mexTeamMode
      ? Math.max(2, totalPool)
      : Math.max(2, Math.floor(totalPool / 2));
    const requestedTeams = Math.max(2, Math.min(maxTeams, Number(teamCount || _mexPlayoffTeamCount || 4)));
    _mexPlayoffTeamCount = requestedTeams;
    // Cap API fetch to available regular players
    const regularMaxTeams = _mexTeamMode ? regularCount : Math.floor(regularCount / 2);
    const apiTeamsToFetch = Math.max(0, Math.min(requestedTeams, regularMaxTeams));
    const participantsToRecommend = _mexTeamMode ? apiTeamsToFetch : apiTeamsToFetch * 2;
    if (participantsToRecommend > 0) {
      const data = await api(`/api/tournaments/${currentTid}/mex/recommend-playoffs?n_teams=${participantsToRecommend}`);
      _playoffTeams = data.recommended_teams.map(t => ({ id: t.player_id, name: t.player, score: t.total_points ?? 0, estimatedScore: t.estimated_points ?? t.total_points ?? 0, rankedByAvg: t.ranked_by_avg, avgScore: t.avg_points ?? 0 }));
    } else {
      _playoffTeams = [];
    }
    _savedPlayoffTeams = {};  // reset saved state when editor re-initialises
    // Use estimated score for display/sorting when match counts differ
    _playoffScoreMap = Object.fromEntries(_playoffTeams.map(p => [p.id, p.rankedByAvg ? p.estimatedScore : p.score]));
    // Inject external participants into the available pool
    _syncExternalsToPlayoffTeams();
    const section = document.getElementById('mex-playoffs-section') || document.getElementById('mex-next-section');
    if (section) {
      section.innerHTML = _renderPlayoffEditor();
    }
  } catch (e) { alert(e.message); }
}

function _syncExternalsToPlayoffTeams() {
  for (const ext of _mexExternalParticipants) {
    if (!_playoffTeams.some(p => p.id === ext.id)) {
      _playoffTeams.push({ id: ext.id, name: ext.name, score: ext.score, estimatedScore: ext.score, rankedByAvg: false, avgScore: 0, isExternal: true });
    }
    _playoffScoreMap[ext.id] = ext.score;
  }
}

async function _changeMexPlayoffTeamCount(value) {
  clearTimeout(_teamCountDebounceTimer);
  _teamCountDebounceTimer = setTimeout(() => proposeMexPlayoffs(Number(value)), 300);
}

async function endMexicano() {
  if (!confirm(t('txt_txt_confirm_end_mexicano'))) return;
  try {
    await api(`/api/tournaments/${currentTid}/mex/end`, { method: 'POST' });
    renderMex();
  } catch (e) { alert(e.message); }
}

async function finishMexicanoAsIs() {
  if (!confirm(t('txt_txt_confirm_finish_as_is'))) return;
  try {
    await api(`/api/tournaments/${currentTid}/mex/finish`, { method: 'POST' });
    renderMex();
  } catch (e) { alert(e.message); }
}

function _renderPlayoffEditor() {
  let html = `<div class="card">`;
  html += `<h2>${t('txt_txt_configure_mexicano_playoffs')}</h2>`;
  const _useEstNote = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;
  const estNote = _useEstNote ? `<span style="color:var(--text-muted);font-size:0.8rem">${t('txt_txt_estimated_points_note')}</span>` : '';
  html += `<p style="color:var(--text-muted);font-size:0.85rem">${_mexTeamMode ? ts('txt_txt_participant_row_instructions', _currentSport) : ts('txt_txt_team_row_instructions', _currentSport)} ${estNote}</p>`;

  const regularCount = (_mexPlayers || []).length;
  const extCount = _mexExternalParticipants.length;
  const totalPool = regularCount + extCount;
  const maxTeams = _mexTeamMode
    ? Math.max(2, totalPool)
    : Math.max(2, Math.floor(totalPool / 2));
  html += `<div class="inline-group" style="margin-bottom:0.75rem">`;
  html += `<div class="form-group"><label>${ts('txt_txt_teams_participating', _currentSport)}</label><select id="playoff-team-count" onchange="_changeMexPlayoffTeamCount(this.value)">`;
  for (let teams = 2; teams <= maxTeams; teams++) {
    const selected = teams === _mexPlayoffTeamCount ? ' selected' : '';
    html += `<option value="${teams}"${selected}>${ts('txt_txt_n_teams', _currentSport, { n: teams })}</option>`;
  }
  html += `</select></div>`;
  html += `</div>`;

  // External participants — add section (between team count and team rows)
  html += `<div style="margin-bottom:0.75rem;border:1px solid var(--border);border-radius:6px;padding:0.75rem">`;
  html += `<h3 style="font-size:0.95rem;margin-top:0">${t('txt_txt_external_participants')}</h3>`;
  if (_mexExternalParticipants.length > 0) {
    html += `<div id="mex-external-list" style="margin-bottom:0.5rem">`;
    for (let i = 0; i < _mexExternalParticipants.length; i++) {
      const ep = _mexExternalParticipants[i];
      html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem">`;
      html += `<span style="min-width:140px">★ ${esc(ep.name)}</span>`;
      html += `<input type="number" value="${ep.score}" style="width:70px" onchange="_mexUpdateExternalScore(${i}, this.value)">`;
      html += `<button type="button" class="btn btn-sm" style="padding:0.15rem 0.5rem;background:var(--border);color:var(--text)" onclick="_mexRemoveExternal(${i})">✕</button>`;
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `<div style="display:flex;align-items:center;gap:0.5rem">`;
  html += `<input type="text" id="mex-external-name" placeholder="${_mexTeamMode ? t('txt_txt_add_external_team') : t('txt_txt_add_external_player')}" style="min-width:200px" onkeydown="if(event.key==='Enter')_mexAddExternal()">`;
  html += `<input type="number" id="mex-external-score" placeholder="${t('txt_txt_score')}" value="0" style="width:70px">`;
  html += `<button type="button" class="btn btn-sm btn-primary" onclick="_mexAddExternal()">+</button>`;
  html += `</div>`;
  html += `</div>`;

  const useEst = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;

  const participantOptions = (selectedId) => {
    let options = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;
    for (let i = 0; i < _playoffTeams.length; i++) {
      const p = _playoffTeams[i];
      const selected = p.id === selectedId ? ' selected' : '';
      const pts = p.isExternal ? `${p.score}` : (useEst ? `${p.estimatedScore.toFixed(1)}*` : `${p.score}`);
      const prefix = p.isExternal ? '★' : `#${i + 1}`;
      options += `<option value="${p.id}"${selected}>${prefix} ${esc(p.name)} (${pts} pts)</option>`;
    }
    return options;
  };

  // Regular mode only: combined score for a 2-player team
  const teamScore = (aid, bid) => {
    if (!aid || !bid) return '—';
    const total = (_playoffScoreMap[aid] || 0) + (_playoffScoreMap[bid] || 0);
    return useEst ? `${total.toFixed(1)}* pts` : `${total} pts`;
  };

  // Team mode: score for a single participant
  const singleScore = (aid) => {
    if (!aid) return '—';
    const val = _playoffScoreMap[aid] || 0;
    return useEst ? `${val.toFixed(1)}* pts` : `${val} pts`;
  };

  const teamCount = _mexPlayoffTeamCount;
  html += `<div class="playoff-team-list">`;
  for (let i = 0; i < teamCount; i++) {
    html += `<div class="playoff-team-item" style="align-items:center; gap:0.6rem; flex-wrap:wrap">`;
    html += `<span class="seed" style="min-width:58px">${ts('txt_txt_team_n', _currentSport, { n: i + 1 })}</span>`;
    if (_mexTeamMode) {
      // Team mode: one participant = one playoff slot
      const defaultId = _playoffTeams[i]?.id || '';
      const initScore = singleScore(defaultId);
      html += `<select id="playoff-team-${i}-a" class="manual-sel" style="min-width:220px" onchange="_updateTeamScore(${i})">${participantOptions(defaultId)}</select>`;
      html += `<span id="team-score-${i}" class="tag" style="min-width:70px;text-align:center;font-variant-numeric:tabular-nums">${initScore}</span>`;
    } else {
      // Regular mode: two players form a team
      const leftDefault = _playoffTeams[i * 2]?.id || '';
      const rightDefault = _playoffTeams[i * 2 + 1]?.id || '';
      const initScore = teamScore(leftDefault, rightDefault);
      html += `<select id="playoff-team-${i}-a" class="manual-sel" style="min-width:220px" onchange="_updateTeamScore(${i})">${participantOptions(leftDefault)}</select>`;
      html += `<span style="color:var(--text-muted)">+</span>`;
      html += `<select id="playoff-team-${i}-b" class="manual-sel" style="min-width:220px" onchange="_updateTeamScore(${i})">${participantOptions(rightDefault)}</select>`;
      html += `<span id="team-score-${i}" class="tag" style="min-width:70px;text-align:center;font-variant-numeric:tabular-nums">${initScore}</span>`;
    }
    html += `<button type="button" id="playoff-save-${i}" class="btn btn-success" style="padding:0.25rem 0.65rem;font-size:0.82rem" onclick="_savePlayoffTeam(${i})">✓ ${t('txt_txt_save')}</button>`;
    html += `<button type="button" id="playoff-edit-${i}" class="btn" style="padding:0.25rem 0.65rem;font-size:0.82rem;display:none;background:var(--border);color:var(--text)" onclick="_editPlayoffTeam(${i})">✎ ${t('txt_txt_edit')}</button>`;
    html += `<span id="playoff-saved-badge-${i}" style="display:none;color:var(--success);font-size:0.82rem;font-weight:600">✓ ${t('txt_txt_saved')}</span>`;
    html += `</div>`;
  }
  html += `</div>`;

  html += `<div class="inline-group" style="margin-bottom:0.75rem">`;
  html += `<div class="form-group"><label>${t('txt_txt_format')}</label><select id="playoff-format"><option value="single">${t('txt_txt_single_elimination')}</option><option value="double">${t('txt_txt_double_elimination')}</option></select></div>`;
  html += `</div>`;
  html += `<div class="proposal-actions">`;
  html += `<button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,_startMexPlayoffs)">✓ ${t('txt_txt_start_mexicano_playoffs')}</button>`;
  html += `<button type="button" class="btn" style="padding:0.75rem 1.5rem;font-size:1.1rem;background:var(--border);color:var(--text)" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

async function _startMexPlayoffs() {
  const allIds = [];  // all selected IDs (real + ext_ placeholders)
  const used = new Set();
  const teamCount = _mexPlayoffTeamCount;
  for (let i = 0; i < teamCount; i++) {
    const left = document.getElementById(`playoff-team-${i}-a`)?.value || '';

    if (_mexTeamMode) {
      // Team mode: one participant per playoff slot
      if (!left) {
        alert(t('txt_txt_team_n_select_both_players', { n: i + 1 }));
        return;
      }
      if (used.has(left)) {
        alert(t('txt_txt_a_player_is_assigned_to_multiple_teams_please_fix_duplicates'));
        return;
      }
      used.add(left);
      allIds.push(left);
    } else {
      // Regular mode: two players form a team
      const right = document.getElementById(`playoff-team-${i}-b`)?.value || '';
      if (!left || !right) {
        alert(t('txt_txt_team_n_select_both_players', { n: i + 1 }));
        return;
      }
      if (left === right) {
        alert(t('txt_txt_team_n_players_must_be_different', { n: i + 1 }));
        return;
      }
      if (used.has(left) || used.has(right)) {
        alert(t('txt_txt_a_player_is_assigned_to_multiple_teams_please_fix_duplicates'));
        return;
      }
      used.add(left);
      used.add(right);
      allIds.push(left, right);
    }
  }
  // Separate real player IDs from ext_ placeholder IDs
  const teamIds = [];
  const extParticipants = [];
  for (const pid of allIds) {
    if (pid.startsWith('ext_')) {
      const ext = _mexExternalParticipants.find(e => e.id === pid);
      if (ext) extParticipants.push({ name: ext.name, score: ext.score, placeholder_id: pid });
      teamIds.push(pid);  // keep in position so backend can replace
    } else {
      teamIds.push(pid);
    }
  }
  const fmt = document.getElementById('playoff-format')?.value || 'single';
  const extra = extParticipants.length > 0 ? extParticipants : null;
  try {
    await api(`/api/tournaments/${currentTid}/mex/start-playoffs`, {
      method: 'POST',
      body: JSON.stringify({
        team_player_ids: teamIds,
        double_elimination: fmt === 'double',
        extra_participants: extra,
      }),
    });
    _playoffTeams = [];
    _mexExternalParticipants = [];
    _mexExtCounter = 0;
    renderMex();
  } catch (e) { alert(e.message); }
}

function _updateTeamScore(i) {
  const aId = document.getElementById(`playoff-team-${i}-a`)?.value || '';
  const el = document.getElementById(`team-score-${i}`);
  if (!el) return;
  const useEst = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;
  if (_mexTeamMode) {
    if (!aId) { el.textContent = '—'; return; }
    const val = _playoffScoreMap[aId] || 0;
    el.textContent = useEst ? `${val.toFixed(1)}* pts` : `${val} pts`;
  } else {
    const bId = document.getElementById(`playoff-team-${i}-b`)?.value || '';
    if (!aId || !bId) { el.textContent = '—'; return; }
    const total = (_playoffScoreMap[aId] || 0) + (_playoffScoreMap[bId] || 0);
    el.textContent = useEst ? `${total.toFixed(1)}* pts` : `${total} pts`;
  }
}

function _mexAddExternal() {
  const input = document.getElementById('mex-external-name');
  const scoreInput = document.getElementById('mex-external-score');
  const name = (input?.value || '').trim();
  if (!name) return;
  const score = parseInt(scoreInput?.value || '0', 10) || 0;
  const id = `ext_${_mexExtCounter++}`;
  _mexExternalParticipants.push({ name, score, id });
  // Inject into playoff teams pool so it appears in dropdowns
  _playoffTeams.push({ id, name, score, estimatedScore: score, rankedByAvg: false, avgScore: 0, isExternal: true });
  _playoffScoreMap[id] = score;
  input.value = '';
  if (scoreInput) scoreInput.value = '0';
  const section = document.getElementById('mex-playoffs-section') || document.getElementById('mex-next-section');
  if (section) section.innerHTML = _renderPlayoffEditor();
}

function _mexRemoveExternal(idx) {
  const removed = _mexExternalParticipants.splice(idx, 1)[0];
  if (removed) {
    _playoffTeams = _playoffTeams.filter(p => p.id !== removed.id);
    delete _playoffScoreMap[removed.id];
    // Clear any saved teams using the removed external
    for (const [teamIdx, team] of Object.entries(_savedPlayoffTeams)) {
      if (team.a === removed.id || team.b === removed.id) {
        delete _savedPlayoffTeams[teamIdx];
      }
    }
  }
  const section = document.getElementById('mex-playoffs-section') || document.getElementById('mex-next-section');
  if (section) section.innerHTML = _renderPlayoffEditor();
}

function _mexUpdateExternalScore(idx, value) {
  if (idx >= 0 && idx < _mexExternalParticipants.length) {
    const newScore = parseInt(value, 10) || 0;
    _mexExternalParticipants[idx].score = newScore;
    const extId = _mexExternalParticipants[idx].id;
    const pt = _playoffTeams.find(p => p.id === extId);
    if (pt) { pt.score = newScore; pt.estimatedScore = newScore; }
    _playoffScoreMap[extId] = newScore;
  }
}

function _getLockedPlayoffIds(exceptTeamIdx = -1) {
  const ids = new Set();
  for (const [idx, team] of Object.entries(_savedPlayoffTeams)) {
    if (Number(idx) === exceptTeamIdx) continue;
    if (team.a) ids.add(team.a);
    if (!_mexTeamMode && team.b) ids.add(team.b);
  }
  return ids;
}

function _savePlayoffTeam(i) {
  const aEl = document.getElementById(`playoff-team-${i}-a`);
  const a = aEl?.value || '';
  if (_mexTeamMode) {
    if (!a) { alert(t('txt_txt_team_n_select_both_players_before_saving', { n: i + 1 })); return; }
    _savedPlayoffTeams[i] = { a };
  } else {
    const bEl = document.getElementById(`playoff-team-${i}-b`);
    const b = bEl?.value || '';
    if (!a || !b) { alert(t('txt_txt_team_n_select_both_players_before_saving', { n: i + 1 })); return; }
    if (a === b) { alert(t('txt_txt_team_n_players_must_be_different', { n: i + 1 })); return; }
    _savedPlayoffTeams[i] = { a, b };
  }
  _refreshPlayoffOptions();
}

function _editPlayoffTeam(i) {
  delete _savedPlayoffTeams[i];
  _refreshPlayoffOptions();
}

function _refreshPlayoffOptions() {
  const useEst = _playoffTeams.length > 0 && _playoffTeams[0].rankedByAvg;
  const teamCount = _mexPlayoffTeamCount;

  for (let i = 0; i < teamCount; i++) {
    const aEl = document.getElementById(`playoff-team-${i}-a`);
    const bEl = _mexTeamMode ? null : document.getElementById(`playoff-team-${i}-b`);
    const saveBtn  = document.getElementById(`playoff-save-${i}`);
    const editBtn  = document.getElementById(`playoff-edit-${i}`);
    const badge    = document.getElementById(`playoff-saved-badge-${i}`);
    if (!aEl) continue;

    const saved = _savedPlayoffTeams[i];
    if (saved) {
      aEl.disabled = true;
      if (bEl) bEl.disabled = true;
      if (saveBtn) saveBtn.style.display = 'none';
      if (editBtn) editBtn.style.display = '';
      if (badge)   badge.style.display = '';
    } else {
      const locked = _getLockedPlayoffIds(i);
      const curA = aEl.value;
      const curB = bEl ? bEl.value : '';

      const buildOptions = (selectedId) => {
        let opts = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;
        for (let j = 0; j < _playoffTeams.length; j++) {
          const p = _playoffTeams[j];
          if (locked.has(p.id)) continue;  // hide participants already locked in other rows
          const sel = p.id === selectedId ? ' selected' : '';
          const pts = p.isExternal ? `${p.score}` : (useEst ? `${p.estimatedScore.toFixed(1)}*` : `${p.score}`);
          const prefix = p.isExternal ? '★' : `#${j + 1}`;
          opts += `<option value="${p.id}"${sel}>${prefix} ${esc(p.name)} (${pts} pts)</option>`;
        }
        return opts;
      };

      aEl.innerHTML = buildOptions(curA);
      aEl.disabled = false;
      if (bEl) {
        bEl.innerHTML = buildOptions(curB);
        bEl.disabled = false;
        if (locked.has(curB)) bEl.value = '';
      }
      if (saveBtn) saveBtn.style.display = '';
      if (editBtn) editBtn.style.display = 'none';
      if (badge)   badge.style.display = 'none';
      // If the previously selected participant was just taken by another row, clear the selection
      if (locked.has(curA)) aEl.value = '';
      _updateTeamScore(i);
    }
  }
}

// ─── Rolling Mode toggle ────────────────────────────────
function _setMexRoundsMode(mode) {
  const toggle = document.getElementById('mex-rounds-toggle');
  const roundsInput = document.getElementById('mex-rounds');
  const [btnUnlimited, btnFixed] = toggle.querySelectorAll('button');
  if (mode === 'unlimited') {
    btnUnlimited.classList.add('active');
    btnFixed.classList.remove('active');
    roundsInput.style.display = 'none';
  } else {
    btnFixed.classList.add('active');
    btnUnlimited.classList.remove('active');
    roundsInput.style.display = '';
    roundsInput.focus();
  }
}

function _export_include_history() {
  const input = document.getElementById('export-include-history');
  return input ? Boolean(input.checked) : true;
}

function _format_match_score(m) {
  if (m.sets && m.sets.length > 0) {
    return m.sets.map(s => `${s[0]}-${s[1]}`).join(', ');
  }
  if (m.score && m.score.length === 2) {
    return `${m.score[0]}-${m.score[1]}`;
  }
  return '—';
}

function _report_table(headers, rows) {
  const thead = `<tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map(row => `<tr>${row.map(c => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('');
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function _build_report_document(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #1f2937; }
    h1 { margin: 0 0 8px; }
    h2 { margin: 24px 0 8px; color: #1d4ed8; }
    .muted { color: #6b7280; font-size: 0.92rem; margin-bottom: 16px; }
    .champ { margin: 12px 0 18px; padding: 10px; background: #ecfdf5; border: 1px solid #86efac; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 0.9rem; }
    th { background: #f3f4f6; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function _download_text_file(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function _open_printable_pdf(htmlDoc) {
  const w = window.open('', '_blank');
  if (!w) {
    alert(t('txt_txt_popup_blocked_allow_popups_to_export_pdf'));
    return;
  }
  w.document.open();
  w.document.write(htmlDoc);
  w.document.close();
  setTimeout(() => w.print(), 250);
}

async function _fetch_image_as_base64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result); // data:image/png;base64,...
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function exportTournamentOutcome(format) {
  if (!currentTid || !currentType) return;
  const includeHistory = _export_include_history();
  const now = new Date().toLocaleString();
  const name = currentTournamentName || `Tournament ${currentTid}`;

  try {
    let body = `<h1>${esc(name)} — ${t('txt_txt_results')}</h1>`;
    body += `<div class="muted">${t('txt_txt_generated_value', { value: esc(now) })}</div>`;

    if (currentType === 'group_playoff') {
      const schemaUrl = `/api/tournaments/${currentTid}/gp/playoffs-schema?fmt=png`
        + `&box_scale=${(document.getElementById('tv-schema-box')?.value || 1.0)}`
        + `&line_width=${(document.getElementById('tv-schema-lw')?.value || 1.0)}`
        + `&arrow_scale=${(document.getElementById('tv-schema-arrow')?.value || 1.0)}`
        + `&title_font_scale=${(document.getElementById('tv-schema-title-scale')?.value || 1.0)}`;
      const [status, groups, playoffs, schemaSrc] = await Promise.all([
        api(`/api/tournaments/${currentTid}/gp/status`),
        api(`/api/tournaments/${currentTid}/gp/groups`),
        api(`/api/tournaments/${currentTid}/gp/playoffs`).catch(() => ({ matches: [] })),
        _fetch_image_as_base64(schemaUrl),
      ]);

      if (status.champion) {
        body += `<div class="champ">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
      }

      // ── Play-offs (above group content) ───────────────────────
      if (schemaSrc) {
        body += `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
        body += `<img src="${schemaSrc}" alt="${t('txt_txt_play_off_bracket')}" style="max-width:100%;height:auto;margin:8px 0 18px">`;
      }

      if (includeHistory) {
        const pMatches = (playoffs?.matches || []).filter(m => m.status === 'completed');
        if (pMatches.length > 0) {
          body += `<h2>${t('txt_txt_play_off_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            pMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }

      // ── Group stage (below) ───────────────────────────────────
      body += `<h2>${t('txt_txt_group_standings')}</h2>`;
      for (const [gName, rows] of Object.entries(groups.standings || {})) {
        body += `<h3>${t('txt_txt_group_name_value', { value: esc(gName) })}</h3>`;
        const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
        const headers = [t('txt_txt_player'), t('txt_txt_played'), t('txt_txt_w_abbrev'), t('txt_txt_d_abbrev'), t('txt_txt_l_abbrev')];
        if (hasSets) headers.push(t('txt_txt_sw_abbrev'), t('txt_txt_sl_abbrev'), t('txt_txt_sd_abbrev'));
        headers.push(t('txt_txt_pf_abbrev'), t('txt_txt_pa_abbrev'), t('txt_txt_diff_abbrev'));
        body += _report_table(
          headers,
          rows.map(r => {
            const base = [r.player, r.played, r.wins, r.draws, r.losses];
            if (hasSets) base.push(r.sets_won, r.sets_lost, r.sets_diff);
            base.push(r.points_for, r.points_against, r.point_diff);
            return base;
          }),
        );
      }

      if (includeHistory) {
        const gMatches = Object.values(groups.matches || {}).flat().filter(m => m.status === 'completed');
        if (gMatches.length > 0) {
          body += `<h2>${t('txt_txt_group_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            gMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }
    } else if (currentType === 'playoff') {
      const schemaUrl = `/api/tournaments/${currentTid}/po/playoffs-schema?fmt=png`
        + `&box_scale=${(document.getElementById('tv-schema-box')?.value || 1.0)}`
        + `&line_width=${(document.getElementById('tv-schema-lw')?.value || 1.0)}`
        + `&arrow_scale=${(document.getElementById('tv-schema-arrow')?.value || 1.0)}`
        + `&title_font_scale=${(document.getElementById('tv-schema-title-scale')?.value || 1.0)}`;
      const [status, playoffs, schemaSrc] = await Promise.all([
        api(`/api/tournaments/${currentTid}/po/status`),
        api(`/api/tournaments/${currentTid}/po/playoffs`),
        _fetch_image_as_base64(schemaUrl),
      ]);

      if (status.champion) {
        body += `<div class="champ">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
      }

      if (schemaSrc) {
        body += `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
        body += `<img src="${schemaSrc}" alt="${t('txt_txt_play_off_bracket')}" style="max-width:100%;height:auto;margin:8px 0 18px">`;
      }

      if (includeHistory) {
        const pMatches = (playoffs?.matches || []).filter(m => m.status === 'completed');
        if (pMatches.length > 0) {
          body += `<h2>${t('txt_txt_play_off_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            pMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }
    } else {
      const schemaUrl = `/api/tournaments/${currentTid}/mex/playoffs-schema?fmt=png`
        + `&box_scale=${(document.getElementById('tv-schema-box')?.value || 1.0)}`
        + `&line_width=${(document.getElementById('tv-schema-lw')?.value || 1.0)}`
        + `&arrow_scale=${(document.getElementById('tv-schema-arrow')?.value || 1.0)}`
        + `&title_font_scale=${(document.getElementById('tv-schema-title-scale')?.value || 1.0)}`;
      const [status, matches, playoffs, schemaSrc] = await Promise.all([
        api(`/api/tournaments/${currentTid}/mex/status`),
        api(`/api/tournaments/${currentTid}/mex/matches`),
        api(`/api/tournaments/${currentTid}/mex/playoffs`).catch(() => ({ matches: [] })),
        _fetch_image_as_base64(schemaUrl),
      ]);

      if (status.champion) {
        body += `<div class="champ">🏆 ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
      }

      // ── Play-offs (above leaderboard/rounds) ──────────────────
      if (schemaSrc) {
        body += `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
        body += `<img src="${schemaSrc}" alt="${t('txt_txt_play_off_bracket')}" style="max-width:100%;height:auto;margin:8px 0 18px">`;
      }

      if (includeHistory) {
        const playoffMatches = (playoffs?.matches || []).filter(m => m.status === 'completed');
        if (playoffMatches.length > 0) {
          body += `<h2>${t('txt_txt_play_off_match_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            playoffMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }

      // ── Mexicano (below) ──────────────────────────────────────
      body += `<h2>${t('txt_txt_leaderboard')}</h2>`;
      body += _report_table(
        [t('txt_txt_rank'), t('txt_txt_player'), t('txt_txt_total_pts'), t('txt_txt_played'), t('txt_txt_w_abbrev'), t('txt_txt_d_abbrev'), t('txt_txt_l_abbrev'), t('txt_txt_avg_pts')],
        (status.leaderboard || []).map(r => [r.rank, r.player, r.total_points, r.matches_played, r.wins || 0, r.draws || 0, r.losses || 0, r.avg_points]),
      );

      if (includeHistory) {
        const mexMatches = (matches.all_matches || []).filter(m => m.status === 'completed');
        if (mexMatches.length > 0) {
          body += `<h2>${t('txt_txt_mexicano_round_history')}</h2>`;
          body += _report_table(
            [t('txt_txt_round'), t('txt_txt_team_1'), t('txt_txt_team_2'), t('txt_txt_score'), t('txt_txt_court')],
            mexMatches.map(m => [m.round_label || '', (m.team1 || []).join(' & ') || 'TBD', (m.team2 || []).join(' & ') || 'TBD', _format_match_score(m), m.court || '']),
          );
        }
      }
    }

    const htmlDoc = _build_report_document(`${name} ${t('txt_txt_results')}`, body);
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tournament';

    if (format === 'pdf') {
      _open_printable_pdf(htmlDoc);
    } else {
      _download_text_file(`${slug}-results.html`, htmlDoc, 'text/html;charset=utf-8');
    }
  } catch (e) {
    alert(t('txt_txt_export_failed_value', { value: e.message }));
  }
}

// ─── Player Codes ────────────────────────────────────────

/** Cache for player secrets (per tournament) */
let _playerSecrets = {};

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
 * Render the collapsible Player Codes panel for the admin view.
 * secrets is { player_id: { name, passphrase, token } }
 */
function _renderPlayerCodes(secrets) {
  if (!currentTid) return '';
  const entries = Object.entries(secrets || {});

  let html = `<details class="card" id="player-codes-panel">`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="display:inline-block;transition:transform 0.18s;font-size:0.7em;color:var(--text-muted)">▸</span> 🔑 ${t('txt_txt_player_codes')}</span>`;
  const _isMex = currentType === 'mexicano';
  const _isGP = currentType === 'group_playoff';
  if (entries.length > 0) {
    html += `<span style="display:flex;gap:0.4rem;margin-left:auto">`;
    html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="event.preventDefault();_copyAllPlayerCodes()">📋 ${t('txt_txt_copy_all_codes')}</button>`;
    html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="event.preventDefault();_printPlayerCodes()">🖨 ${t('txt_txt_print_all_codes')}</button>`;
    html += `</span>`;
  }
  html += `</summary>`;
  html += `<div style="margin-top:0.65rem">`;
  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.65rem">${t('txt_txt_player_codes_help')}</p>`;

  if (entries.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:1rem 0">${t('txt_txt_no_player_codes')}</p>`;
  } else {
    html += `<div style="overflow-x:auto">`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.84rem">`;
    html += `<thead><tr style="border-bottom:2px solid var(--border)">`;
    html += `<th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_player')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_passphrase')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_contact')}</th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.6rem">${t('txt_txt_qr_code')}</th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.6rem"></th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.6rem"></th>`;
    html += `</tr></thead><tbody>`;
    for (const [pid, info] of entries) {
      html += `<tr style="border-bottom:1px solid var(--border)" id="pc-row-${pid}">`;
      html += `<td style="padding:0.4rem 0.6rem;font-weight:600">${esc(info.name)}</td>`;
      html += `<td style="padding:0.4rem 0.6rem"><code id="pc-pass-${pid}" style="font-size:0.9em;color:var(--accent);user-select:all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent)" title="Click to copy">${esc(info.passphrase)}</code></td>`;
      html += `<td style="padding:0.4rem 0.6rem"><span style="display:flex;gap:0.3rem;align-items:center"><input type="text" id="pc-contact-${pid}" value="${escAttr(info.contact || '')}" placeholder="${t('txt_reg_contact_placeholder')}" style="flex:1;min-width:120px;font-size:0.82rem;padding:0.2rem 0.4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"><button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem;white-space:nowrap" onclick="_savePlayerContact('${pid}')" id="pc-contact-save-${pid}">${t('txt_txt_save_contact')}</button></span></td>`;
      html += `<td style="padding:0.4rem 0.6rem;text-align:center"><button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem" onclick="_showPlayerQr('${escAttr(pid)}','${escAttr(info.name)}')">📱 ${t('txt_txt_qr_code')}</button></td>`;
      html += `<td style="padding:0.4rem 0.6rem;text-align:center"><button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:var(--border);color:var(--text)" onclick="_regeneratePlayerCode('${pid}')">🔄 ${t('txt_txt_regenerate')}</button></td>`;
      html += `<td style="padding:0.4rem 0.6rem;text-align:center">${_isMex ? `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem" onclick="_removeTournamentPlayer('${pid}','${escAttr(info.name)}')" title="${t('txt_txt_remove_player')}">🗑</button>` : ''}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;
  }

  if (_isMex || (_isGP && _gpCurrentPhase === 'groups')) {
    html += `<div style="margin-top:0.5rem"><button type="button" class="add-participant-btn" onclick="_addTournamentPlayer()">＋ ${t('txt_txt_add_player')}</button></div>`;
  }

  html += `</div></details>`;
  return html;
}

/** Show a QR code in a modal dialog */
async function _showPlayerQr(playerId, playerName) {
  const imgUrl = `/api/tournaments/${currentTid}/player-secrets/qr/${playerId}?origin=${encodeURIComponent(window.location.origin)}`;
  // Fetch with auth
  try {
    const resp = await fetch(API + imgUrl, {
      headers: { 'Authorization': 'Bearer ' + getAuthToken() }
    });
    if (!resp.ok) throw new Error('Failed to load QR code');
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Build modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
    modal.onclick = (e) => { if (e.target === modal) { modal.remove(); URL.revokeObjectURL(objectUrl); } };
    modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;text-align:center;max-width:340px;width:100%">
      <h3 style="margin:0 0 0.5rem;font-size:1rem">${esc(playerName)}</h3>
      <img src="${objectUrl}" alt="QR" style="width:100%;max-width:260px;image-rendering:pixelated;border-radius:4px;background:#fff;padding:0.5rem">
      <p style="margin:0.75rem 0 0;color:var(--text-muted);font-size:0.8rem">${t('txt_txt_player_codes_help')}</p>
      <button type="button" class="btn btn-primary btn-sm" style="margin-top:0.75rem" onclick="this.closest('div[style*=fixed]').remove()">✕ ${t('txt_txt_close')}</button>
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

/** Open an inline add-player form inside the specific group card. */
function _addPlayerToGroup(groupName) {
  const areaId = `gp-add-player-area-${groupName}`;
  const inputId = `gp-add-name-${groupName}`;
  const area = document.getElementById(areaId);
  if (!area) return;

  // Already open — just focus.
  if (document.getElementById(inputId)) {
    document.getElementById(inputId).focus();
    return;
  }

  // Replace the button with an inline input row.
  area.innerHTML = `
    <span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;margin-top:0.1rem">
      <input type="text" id="${escAttr(inputId)}"
        placeholder="${escAttr(t('txt_txt_add_player_prompt'))}"
        style="flex:1;min-width:150px;font-size:0.88rem;padding:0.3rem 0.5rem;border:2px solid var(--accent);border-radius:4px;background:var(--surface);color:var(--text)"
        maxlength="128">
      <button type="button" class="btn btn-primary btn-sm"
        style="font-size:0.78rem;padding:0.25rem 0.6rem;white-space:nowrap"
        onclick="_submitPlayerToGroup(${JSON.stringify(groupName)})">✓</button>
      <button type="button" class="btn btn-sm"
        style="font-size:0.78rem;padding:0.25rem 0.5rem"
        onclick="_cancelAddPlayerToGroup(${JSON.stringify(groupName)})">✕</button>
    </span>`;

  const input = document.getElementById(inputId);
  if (input) {
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitPlayerToGroup(groupName);
      else if (e.key === 'Escape') _cancelAddPlayerToGroup(groupName);
    });
  }
}

/** Restore the add-player button after cancelling. */
function _cancelAddPlayerToGroup(groupName) {
  const area = document.getElementById(`gp-add-player-area-${groupName}`);
  if (!area) return;
  area.innerHTML = `<button type="button" class="add-participant-btn" onclick="_addPlayerToGroup(${JSON.stringify(groupName)})">＋ ${t('txt_txt_add_player')}</button>`;
}

/** Submit a new player directly to a specific group. */
async function _submitPlayerToGroup(groupName) {
  const inputId = `gp-add-name-${groupName}`;
  const input = document.getElementById(inputId);
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  input.disabled = true;
  const area = document.getElementById(`gp-add-player-area-${groupName}`);
  if (area) area.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    await api(`/api/tournaments/${currentTid}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, group_name: groupName }),
    });
    const drafts = _captureViewDrafts();
    drafts['details:player-codes-panel'] = true;
    await renderGP();
    _restoreViewDrafts(drafts);
  } catch (e) {
    alert(e.message || t('txt_reg_error'));
    if (input) input.disabled = false;
    if (area) area.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

/** Add a new player to the running tournament — inline (no prompt) */
function _addTournamentPlayer() {
  const panel = document.getElementById('player-codes-panel');
  if (panel && !panel.open) panel.open = true;

  // If there's already a pending add row, just focus it
  if (document.getElementById('pc-new-row')) {
    document.getElementById('pc-new-name')?.focus();
    return;
  }

  let tbody = panel?.querySelector('table tbody');

  // If no table exists yet (0 players), create one
  if (!tbody) {
    const noMsg = panel?.querySelector('div > p');
    if (noMsg) noMsg.remove();
    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.84rem"><thead><tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_player')}</th><th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_passphrase')}</th><th style="text-align:left;padding:0.4rem 0.6rem">${t('txt_txt_contact')}</th><th style="text-align:center;padding:0.4rem 0.6rem">${t('txt_txt_qr_code')}</th><th></th><th></th></tr></thead><tbody></tbody></table>`;
    const addBtnDiv = panel?.querySelector('.add-participant-btn')?.parentElement;
    if (addBtnDiv) addBtnDiv.before(wrapper);
    else panel?.querySelector('div')?.appendChild(wrapper);
    tbody = wrapper.querySelector('tbody');
  }

  const isGP = currentType === 'group_playoff';
  const groupSelectHtml = isGP && _gpGroupNames.length
    ? `<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.82rem;white-space:nowrap;color:var(--text-muted)">${t('txt_txt_select_group')}
        <select id="pc-new-group" style="font-size:0.88rem;padding:0.28rem 0.4rem;border:2px solid var(--accent);border-radius:4px;background:var(--surface);color:var(--text)">
          ${_gpGroupNames.map(g => `<option value="${escAttr(g)}">${esc(g)}</option>`).join('')}
        </select></label>`
    : '';

  const newRow = document.createElement('tr');
  newRow.id = 'pc-new-row';
  newRow.style.borderBottom = '1px solid var(--border)';
  newRow.innerHTML = `<td style="padding:0.4rem 0.6rem" colspan="6">
    <span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
      <input type="text" id="pc-new-name" placeholder="${escAttr(t('txt_txt_add_player_prompt'))}" style="flex:1;min-width:150px;font-size:0.88rem;padding:0.3rem 0.5rem;border:2px solid var(--accent);border-radius:4px;background:var(--surface);color:var(--text)" maxlength="128">
      ${groupSelectHtml}
      <button type="button" class="btn btn-primary btn-sm" style="font-size:0.78rem;padding:0.25rem 0.6rem;white-space:nowrap" onclick="_submitNewPlayer()">✓</button>
      <button type="button" class="btn btn-sm" style="font-size:0.78rem;padding:0.25rem 0.5rem" onclick="document.getElementById('pc-new-row')?.remove()">✕</button>
    </span></td>`;
  tbody.appendChild(newRow);

  const input = document.getElementById('pc-new-name');
  if (input) {
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitNewPlayer();
      else if (e.key === 'Escape') newRow.remove();
    });
  }
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
    await api(`/api/tournaments/${currentTid}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Refresh view, keeping the player-codes panel open
    const drafts = _captureViewDrafts();
    drafts['details:player-codes-panel'] = true;
    if (currentType === 'group_playoff') await renderGP();
    else if (currentType === 'playoff') await renderPO();
    else if (currentType === 'mexicano') await renderMex();
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
  } catch (e) { alert(e.message || t('txt_reg_error')); }
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
async function _copyAllPlayerCodes() {
  const lines = Object.values(_playerSecrets)
    .map(p => `${p.name}: ${p.passphrase}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(lines);
    alert(t('txt_txt_codes_copied'));
  } catch { /* ignore */ }
}

/** Save the contact string for a single player */
async function _savePlayerContact(playerId) {
  const input = document.getElementById(`pc-contact-${playerId}`);
  const saveBtn = document.getElementById(`pc-contact-save-${playerId}`);
  if (!input) return;
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
    await api(`/api/tournaments/${currentTid}/player-secrets/${playerId}/contact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: input.value }),
    });
    if (_playerSecrets[playerId]) _playerSecrets[playerId].contact = input.value;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_txt_contact_saved'); }
    setTimeout(() => { if (saveBtn) saveBtn.textContent = t('txt_txt_save_contact'); }, 1500);
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_txt_save_contact'); }
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

// ─── TV Mode ─────────────────────────────────────────────

/**
 * Render the TV Mode control card for the admin panel.
 * tvSettings is the object returned by GET /api/tournaments/{tid}/tv-settings.
 * hasCourts indicates whether the tournament uses court assignments.
 */
function _renderTvControls(tvSettings, hasCourts) {
  if (!currentTid) return '';
  const s = tvSettings || {};
  const def = (k, d) => (s[k] !== undefined ? s[k] : d);

  const chkRow = (key, label, defaultVal, opts = {}) => {
    const disabled = opts.disabled || false;
    const forceOff = opts.forceOff || false;
    const forceOn = opts.forceOn || false;
    const resolvedVal = forceOff ? false : forceOn ? true : def(key, defaultVal);
    const checked = resolvedVal ? 'checked' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const opacityStyle = disabled ? 'opacity:0.45;cursor:not-allowed;' : 'cursor:pointer;';
    // Auto-persist forced value so the backend/TV page stays in sync
    if ((forceOff || forceOn) && def(key, defaultVal) !== resolvedVal) {
      _updateTvSetting(key, resolvedVal);
    }
    return `<label style="display:flex;align-items:center;gap:0.45rem;${opacityStyle}font-size:0.84rem;"${disabled ? ' title="' + t('txt_tv_no_courts_hint') + '"' : ''}>
      <input type="checkbox" style="width:auto;min-height:auto;margin:0" ${checked} ${disabledAttr}
        onchange="_updateTvSetting('${key}', this.checked)">
      ${label}
    </label>`;
  };

  // Get current tournament alias
  const currentAlias = _tournamentMeta[currentTid]?.alias || '';
  
  let html = `<details class="card" id="tv-controls-panel">`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="display:inline-block;transition:transform 0.18s;font-size:0.7em;color:var(--text-muted)">▸</span> ${t('txt_txt_tv_mode_controls')}</span>`;
  html += `<button type="button" class="btn btn-primary" style="margin-left:auto" onclick="event.preventDefault();window.open('/tv/'+((_tournamentMeta[currentTid]&&_tournamentMeta[currentTid].alias)||currentTid),'padel_tv_'+currentTid,'noopener noreferrer')">📺 ↗</button>`;
  html += `</summary>`;
  html += `<div style="margin-top:0.65rem">`;
  
  // Tournament Alias Section
  html += `<div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">🔗 ${t('txt_txt_tournament_alias')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_tv_alias_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="tournament-alias-input" placeholder="my-tournament" value="${escAttr(currentAlias)}" 
    pattern="[a-zA-Z0-9_-]+" maxlength="64" 
    style="flex:1;min-width:200px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentAlias()" style="white-space:nowrap">${t('txt_txt_set_alias')}</button>`;
  if (currentAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="_deleteTournamentAlias()" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  if (currentAlias) {
    html += `<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:0.78rem">`;
    html += `<span style="color:var(--text-muted)">${t('txt_txt_tv_url')}</span> <code style="color:var(--accent);font-size:0.85rem">/tv/${esc(currentAlias)}</code>`;
    html += ` <button type="button" onclick="navigator.clipboard.writeText(window.location.origin+'/tv/${escAttr(currentAlias)}');alert('${escAttr(t('txt_txt_url_copied'))}')"
      style="background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:3px;padding:0.1rem 0.4rem;cursor:pointer;font-size:0.75rem;margin-left:0.3rem">📋 ${t('txt_txt_copy')}</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  
  // Banner Section
  const currentBanner = def('banner_text', '');
  html += `<div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">📢 ${t('txt_banner_label')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_banner_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="tournament-banner-input" placeholder="${t('txt_banner_placeholder')}" value="${escAttr(currentBanner)}" 
    maxlength="500" 
    style="flex:1;min-width:200px;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_setTournamentBanner()" style="white-space:nowrap">${t('txt_txt_set')}</button>`;
  if (currentBanner) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="_clearTournamentBanner()" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `</div>`;

  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.65rem">${t('txt_tv_sections_help')}</p>`;
  html += `<div class="tv-settings-grid">`;
  html += chkRow('show_past_matches',   t('txt_txt_past_matches'),            true);
  html += chkRow('show_score_breakdown',t('txt_tv_score_breakdowns'),         false);
  html += chkRow('show_standings',      t('txt_tv_standings_leaderboard'),    true);
  html += chkRow('show_bracket',        t('txt_txt_play_off_bracket'),        true);
  html += chkRow('show_courts',         t('txt_tv_court_assignments_view'),   true,  { disabled: !hasCourts, forceOff: !hasCourts });
  html += chkRow('show_pending_matches', t('txt_tv_pending_matches_view'),     false, { forceOn: !hasCourts });
  html += `</div>`;

  // Player scoring toggle
  html += `<div style="margin-top:0.65rem;padding-top:0.55rem;border-top:1px solid var(--border)">`;
  html += `<label style="display:flex;align-items:center;gap:0.45rem;cursor:pointer;font-size:0.84rem;">
    <input type="checkbox" style="width:auto;min-height:auto;margin:0" ${def('allow_player_scoring', true) ? 'checked' : ''}
      onchange="_updateTvSetting('allow_player_scoring', this.checked)">
    ${t('txt_tv_allow_player_scoring')}
  </label>`;
  html += `<p style="color:var(--text-muted);font-size:0.76rem;margin:0.25rem 0 0 1.4rem">${t('txt_tv_allow_player_scoring_help')}</p>`;
  html += `</div>`;
  const currentInterval = def('refresh_interval', 15);
  html += `<div style="margin-top:0.65rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">`;
  html += `<label style="font-size:0.84rem;color:var(--text-muted);white-space:nowrap">${t('txt_txt_auto_refresh_every')}</label>`;
  html += `<select style="width:auto;min-height:auto;padding:0.3rem 0.5rem;font-size:0.84rem" onchange="_updateTvSetting('refresh_interval', +this.value)">`;
  [[-1,t('txt_tv_on_update')],[0,t('txt_tv_never')],[5,'5 s'],[10,'10 s'],[15,'15 s'],[30,'30 s'],[60,'1 min'],[120,'2 min'],[300,'5 min']].forEach(([secs, lbl]) => {
    html += `<option value="${secs}"${currentInterval === secs ? ' selected' : ''}>${lbl}</option>`;
  });
  html += `</select></div>`;

  // Schema rendering controls
  const boxScale   = def('schema_box_scale',   1.0);
  const lineWidth  = def('schema_line_width',  1.0);
  const arrowScale = def('schema_arrow_scale', 1.0);
  const titleFontScale = def('schema_title_font_scale', 1.0);
  html += `<details style="margin-top:0.65rem">`;
  html += `<summary style="cursor:pointer;color:var(--text-muted);font-size:0.82rem;user-select:none">⚙ ${t('txt_txt_rendering_options')}</summary>`;
  html += `<div class="tv-sliders-grid">`;
  const sliders = [
    ['schema_box_scale',        'tv-schema-box',         t('txt_txt_box_size'),    0.3, 3.0, boxScale],
    ['schema_line_width',       'tv-schema-lw',          t('txt_txt_line_width'),  0.3, 5.0, lineWidth],
    ['schema_arrow_scale',      'tv-schema-arrow',       t('txt_txt_arrow_size'),  0.3, 5.0, arrowScale],
    ['schema_title_font_scale', 'tv-schema-title-scale', t('txt_txt_header_size'), 0.3, 3.0, titleFontScale],
  ];
  sliders.forEach(([key, elId, label, min, max, val]) => {
    html += `<label style="font-size:0.83rem;color:var(--text-muted);white-space:nowrap">${label} <span id="${elId}-val" style="color:var(--text)">${val.toFixed(1)}</span></label>`;
    html += `<input type="range" id="${elId}" min="${min}" max="${max}" step="0.1" value="${val}" style="width:100%;min-height:auto"
      oninput="document.getElementById('${elId}-val').textContent=(+this.value).toFixed(1)"
      onchange="_updateTvSetting('${key}', +this.value)">`;
  });
  html += `</div></details>`;
  html += `</div>`;
  html += `</details>`;
  return html;
}

/** Persist a single TV setting toggle to the backend. */
async function _updateTvSetting(key, value) {
  if (!currentTid) return;
  try {
    await api(`/api/tournaments/${currentTid}/tv-settings`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: value }),
    });
  } catch (e) {
    console.error('TV setting update failed:', e.message);
  }
}

/** Show the inline comment editor for a match. */
function _openCommentEdit(matchId) {
  const row = document.getElementById(`mc-row-${matchId}`);
  if (!row) return;
  row.classList.remove('hidden');
  const input = document.getElementById(`mc-${matchId}`);
  if (input) { input.focus(); input.select(); }
}

/** Hide the inline comment editor without saving. */
function _closeCommentEdit(matchId) {
  const row = document.getElementById(`mc-row-${matchId}`);
  if (row) row.classList.add('hidden');
}

/** Set a comment on a pending match. */
async function _setMatchComment(matchId) {
  if (!currentTid) return;
  const input = document.getElementById(`mc-${matchId}`);
  if (!input) return;
  const comment = input.value.trim();
  try {
    await api(`/api/tournaments/${currentTid}/match-comment`, {
      method: 'PATCH',
      body: JSON.stringify({ match_id: matchId, comment }),
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Set match comment failed:', e.message);
  }
}

/** Clear the comment on a match. */
async function _clearMatchComment(matchId) {
  if (!currentTid) return;
  try {
    await api(`/api/tournaments/${currentTid}/match-comment`, {
      method: 'PATCH',
      body: JSON.stringify({ match_id: matchId, comment: '' }),
    });
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Clear match comment failed:', e.message);
  }
}

/** Set the tournament announcement banner text. */
async function _setTournamentBanner() {
  if (!currentTid) return;
  const input = document.getElementById('tournament-banner-input');
  if (!input) return;
  const text = input.value.trim();
  try {
    await _updateTvSetting('banner_text', text);
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Set banner failed:', e.message);
  }
}

/** Clear the tournament announcement banner. */
async function _clearTournamentBanner() {
  if (!currentTid) return;
  try {
    await _updateTvSetting('banner_text', '');
    await _rerenderCurrentViewPreserveDrafts();
  } catch (e) {
    console.error('Clear banner failed:', e.message);
  }
}

/** Set tournament alias */
async function _setTournamentAlias() {
  if (!currentTid) return;
  const input = document.getElementById('tournament-alias-input');
  const alias = input.value.trim();
  
  if (!alias) {
    alert(t('txt_txt_please_enter_an_alias'));
    return;
  }
  
  // Validate pattern
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    alert(t('txt_txt_alias_can_only_contain_letters_numbers_hyphens_and_underscores'));
    return;
  }
  
  try {
    await api(`/api/tournaments/${currentTid}/alias`, {
      method: 'PUT',
      body: JSON.stringify({ alias }),
    });
    // Update the meta cache
    if (_tournamentMeta[currentTid]) {
      _tournamentMeta[currentTid].alias = alias;
    }
    // Reload tournaments list to update all views
    await loadTournaments();
    // Re-render current view to show updated alias section
    await _rerenderCurrentViewPreserveDrafts();
    alert(t('txt_txt_alias_value_set_successfully', { value: alias }));
  } catch (e) {
    alert(t('txt_txt_failed_to_set_alias_value', { value: e.message }));
  }
}

/** Delete tournament alias */
async function _deleteTournamentAlias() {
  if (!currentTid) return;
  if (!confirm(t('txt_txt_remove_the_alias_from_this_tournament'))) return;
  
  try {
    await api(`/api/tournaments/${currentTid}/alias`, {
      method: 'DELETE',
    });
    // Update the meta cache
    if (_tournamentMeta[currentTid]) {
      delete _tournamentMeta[currentTid].alias;
    }
    // Clear the input
    const input = document.getElementById('tournament-alias-input');
    if (input) input.value = '';
    // Reload tournaments list to update all views
    await loadTournaments();
    // Re-render current view to show updated alias section
    await _rerenderCurrentViewPreserveDrafts();
    alert(t('txt_txt_alias_removed_successfully'));
  } catch (e) {
    alert(t('txt_txt_failed_to_remove_alias_value', { value: e.message }));
  }
}

// ─── Registration Lobbies ─────────────────────────────────

let _registrations = [];
let _showArchivedRegistrations = false;
let _regDetails = {};  // rid → full registration detail data
let _regCollaborators = {};  // rid → list of co-editor usernames
let _currentRegDetail = null;  // last-opened registration (for convert flow)
let _regPollTimer = null;
const _REG_POLL_INTERVAL_MS = 10000;

// Registration detail auto-refresh
let _regDetailPollTimer = null;
let _regDetailFetching = false;
let _regDetailLastCount = null;
let _regDetailLastAnswerSig = null;
let _regDetailLastAssignedSig = null;
const _REG_DETAIL_POLL_INTERVAL_MS = 6000;

function _regAnswerSig(registrants) {
  return (registrants || []).map(r => `${r.player_id}:${JSON.stringify(r.answers ?? {})}`).join('|');
}

function _regAssignedSig(assignedPlayerIds) {
  return [...(assignedPlayerIds || [])].sort().join('|');
}

function _startRegDetailPoll() {
  _stopRegDetailPoll();
  if (!currentTid || currentType !== 'registration') return;
  _regDetailLastCount = _currentRegDetail?.registrant_count ?? null;
  _regDetailLastAnswerSig = _regAnswerSig(_currentRegDetail?.registrants);
  _regDetailLastAssignedSig = _regAssignedSig(_currentRegDetail?.assigned_player_ids);
  _regDetailPollTimer = setInterval(async () => {
    if (!currentTid || currentType !== 'registration' || _regDetailFetching) return;
    _regDetailFetching = true;
    try {
      const d = await api(`/api/registrations/${currentTid}`).catch(() => null);
      if (!d) return;
      const sig = _regAnswerSig(d.registrants);
      const assignedSig = _regAssignedSig(d.assigned_player_ids);
      const countChanged = _regDetailLastCount !== null && d.registrant_count !== _regDetailLastCount;
      const answersChanged = sig !== _regDetailLastAnswerSig;
      const assignedChanged = assignedSig !== _regDetailLastAssignedSig;
      _regDetailLastCount = d.registrant_count;
      _regDetailLastAnswerSig = sig;
      _regDetailLastAssignedSig = assignedSig;
      if (countChanged || answersChanged || assignedChanged) {
        _regDetails[currentTid] = d;
        _currentRegDetail = d;
        _renderRegDetailInline(currentTid);
      }
    } catch (_) { /* network blip */ }
    finally { _regDetailFetching = false; }
  }, _REG_DETAIL_POLL_INTERVAL_MS);
}

function _stopRegDetailPoll() {
  if (_regDetailPollTimer) { clearInterval(_regDetailPollTimer); _regDetailPollTimer = null; }
  _regDetailFetching = false;
  _regDetailLastCount = null;
  _regDetailLastAnswerSig = null;
  _regDetailLastAssignedSig = null;
}

function _startRegPoll() {
  _stopRegPoll();
  _regPollTimer = setInterval(_pollRegistrations, _REG_POLL_INTERVAL_MS);
}

function _stopRegPoll() {
  if (_regPollTimer) { clearInterval(_regPollTimer); _regPollTimer = null; }
}

async function _pollRegistrations() {
  try {
    await loadTournaments();
  } catch (_) { /* network blip — ignore */ }
}

async function loadRegistrations() {
  await loadTournaments();
}

function _setShowArchivedRegistrations(enabled) {
  _showArchivedRegistrations = !!enabled;
  loadTournaments();
}

async function _loadRegDetail(rid) {
  const data = await api(`/api/registrations/${rid}`);
  _regDetails[rid] = data;
  _currentRegDetail = data;
  _renderRegDetailInline(rid);
}

function _renderRegDetailInline(rid) {
  const el = document.getElementById('view-content');
  const r = _regDetails[rid];
  if (!el || !r) return;

  let closeOpenBtn = '';
  if (r.archived) {
    closeOpenBtn = `<button type="button" class="btn btn-secondary" style="padding:0.35rem 0.8rem;font-size:0.78rem;white-space:nowrap" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',false))">${t('txt_reg_unarchive')}</button>`;
  } else if (r.open) {
    closeOpenBtn = `<button type="button" class="btn" style="padding:0.35rem 0.8rem;font-size:0.78rem;background:var(--red);color:#fff;white-space:nowrap" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',true))">${t('txt_reg_close_registration')}</button>`;
  } else {
    closeOpenBtn = `<div style="display:flex;gap:0.4rem;flex-shrink:0">`
      + `<button type="button" class="btn btn-primary" style="padding:0.35rem 0.8rem;font-size:0.78rem;white-space:nowrap" onclick="withLoading(this,()=>_toggleRegOpen('${esc(rid)}',false))">${t('txt_reg_open_registration')}</button>`
      + `<button type="button" class="btn btn-secondary" style="padding:0.35rem 0.8rem;font-size:0.78rem;white-space:nowrap" onclick="withLoading(this,()=>_archiveRegistration('${esc(rid)}',true))">${t('txt_reg_archive')}</button>`
      + `</div>`;
  }
  let html = `<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;margin-bottom:0.5rem"><h2 style="margin:0">${esc(r.name)}</h2>${closeOpenBtn}</div>`;
  const regAlias = r.alias || '';
  const regUrl = regAlias
    ? `${window.location.origin}/register/${regAlias}`
    : `${window.location.origin}/register?id=${esc(r.id)}`;

  // Registration link + alias section
  html += `<div style="margin-bottom:1rem;padding:0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">${t('txt_reg_registration_alias')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_reg_alias_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="reg-alias-input-${esc(rid)}" placeholder="my-tournament" value="${esc(regAlias)}" pattern="[a-zA-Z0-9_-]+" maxlength="64" style="flex:1;min-width:180px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_setRegAlias('${esc(rid)}'))" style="white-space:nowrap">${t('txt_txt_set_alias')}</button>`;
  if (regAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="withLoading(this,()=>_deleteRegAlias('${esc(rid)}'))" style="white-space:nowrap">${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `<div style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">`;
  html += `<div style="flex:1;min-width:220px;padding:0.4rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:0.78rem;word-break:break-all">`;
  html += `<span style="color:var(--text-muted)">${t('txt_reg_public_url')}</span> <a href="${regUrl}" target="_blank" style="color:var(--accent);font-size:0.85rem">${regUrl}</a>`;
  html += `</div>`;
  html += `<button type="button" class="btn btn-sm" style="font-size:0.7rem;white-space:nowrap" onclick="_copyRegLink('${esc(rid)}')">${t('txt_reg_copy_link')}</button>`;
  html += `</div></div>`;

  html += `<div class="reg-sections-group reg-sections-group-admin">`;

  // Settings section
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:0.45rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_settings')}</summary>`;
  html += `<div style="padding:0.75rem 0">`;
  html += `<div class="form-group"><label>${t('txt_reg_tournament_name')}</label>`;
  html += `<input type="text" id="reg-edit-name-${esc(rid)}" value="${esc(r.name)}"></div>`;
  html += `<div class="form-group"><label>${t('txt_reg_description')}</label>`;
  html += `<textarea id="reg-edit-desc-${esc(rid)}" class="reg-desc-textarea" rows="3" oninput="_autoResizeTextarea(this)">${esc(r.description || '')}</textarea>`;
  html += `<div id="reg-desc-preview-${esc(rid)}" style="display:none;margin-top:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"></div>`;
  html += `<button type="button" class="btn btn-sm" style="margin-top:0.3rem;font-size:0.75rem" onclick="_toggleRegDescPreview('${esc(rid)}')">${t('txt_reg_preview')}</button></div>`;
  html += `<div class="form-group"><label>${t('txt_email_requirement')}</label>`;
  html += `<select id="reg-edit-emailreq-${esc(rid)}">`;
  html += `<option value="required" ${(r.email_requirement || 'optional') === 'required' ? 'selected' : ''}>${t('txt_email_mode_required')}</option>`;
  html += `<option value="optional" ${(r.email_requirement || 'optional') === 'optional' ? 'selected' : ''}>${t('txt_email_mode_optional')}</option>`;
  html += `<option value="disabled" ${(r.email_requirement || 'optional') === 'disabled' ? 'selected' : ''}>${t('txt_email_mode_disabled')}</option>`;
  html += `</select></div>`;
  html += `<div class="form-group"><label>${t('txt_reg_join_code')}</label>`;
  html += `<input type="text" id="reg-edit-joincode-${esc(rid)}" value="${esc(r.join_code || '')}" placeholder="${t('txt_reg_join_code_placeholder')}"></div>`;
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.5rem">`;
  html += `<input type="checkbox" id="reg-edit-listed-${esc(rid)}" ${r.listed ? 'checked' : ''} style="width:1rem;height:1rem;cursor:pointer">`;
  html += `<label for="reg-edit-listed-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_listed')}</label></div>`;
  if (window._emailConfigured) {
    html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.5rem">`;
    html += `<input type="checkbox" id="reg-edit-autoemail-${esc(rid)}" ${r.auto_send_email ? 'checked' : ''} style="width:1rem;height:1rem;cursor:pointer">`;
    html += `<label for="reg-edit-autoemail-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_email_auto_send')}</label></div>`;
  }
  html += `<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegSettings('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div>`;
  html += _renderRegCollaboratorsSection(rid, _regCollaborators[rid] || []);
  html += `</div></details>`;

  // Admin message section
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:0.45rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_admin_message')}</summary>`;
  html += `<div style="padding:0.75rem 0">`;
  html += `<div class="form-group" style="margin-bottom:0.4rem">`;
  html += `<textarea id="reg-edit-message-${esc(rid)}" rows="3" placeholder="${t('txt_reg_message_placeholder')}">${esc(r.message || '')}</textarea>`;
  html += `</div>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.5rem">`;
  if (window._emailConfigured) {
    html += `<button type="button" class="btn btn-sm" onclick="withLoading(this,()=>_sendRegMessageEmails('${esc(rid)}'))" title="${t('txt_email_confirm_send_message_all')}">📧 ${t('txt_email_send_message_all')}</button>`;
  }
  html += `<button type="button" class="btn btn-primary btn-sm" style="margin-left:auto" onclick="withLoading(this,()=>_saveRegMessage('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div></div></details>`;

  // Questions edit section
  const editQContainer = `reg-edit-questions-${rid}`;
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;user-select:none;font-weight:700;display:flex;align-items:center;gap:0.5rem;list-style:none">`;
  html += `<span style="display:flex;align-items:center;gap:0.4rem;flex:1"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_questions')}</span>`;
  html += `<span class="participant-count" id="${editQContainer}-count">(0)</span>`;
  html += `</summary>`;
  html += `<div style="padding:0.6rem 0">`;
  const hasContactQ = (r.questions || []).some(q => q.key === 'contact');
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.55rem">`;
  html += `<input type="checkbox" id="reg-contact-toggle-${esc(rid)}" style="width:1rem;height:1rem;cursor:pointer" ${hasContactQ ? 'checked' : ''} onchange="_toggleRegContactQuestion('${esc(rid)}', this.checked, '${editQContainer}')">`;
  html += `<label for="reg-contact-toggle-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_request_contact')}</label>`;
  html += `</div>`;
  html += `<div id="${editQContainer}"><div class="reg-q-empty" id="${editQContainer}-empty">${t('txt_reg_q_no_questions')}</div></div>`;
  html += `<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">`;
  html += `<button type="button" class="add-participant-btn" onclick="_addRegQuestion('${editQContainer}')" style="flex:1">${t('txt_reg_add_question')}</button>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegQuestions('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div></div></details>`;

  html += `</div>`;

  html += `<div class="reg-sections-group reg-sections-group-players">`;

  // Registrants table (collapsible) — names, passphrases, actions only
  html += `<details class="reg-section" style="margin-bottom:0.75rem">`;
  html += `<summary class="reg-section-summary" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_registrants')} (${r.registrants.length})</span>`;
  html += `</summary>`;
  if (r.registrants.length > 0) {
    html += `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.65rem;margin-bottom:0.25rem">`;
    html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="_copyAllRegCodes('${esc(rid)}')">${t('txt_txt_copy_all_codes')}</button>`;
    if (window._emailConfigured) {
      html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="_sendAllRegEmails('${esc(rid)}')">${t('txt_email_send_all')}</button>`;
    }
    html += `</div>`;
  }
  if (r.registrants.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_reg_no_registrants')}</p>`;
  } else {
    // Duplicate name detection
    const _nameCounts = new Map();
    for (const reg of r.registrants) {
      const norm = reg.player_name.trim().toLowerCase();
      _nameCounts.set(norm, (_nameCounts.get(norm) || 0) + 1);
    }
    const _dupNames = new Set([..._nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
    if (_dupNames.size > 0) {
      const dupList = r.registrants
        .filter(reg => _dupNames.has(reg.player_name.trim().toLowerCase()))
        .map(reg => esc(reg.player_name));
      const unique = [...new Set(dupList)].join(', ');
      html += `<div style="margin-top:0.5rem;padding:0.45rem 0.7rem;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.5);border-radius:6px;font-size:0.8rem;color:#f59e0b">${t('txt_reg_duplicate_names', { names: unique })}</div>`;
    }
    html += `<div style="overflow-x:auto;margin-top:0.5rem"><table style="width:100%;border-collapse:collapse;font-size:0.84rem">`;
    html += `<thead><tr style="border-bottom:2px solid var(--border)">`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_reg_name')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_email')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_txt_passphrase')}</th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.5rem"></th>`;
    html += `</tr></thead><tbody>`;
    for (const reg of r.registrants) {
      const isDup = _dupNames.has(reg.player_name.trim().toLowerCase());
      const rowStyle = isDup
        ? 'border-bottom:1px solid var(--border);background:rgba(251,191,36,0.08)'
        : 'border-bottom:1px solid var(--border)';
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding:0.4rem 0.5rem;font-weight:600">${isDup ? '⚠ ' : ''}${esc(reg.player_name)}</td>`;
      html += `<td style="padding:0.4rem 0.5rem;font-size:0.82em;color:var(--text-muted)">${reg.email ? esc(reg.email) : '—'}</td>`;
      html += `<td style="padding:0.4rem 0.5rem"><code style="font-size:0.9em;color:var(--accent);user-select:all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent)" title="Click to copy">${esc(reg.passphrase)}</code></td>`;
      html += `<td style="padding:0.4rem 0.5rem;text-align:center;white-space:nowrap">`;
      html += `<button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem;margin-right:0.25rem" onclick="_editRegistrant('${esc(r.id)}','${esc(reg.player_id)}','${esc(reg.player_name)}','${esc(reg.email||'')}')" title="${t('txt_reg_edit_player')}">✏️</button>`;
      if (window._emailConfigured && reg.email) {
        html += `<button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem;margin-right:0.25rem" onclick="_sendRegEmail('${esc(r.id)}','${esc(reg.player_id)}')" title="${t('txt_email_send')}">✉️</button>`;
      }
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem" onclick="_removeRegistrant('${esc(r.id)}','${esc(reg.player_id)}')" title="${t('txt_reg_confirm_remove')}">✕</button>`;
      html += `</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  html += `<div style="margin-top:0.5rem"><button type="button" class="add-participant-btn" onclick="_adminAddRegistrant('${esc(rid)}')">${t('txt_reg_add_player')}</button></div>`;
  html += `</details>`;

  // Question Answers panel (separate, only shown when questions exist)
  const questions = r.questions || [];
  if (questions.length > 0 && r.registrants.length > 0) {
    html += _renderAnswersPanel(rid, r, questions);
  }

  html += `</div>`;

  // Linked tournaments section (shown after first or more conversions)
  if (r.converted_to_tids?.length > 0) {
    const linkedById = new Map((r.linked_tournaments || []).map((item) => [item.id, item]));
    html += `<div class="linked-tournaments">`;
    html += `<div class="linked-tournaments-title">${t('txt_reg_linked_tournaments')}</div>`;
    html += `<div class="linked-tournaments-list">`;
    r.converted_to_tids.forEach(function(ltid) {
      const linked = linkedById.get(ltid);
      const fromMeta = _tournamentMeta?.[ltid] || (_openTournaments || []).find(function(tr) { return tr.id === ltid; });
      const tname = linked?.name || fromMeta?.name || ltid;
      const ttype = linked?.type || fromMeta?.type;
      if (ttype) {
        html += `<a href="#" class="linked-tournament-link" onclick="openTournament('${esc(ltid)}','${esc(ttype)}','${esc(tname)}');return false" title="${esc(ltid)}">${esc(tname)}</a>`;
      } else {
        html += `<a href="/tv/${encodeURIComponent(ltid)}" class="linked-tournament-link" target="_blank" rel="noopener" title="${esc(ltid)}">${esc(tname)}</a>`;
      }
    });
    html += `</div>`;
    html += `</div>`;
  }

  // Convert button + close/open registration toggle
  const regBtnLabel = (r.converted_to_tids?.length > 0) ? t('txt_reg_create_another') : t('txt_reg_convert_to_tournament');
  let regConvDisabled = '';
  if (!r.open) regConvDisabled = `disabled title="${t('txt_reg_closed_cannot_convert')}"`;
  else if (r.registrants.length < 2) regConvDisabled = `disabled title="${t('txt_reg_min_registrants_needed')}"`;
  html += `<div style="display:flex;gap:0.75rem;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:1.25rem">`;
  if (!r.archived && r.open) {
    html += `<button type="button" class="btn btn-success" style="padding:0.7rem 1.5rem;font-size:1rem" onclick="_startConvertFromReg('${esc(rid)}')" ${regConvDisabled}>${regBtnLabel}</button>`;
  }
  html += `</div>`;

  html += `</div>`; // close .card

  // ── Save UI state before replacing DOM ────────────────────────────
  const openDetails = new Set();
  el.querySelectorAll('details.reg-section').forEach((d, i) => { if (d.open) openDetails.add(i); });
  const savedInputs = {};
  el.querySelectorAll('input[id], textarea[id]').forEach(inp => {
    if (inp.type === 'checkbox') savedInputs[inp.id] = { checked: inp.checked };
    else savedInputs[inp.id] = { value: inp.value };
  });
  const scrollY = window.scrollY;

  el.innerHTML = html;

  // ── Restore UI state after replacing DOM ──────────────────────────
  el.querySelectorAll('details.reg-section').forEach((d, i) => { if (openDetails.has(i)) d.open = true; });
  for (const [id, state] of Object.entries(savedInputs)) {
    const inp = document.getElementById(id);
    if (!inp) continue;
    if ('checked' in state) inp.checked = state.checked;
    else inp.value = state.value;
  }
  window.scrollTo({ top: scrollY });

  el.querySelectorAll('.reg-answer-card.hide-empty').forEach(card => _regApplyRowFilters(card));

  const descEl = document.getElementById(`reg-edit-desc-${rid}`);
  if (descEl) _autoResizeTextarea(descEl);
  _populateRegQuestions(`reg-edit-questions-${rid}`, questions);
}

function _copyRegLink(rid) {
  const alias = _regDetails[rid]?.alias;
  const url = alias
    ? `${window.location.origin}/register/${alias}`
    : `${window.location.origin}/register?id=${rid}`;
  navigator.clipboard.writeText(url).then(() => {
    const origText = event?.target?.textContent;
    if (event?.target) { event.target.textContent = '✓'; setTimeout(() => { event.target.textContent = origText || t('txt_reg_copy_link'); }, 1200); }
  });
}

async function _setRegAlias(rid) {
  const input = document.getElementById(`reg-alias-input-${rid}`);
  const alias = input?.value.trim();
  if (!alias) { alert(t('txt_txt_please_enter_an_alias')); return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) { alert(t('txt_txt_alias_can_only_contain_letters_numbers_hyphens_and_underscores')); return; }
  try {
    await api(`/api/registrations/${rid}/alias`, { method: 'PUT', body: JSON.stringify({ alias }) });
    if (_regDetails[rid]) _regDetails[rid].alias = alias;
    _renderRegDetailInline(rid);
    alert(t('txt_txt_alias_value_set_successfully', { value: alias }));
  } catch (e) { alert(t('txt_txt_failed_to_set_alias_value', { value: e.message })); }
}

async function _deleteRegAlias(rid) {
  if (!confirm(t('txt_txt_remove_the_alias_from_this_tournament'))) return;
  try {
    await api(`/api/registrations/${rid}/alias`, { method: 'DELETE' });
    if (_regDetails[rid]) delete _regDetails[rid].alias;
    _renderRegDetailInline(rid);
    alert(t('txt_txt_alias_removed_successfully'));
  } catch (e) { alert(t('txt_txt_failed_to_remove_alias_value', { value: e.message })); }
}

async function _archiveRegistration(rid, archive) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: archive }),
    });
    if (_regDetails[rid]) _regDetails[rid].archived = archive;
    _currentRegDetail = _regDetails[rid] || _currentRegDetail;
    if (currentTid === rid && currentType === 'registration') {
      _renderRegDetailInline(rid);
    }
    await loadRegistrations();
  } catch (e) { console.error('_archiveRegistration failed:', e); }
}

async function _toggleRegOpen(rid, currentlyOpen) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: !currentlyOpen }),
    });
    if (_regDetails[rid]) _regDetails[rid].open = !currentlyOpen;
    _currentRegDetail = _regDetails[rid] || _currentRegDetail;
    if (currentTid === rid && currentType === 'registration') {
      _renderRegDetailInline(rid);
    }
    await loadRegistrations();
  } catch (e) { console.error('_toggleRegOpen failed:', e); }
}

async function _toggleRegListed(rid, currentlyListed) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listed: !currentlyListed }),
    });
    if (_regDetails[rid]) _regDetails[rid].listed = !currentlyListed;
    await loadRegistrations();
  } catch (e) { console.error('_toggleRegListed failed:', e); }
}

function _openTournamentFromReg(tid) {
  const meta = _tournamentMeta[tid];
  if (meta) {
    openTournament(tid, meta.type, meta.name);
  } else {
    // Tournament not in cache — fetch list first, then open
    loadTournaments().then(() => {
      const m = _tournamentMeta[tid];
      if (m) openTournament(tid, m.type, m.name);
      else alert('Tournament not found');
    });
  }
}

async function _deleteRegistration(rid) {
  if (!confirm(t('txt_reg_confirm_delete'))) return;
  try {
    await api(`/api/registrations/${rid}`, { method: 'DELETE' });
    delete _regDetails[rid];
    if (_currentRegDetail && _currentRegDetail.id === rid) _currentRegDetail = null;
    // Unpin the tab if it was open
    if (_openTournaments.some(t => t.id === rid)) _unpinTournament(rid);
    await loadRegistrations();
  } catch (e) { alert(t('txt_reg_error')); }
}

// ─── Create registration form ─────────────────────────────

function _defaultLobbyName() {
  return _currentSport === 'tennis' ? 'My Tennis Tournament' : 'My Padel Tournament';
}

function showCreateRegistration() {
  const el = document.getElementById('reg-create-form');
  if (!el) return;
  _regQuestionCounter = 0;

  el.innerHTML = `
      <div class="field-section" style="margin-bottom:0.75rem">
        <input id="reg-new-name" value="${_defaultLobbyName()}" class="tournament-name-input" placeholder="${t('txt_reg_tournament_name')}" style="width:100%;min-width:160px">
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div class="field-section-title">${t('txt_reg_description')}</div>
        <textarea id="reg-new-desc" class="reg-desc-textarea" rows="3" oninput="_autoResizeTextarea(this)"></textarea>
        <div id="reg-new-desc-preview" style="display:none;margin-top:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.3rem">
          <button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="_toggleNewRegDescPreview()">${t('txt_reg_preview')}</button>
          <small style="color:var(--text-muted);font-size:0.75rem">${t('txt_reg_description_hint')}</small>
        </div>
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <label class="switch-label" style="cursor:pointer">
          <input type="checkbox" id="reg-new-joincode-toggle" onchange="document.getElementById('reg-new-joincode').style.display=this.checked?'':'none'">
          <span class="switch-track"></span>
          <span>${t('txt_reg_join_code_toggle')}</span>
        </label>
        <input type="text" id="reg-new-joincode" placeholder="${t('txt_reg_join_code_placeholder')}" maxlength="64" style="display:none;margin-top:0.4rem">
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div class="field-section-title">${t('txt_email_requirement')}</div>
        <select id="reg-new-emailreq" style="width:100%">
          <option value="required">${t('txt_email_mode_required')}</option>
          <option value="optional" selected>${t('txt_email_mode_optional')}</option>
          <option value="disabled">${t('txt_email_mode_disabled')}</option>
        </select>
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.55rem">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="field-section-title" style="margin-bottom:0">${t('txt_reg_questions')}</span>
            <span class="participant-count" id="reg-new-questions-count">(0)</span>
          </div>
          <label for="reg-new-contact" style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;cursor:pointer">
            <input type="checkbox" id="reg-new-contact" style="width:1rem;height:1rem;cursor:pointer" onchange="_toggleNewRegContact(this.checked)">
            <span>${t('txt_reg_request_contact')}</span>
          </label>
        </div>
        <div id="reg-new-questions">
          <div class="reg-q-empty" id="reg-new-questions-empty">${t('txt_reg_q_no_questions')}</div>
        </div>
        <button type="button" class="add-participant-btn" style="margin-top:0.4rem" onclick="_addRegQuestion('reg-new-questions')">${t('txt_reg_add_question')}</button>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
        <input type="checkbox" id="reg-new-listed" style="width:1rem;height:1rem;cursor:pointer">
        <label for="reg-new-listed" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_listed')}</label>
      </div>
      <div style="text-align:center">
        <button type="button" class="btn btn-success" style="padding:0.75rem 1.5rem;font-size:1.1rem" onclick="withLoading(this,_submitCreateRegistration)">${t('txt_reg_create')}</button>
      </div>`;
}

async function _submitCreateRegistration() {
  const name = document.getElementById('reg-new-name')?.value?.trim();
  if (!name) return;
  const body = { name };

  const desc = document.getElementById('reg-new-desc')?.value?.trim();
  if (desc) body.description = desc;

  if (document.getElementById('reg-new-joincode-toggle')?.checked) {
    const code = document.getElementById('reg-new-joincode')?.value?.trim();
    if (code) body.join_code = code;
  }

  const questions = _collectRegQuestions();
  if (document.getElementById('reg-new-contact')?.checked) {
    if (!questions.some(q => q.key === 'contact')) {
      questions.unshift({ key: 'contact', label: t('txt_reg_contact'), type: 'text', required: false, choices: [] });
    }
  }
  if (questions.length) body.questions = questions;

  body.listed = !!document.getElementById('reg-new-listed')?.checked;
  body.email_requirement = document.getElementById('reg-new-emailreq')?.value || 'optional';

  body.sport = _currentSport || 'padel';

  await api('/api/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await loadRegistrations();
  setActiveTab('home');
}

let _regQuestionCounter = 0;

function _updateRegQNumbers(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const cards = container.querySelectorAll('.reg-q-card');
  const count = cards.length;
  cards.forEach((card, i) => {
    const num = card.querySelector('.reg-q-number');
    if (num) num.textContent = `Q${i + 1}`;
  });
  const countEl = document.getElementById(`${containerId}-count`);
  if (countEl) countEl.textContent = `(${count})`;
  const empty = document.getElementById(`${containerId}-empty`);
  if (empty) empty.style.display = count ? 'none' : '';
}

function _addRegQuestion(containerId, noFocus = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const idx = _regQuestionCounter++;
  const div = document.createElement('div');
  div.className = 'reg-q-card reg-q-item';
  div.dataset.qidx = idx;
  div.dataset.qContainer = containerId;
  div.innerHTML = `
    <div class="reg-q-card-header">
      <span class="reg-q-number">Q1</span>
      <label class="switch-label" style="cursor:pointer;font-size:0.78rem">
        <input type="checkbox" class="reg-q-required">
        <span class="switch-track"></span>
        <span>${t('txt_reg_q_required')}</span>
      </label>
      <button type="button" class="reg-q-remove" onclick="_removeRegQuestion(this)" title="Remove">✕</button>
    </div>
    <div class="reg-q-card-body">
      <input type="text" class="reg-q-label" placeholder="${t('txt_reg_question_label')}" maxlength="128">
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
        <div class="reg-q-type-toggle" data-current="text">
          <button type="button" class="active" data-type="text" onclick="_setRegQType(this,'text')">${t('txt_reg_q_type_text')}</button>
          <button type="button" data-type="number" onclick="_setRegQType(this,'number')">${t('txt_reg_q_type_number')}</button>
          <button type="button" data-type="choice" onclick="_setRegQType(this,'choice')">${t('txt_reg_q_type_choice')}</button>
          <button type="button" data-type="multichoice" onclick="_setRegQType(this,'multichoice')">${t('txt_reg_q_type_multichoice')}</button>
        </div>
      </div>
      <div class="reg-q-choices-area">
        <div class="reg-q-choices-list"></div>
        <button type="button" class="reg-q-add-choice-btn" onclick="_addRegChoice(this)">${t('txt_reg_q_add_choice')}</button>
      </div>
    </div>`;
  container.appendChild(div);
  _updateRegQNumbers(containerId);
  if (!noFocus) div.querySelector('.reg-q-label')?.focus();
}

function _removeRegQuestion(btn) {
  const card = btn.closest('.reg-q-card');
  const containerId = card?.dataset.qContainer || 'reg-new-questions';
  if (card) card.remove();
  _updateRegQNumbers(containerId);
}

function _setRegQType(btn, type) {
  const toggle = btn.closest('.reg-q-type-toggle');
  if (!toggle) return;
  toggle.dataset.current = type;
  toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const area = btn.closest('.reg-q-card-body')?.querySelector('.reg-q-choices-area');
  if (!area) return;
  if (type === 'choice' || type === 'multichoice') {
    area.classList.add('open');
    if (!area.querySelector('.reg-q-choice-row')) _addRegChoice(area.querySelector('.reg-q-add-choice-btn'));
  } else {
    area.classList.remove('open');
  }
}

function _addRegChoice(btn) {
  const area = btn.closest('.reg-q-choices-area');
  const list = area?.querySelector('.reg-q-choices-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'reg-q-choice-row';
  row.innerHTML = `<input type="text" class="reg-q-choice-val" placeholder="${t('txt_reg_q_choices_placeholder')}" maxlength="128"><button type="button" class="reg-q-choice-remove" onclick="this.parentElement.remove()" title="Remove">✕</button>`;
  list.appendChild(row);
  row.querySelector('input')?.focus();
}

function _collectRegQuestions(containerId = 'reg-new-questions') {
  const container = document.getElementById(containerId);
  const items = container ? container.querySelectorAll('.reg-q-item') : [];
  // Start fallback index past all existing q<n> keys to avoid collisions on new questions
  let idx = 0;
  for (const item of items) {
    const origKey = item.dataset.originalKey;
    if (origKey) {
      const m = origKey.match(/^q(\d+)$/);
      if (m) idx = Math.max(idx, parseInt(m[1], 10) + 1);
    }
  }
  const questions = [];
  for (const item of items) {
    const label = item.querySelector('.reg-q-label')?.value?.trim();
    if (!label) continue;
    const toggle = item.querySelector('.reg-q-type-toggle');
    const type = toggle?.dataset.current || 'text';
    const required = !!item.querySelector('.reg-q-required')?.checked;
    const key = item.dataset.originalKey || `q${idx++}`;
    const q = { key, label, type, required };
    if (type === 'choice' || type === 'multichoice') {
      const inputs = item.querySelectorAll('.reg-q-choice-val');
      q.choices = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    } else {
      q.choices = [];
    }
    questions.push(q);
  }
  return questions;
}

// ─── Registration detail helpers ──────────────────────────

async function _copyAllRegCodes(rid) {
  const r = _regDetails[rid];
  if (!r?.registrants) return;
  const lines = r.registrants.map(reg => `${reg.player_name}: ${reg.passphrase}`).join('\n');
  try {
    await navigator.clipboard.writeText(lines);
    _showToast(t('txt_txt_codes_copied'));
  } catch { /* clipboard access denied */ }
}

function _renderAnswersPanel(rid, r, questions) {
  let h = `<details class="reg-section" style="margin-bottom:0.75rem">`;
  h += `<summary class="reg-section-summary" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  h += `<span style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">&#9658;</span>${t('txt_reg_answers_title')} (${questions.length})</span>`;
  h += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="event.preventDefault();_downloadAnswersCSV('${esc(rid)}')">${t('txt_reg_download_answers_csv')}</button>`;
  h += `</summary>`;

  const DICT_THRESHOLD = 25;
  h += `<div class="reg-answers-grid">`;
  for (const q of questions) {
    let counts = {}, useDictionary = false, choiceToLetter = {};
    const isChoiceType = (q.type === 'choice' || q.type === 'multichoice') && q.choices?.length;
    if (isChoiceType) {
      for (const c of q.choices) counts[c] = 0;
      for (const reg of r.registrants) {
        const a = reg.answers?.[q.key];
        if (a) {
          if (q.type === 'multichoice') {
            let selected = [];
            try { selected = JSON.parse(a) || []; } catch (_) {}
            for (const s of selected) counts[s] = (counts[s] || 0) + 1;
          } else {
            counts[a] = (counts[a] || 0) + 1;
          }
        }
      }
      useDictionary = q.choices.some(c => c.length > DICT_THRESHOLD);
      if (useDictionary) {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        q.choices.forEach((c, i) => { choiceToLetter[c] = letters[i] ?? `#${i + 1}`; });
      }
    }

    // Card header
    const unansweredCount = r.registrants.filter(reg => !reg.answers?.[q.key]).length;
    h += `<div class="reg-answer-card${unansweredCount > 0 ? ' hide-empty' : ''}">`;

    h += `<div class="reg-answer-card-header">`;
    h += `<span class="reg-answer-card-label">${esc(q.label)}</span>`;
    if (q.type === 'choice' || q.type === 'multichoice') {
      const typeLabel = q.type === 'multichoice' ? t('txt_reg_q_type_multichoice') : t('txt_reg_q_type_choice');
      h += `<span class="badge ${q.required ? 'badge-phase' : ''}" style="font-size:0.68rem">${typeLabel}${q.required ? ' · ' + t('txt_reg_q_required') : ''}</span>`;
    } else {
      const ansCount = r.registrants.length - unansweredCount;
      if (q.type === 'number') {
        h += `<span class="badge" style="font-size:0.68rem">${t('txt_reg_q_type_number')}</span>`;
      }
      h += `<span class="reg-answer-count-badge">${ansCount} / ${r.registrants.length}</span>`;
    }
    if (unansweredCount > 0) {
      h += `<button type="button" class="reg-answer-hide-empty-btn active" onclick="event.stopPropagation();_regToggleHideEmpty(this)" title="${t('txt_reg_hide_unanswered')}">⊘ ${unansweredCount}</button>`;
    }
    h += `</div>`;

    // Dictionary legend (choice questions with long options)
    if (useDictionary) {
      h += `<div class="reg-answer-legend">`;
      for (const c of q.choices) {
        h += `<span class="reg-answer-legend-item"><b>${choiceToLetter[c]}</b><span class="reg-answer-legend-text">${esc(c)}</span></span>`;
      }
      h += `</div>`;
    }

    // Distribution bars (choice/multichoice questions)
    if (isChoiceType) {
      h += `<div class="reg-answer-bars">`;
      for (const c of q.choices) {
        const pct = r.registrants.length > 0 ? Math.round((counts[c] / r.registrants.length) * 100) : 0;
        const label = useDictionary ? choiceToLetter[c] : esc(c);
        h += `<div class="reg-answer-bar-row" data-choice="${esc(c)}" title="${t('txt_reg_filter_by_choice')}" onclick="_regFilterByChoice(this)">`;
        h += `<span class="reg-answer-bar-label">${label}</span>`;
        h += `<div class="reg-answer-bar-track"><div class="reg-answer-bar-fill" style="width:${pct}%"></div></div>`;
        h += `<span class="reg-answer-bar-count">${counts[c]}</span>`;
        h += `</div>`;
      }
      h += `</div>`;
    }

    // Inline individual answers list (text/number questions) or spoiler (choice/multichoice questions)
    if (q.type !== 'choice' && q.type !== 'multichoice') {
      const TRUNCATE = 100;
      h += `<div class="reg-answer-text-section">`;
      // Number stats: average
      if (q.type === 'number') {
        const numVals = r.registrants
          .map(reg => parseFloat(reg.answers?.[q.key]))
          .filter(n => !isNaN(n));
        if (numVals.length > 0) {
          const avg = (numVals.reduce((a, b) => a + b, 0) / numVals.length).toFixed(2).replace(/\.?0+$/, '');
          h += `<div class="reg-answer-num-stats">${t('txt_reg_answers_avg')}: <b>${avg}</b></div>`;
        }
      }
      if (r.registrants.length > 4) {
        h += `<input type="text" class="reg-answer-text-search" placeholder="${t('txt_reg_search_by_name')}" oninput="_regFilterAnswers(this)">`;
      }
      h += `<div class="reg-answer-text-list">`;
      for (const reg of r.registrants) {
        const answer = reg.answers?.[q.key] || '';
        const isLong = answer.length > TRUNCATE;
        const snippet = isLong ? esc(answer.slice(0, TRUNCATE)) + '\u2026' : (answer ? esc(answer) : '&mdash;');
        const clickAttr = isLong ? `onclick="_regToggleAnswerExpand(this)" title="${t('txt_reg_click_to_expand')}"` : '';
        h += `<div class="reg-answer-text-row${isLong ? ' long' : ''}" data-name="${esc(reg.player_name)}" data-answered="${answer ? 'true' : 'false'}">`;
        h += `<span class="reg-answer-name">${esc(reg.player_name)}</span>`;
        h += `<span class="reg-answer-text-val" ${clickAttr} data-full="${esc(answer)}">${snippet}</span>`;
        h += `</div>`;
      }
      h += `</div></div>`;
    } else {
      // Individual answers under spoiler with sort toggle
      h += `<details class="reg-answer-spoiler">`;
      h += `<summary class="reg-answer-spoiler-summary">`;
      h += `<span class="reg-answer-spoiler-title">${t('txt_reg_show_individual_answers')} (${r.registrants.length})</span>`;
      h += `<button type="button" class="reg-answer-sort-btn" data-sorted="false" onclick="event.stopPropagation();event.preventDefault();_regSortChoiceAnswers(this)">${t('txt_reg_sort_by_answer')}</button>`;
      h += `</summary>`;
      h += `<div class="reg-answer-list">`;
      for (let i = 0; i < r.registrants.length; i++) {
        const reg = r.registrants[i];
        const raw = reg.answers?.[q.key];
        let display = '—', sortKey = '';
        if (raw && q.type === 'multichoice') {
          let selected = [];
          try { selected = JSON.parse(raw) || []; } catch (_) {}
          display = selected.map(s => useDictionary ? (choiceToLetter[s] ?? esc(s)) : esc(s)).join(', ') || '—';
          sortKey = selected.join(',');
        } else if (raw) {
          display = useDictionary ? (choiceToLetter[raw] ?? esc(raw)) : esc(raw);
          sortKey = raw;
        }
        h += `<div class="reg-answer-row" data-choice="${esc(sortKey)}" data-answered="${raw ? 'true' : 'false'}" data-idx="${i}">`;
        h += `<span class="reg-answer-name">${esc(reg.player_name)}</span>`;
        h += `<span class="reg-answer-value">${display}</span>`;
        h += `</div>`;
      }
      h += `</div></details>`;
    }

    h += `</div>`; // close card
  }
  h += `</div>`;
  h += `</details>`;
  return h;
}

function _regToggleAnswerExpand(el) {
  const row = el.closest('.reg-answer-text-row');
  if (!row) return;
  const isExpanded = row.classList.toggle('expanded');
  const full = el.dataset.full || '';
  el.textContent = isExpanded ? full : full.slice(0, 100) + '\u2026';
}

function _regFilterAnswers(input) {
  const q = input.value.toLowerCase();
  const list = input.parentElement?.querySelector('.reg-answer-text-list');
  if (!list) return;
  const card = input.closest('.reg-answer-card');
  const hideEmpty = card?.classList.contains('hide-empty') ?? false;
  for (const row of list.querySelectorAll('.reg-answer-text-row')) {
    const name = (row.dataset.name || '').toLowerCase();
    const answered = row.dataset.answered === 'true';
    const nameMatch = !q || name.includes(q);
    row.style.display = (!nameMatch || (hideEmpty && !answered)) ? 'none' : '';
  }
}

function _regApplyRowFilters(card) {
  const hideEmpty = card.classList.contains('hide-empty');
  const activeChoice = card.querySelector('.reg-answer-bar-row.active')?.dataset.choice ?? null;
  const searchInput = card.querySelector('.reg-answer-text-search');
  const nameQuery = searchInput ? searchInput.value.toLowerCase() : '';

  // Text question rows
  card.querySelectorAll('.reg-answer-text-row').forEach(row => {
    const answered = row.dataset.answered === 'true';
    const name = (row.dataset.name || '').toLowerCase();
    const nameMatch = !nameQuery || name.includes(nameQuery);
    row.style.display = (!nameMatch || (hideEmpty && !answered)) ? 'none' : '';
  });

  // Choice individual answer rows
  card.querySelectorAll('.reg-answer-row').forEach(row => {
    const answered = row.dataset.answered === 'true';
    const choiceMatch = activeChoice === null || row.dataset.choice === activeChoice;
    row.style.display = (hideEmpty && !answered) || !choiceMatch ? 'none' : '';
  });
}

function _regToggleHideEmpty(btn) {
  const card = btn.closest('.reg-answer-card');
  if (!card) return;
  const active = card.classList.toggle('hide-empty');
  btn.classList.toggle('active', active);
  _regApplyRowFilters(card);
}

function _regFilterByChoice(barRow) {
  const card = barRow.closest('.reg-answer-card');
  if (!card) return;
  const spoiler = card.querySelector('.reg-answer-spoiler');
  if (!spoiler) return;

  const wasActive = barRow.classList.contains('active');
  card.querySelectorAll('.reg-answer-bar-row').forEach(r => r.classList.remove('active'));

  if (!wasActive) {
    barRow.classList.add('active');
    spoiler.open = true;
  }

  _regApplyRowFilters(card);
}

function _regSortChoiceAnswers(btn) {
  const list = btn.closest('.reg-answer-spoiler')?.querySelector('.reg-answer-list');
  if (!list) return;
  const sorted = btn.dataset.sorted === 'true';
  const rows = Array.from(list.querySelectorAll('.reg-answer-row'));
  if (!sorted) {
    rows.sort((a, b) => (a.dataset.choice || '').localeCompare(b.dataset.choice || ''));
    btn.dataset.sorted = 'true';
    btn.textContent = t('txt_reg_sort_by_registration');
    btn.classList.add('active');
  } else {
    rows.sort((a, b) => parseInt(a.dataset.idx || 0) - parseInt(b.dataset.idx || 0));
    btn.dataset.sorted = 'false';
    btn.textContent = t('txt_reg_sort_by_answer');
    btn.classList.remove('active');
  }
  rows.forEach(row => list.appendChild(row));
}

function _csvCell(v) {
  const s = String(v ?? '');
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function _downloadAnswersCSV(rid) {
  const r = _regDetails[rid];
  if (!r?.registrants) return;
  const questions = r.questions || [];
  if (!questions.length) return;
  const header = [t('txt_reg_name'), ...questions.map(q => q.label)].map(_csvCell).join(',');
  const rows = r.registrants.map(reg => {
    const cells = [reg.player_name, ...questions.map(q => {
      const raw = reg.answers?.[q.key] || '';
      if (q.type === 'multichoice' && raw) {
        try { return (JSON.parse(raw) || []).join(', '); } catch (_) {}
      }
      return raw;
    })];
    return cells.map(_csvCell).join(',');
  });
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `answers_${(r.name || rid).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function _autoResizeTextarea(el) {
  el.style.overflow = 'hidden';
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function _populateRegQuestions(containerId, questions) {
  for (const q of questions) {
    _addRegQuestion(containerId, true);
    const container = document.getElementById(containerId);
    if (!container) break;
    const cards = container.querySelectorAll('.reg-q-card');
    const card = cards[cards.length - 1];
    if (!card) continue;
    card.dataset.originalKey = q.key;
    const labelInput = card.querySelector('.reg-q-label');
    if (labelInput) labelInput.value = q.label;
    if (q.required) {
      const reqCb = card.querySelector('.reg-q-required');
      if (reqCb) reqCb.checked = true;
    }
    if (q.type !== 'text') {
      const typeBtn = card.querySelector(`.reg-q-type-toggle button[data-type="${q.type}"]`);
      if (typeBtn) _setRegQType(typeBtn, q.type);
    }
    if (q.type === 'choice' || q.type === 'multichoice') {
      const area = card.querySelector('.reg-q-choices-area');
      const list = area?.querySelector('.reg-q-choices-list');
      if (list && q.choices?.length) {
        list.innerHTML = '';
        for (const choice of q.choices) {
          const row = document.createElement('div');
          row.className = 'reg-q-choice-row';
          row.innerHTML = `<input type="text" class="reg-q-choice-val" placeholder="${t('txt_reg_q_choices_placeholder')}" maxlength="128"><button type="button" class="reg-q-choice-remove" onclick="this.parentElement.remove()" title="Remove">✕</button>`;
          row.querySelector('input').value = choice;
          list.appendChild(row);
        }
      }
    }
  }
}

async function _saveRegQuestions(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const containerId = `reg-edit-questions-${rid}`;
  const newQuestions = _collectRegQuestions(containerId);
  const origQuestions = r.questions || [];

  const newKeyMap = new Map(newQuestions.map(q => [q.key, q]));
  const keysToDiscard = [];
  for (const orig of origQuestions) {
    if (!newKeyMap.has(orig.key)) {
      keysToDiscard.push(orig.key);
      continue;
    }
    const updated = newKeyMap.get(orig.key);
    if (orig.type !== updated.type) {
      keysToDiscard.push(orig.key);
      continue;
    }
    if (orig.type === 'choice') {
      const origSet = new Set(orig.choices || []);
      const newArr = updated.choices || [];
      const changed = newArr.length !== origSet.size || newArr.some(c => !origSet.has(c));
      if (changed) keysToDiscard.push(orig.key);
    }
  }

  const body = { questions: newQuestions };
  const hasAffectedAnswers = keysToDiscard.length > 0 &&
    r.registrants?.some(reg => keysToDiscard.some(k => reg.answers?.[k]));
  if (hasAffectedAnswers && confirm(t('txt_reg_q_discard_prompt'))) {
    body.clear_answers_for_keys = keysToDiscard;
  }

  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
}

async function _saveRegSettings(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const body = {};
  const name = document.getElementById(`reg-edit-name-${rid}`)?.value?.trim();
  if (name) body.name = name;
  const desc = document.getElementById(`reg-edit-desc-${rid}`)?.value;
  if (desc !== undefined) {
    if (desc.trim()) body.description = desc; else body.clear_description = true;
  }
  const joinCode = document.getElementById(`reg-edit-joincode-${rid}`)?.value?.trim();
  if (joinCode) body.join_code = joinCode; else body.clear_join_code = true;

  body.listed = !!document.getElementById(`reg-edit-listed-${rid}`)?.checked;
  body.email_requirement = document.getElementById(`reg-edit-emailreq-${rid}`)?.value || 'optional';

  const autoEmailCb = document.getElementById(`reg-edit-autoemail-${rid}`);
  if (autoEmailCb) body.auto_send_email = autoEmailCb.checked;

  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
  await loadRegistrations();
}

function _editRegistrant(rid, pid, currentName, currentEmail) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:380px;width:100%">
    <h3 style="margin:0 0 1rem;font-size:1rem">${t('txt_reg_edit_player')}</h3>
    <div style="margin-bottom:0.75rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_name')}</label>
      <input id="_er-name" type="text" value="${escAttr(currentName)}" maxlength="128" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="margin-bottom:1.1rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_email_label')} <span style="color:var(--text-muted);font-weight:400">(${t('txt_txt_optional')})</span></label>
      <input id="_er-email" type="email" value="${escAttr(currentEmail)}" maxlength="320" placeholder="${t('txt_reg_email_placeholder')}" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button type="button" class="btn btn-sm" id="_er-cancel">${t('txt_txt_cancel')}</button>
      <button type="button" class="btn btn-primary btn-sm" id="_er-save">${t('txt_reg_save')}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#_er-cancel').onclick = () => modal.remove();
  modal.querySelector('#_er-save').onclick = async () => {
    const nameEl = modal.querySelector('#_er-name');
    const emailEl = modal.querySelector('#_er-email');
    const newName = nameEl.value.trim();
    const newEmail = emailEl.value.trim();
    if (!newName) { nameEl.focus(); return; }
    const patch = {};
    if (newName !== currentName) patch.player_name = newName;
    if (newEmail !== currentEmail) patch.email = newEmail || null;
    if (!Object.keys(patch).length) { modal.remove(); return; }
    try {
      await api(`/api/registrations/${rid}/registrant/${pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      modal.remove();
      _showToast(t('txt_reg_saved'));
      await _loadRegDetail(rid);
      await loadRegistrations();
    } catch (e) { alert(e.message || t('txt_reg_error')); }
  };
  modal.querySelector('#_er-name').focus();
}

async function _removeRegistrant(rid, pid) {
  if (!confirm(t('txt_reg_confirm_remove'))) return;
  try {
    await api(`/api/registrations/${rid}/registrant/${pid}`, { method: 'DELETE' });
    await _loadRegDetail(rid);
    await loadRegistrations();
  } catch (e) { alert(e.message || t('txt_reg_error')); }
}

function _adminAddRegistrant(rid) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:380px;width:100%">
    <h3 style="margin:0 0 1rem;font-size:1rem">${t('txt_reg_add_player')}</h3>
    <div style="margin-bottom:0.75rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_name')}</label>
      <input id="_ar-name" type="text" maxlength="128" placeholder="${t('txt_reg_add_player_prompt')}" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="margin-bottom:1.1rem">
      <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">${t('txt_reg_email_label')} <span style="color:var(--text-muted);font-weight:400">(${t('txt_txt_optional')})</span></label>
      <input id="_ar-email" type="email" maxlength="320" placeholder="${t('txt_reg_email_placeholder')}" style="width:100%;box-sizing:border-box;padding:0.45rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:0.88rem">
    </div>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button type="button" class="btn btn-sm" id="_ar-cancel">${t('txt_txt_cancel')}</button>
      <button type="button" class="btn btn-primary btn-sm" id="_ar-save">${t('txt_reg_add_player')}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#_ar-cancel').onclick = () => modal.remove();
  modal.querySelector('#_ar-save').onclick = async () => {
    const nameEl = modal.querySelector('#_ar-name');
    const emailEl = modal.querySelector('#_ar-email');
    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    const body = { player_name: name };
    if (email) body.email = email;
    try {
      await api(`/api/registrations/${rid}/registrant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      modal.remove();
      _showToast(t('txt_reg_saved'));
      await _loadRegDetail(rid);
      await loadRegistrations();
    } catch (e) { alert(e.message || t('txt_reg_error')); }
  };
  modal.querySelector('#_ar-name').focus();
}

async function _saveRegMessage(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const msg = document.getElementById(`reg-edit-message-${rid}`)?.value?.trim();
  const body = msg ? { message: msg } : { clear_message: true };
  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
  _showToast(t('txt_reg_saved'));
}

async function _sendRegEmail(rid, pid) {
  try {
    await api(`/api/registrations/${rid}/send-email/${pid}`, { method: 'POST' });
    _showToast(t('txt_email_sent'));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _sendAllRegEmails(rid) {
  if (!confirm(t('txt_email_confirm_send_all'))) return;
  try {
    const res = await api(`/api/registrations/${rid}/send-all-emails`, { method: 'POST' });
    _showToast(t('txt_email_sent_count', { sent: res.sent || 0, skipped: res.skipped || 0 }));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _notifyTournamentPlayers(tid) {
  if (!confirm(t('txt_email_confirm_notify'))) return;
  try {
    const res = await api(`/api/tournaments/${tid}/notify-players`, { method: 'POST' });
    const data = typeof res === 'object' ? res : await res;
    _showToast(t('txt_email_notify_sent', { sent: data.sent || 0, skipped: data.skipped || 0 }));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _sendRegMessageEmails(rid) {
  if (!confirm(t('txt_email_confirm_send_message_all'))) return;
  try {
    const res = await api(`/api/registrations/${rid}/send-message-emails`, { method: 'POST' });
    const data = typeof res === 'object' ? res : await res;
    _showToast(t('txt_email_message_sent_count', { sent: data.sent || 0, skipped: data.skipped || 0 }));
  } catch (e) {
    alert(e.message || t('txt_email_failed'));
  }
}

async function _clearRegMessage(rid) {
  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear_message: true }) });
  await _loadRegDetail(rid);
}

function _toggleRegDescPreview(rid) {
  const preview = document.getElementById(`reg-desc-preview-${rid}`);
  const textarea = document.getElementById(`reg-edit-desc-${rid}`);
  if (!preview || !textarea) return;
  if (preview.style.display === 'none') {
    const md = textarea.value || '';
    try {
      const rawHtml = typeof marked !== 'undefined' && marked.parse ? marked.parse(md) : md.replace(/</g, '&lt;');
      preview.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] }) : esc(md);
    } catch (_) { preview.textContent = md; }
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

function _toggleNewRegDescPreview() {
  const preview = document.getElementById('reg-new-desc-preview');
  const textarea = document.getElementById('reg-new-desc');
  if (!preview || !textarea) return;
  if (preview.style.display === 'none') {
    const md = textarea.value || '';
    try {
      const rawHtml = typeof marked !== 'undefined' && marked.parse ? marked.parse(md) : md.replace(/</g, '&lt;');
      preview.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] }) : esc(md);
    } catch (_) { preview.textContent = md; }
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

async function _startConvertFromReg(rid) {
  try {
    const fresh = await api(`/api/registrations/${rid}`);
    _regDetails[rid] = fresh;
    _currentRegDetail = fresh;
    if (!fresh.open || fresh.archived) {
      _renderRegDetailInline(rid);
      return;
    }
  } catch (_) {
    const cached = _regDetails[rid];
    if (!cached) return;
    if (!cached.open || cached.archived) {
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

function _renderConvertPanel(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const el = document.getElementById('view-content');
  const isTennis = _isTennisRegistration(rid);

  // Reset state
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
  const toggle = document.getElementById('conv-type-toggle');
  if (toggle) toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.textContent.trim() === {
    group_playoff: t('txt_txt_group_play_off'),
    mexicano: t('txt_txt_mexicano_play_offs'),
    playoff: t('txt_txt_play_offs_only'),
  }[type]));
  // Find the rid from the submit button onclick
  const submitBtn = document.querySelector('#conv-msg')?.parentElement?.querySelector('.btn-success');
  const rid = submitBtn ? submitBtn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1] : null;
  _renderConvSettings(rid);
  _renderConvStrength(rid);
}

function _setConvTeamMode(isTeam) {
  if (_isTennisRegistration()) isTeam = false;
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
    html += `<div class="adv-field"><label>${t('txt_txt_loss_discount_label')}</label><input id="conv-mex-loss-discount" type="number" value="1" min="0" max="1" step="0.05"></div>`;
    html += `<div class="adv-field"><label>${t('txt_txt_balance_tolerance_label')}</label><input id="conv-mex-balance-tol" type="number" value="0.2" min="0" max="2" step="0.1"></div>`;
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
      body.loss_discount = +(document.getElementById('conv-mex-loss-discount')?.value || 1);
      body.balance_tolerance = +(document.getElementById('conv-mex-balance-tol')?.value || 0.2);
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
    api('/api/tournaments/email-status').then(d => { window._emailConfigured = !!d.configured; }).catch(() => {});
    loadTournaments();
  }
});

// ─── Registration Collaborators / Sharing ────────────────

/**
 * Render the Collaborators management card for a registration.
 * Only visible to the registration owner and site admins.
 */
function _renderRegCollaboratorsSection(rid, collaborators) {
  const r = _regDetails[rid];
  if (!r) return '';
  const isOwner = r.owner === getAuthUsername();
  if (!isOwner && !isAdmin()) return '';

  const list = collaborators || [];

  let html = `<div style="margin-top:0.9rem;padding-top:0.75rem;border-top:1px solid var(--border)">`;
  html += `<div style="font-weight:700;display:flex;align-items:center;gap:0.45rem;margin-bottom:0.55rem">`;
  html += `👥 ${t('txt_txt_collaborators')}`;
  if (list.length > 0) html += ` <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">(${list.length})</span>`;
  html += `</div>`;
  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.75rem">${t('txt_txt_collaborators_help')}</p>`;

  // Add co-editor input row
  html += `<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">`;
  html += `<input type="text" id="reg-collab-username-input-${esc(rid)}" placeholder="${t('txt_txt_add_collaborator_placeholder')}"`;
  html += ` list="reg-collab-username-suggestions-${esc(rid)}" autocomplete="off"`;
  html += ` style="flex:1;min-width:180px;font-size:0.85rem"`;
  html += ` oninput="_onRegCollabInput('${esc(rid)}', this.value)" onkeydown="if(event.key==='Enter')_addRegCollaborator('${esc(rid)}')">`;
  html += `<datalist id="reg-collab-username-suggestions-${esc(rid)}"></datalist>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_addRegCollaborator('${esc(rid)}')">+ ${t('txt_txt_add_collaborator_btn')}</button>`;
  html += `</div>`;
  html += `<div id="reg-collab-error-${esc(rid)}" style="color:var(--danger,#ef4444);font-size:0.82rem;margin-bottom:0.5rem;display:none"></div>`;

  // Current co-editors list
  html += `<div id="reg-collab-list-${esc(rid)}">`;
  if (list.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_txt_no_collaborators')}</p>`;
  } else {
    for (const username of list) {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border)">`;
      html += `<span style="font-size:0.9rem">👤 ${esc(username)}</span>`;
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem"`;
      html += ` onclick="_removeRegCollaborator('${esc(rid)}', '${escAttr(username)}')">✕ ${t('txt_txt_remove')}</button>`;
      html += `</div>`;
    }
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}

const _regCollabSearchTimers = {};
function _onRegCollabInput(rid, value) {
  clearTimeout(_regCollabSearchTimers[rid]);
  const dl = document.getElementById(`reg-collab-username-suggestions-${rid}`);
  if (!dl) return;
  if (value.length < 2) { dl.innerHTML = ''; return; }
  _regCollabSearchTimers[rid] = setTimeout(async () => {
    try {
      const results = await api(`/api/auth/users/search?q=${encodeURIComponent(value)}`);
      dl.innerHTML = results.map(u => `<option value="${u.replace(/"/g, '&quot;')}">`).join('');
    } catch (_) { /* silently ignore search errors */ }
  }, 200);
}

async function _addRegCollaborator(rid) {
  const input = document.getElementById(`reg-collab-username-input-${rid}`);
  const errEl = document.getElementById(`reg-collab-error-${rid}`);
  if (!input) return;
  const username = input.value.trim();
  if (!username) return;
  if (errEl) errEl.style.display = 'none';
  try {
    const result = await api(`/api/registrations/${rid}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    input.value = '';
    _regCollaborators[rid] = result.collaborators || [];
    _renderRegDetailInline(rid);
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    else alert(e.message);
  }
}

async function _removeRegCollaborator(rid, username) {
  if (!confirm(t('txt_txt_confirm_remove_collab', { username }))) return;
  try {
    const result = await api(`/api/registrations/${rid}/collaborators/${encodeURIComponent(username)}`, { method: 'DELETE' });
    _regCollaborators[rid] = result.collaborators || [];
    _renderRegDetailInline(rid);
  } catch (e) {
    alert(e.message);
  }
}

// ─── Collaborators / Sharing ─────────────────────────────

/**
 * Render the Collaborators management card.
 * Only visible to the tournament owner and site admins — co-editors cannot
 * modify the share list.
 */
function _renderCollaboratorsSection(collaborators) {
  if (!currentTid) return '';
  const isOwner = _tournamentMeta[currentTid]?.owner === getAuthUsername();
  if (!isOwner && !isAdmin()) return '';

  const list = collaborators || [];

  let html = `<details class="card" id="collaborators-panel">`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem">`;
  html += `<span class="tv-chevron" style="display:inline-block;transition:transform 0.18s;font-size:0.7em;color:var(--text-muted)">▸</span>`;
  html += ` 👥 ${t('txt_txt_collaborators')}`;
  if (list.length > 0) html += ` <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">(${list.length})</span>`;
  html += `</span></summary>`;
  html += `<div style="margin-top:0.65rem">`;
  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.75rem">${t('txt_txt_collaborators_help')}</p>`;

  // Add co-editor input row
  html += `<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">`;
  html += `<input type="text" id="collab-username-input" placeholder="${t('txt_txt_add_collaborator_placeholder')}"`;
  html += ` list="collab-username-suggestions" autocomplete="off"`;
  html += ` style="flex:1;min-width:180px;font-size:0.85rem"`;
  html += ` oninput="_onCollabInput(this.value)" onkeydown="if(event.key==='Enter')_addCollaborator()">`;
  html += `<datalist id="collab-username-suggestions"></datalist>`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="_addCollaborator()">+ ${t('txt_txt_add_collaborator_btn')}</button>`;
  html += `</div>`;
  html += `<div id="collab-error" style="color:var(--danger,#ef4444);font-size:0.82rem;margin-bottom:0.5rem;display:none"></div>`;

  // Current co-editors list
  html += `<div id="collaborators-list">`;
  if (list.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_txt_no_collaborators')}</p>`;
  } else {
    for (const username of list) {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border)">`;
      html += `<span style="font-size:0.9rem">👤 ${esc(username)}</span>`;
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem"`;
      html += ` onclick="_removeCollaborator('${escAttr(username)}')">✕ ${t('txt_txt_remove')}</button>`;
      html += `</div>`;
    }
  }
  html += `</div>`;
  html += `</div></details>`;
  return html;
}

let _collabSearchTimer = null;
function _onCollabInput(value) {
  clearTimeout(_collabSearchTimer);
  const dl = document.getElementById('collab-username-suggestions');
  if (!dl) return;
  if (value.length < 2) { dl.innerHTML = ''; return; }
  _collabSearchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/auth/users/search?q=${encodeURIComponent(value)}`);
      dl.innerHTML = results.map(u => `<option value="${u.replace(/"/g, '&quot;')}">`).join('');
    } catch (_) { /* silently ignore search errors */ }
  }, 200);
}

async function _addCollaborator() {
  const input = document.getElementById('collab-username-input');
  const errEl = document.getElementById('collab-error');
  if (!input || !currentTid) return;
  const username = input.value.trim();
  if (!username) return;
  if (errEl) errEl.style.display = 'none';
  try {
    await api(`/api/tournaments/${currentTid}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    input.value = '';
    _refreshCurrentView();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
    else alert(e.message);
  }
}

async function _removeCollaborator(username) {
  if (!confirm(t('txt_txt_confirm_remove_collab', { username }))) return;
  try {
    await api(`/api/tournaments/${currentTid}/collaborators/${encodeURIComponent(username)}`, { method: 'DELETE' });
    _refreshCurrentView();
  } catch (e) {
    alert(e.message);
  }
}

// ── Event delegation for static HTML actions ────────────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'toggleLanguage': toggleLanguage(); break;
    case 'togglePageSelector': togglePageSelector(); break;
    case 'toggleTheme': toggleTheme(); break;
    case 'refreshCurrentView': _refreshCurrentView(); break;
    case 'openFormatInfo': openFormatInfo(); break;
    case 'setSport': setSport(el.dataset.sport); break;
    case 'setCreateMode': setCreateMode(el.dataset.tab); break;
    case 'setEntryMode': setEntryMode(el.dataset.entryCtx, el.dataset.entryMode); break;
    case 'clearParticipants': clearParticipants(el.dataset.ctx); break;
    case 'togglePasteMode': togglePasteMode(el.dataset.ctx); break;
    case 'addParticipantField': addParticipantField(el.dataset.ctx); break;
    case 'withLoading': withLoading(el, window[el.dataset.handler]); break;
    case 'setMexRoundsMode': _setMexRoundsMode(el.dataset.roundsMode); break;
    case 'applySchemaPreset': _applySchemaPreset(el.dataset.preset); break;
    case 'generatePoPreviewSchema': generatePoPreviewSchema(); break;
    case 'generateSchema': generateSchema(); break;
    case 'closeFormatInfo': closeFormatInfo(); break;
    case 'closeBracketLightbox': _closeBracketLightbox(e); break;
    case 'stopPropagation': e.stopPropagation(); break;
    case 'bracketLightboxZoomOut': _bracketLightboxZoomOut(); break;
    case 'bracketLightboxZoomReset': _bracketLightboxZoomReset(); break;
    case 'bracketLightboxZoomIn': _bracketLightboxZoomIn(); break;
    case 'bracketLightboxOpenFull': _bracketLightboxOpenFull(); break;
    case 'bracketLightboxDownload': _bracketLightboxDownload(); break;
    case 'hideLoginDialog': hideLoginDialog(); break;
    case 'hideUserMgmt': hideUserMgmt(); break;
    case 'hideChangePasswordDialog': hideChangePasswordDialog(); break;
    case 'hideForgotPasswordDialog': hideForgotPasswordDialog(); break;
  }
});
