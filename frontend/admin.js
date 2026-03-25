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

// ─── Abbreviation legend popup ────────────────────────────────────────────────
let _abbrevPopupBtn = null;

function _buildAbbrevLegend(type) {
  const rows = type === 'standings' ? [
    [t('txt_txt_p_abbrev'),    t('txt_txt_abbrev_mp_full')],
    [t('txt_txt_w_abbrev'),    t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),    t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),    t('txt_txt_abbrev_l_full')],
    [t('txt_txt_pf_abbrev'),   t('txt_txt_abbrev_pf_full')],
    [t('txt_txt_pa_abbrev'),   t('txt_txt_abbrev_pa_full')],
    [t('txt_txt_diff_abbrev'), t('txt_txt_abbrev_diff_full')],
    [t('txt_txt_pts_abbrev'),  t('txt_txt_abbrev_pts_full')],
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
  setTheme(_loadSavedTheme());
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
    const [list, regList] = await Promise.all([
      api('/api/tournaments'),
      isAuthenticated() ? api('/api/registrations').catch(() => []) : Promise.resolve([]),
    ]);
    _tournamentMeta = {};
    for (const tournament of list) _tournamentMeta[tournament.id] = tournament;
    _registrations = regList;
    const el = document.getElementById('tournament-list');
    const finEl = document.getElementById('finished-tournament-list');
    const finCard = document.getElementById('finished-tournaments-card');
    const active = list.filter(tr => tr.phase !== 'finished');
    const finished = list.filter(tr => tr.phase === 'finished');
    // Filter out converted lobbies (tournament already shown)
    const lobbies = regList.filter(r => !r.converted_to_tid);
    if (!active.length && !lobbies.length) {
      el.innerHTML = `<div style="text-align:center;padding:2rem 1rem;color:var(--text-muted)"><div style="font-size:2.2rem;margin-bottom:0.5rem">🏆</div><div style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:0.35rem">${t('txt_txt_no_tournaments_yet')}</div><div style="font-size:0.85rem;margin-bottom:1rem">${t('txt_txt_no_tournaments_hint')}</div><button type="button" class="btn btn-primary btn-sm" onclick="setActiveTab('create')">${t('txt_txt_create_first')}</button></div>`;
      finCard.style.display = 'none';
      return;
    }
    const renderTournamentCard = (tournament) => {
      const canEdit = isAdmin() || getAuthUsername() === tournament.owner;
      const isPublic = tournament.public !== false;
      const visBtn = canEdit
        ? `<button type="button" class="btn btn-sm" title="${t('txt_txt_visibility')}" onclick="togglePublic('${tournament.id}',${isPublic})" style="padding:0.25rem 0.5rem;font-size:0.75rem">${isPublic ? '🌍 ' + t('txt_txt_public') : '🔒 ' + t('txt_txt_private')}</button>`
        : '';
      const actionBtns = canEdit ? `
        ${visBtn}
        <button type="button" class="btn btn-danger btn-sm" onclick="deleteTournament('${tournament.id}')">✕</button>
      ` : '';
      const isTennis = tournament.sport === 'tennis';
      const sportLabel = isTennis ? t('txt_txt_sport_tennis') : t('txt_txt_sport_padel');
      return `
      <div class="match-card tournament-list-card${tournament.id === currentTid ? ' active-tournament' : ''}">
        <div class="match-teams">
          <a class="tournament-name-link" href="#" onclick="openTournament('${tournament.id}','${tournament.type}');return false">${esc(tournament.name)}</a>
          <span class="badge badge-sport">${esc(sportLabel)}</span>
          ${!isTennis ? `<span class="badge badge-type">${tournament.team_mode ? t('txt_txt_team_mode_short') : t('txt_txt_individual_mode')}</span>` : ''}
          <span class="badge badge-phase">${_phaseLabel(tournament.phase)}</span>
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
        : `<span class="badge badge-lobby-closed">${t('txt_reg_registration_closed')}</span>`;
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
    // Lobbies first, then active tournaments
    let html = lobbies.map(_renderLobbyCard).join('');
    html += active.map(renderTournamentCard).join('');
    el.innerHTML = html || `<em>${t('txt_txt_no_tournaments_yet')}</em>`;
    if (finished.length) {
      finCard.style.display = '';
      finEl.innerHTML = finished.map(renderTournamentCard).join('');
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
const _ADMIN_POLL_INTERVAL_MS = 15000;

function _startAdminVersionPoll() {
  _stopAdminVersionPoll();
  if (!currentTid) return;
  // Seed the version so the first poll doesn't trigger a spurious reload
  fetch(`/api/tournaments/${currentTid}/version`)
    .then(r => r.json())
    .then(d => { _adminLastKnownVersion = d.version; })
    .catch(() => {});
  _adminVersionPollTimer = setInterval(async () => {
    if (!currentTid) return;
    try {
      const d = await fetch(`/api/tournaments/${currentTid}/version`).then(r => r.json());
      if (_adminLastKnownVersion !== null && d.version !== _adminLastKnownVersion) {
        _adminLastKnownVersion = d.version;
        await _rerenderCurrentViewPreserveDrafts();
      } else {
        _adminLastKnownVersion = d.version;
      }
    } catch (_) { /* network blip — ignore */ }
  }, _ADMIN_POLL_INTERVAL_MS);
}

function _stopAdminVersionPoll() {
  if (_adminVersionPollTimer) { clearInterval(_adminVersionPollTimer); _adminVersionPollTimer = null; }
  _adminLastKnownVersion = null;
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
      openTournament(next.id, next.type, next.name);
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
  el.innerHTML = `<div class="card"><em>${t('txt_txt_loading')}</em></div>`;
  try {
    const data = await api(`/api/registrations/${currentTid}`);
    _regDetails[currentTid] = data;
    _currentRegDetail = data;
    _renderRegDetailInline(currentTid);
  } catch (e) {
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
}

// ─── Create Group+Playoff ─────────────────────────────────
async function createGP() {
  const msg = document.getElementById('gp-msg');
  try {
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
  const el = document.getElementById('view-content');
  try {
    const [status, groups, playoffs, tvSettings, playerSecrets] = await Promise.all([
      api(`/api/tournaments/${currentTid}/gp/status`),
      api(`/api/tournaments/${currentTid}/gp/groups`),
      api(`/api/tournaments/${currentTid}/gp/playoffs`).catch(()=>null),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
    ]);

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderPlayerCodes(playerSecrets);
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
      html += `<div class="card"><h3 class="card-heading-row">${t('txt_txt_group_name_value', { value: esc(gName) })} <button class="format-info-btn" onclick="showAbbrevPopup(event,'standings')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></h3>`;
      const hParticipant = status.team_mode ? t('txt_txt_team') : t('txt_txt_player');
      html += `<table><thead><tr><th>${hParticipant}</th><th>${t('txt_txt_p_abbrev')}</th><th>${t('txt_txt_w_abbrev')}</th><th>${t('txt_txt_d_abbrev')}</th><th>${t('txt_txt_l_abbrev')}</th><th>${t('txt_txt_pf_abbrev')}</th><th>${t('txt_txt_pa_abbrev')}</th><th>${t('txt_txt_diff_abbrev')}</th><th>${t('txt_txt_pts_abbrev')}</th></tr></thead><tbody>`;
      for (const r of rows) {
        html += `<tr><td>${esc(r.player)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${r.points_for}</td><td>${r.points_against}</td><td>${r.point_diff}</td><td><strong>${r.match_points}</strong></td></tr>`;
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
        html += `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;justify-content:center">`;
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

    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
}

// ─── Render Standalone Playoff ────────────────────────────
async function renderPO() {
  _totalPts = 0;
  const el = document.getElementById('view-content');
  try {
    const [status, playoffs, tvSettings, playerSecrets] = await Promise.all([
      api(`/api/tournaments/${currentTid}/po/status`),
      api(`/api/tournaments/${currentTid}/po/playoffs`),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
    ]);

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderPlayerCodes(playerSecrets);

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

    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
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
    const autoCalc = _totalPts > 0 && (ctx === 'mex' || ctx === 'mex-playoff');
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
  const autoCalc = _totalPts > 0 && isMex;
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
    html += `<input type="number" id="s1-${m.id}" min="0" value="0" style="width:50px">`;
    html += `<span>–</span>`;
    html += `<input type="number" id="s2-${m.id}" min="0" value="0" style="width:50px">`;
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
    html += `<input type="number" id="s1-${m.id}" min="0" value="0" style="width:50px" ${onInput}>`;
    html += `<span>–</span>`;
    html += `<input type="number" id="s2-${m.id}" min="0" value="${autoCalc ? _totalPts : 0}" style="width:50px" ${onInput}>`;
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
      html += `<span class="gp-player-stats">${r.match_points} ${t('txt_txt_pts_abbrev')}, diff ${r.point_diff >= 0 ? '+' : ''}${r.point_diff}</span>`;
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

  // Action buttons
  html += `<div class="proposal-actions">`;
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
  const el = document.getElementById('view-content');
  try {
    const [status, matches, tvSettings, playerSecrets, playoffsData] = await Promise.all([
      api(`/api/tournaments/${currentTid}/mex/status`),
      api(`/api/tournaments/${currentTid}/mex/matches`),
      api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({})),
      _loadPlayerSecrets(),
      api(`/api/tournaments/${currentTid}/mex/playoffs`).catch(() => ({ matches: [], pending: [] })),
    ]);

    _totalPts = status.total_points_per_match || 0;
    _mexPlayers = status.players || [];
    _mexTeamMode = status.team_mode || false;
    _mexBreakdowns = matches.breakdowns || {};
    _mexPlayerMap = {};
    for (const p of _mexPlayers) _mexPlayerMap[p.id] = p.name;

    if (tvSettings.score_mode) {
      for (const [k, v] of Object.entries(tvSettings.score_mode)) if (k in _gpScoreMode) _gpScoreMode[k] = v;
    }

    const hasCourts = status.assign_courts !== false;
    let html = '';
    html += _renderTvControls(tvSettings, hasCourts);
    html += _renderPlayerCodes(playerSecrets);

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
      html += `<tr><td>${r.rank}</td><td>${esc(r.player)}</td><td>${totalCell}</td><td>${r.matches_played}</td><td>${r.wins || 0}</td><td>${r.draws || 0}</td><td>${r.losses || 0}</td><td>${avgCell}</td></tr>`;
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
        html += `<button type="button" class="btn btn-success" onclick="withLoading(this,proposeMexPairings)">⚡ ${t('txt_txt_propose_next_round')}</button>`;
        if (status.current_round > 0) {
          html += ` <button type="button" class="btn btn-primary" onclick="withLoading(this,endMexicano)" style="margin-left:0.5rem">🛑 ${t('txt_txt_end_mexicano')}</button>`;
        }
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
        html += `<div class="proposal-actions" style="gap:1rem;margin-top:0.5rem">`;
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

    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
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
let _showExtraMexProposals = false;

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
    nextSection.innerHTML = `<em style="color:var(--text-muted)">${t('txt_txt_updating_proposals')}</em>`;
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

async function _loadMoreMexPairings() {
  const previousSelected = _selectedOptionId;
  await proposeMexPairings(10);
  if (previousSelected && _currentPairingProposals.some(p => p.option_id === previousSelected)) {
    _selectedOptionId = previousSelected;
  }
  _showExtraMexProposals = true;
  const section = document.getElementById('mex-next-section');
  if (section && _currentPairingProposals.length > 0) {
    section.innerHTML = _renderProposalPicker(_currentPairingProposals);
  }
}

function _toggleExtraMexProposals() {
  _showExtraMexProposals = !_showExtraMexProposals;
  const section = document.getElementById('mex-next-section');
  if (section && _currentPairingProposals.length > 0) {
    section.innerHTML = _renderProposalPicker(_currentPairingProposals);
  }
}

function _renderProposalPicker(proposals) {
  let html = `<div class="card">`;
  html += `<h2>${t('txt_txt_choose_pairings')}</h2>`;
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

  let balancedOptions = allBalancedOptions;
  let seededOptions = allSeededOptions;
  if (!_showExtraMexProposals) {
    let remaining = 5;
    balancedOptions = allBalancedOptions.slice(0, remaining);
    remaining -= balancedOptions.length;
    seededOptions = allSeededOptions.slice(0, Math.max(0, remaining));
  }

  const shownAlternatives = balancedOptions.length + seededOptions.length;
  const hiddenAlternatives = Math.max(0, allAlternatives.length - shownAlternatives);
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
      html += `<button class="proposal-inline-action" type="button" onclick="_loadMoreMexPairings()">⬇ ${t('txt_txt_load_more_combos')}</button>`;
    }
    if (hiddenAlternatives > 0 || hasLoadedMore) {
      const arrow = _showExtraMexProposals ? '▾' : '▸';
      const suffix = hiddenAlternatives > 0 ? ` (${hiddenAlternatives})` : '';
      html += `<button class="proposal-inline-action" type="button" onclick="_toggleExtraMexProposals()">${arrow} ${t('txt_txt_more_combinations')}${suffix}</button>`;
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

  if (seededOptions.length > 0 || _showExtraMexProposals) {
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

  html += `<div class="proposal-actions">`;
  html += `<button type="button" class="btn btn-success" onclick="_confirmMexRound()">✓ ${t('txt_txt_confirm_selection')}</button>`;
  html += `<button type="button" class="btn" style="background:var(--border);color:var(--text)" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += ` <button type="button" class="btn" style="background:var(--text-muted);color:#fff" onclick="_showManualEditor()">✏️ ${t('txt_txt_manual_override')}</button>`;
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

// ─── Manual pairing editor ───────────────────────────────
let _manualMatchCount = 0;

function _showManualEditor() {
  const section = document.getElementById('mex-next-section');
  if (!section) return;

  const numCourts = Math.floor(_mexPlayers.length / 4);
  _manualMatchCount = numCourts;

  let html = `<div class="card">`;
  html += `<h2>✏️ ${t('txt_txt_manual_pairing_editor')}</h2>`;
  html += `<p style="color:var(--text-muted);font-size:0.85rem">${t('txt_txt_manual_editor_instructions')}</p>`;

  html += `<div id="manual-matches">`;
  for (let i = 0; i < numCourts; i++) {
    html += _renderManualMatch(i);
  }
  html += `</div>`;

  html += `<div style="margin: 0.5rem 0; display:flex; gap:0.5rem; flex-wrap:wrap">`;
  html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_addManualMatch()">+ ${t('txt_txt_add_match')}</button>`;
  html += `<button type="button" class="btn btn-sm" style="background:var(--border);color:var(--text)" onclick="_removeManualMatch()">− ${t('txt_txt_remove_match')}</button>`;
  html += `</div>`;

  html += `<div id="manual-sitout" style="margin:0.5rem 0; font-size:0.85rem; color:var(--text-muted)"></div>`;

  html += `<div class="proposal-actions">`;
  html += `<button type="button" class="btn btn-success" onclick="_commitManualRound()">✓ ${t('txt_txt_commit_manual_round')}</button>`;
  html += `<button type="button" class="btn" style="background:var(--border);color:var(--text)" onclick="proposeMexPairings()">← ${t('txt_txt_back_to_proposals')}</button>`;
  html += `<button type="button" class="btn" style="background:var(--border);color:var(--text)" onclick="renderMex()">✕ ${t('txt_txt_cancel')}</button>`;
  html += `</div>`;
  html += `</div>`;

  section.innerHTML = html;
  _updateManualSitout();
}

function _renderManualMatch(idx) {
  const opts = _mexPlayers.map(p =>
    `<option value="${p.id}">${esc(p.name)}</option>`
  ).join('');
  const blank = `<option value="">${t('txt_txt_pick_placeholder')}</option>`;
  return `<div class="manual-match-row" style="margin-bottom:0.6rem; padding:0.5rem; border:1px solid var(--border); border-radius:6px;">
    <strong>${t('txt_txt_match_n', { n: idx + 1 })}</strong>
    <div style="display:flex; gap:0.3rem; flex-wrap:wrap; margin-top:0.3rem; align-items:center">
      <select class="manual-sel" data-match="${idx}" data-slot="t1a" onchange="_updateManualSitout()">${blank}${opts}</select>
      <span>&amp;</span>
      <select class="manual-sel" data-match="${idx}" data-slot="t1b" onchange="_updateManualSitout()">${blank}${opts}</select>
      <span style="margin:0 0.3rem; color:var(--text-muted)">vs</span>
      <select class="manual-sel" data-match="${idx}" data-slot="t2a" onchange="_updateManualSitout()">${blank}${opts}</select>
      <span>&amp;</span>
      <select class="manual-sel" data-match="${idx}" data-slot="t2b" onchange="_updateManualSitout()">${blank}${opts}</select>
    </div>
  </div>`;
}

function _addManualMatch() {
  _manualMatchCount++;
  const container = document.getElementById('manual-matches');
  container.insertAdjacentHTML('beforeend', _renderManualMatch(_manualMatchCount - 1));
  _updateManualSitout();
}

function _removeManualMatch() {
  if (_manualMatchCount <= 1) return;
  _manualMatchCount--;
  const container = document.getElementById('manual-matches');
  container.removeChild(container.lastElementChild);
  _updateManualSitout();
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
      el.innerHTML = `🪑 ${t('txt_txt_sitting_out')}: <em>${esc(sitting.map(p => p.name).join(', '))}</em>`;
    } else {
      el.innerHTML = t('txt_txt_all_players_assigned');
    }
  }
}

async function _commitManualRound() {
  // Gather selections
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
    alert(errors.join('\\n'));
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
        body += _report_table(
          [t('txt_txt_player'), t('txt_txt_played'), t('txt_txt_w_abbrev'), t('txt_txt_d_abbrev'), t('txt_txt_l_abbrev'), t('txt_txt_pf_abbrev'), t('txt_txt_pa_abbrev'), t('txt_txt_diff_abbrev'), t('txt_txt_pts_abbrev')],
          rows.map(r => [r.player, r.played, r.wins, r.draws, r.losses, r.points_for, r.points_against, r.point_diff, r.match_points]),
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
    html += `<th style="text-align:center;padding:0.4rem 0.6rem">${t('txt_txt_qr_code')}</th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.6rem"></th>`;
    html += `</tr></thead><tbody>`;
    for (const [pid, info] of entries) {
      html += `<tr style="border-bottom:1px solid var(--border)" id="pc-row-${pid}">`;
      html += `<td style="padding:0.4rem 0.6rem;font-weight:600">${esc(info.name)}</td>`;
      html += `<td style="padding:0.4rem 0.6rem"><code id="pc-pass-${pid}" style="font-size:0.9em;color:var(--accent);user-select:all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent)" title="Click to copy">${esc(info.passphrase)}</code></td>`;
      html += `<td style="padding:0.4rem 0.6rem;text-align:center"><button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem" onclick="_showPlayerQr('${escAttr(pid)}','${escAttr(info.name)}')">📱 ${t('txt_txt_qr_code')}</button></td>`;
      html += `<td style="padding:0.4rem 0.6rem;text-align:center"><button type="button" class="btn btn-sm" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:var(--border);color:var(--text)" onclick="_regeneratePlayerCode('${pid}')">🔄 ${t('txt_txt_regenerate')}</button></td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `</div>`;
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
let _regDetails = {};  // rid → full registration detail data
let _currentRegDetail = null;  // last-opened registration (for convert flow)
let _regPollTimer = null;
const _REG_POLL_INTERVAL_MS = 10000;

// Registration detail auto-refresh
let _regDetailPollTimer = null;
let _regDetailLastCount = null;
const _REG_DETAIL_POLL_INTERVAL_MS = 6000;

function _startRegDetailPoll() {
  _stopRegDetailPoll();
  if (!currentTid || currentType !== 'registration') return;
  _regDetailLastCount = _currentRegDetail?.registrants?.length ?? null;
  _regDetailPollTimer = setInterval(async () => {
    if (!currentTid || currentType !== 'registration') return;
    try {
      const d = await fetch(`/api/registrations/${currentTid}/public`).then(r => r.ok ? r.json() : null);
      if (!d) return;
      if (_regDetailLastCount !== null && d.registrant_count !== _regDetailLastCount) {
        _regDetailLastCount = d.registrant_count;
        renderRegistration();
      } else {
        _regDetailLastCount = d.registrant_count;
      }
    } catch (_) { /* network blip */ }
  }, _REG_DETAIL_POLL_INTERVAL_MS);
}

function _stopRegDetailPoll() {
  if (_regDetailPollTimer) { clearInterval(_regDetailPollTimer); _regDetailPollTimer = null; }
  _regDetailLastCount = null;
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

  let html = `<div class="card"><h2 style="margin-top:0">${esc(r.name)}</h2>`;
  const regAlias = r.alias || '';
  const regUrl = regAlias
    ? `${window.location.origin}/register/${regAlias}`
    : `${window.location.origin}/register?id=${esc(r.id)}`;

  // Registration link + alias section
  html += `<div style="margin-bottom:1rem;padding:0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px">`;
  html += `<label style="font-size:0.85rem;font-weight:600;margin-bottom:0.4rem;display:block">🔗 ${t('txt_reg_registration_alias')}</label>`;
  html += `<p style="color:var(--text-muted);font-size:0.78rem;margin-bottom:0.5rem">${t('txt_reg_alias_help')}</p>`;
  html += `<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">`;
  html += `<input type="text" id="reg-alias-input-${esc(rid)}" placeholder="my-tournament" value="${esc(regAlias)}" pattern="[a-zA-Z0-9_-]+" maxlength="64" style="flex:1;min-width:180px;font-family:monospace;font-size:0.85rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_setRegAlias('${esc(rid)}'))" style="white-space:nowrap">${t('txt_txt_set_alias')}</button>`;
  if (regAlias) {
    html += `<button type="button" class="btn btn-danger btn-sm" onclick="withLoading(this,()=>_deleteRegAlias('${esc(rid)}'))" style="white-space:nowrap">✕ ${t('txt_txt_remove')}</button>`;
  }
  html += `</div>`;
  html += `<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:0.78rem;word-break:break-all">`;
  html += `<span style="color:var(--text-muted)">${t('txt_reg_public_url')}</span> <a href="${regUrl}" target="_blank" style="color:var(--accent);font-size:0.85rem">${regUrl}</a>`;
  html += ` <button type="button" class="btn btn-sm" style="font-size:0.7rem;margin-left:0.3rem" onclick="_copyRegLink('${esc(rid)}')">📋 ${t('txt_reg_copy_link')}</button>`;
  html += `</div></div>`;

  // Settings section
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary style="cursor:pointer;font-weight:700">⚙\uFE0F ${t('txt_reg_settings')}</summary>`;
  html += `<div style="padding:0.75rem 0">`;
  html += `<div class="form-group"><label>${t('txt_reg_tournament_name')}</label>`;
  html += `<input type="text" id="reg-edit-name-${esc(rid)}" value="${esc(r.name)}"></div>`;
  html += `<div class="form-group"><label>${t('txt_reg_description')}</label>`;
  html += `<textarea id="reg-edit-desc-${esc(rid)}" rows="3">${esc(r.description || '')}</textarea>`;
  html += `<div id="reg-desc-preview-${esc(rid)}" style="display:none;margin-top:0.5rem;padding:0.5rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"></div>`;
  html += `<button type="button" class="btn btn-sm" style="margin-top:0.3rem;font-size:0.75rem" onclick="_toggleRegDescPreview('${esc(rid)}')">${t('txt_reg_preview')}</button></div>`;
  html += `<div class="form-group"><label>${t('txt_reg_join_code')}</label>`;
  html += `<input type="text" id="reg-edit-joincode-${esc(rid)}" value="${esc(r.join_code || '')}" placeholder="${t('txt_reg_join_code_placeholder')}"></div>`;
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-bottom:0.5rem">`;
  html += `<input type="checkbox" id="reg-edit-listed-${esc(rid)}" ${r.listed ? 'checked' : ''} style="width:1rem;height:1rem;cursor:pointer">`;
  html += `<label for="reg-edit-listed-${esc(rid)}" style="font-size:0.85rem;cursor:pointer">${t('txt_reg_listed')}</label></div>`;
  html += `<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegSettings('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div></div></details>`;

  // Admin message section
  html += `<details class="reg-section" style="margin-bottom:1rem">`;
  html += `<summary style="cursor:pointer;font-weight:700">📢 ${t('txt_reg_admin_message')}</summary>`;
  html += `<div style="padding:0.75rem 0">`;
  html += `<div class="form-group" style="margin-bottom:0.4rem">`;
  html += `<textarea id="reg-edit-message-${esc(rid)}" rows="3" placeholder="${t('txt_reg_message_placeholder')}">${esc(r.message || '')}</textarea>`;
  html += `</div>`;
  html += `<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.5rem">`;
  html += `<button type="button" class="btn btn-primary btn-sm" onclick="withLoading(this,()=>_saveRegMessage('${esc(rid)}'))">${t('txt_reg_save')}</button>`;
  html += `</div></div></details>`;

  // Registrants table (collapsible) — names, passphrases, actions only
  html += `<details class="reg-section" style="margin-bottom:0.75rem" open>`;
  html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  html += `<span style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">▸</span> ${t('txt_reg_registrants')} (${r.registrants.length})</span>`;
  if (r.registrants.length > 0) {
    html += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="event.preventDefault();_copyAllRegCodes('${esc(rid)}')">📋 ${t('txt_txt_copy_all_codes')}</button>`;
  }
  html += `</summary>`;
  if (r.registrants.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${t('txt_reg_no_registrants')}</p>`;
  } else {
    html += `<div style="overflow-x:auto;margin-top:0.5rem"><table style="width:100%;border-collapse:collapse;font-size:0.84rem">`;
    html += `<thead><tr style="border-bottom:2px solid var(--border)">`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_reg_name')}</th>`;
    html += `<th style="text-align:left;padding:0.4rem 0.5rem">${t('txt_txt_passphrase')}</th>`;
    html += `<th style="text-align:center;padding:0.4rem 0.5rem"></th>`;
    html += `</tr></thead><tbody>`;
    for (const reg of r.registrants) {
      html += `<tr style="border-bottom:1px solid var(--border)">`;
      html += `<td style="padding:0.4rem 0.5rem;font-weight:600">${esc(reg.player_name)}</td>`;
      html += `<td style="padding:0.4rem 0.5rem"><code style="font-size:0.9em;color:var(--accent);user-select:all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent)" title="Click to copy">${esc(reg.passphrase)}</code></td>`;
      html += `<td style="padding:0.4rem 0.5rem;text-align:center">`;
      html += `<button type="button" class="btn btn-danger btn-sm" style="font-size:0.72rem;padding:0.2rem 0.4rem" onclick="_removeRegistrant('${esc(r.id)}','${esc(reg.player_id)}')" title="${t('txt_reg_confirm_remove')}">✕</button>`;
      html += `</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  html += `</details>`;

  // Question Answers panel (separate, only shown when questions exist)
  const questions = r.questions || [];
  if (questions.length > 0 && r.registrants.length > 0) {
    html += _renderAnswersPanel(rid, r, questions);
  }

  // Convert button (if not already converted)
  if (!r.converted_to_tid) {
    html += `<div style="text-align:center;margin-top:1.25rem">`;
    html += `<button type="button" class="btn btn-success" style="padding:0.7rem 1.5rem;font-size:1rem" onclick="_startConvertFromReg('${esc(rid)}')" ${r.registrants.length < 2 ? 'disabled title="Need at least 2 registrants"' : ''}>🏆 ${t('txt_reg_convert_to_tournament')}</button>`;
    html += `</div>`;
  }

  html += `</div>`; // close .card
  el.innerHTML = html;
}

function _copyRegLink(rid) {
  const alias = _regDetails[rid]?.alias;
  const url = alias
    ? `${window.location.origin}/register/${alias}`
    : `${window.location.origin}/register?id=${rid}`;
  navigator.clipboard.writeText(url).then(() => {
    const origText = event?.target?.textContent;
    if (event?.target) { event.target.textContent = '✓'; setTimeout(() => { event.target.textContent = origText || '📋'; }, 1200); }
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

async function _toggleRegOpen(rid, currentlyOpen) {
  try {
    await api(`/api/registrations/${rid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: !currentlyOpen }),
    });
    if (_regDetails[rid]) _regDetails[rid].open = !currentlyOpen;
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

function showCreateRegistration() {
  const el = document.getElementById('reg-create-form');
  if (!el) return;
  _regQuestionCounter = 0;

  el.innerHTML = `
      <div class="field-section" style="margin-bottom:0.75rem">
        <input id="reg-new-name" value="My Tournament" class="tournament-name-input" placeholder="${t('txt_reg_tournament_name')}" style="width:100%;min-width:160px">
      </div>
      <div class="field-section" style="margin-bottom:0.75rem">
        <div class="field-section-title">${t('txt_reg_description')}</div>
        <textarea id="reg-new-desc" rows="3"></textarea>
        <small style="color:var(--text-muted);font-size:0.75rem">${t('txt_reg_description_hint')}</small>
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
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.55rem">
          <span class="field-section-title" style="margin-bottom:0">${t('txt_reg_questions')}</span>
          <span class="participant-count" id="reg-q-count">(0)</span>
        </div>
        <div id="reg-new-questions">
          <div class="reg-q-empty" id="reg-q-empty">${t('txt_reg_q_no_questions')}</div>
        </div>
        <button type="button" class="add-participant-btn" style="margin-top:0.4rem" onclick="_addRegQuestion()">＋ ${t('txt_reg_add_question')}</button>
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
  if (questions.length) body.questions = questions;

  body.listed = !!document.getElementById('reg-new-listed')?.checked;

  body.sport = _currentSport || 'padel';

  await api('/api/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await loadRegistrations();
  setActiveTab('home');
}

let _regQuestionCounter = 0;

function _updateRegQNumbers() {
  const container = document.getElementById('reg-new-questions');
  if (!container) return;
  const cards = container.querySelectorAll('.reg-q-card');
  const count = cards.length;
  cards.forEach((card, i) => {
    const num = card.querySelector('.reg-q-number');
    if (num) num.textContent = `Q${i + 1}`;
  });
  const countEl = document.getElementById('reg-q-count');
  if (countEl) countEl.textContent = `(${count})`;
  const empty = document.getElementById('reg-q-empty');
  if (empty) empty.style.display = count ? 'none' : '';
}

function _addRegQuestion() {
  const container = document.getElementById('reg-new-questions');
  if (!container) return;
  const idx = _regQuestionCounter++;
  const div = document.createElement('div');
  div.className = 'reg-q-card reg-q-item';
  div.dataset.qidx = idx;
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
          <button type="button" class="active" onclick="_setRegQType(this,'text')">${t('txt_reg_q_type_text')}</button>
          <button type="button" onclick="_setRegQType(this,'choice')">${t('txt_reg_q_type_choice')}</button>
        </div>
      </div>
      <div class="reg-q-choices-area">
        <div class="reg-q-choices-list"></div>
        <button type="button" class="reg-q-add-choice-btn" onclick="_addRegChoice(this)">${t('txt_reg_q_add_choice')}</button>
      </div>
    </div>`;
  container.appendChild(div);
  _updateRegQNumbers();
  div.querySelector('.reg-q-label')?.focus();
}

function _removeRegQuestion(btn) {
  const card = btn.closest('.reg-q-card');
  if (card) card.remove();
  _updateRegQNumbers();
}

function _setRegQType(btn, type) {
  const toggle = btn.closest('.reg-q-type-toggle');
  if (!toggle) return;
  toggle.dataset.current = type;
  toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const area = btn.closest('.reg-q-card-body')?.querySelector('.reg-q-choices-area');
  if (!area) return;
  if (type === 'choice') {
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

function _collectRegQuestions() {
  const items = document.querySelectorAll('#reg-new-questions .reg-q-item');
  const questions = [];
  let idx = 0;
  for (const item of items) {
    const label = item.querySelector('.reg-q-label')?.value?.trim();
    if (!label) continue;
    const toggle = item.querySelector('.reg-q-type-toggle');
    const type = toggle?.dataset.current || 'text';
    const required = !!item.querySelector('.reg-q-required')?.checked;
    const key = `q${idx++}`;
    const q = { key, label, type, required };
    if (type === 'choice') {
      const inputs = item.querySelectorAll('.reg-q-choice-val');
      q.choices = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    }
    questions.push(q);
  }
  return questions;
}

// ─── Registration detail helpers ──────────────────────────

function _copyAllRegCodes(rid) {
  const r = _regDetails[rid];
  if (!r?.registrants) return;
  const lines = r.registrants.map(reg => `${reg.player_name}: ${reg.passphrase}`).join('\n');
  navigator.clipboard.writeText(lines);
}

function _renderAnswersPanel(rid, r, questions) {
  let h = `<details class="reg-section" style="margin-bottom:0.75rem">`;
  h += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;list-style:none">`;
  h += `<span style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.4rem"><span class="tv-chevron" style="font-size:0.7em;color:var(--text-muted)">▸</span> ${t('txt_reg_answers_title')} (${questions.length})</span>`;
  h += `<button type="button" class="btn btn-sm" style="font-size:0.75rem" onclick="event.preventDefault();_copyAnswersCSV('${esc(rid)}')">📋 ${t('txt_reg_copy_answers')}</button>`;
  h += `</summary>`;

  // Per-question summary cards
  h += `<div class="reg-answers-grid">`;
  for (const q of questions) {
    h += `<div class="reg-answer-card">`;
    h += `<div class="reg-answer-card-header">`;
    h += `<span class="reg-answer-card-label">${esc(q.label)}</span>`;
    h += `<span class="badge ${q.required ? 'badge-phase' : ''}" style="font-size:0.68rem">${q.type === 'choice' ? t('txt_reg_q_type_choice') : t('txt_reg_q_type_text')}${q.required ? ' · ' + t('txt_reg_q_required') : ''}</span>`;
    h += `</div>`;

    if (q.type === 'choice' && q.choices?.length) {
      // Show distribution bars for choice questions
      const counts = {};
      for (const c of q.choices) counts[c] = 0;
      let answered = 0;
      for (const reg of r.registrants) {
        const a = reg.answers?.[q.key];
        if (a) { counts[a] = (counts[a] || 0) + 1; answered++; }
      }
      h += `<div class="reg-answer-bars">`;
      for (const c of q.choices) {
        const pct = answered > 0 ? Math.round((counts[c] / r.registrants.length) * 100) : 0;
        h += `<div class="reg-answer-bar-row">`;
        h += `<span class="reg-answer-bar-label">${esc(c)}</span>`;
        h += `<div class="reg-answer-bar-track"><div class="reg-answer-bar-fill" style="width:${pct}%"></div></div>`;
        h += `<span class="reg-answer-bar-count">${counts[c]}</span>`;
        h += `</div>`;
      }
      h += `</div>`;
    }

    // Individual answers list
    h += `<div class="reg-answer-list">`;
    for (const reg of r.registrants) {
      const a = reg.answers?.[q.key] || '—';
      h += `<div class="reg-answer-row">`;
      h += `<span class="reg-answer-name">${esc(reg.player_name)}</span>`;
      h += `<span class="reg-answer-value">${esc(a)}</span>`;
      h += `</div>`;
    }
    h += `</div>`;
    h += `</div>`;
  }
  h += `</div>`;
  h += `</details>`;
  return h;
}

function _copyAnswersCSV(rid) {
  const r = _regDetails[rid];
  if (!r?.registrants) return;
  const questions = r.questions || [];
  if (!questions.length) return;
  const header = [t('txt_reg_name'), ...questions.map(q => q.label)].join('\t');
  const rows = r.registrants.map(reg => {
    const cells = [reg.player_name, ...questions.map(q => reg.answers?.[q.key] || '')];
    return cells.join('\t');
  });
  navigator.clipboard.writeText([header, ...rows].join('\n'));
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

  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
  await loadRegistrations();
}

async function _removeRegistrant(rid, pid) {
  if (!confirm(t('txt_reg_confirm_remove'))) return;
  try {
    await api(`/api/registrations/${rid}/registrant/${pid}`, { method: 'DELETE' });
    await _loadRegDetail(rid);
    await loadRegistrations();
  } catch (e) { alert(t('txt_reg_error')); }
}

async function _saveRegMessage(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  const msg = document.getElementById(`reg-edit-message-${rid}`)?.value?.trim();
  const body = msg ? { message: msg } : { clear_message: true };
  await api(`/api/registrations/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await _loadRegDetail(rid);
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

function _startConvertFromReg(rid) {
  const r = _regDetails[rid];
  if (!r) return;
  _currentRegDetail = r;
  _startConvertFromRegistration();
}

// ─── Convert registration to tournament (reuses main Create form) ─────

let _convertFromRegistration = null;  // { rid, name } when in convert mode

function _startConvertFromRegistration() {
  if (!_currentRegDetail) return;
  const r = _currentRegDetail;

  // Store convert context
  _convertFromRegistration = { rid: r.id, name: r.name };

  // Pre-fill the currently active create mode's participant list
  const names = r.registrants.map(reg => reg.player_name);
  for (const mode of ['gp', 'mex', 'po']) {
    _participantEntries[mode] = names.length ? [...names] : [''];
  }

  // Pre-fill tournament name in all modes
  document.getElementById('gp-name').value = r.name;
  document.getElementById('mex-name').value = r.name;
  document.getElementById('po-name').value = r.name;

  // Switch to Create tab and re-render participant fields
  setActiveTab('create');
  renderParticipantFields('gp');
  renderParticipantFields('mex');
  renderParticipantFields('po');

  // Show a banner indicating convert mode
  _showConvertBanner();
}

function _showConvertBanner() {
  for (const mode of ['gp', 'mex', 'po']) {
    const msg = document.getElementById(`${mode}-msg`);
    if (msg) {
      msg.className = 'alert alert-info';
      msg.innerHTML = `📋 ${t('txt_reg_convert_banner')} <button type="button" class="btn btn-sm" style="margin-left:0.5rem;font-size:0.75rem;background:var(--border);color:var(--text)" onclick="_cancelConvertMode()">✕ ${t('txt_txt_cancel')}</button>`; // eslint-disable-line
      msg.classList.remove('hidden');
    }
  }
}

function _cancelConvertMode() {
  _convertFromRegistration = null;
  for (const mode of ['gp', 'mex', 'po']) {
    const msg = document.getElementById(`${mode}-msg`);
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
  }
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
    loadTournaments();
  }
});

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
  }
});
