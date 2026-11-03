const API = '';  // same origin

// Check if running in demo mode and show warning banner
(async function checkDemoMode() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (config && config.amistoso_domain) {
      window.__AMISTOSO_DOMAIN__ = String(config.amistoso_domain).toLowerCase();
    }
    // Lets legacy (string-built) panels hide core-only features such as club
    // subdomains without reaching into the login island.
    window.__DEMO_INSTANCE__ = !!(config && config.demo_instance);
    const demoBanner = document.getElementById('demo-banner');
    if (config.demo_mode && demoBanner) {
      demoBanner.style.display = 'block';
    }
    // Demo instance / demo link config (drives the login dialog island).
    if (typeof _loginStore !== 'undefined') {
      _loginStore.demoUrl = config.demo_url || null;
      _loginStore.isDemoInstance = !!config.demo_instance;
      if (config.demo_ttl_days) _loginStore.demoTtlDays = config.demo_ttl_days;
      _loginStore.configLoaded = true;
      if (typeof _focusLoginDialog === 'function') _focusLoginDialog();
    }
    initDemoCountdown();
    restoreDemoCredsBanner();
  } catch (err) {
    console.warn('Could not fetch config:', err);
    // Fall back to the core login layout rather than an empty dialog.
    if (typeof _loginStore !== 'undefined' && !_loginStore.configLoaded) {
      _loginStore.configLoaded = true;
      if (typeof _focusLoginDialog === 'function') _focusLoginDialog();
    }
  }
})();

// ─── Demo sandbox countdown + UI restrictions ──────────────

let _demoCountdownTimer = null;

/** Format the time left until *expires* as "3d 4h" / "5h 12m" / "0m". */
function _demoTimeLeft(expires) {
  const ms = Math.max(0, expires - Date.now());
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Show the persistent demo-sandbox countdown banner for demo accounts and
 * refresh it every minute. No-op for regular users.
 */
function initDemoCountdown() {
  const banner = document.getElementById('demo-expiry-banner');
  if (!banner) return;
  if (typeof isDemoUser !== 'function' || !isDemoUser() || !getDemoExpiresAt()) {
    banner.style.display = 'none';
    if (_demoCountdownTimer) { clearInterval(_demoCountdownTimer); _demoCountdownTimer = null; }
    return;
  }
  const expires = new Date(getDemoExpiresAt()).getTime();
  if (!Number.isFinite(expires)) return;
  const render = () => {
    const date = new Date(expires).toLocaleString(undefined, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    banner.textContent = t('txt_demo_banner_text', { date, left: _demoTimeLeft(expires) });
    banner.style.display = 'block';
  };
  render();
  if (_demoCountdownTimer) clearInterval(_demoCountdownTimer);
  _demoCountdownTimer = setInterval(render, 60000);
}

// ── Demo account credentials banner ────────────────────────

const DEMO_CREDS_KEY = 'padel-demo-creds';

/**
 * Show the dismissible banner with freshly minted demo credentials.
 * Kept in sessionStorage so a reload doesn't lose the passphrase before the
 * visitor saves it; dismissing forgets it for good.
 */
function showDemoCredsBanner(username, passphrase) {
  try {
    sessionStorage.setItem(DEMO_CREDS_KEY, JSON.stringify({ u: username, p: passphrase }));
  } catch (_) {}
  _renderDemoCredsBanner(username, passphrase);
}

function _renderDemoCredsBanner(username, passphrase) {
  const banner = document.getElementById('demo-creds-banner');
  if (!banner) return;
  banner.innerHTML = `
    <strong>${esc(t('txt_demo_creds_ready'))}</strong>
    <code class="demo-banner-code">${esc(username)}</code> / <code class="demo-banner-code">${esc(passphrase)}</code>
    <button type="button" class="btn btn-sm" onclick="copyDemoCredsBanner(this)">${esc(t('txt_demo_creds_copy'))}</button>
    <span class="demo-creds-note">${esc(t('txt_demo_creds_save_hint'))}</span>
    <button type="button" class="demo-banner-dismiss" onclick="dismissDemoCredsBanner()" aria-label="${escAttr(t('txt_txt_close'))}">✕</button>
  `;
  banner.style.display = 'block';
}

async function copyDemoCredsBanner(btn) {
  let creds = null;
  try {
    creds = JSON.parse(sessionStorage.getItem(DEMO_CREDS_KEY));
  } catch (_) {}
  if (!creds) return;
  try {
    await navigator.clipboard.writeText(`${creds.u} / ${creds.p}`);
    flashSuccess(btn, t('txt_txt_copied'));
  } catch (_) {}
}

function dismissDemoCredsBanner() {
  try {
    sessionStorage.removeItem(DEMO_CREDS_KEY);
  } catch (_) {}
  const banner = document.getElementById('demo-creds-banner');
  if (banner) {
    banner.style.display = 'none';
    banner.innerHTML = '';
  }
}

/** Re-show the creds banner after a reload if it was never dismissed. */
function restoreDemoCredsBanner() {
  if (typeof isDemoUser !== 'function' || !isDemoUser()) return;
  let creds = null;
  try {
    creds = JSON.parse(sessionStorage.getItem(DEMO_CREDS_KEY));
  } catch (_) {}
  if (creds && creds.u && creds.p) _renderDemoCredsBanner(creds.u, creds.p);
}

/**
 * Hide UI surfaces demo accounts can't use (called from updateAuthUI).
 * Whole sections are hidden; in-form controls are greyed out instead —
 * see _applyDemoCreateLock (admin-create.js).
 */
function applyDemoUiRestrictions() {
  const demo = typeof isDemoUser === 'function' && isDemoUser();
  const lobbyTab = document.getElementById('create-tab-lobby');
  if (lobbyTab) lobbyTab.style.display = demo ? 'none' : '';
  if (typeof _applyDemoCreateLock === 'function') _applyDemoCreateLock();
  initDemoCountdown();
}

// ─── Pinned header stack (sticky status bars) ─────────────
/**
 * Per-view status bars that pin to the top of the page: club detail,
 * Mexicano ops header, Group+Playoff group quick-nav. At most one is
 * visible at a time (the others sit in hidden tab panels).
 */
const _ADMIN_STICKY_BAR_SELECTOR = '.club-status-bar, #mex-ops-header, .group-nav-bar';

/**
 * Publish the pinned header stack's real height as CSS custom properties:
 *   --admin-sticky-top     club-subdomain banner height (the bars pin below it)
 *   --admin-sticky-offset  banner + the visible sticky status bar
 * admin.css turns them into `top:` for the bars and `scroll-padding-top` on
 * <html>, so scrollIntoView() jumps and focus scrolling land below the bar
 * instead of underneath it.
 */
function _syncAdminStickyOffset() {
  const visibleHeight = (el) => {
    if (!el || !el.getClientRects().length) return 0;
    if (getComputedStyle(el).position !== 'sticky') return 0;
    return el.getBoundingClientRect().height;
  };
  const banner = visibleHeight(document.querySelector('.admin-subdomain-banner'));
  let bar = 0;
  document.querySelectorAll(_ADMIN_STICKY_BAR_SELECTOR).forEach(el => {
    bar = Math.max(bar, visibleHeight(el));
  });
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--admin-sticky-top', `${Math.ceil(banner)}px`);
  rootStyle.setProperty('--admin-sticky-offset', `${Math.ceil(banner + bar)}px`);
}

/**
 * Keep the sticky offset current: views re-render their bars via innerHTML
 * (MutationObserver re-binds), and bars change height when they wrap,
 * collapse or get hidden with their tab panel (ResizeObserver).
 */
function _initAdminStickyOffset() {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; _syncAdminStickyOffset(); });
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  let observed = [];
  const rebind = () => {
    const bars = Array.from(document.querySelectorAll(`${_ADMIN_STICKY_BAR_SELECTOR}, .admin-subdomain-banner`));
    if (bars.length === observed.length && bars.every((el, i) => el === observed[i])) return;
    if (resizeObserver) {
      resizeObserver.disconnect();
      bars.forEach(el => resizeObserver.observe(el));
    }
    observed = bars;
  };
  new MutationObserver(() => { rebind(); schedule(); })
    .observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  rebind();
  schedule();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAdminStickyOffset);
} else {
  _initAdminStickyOffset();
}

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
    document.querySelectorAll('.tournament-chip').forEach(b => {
      const isActive = b.dataset.tid === currentTid;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });
  } else {
    document.querySelectorAll('.tournament-chip').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
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
  // The lobby flow is server-blocked for demo accounts — fall back to GP.
  if (mode === 'lobby' && typeof isDemoUser === 'function' && isDemoUser()) mode = 'gp';
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
  toast.className = 'flash-toast' + (isError ? ' flash-toast--error' : '');
  document.body.appendChild(toast);
  const duration = isError ? 3000 : 1800;
  setTimeout(() => {
    toast.classList.add('flash-toast--out');
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
  const tiebreakerKey = type === 'standings' ? 'txt_txt_abbrev_tiebreaker_standings' : 'txt_txt_abbrev_tiebreaker_leaderboard';
  const tiebreakerHtml = `<p class="tiebreaker-note"><strong>${esc(t('txt_txt_abbrev_tiebreaker_title'))}</strong><br>${esc(t(tiebreakerKey))}</p>`;
  return `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>${tiebreakerHtml}`;
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
  const ph = popup.offsetHeight || 200;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
  // Clamp vertically too — near the bottom of a phone screen the popup
  // would otherwise extend past the viewport with no way to scroll to it.
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - ph - 8));
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

document.addEventListener('click', (e) => {
  const p = document.getElementById('abbrev-popup');
  if (p && p.style.display === 'block' && !p.contains(e.target) && e.target !== _abbrevPopupBtn) {
    p.style.display = 'none';
    _abbrevPopupBtn = null;
  }
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

function initTheme() {
  _applyTheme(_loadSavedTheme());
}

// Language and theme are switched from the shared footer Display sheet
// (shared.js); re-render the admin views whenever the language changes.
document.addEventListener('app-language-changed', () => {
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
});

// The language/theme button lives in the shared page header (_mountAdminHeader).
function initLanguageSelector() {
  initLanguage();
}

// ─── Page header (shared with the public pages) ───────────
function _mountAdminHeader() {
  const slot = document.getElementById('admin-public-header');
  if (slot) slot.innerHTML = buildPublicHeaderHtml('admin');
  try { localStorage.setItem('amistoso-last-page', 'admin'); } catch (_) {}
}

// ─── Schema preview ────────────────────────────────────────

/** Debounce timer for the PO-creation auto-preview. */
let _poPreviewTimer = null;

/**
 * Schedule a PO bracket preview refresh with a short debounce.
 * Only fires if the po-preview-result container is visible (i.e. the PO
 * creation panel is active) and there are at least 2 participants.
 */
function _schedulePoPreview() {
  clearTimeout(_poPreviewTimer);
  _poPreviewTimer = setTimeout(() => {
    const panel = document.getElementById('create-panel-po');
    // Only auto-refresh when the PO panel is currently active
    if (!panel || !panel.classList.contains('active')) return;
    if (typeof generatePoPreviewSchema === 'function') generatePoPreviewSchema();
  }, 600);
}

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
        // Allow tap/click to open the lightbox — serialize SVG back to a blob
        // URL so the shared _openBracketLightbox machinery works unchanged.
        svgEl.classList.add('cursor-zoom-in');
        svgEl.title = t('txt_txt_click_to_expand');
        svgEl.addEventListener('click', () => {
          const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
          _openBracketLightbox(URL.createObjectURL(blob));
        });
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
  // Reset rendering sliders to defaults so the preview isn't skewed by a
  // previous session's manual tuning after clicking a preset.
  const defaults = { 'schema-box': '1.0', 'schema-lw': '1.0', 'schema-arrow': '1.0', 'schema-title-scale': '1.0', 'schema-output-scale': '0.7' };
  for (const [id, val] of Object.entries(defaults)) {
    const el = document.getElementById(id);
    if (el) {
      el.value = val;
      // Sync the displayed value label next to each slider
      const valLbl = document.getElementById(id + '-val');
      if (valLbl) valLbl.textContent = val;
    }
  }
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
  const isEspejo = opts.isEspejo === true;
  const isDouble = opts.isDouble === true;
  const useSplit = isEspejo || isDouble;
  const url = _adminBracketUrl(apiBase, tvSettings);
  let h = `<div class="card admin-bracket-card" data-bracket-api="${apiBase}" data-espejo="${isEspejo ? '1' : ''}" data-double="${isDouble ? '1' : ''}">`;
  h += `<div class="admin-bracket-header">`;
  h += `<h2 class="admin-bracket-title">${esc(title)}</h2>`;
  h += `<button type="button" class="btn btn-sm btn-muted" onclick="_jumpToSettings('tv')" title="${escAttr(t('txt_admin_bracket_open_settings_hint'))}">${_ic('settings')} ${esc(t('txt_admin_bracket_tune_btn'))}</button>`;
  h += `</div>`;
  if (useSplit) {
    h += `<div class="espejo-brackets-row">`;
    h += `<div class="espejo-bracket-half">`;
    h += `<div class="espejo-bracket-label">${esc(t('txt_txt_espejo_winners_bracket'))}</div>`;
    h += `<div class="bracket-scroll-wrapper"><img id="admin-bracket-img" class="bracket-img" src="${url}&side=winners" alt="Winners" onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}" onerror="this.style.display='none'"></div>`;
    h += `</div>`;
    h += `<div class="espejo-bracket-half">`;
    h += `<div class="espejo-bracket-label">${esc(t('txt_txt_espejo_losers_bracket'))}</div>`;
    h += `<div class="bracket-scroll-wrapper" id="admin-bracket-losers-wrap">` +
      `<img id="admin-bracket-img-losers" class="bracket-img" src="${url}&side=losers" alt="Losers"` +
      ` onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}"`;
    if (isEspejo) {
      h += ` onerror="this.style.display='none';var p=document.getElementById('admin-bracket-losers-pending');if(p)p.style.display='flex'"`;
    } else {
      h += ` onerror="this.style.display='none'"`;
    }
    h += `>`;
    if (isEspejo) {
      h += `<div id="admin-bracket-losers-pending" class="bracket-pending-note" style="display:none">${esc(t('txt_espejo_lb_pending'))}</div>`;
    }
    h += `</div>`;
    h += `</div>`;
    h += `</div>`;
  } else {
    h += `<div class="bracket-scroll-wrapper">`;
    h += `<img id="admin-bracket-img" class="bracket-img" src="${url}" alt="${escAttr(title)}" onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}" onerror="this.style.display='none'">`;
    h += `</div>`;
  }
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
  const isSplit = card.dataset.espejo === '1' || card.dataset.double === '1';
  img.style.display = '';
  img.src = _adminBracketUrl(apiBase, tvSettings) + (isSplit ? '&side=winners' : '');
  // For split brackets (espejo or DE): refresh the losers bracket image too.
  const losersImg = document.getElementById('admin-bracket-img-losers');
  if (losersImg && isSplit) {
    losersImg.style.opacity = '1';
    losersImg.src = _adminBracketUrl(apiBase, tvSettings) + '&side=losers';
  }
  // Keep schema builder sliders in sync with TV settings so both preview
  // surfaces always reflect the same rendering configuration.
  _syncSchemaBuilderFromTvSettings(tvSettings);
}

/**
 * Copy the current TV rendering settings into the Info-tab schema builder
 * sliders so the two preview surfaces stay in sync.
 * Only updates inputs that exist (builder may not be loaded yet).
 */
function _syncSchemaBuilderFromTvSettings(tvSettings) {
  const s = tvSettings || {};
  const pairs = [
    ['schema-fmt',          s.schema_format,           null],
    ['schema-box',          s.schema_box_scale,        'schema-box-val'],
    ['schema-lw',           s.schema_line_width,       'schema-lw-val'],
    ['schema-arrow',        s.schema_arrow_scale,      'schema-arrow-val'],
    ['schema-title-scale',  s.schema_title_font_scale, 'schema-title-scale-val'],
    ['schema-output-scale', s.schema_output_scale,     'schema-output-scale-val'],
  ];
  for (const [id, val, lblId] of pairs) {
    if (val === undefined || val === null) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = val;
    if (lblId) {
      const lbl = document.getElementById(lblId);
      if (lbl) lbl.textContent = typeof val === 'number' ? val.toFixed(1) : val;
    }
  }
}

async function generatePoPreviewSchema() {
  const names = getParticipantNames('po');
  const resultEl = document.getElementById('po-preview-result');
  const msgEl = document.getElementById('po-preview-msg');
  msgEl.classList.add('hidden');
  if (typeof _updatePoMatchEstimate === 'function') _updatePoMatchEstimate();
  if (names.length < 2) {
    resultEl.innerHTML = '';
    return;
  }
  resultEl.innerHTML = `<em>${t('txt_txt_generating')}</em>`;
  try {
    const isEspejo = document.getElementById('po-espejo')?.checked || false;
    const elim = (!isEspejo && document.getElementById('po-double-elim').checked) ? 'double' : 'single';
    // Read rendering options from the schema builder sliders if present.
    const numOpt = (id, fallback) => {
      const el = document.getElementById(id);
      return el ? +el.value : fallback;
    };
    const fmt         = document.getElementById('schema-fmt')?.value || 'png';
    const boxScale    = numOpt('schema-box',          1.0);
    const lineWidth   = numOpt('schema-lw',           1.0);
    const arrowScale  = numOpt('schema-arrow',        1.0);
    const titleScale  = numOpt('schema-title-scale',  1.0);
    const outputScale = numOpt('schema-output-scale', 0.7);
    const title       = document.getElementById('schema-title')?.value?.trim() || '';

    const winnerOpts = _gpReadWinnerControls('po');
    const _buildParams = (participantNames, extraTitle, withWinnerOpts = true) => {
      const p = new URLSearchParams({
        participants: participantNames.length,
        elimination: 'single',
        fmt,
        box_scale: boxScale,
        line_width: lineWidth,
        arrow_scale: arrowScale,
        title_font_scale: titleScale,
        output_scale: outputScale,
      });
      if (withWinnerOpts) {
        if (winnerOpts.num_winners > 1) p.set('num_winners', winnerOpts.num_winners);
        if (winnerOpts.third_place) p.set('third_place', 'true');
      }
      const t_ = extraTitle || title;
      if (t_) p.set('title', t_);
      for (const n of participantNames) p.append('names', n);
      return p;
    };

    if (isEspejo) {
      // Espejo preview: winners bracket with real names, losers bracket with
      // anonymous "Loser N" seeds — we don't know the R1 losers yet.
      const wbNames = names;
      const lbCount = Math.floor(names.length / 2);
      // Anonymous loser seeds for the LB structural preview.
      const lbNames = Array.from({ length: lbCount }, (_, i) => `Loser ${i + 1}`);

      const wbUrl = `/api/schema/playoff-preview?${_buildParams(wbNames, title || t('txt_txt_espejo_winners_bracket'))}`;

      let wbHtml = '', lbHtml = '';

      // Fetch WB always; only fetch LB when there are ≥2 losers to show.
      const fetchWb = fetch(wbUrl);
      const fetchLb = lbCount >= 2 ? fetch(`/api/schema/playoff-preview?${_buildParams(lbNames, t('txt_txt_espejo_losers_bracket'), false)}`) : null;
      const [wbRes, lbRes] = await Promise.all([fetchWb, fetchLb || Promise.resolve(null)]);

      if (!wbRes.ok) throw new Error((await wbRes.json().catch(() => ({}))).detail || 'Error');
      if (lbRes && !lbRes.ok) throw new Error((await lbRes.json().catch(() => ({}))).detail || 'Error');

      const _renderBracketResponse = async (res, altText) => {
        if (!res) return `<p class="settings-help m-0 mt-2 mb-2">${t('txt_txt_espejo_approx_losers')}: ${t('txt_txt_need_at_least_2_participants')}</p>`;
        if (fmt === 'svg') {
          const wrap = document.createElement('div');
          wrap.innerHTML = await res.text();
          const svgEl = wrap.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
            svgEl.classList.add('bracket-svg');
            svgEl.classList.add('cursor-zoom-in');
            svgEl.title = t('txt_txt_click_to_expand');
            svgEl.addEventListener('click', () => {
              const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
              _openBracketLightbox(URL.createObjectURL(blob));
            });
          }
          return wrap.innerHTML;
        } else {
          const blobUrl = URL.createObjectURL(await res.blob());
          return `<img class="bracket-img" src="${blobUrl}" alt="${escAttr(altText)}" onclick="_openBracketLightbox('${blobUrl}')" title="${t('txt_txt_click_to_expand')}">`;
        }
      };

      wbHtml = await _renderBracketResponse(wbRes, t('txt_txt_espejo_winners_bracket'));
      lbHtml = await _renderBracketResponse(lbRes, t('txt_txt_espejo_losers_bracket'));

      resultEl.innerHTML =
        `<div class="espejo-brackets-row">` +
        `<div class="espejo-bracket-half"><div class="espejo-bracket-label">${esc(t('txt_txt_espejo_winners_bracket'))}</div>${wbHtml}</div>` +
        `<div class="espejo-bracket-half"><div class="espejo-bracket-label">${esc(t('txt_txt_espejo_losers_bracket'))}${lbCount >= 2 ? ` <small class="espejo-label-hint">(~${lbCount} ${t('txt_txt_espejo_approx_losers')})</small>` : ''}</div>${lbHtml}</div>` +
        `</div>`;
      return;
    }

    const params = _buildParams(names, title);
    params.set('elimination', elim);
    const url = `/api/schema/playoff-preview?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');

    if (fmt === 'pdf') {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (title || 'bracket') + '.pdf';
      a.click();
      resultEl.innerHTML = `<em>${t('txt_txt_pdf_downloaded')}</em>`;
    } else if (fmt === 'svg') {
      resultEl.innerHTML = await res.text();
      const svgEl = resultEl.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.classList.add('bracket-svg');
        svgEl.classList.add('cursor-zoom-in');
        svgEl.title = t('txt_txt_click_to_expand');
        svgEl.addEventListener('click', () => {
          const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
          _openBracketLightbox(URL.createObjectURL(blob));
        });
      }
    } else {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      resultEl.innerHTML = `<details class="bracket-collapse bracket-collapse-left" open><summary class="bracket-collapse-summary"><span class="bracket-chevron bracket-chevron-anim">&#9654;</span>${t('txt_txt_play_off_bracket')}</summary><img class="bracket-img" src="${blobUrl}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox('${blobUrl}')" title="${t('txt_txt_click_to_expand')}"></details>`;
    }
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
  const enClass = 'lang-toggle-opt lang-toggle-opt--first' + (isEn ? ' lang-toggle-opt--active' : '');
  const esClass = 'lang-toggle-opt lang-toggle-opt--last' + (!isEn ? ' lang-toggle-opt--active' : '');
  const handler = context === 'reg' ? '_setRegLang' : '_setSecLang';
  return `<span class="lang-toggle">`
    + `<span class="${enClass}" onclick="${handler}('${esc(parentId)}','${esc(playerId)}','en',this.parentElement)" title="${t('txt_txt_english')}">EN</span>`
    + `<span class="${esClass}" onclick="${handler}('${esc(parentId)}','${esc(playerId)}','es',this.parentElement)" title="${t('txt_txt_spanish')}">ES</span>`
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
}

function _formatActivityTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
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

// ─── Tournament status bar (GP / Play-offs / Mexicano) ────────────────────
/**
 * Counts shown in the tournament status bar for the matches of the active
 * phase: completed / total, plus the review items (disputes and scores
 * waiting for confirmation or for an off-format review).
 *
 * @param {object[]} matches  Matches of the phase the bar summarises.
 * @returns {{completed: number, total: number, review: number}}
 */
function _buildOpsStats(matches) {
  const list = matches || [];
  const unresolved = list.filter(m => m.status !== 'completed');
  const review = unresolved.filter(m => m.disputed
    || (m.score && m.scored_by && !m.score_confirmed)
    || m.format_review).length;
  return {
    completed: list.length - unresolved.length,
    total: list.length,
    review,
  };
}

/**
 * Current round of every play-off bracket still in progress, for the status
 * bar: [{side: "Winners", round: "Semi-Final", completed: 1, total: 2}] (side
 * is '' for a single bracket and the Grand / Super Final). Espejo matches carry
 * `bracket_side`; double-elimination ones are labelled "Winners R2" /
 * "Losers R1". While a Winners or Losers bracket is running, only those are
 * listed: the Grand / Super Final that joins them follows once both are done.
 *
 * @param {object[]} matches  Play-off matches in bracket order.
 * @returns {{side: string, round: string, completed: number, total: number}[]}
 */
function _buildBracketRounds(matches) {
  const sides = { winners: [], losers: [], main: [] };
  for (const m of matches || []) {
    const label = m.round_label || '';
    const elim = /^(Winners|Losers) (R\d+)$/.exec(label);
    if (m.bracket_side === 'winners' || m.bracket_side === 'losers') {
      sides[m.bracket_side].push({ m, round: label });
    } else if (elim) {
      sides[elim[1].toLowerCase()].push({ m, round: elim[2] });
    } else {
      sides.main.push({ m, round: label });
    }
  }
  const currentRound = (entries, side) => {
    const order = [];
    const byRound = {};
    for (const { m, round } of entries) {
      if (!byRound[round]) { byRound[round] = []; order.push(round); }
      byRound[round].push(m);
    }
    for (const round of order) {
      const list = byRound[round];
      const completed = list.filter(m => m.status === 'completed').length;
      if (completed < list.length) {
        return { side, round, completed, total: list.length };
      }
    }
    return null;
  };
  const split = [
    currentRound(sides.winners, t('txt_admin_status_bracket_winners')),
    currentRound(sides.losers, t('txt_admin_status_bracket_losers')),
  ].filter(Boolean);
  if (split.length) return split;
  const main = currentRound(sides.main, '');
  return main ? [main] : [];
}

/** Phone form of a bracket round name ("Quarter-Final" -> "Quarters"); others unchanged. */
function _shortRoundLabel(round) {
  const keys = {
    'Quarter-Final': 'txt_admin_round_short_quarter',
    'Semi-Final': 'txt_admin_round_short_semi',
    '3rd Place': 'txt_admin_round_short_third',
  };
  if (keys[round]) return t(keys[round]);
  const roundOf = /^Round of (\d+)$/.exec(round);
  return roundOf ? t('txt_admin_round_short_of_n', { n: roundOf[1] }) : round;
}

/** Full round name, plus its phone form when that is shorter (CSS picks one). */
function _roundNameHtml(round) {
  const short = _shortRoundLabel(round);
  if (short === round) return esc(round);
  return `<span class="ops-bar-round-full">${esc(round)}</span><span class="ops-bar-round-short">${esc(short)}</span>`;
}

/**
 * One "[round] 3/8 [matches]" progress group of the status bar. A bracket
 * side ("Winners") sits as a small caption above the round name.
 */
function _renderOpsBarProgress(completed, total, round = '', side = '') {
  const count = t('txt_admin_status_matches_short', { done: completed, total });
  const roundLabel = [side, round].filter(Boolean).join(' ');
  const label = roundLabel ? `${roundLabel}: ${count}` : count;
  const doneCls = completed === total ? ' is-done' : '';
  let html = `<div class="ops-bar-progress${doneCls}" role="status" aria-label="${escAttr(label)}" title="${escAttr(label)}">`;
  if (round) {
    html += `<span class="ops-bar-round" aria-hidden="true">`
      + (side ? `<span class="ops-bar-side">${esc(side)}</span>` : '')
      + `<span class="ops-bar-round-name">${_roundNameHtml(round)}</span></span>`;
  }
  html += `<span class="ops-bar-count" aria-hidden="true"><span class="ops-bar-figure">${completed}/${total}</span>`
    + `<span class="ops-bar-unit">${esc(t('txt_admin_status_matches_unit'))}</span></span>`;
  html += `</div>`;
  return html;
}

/**
 * Slim one-row status bar at the top of a tournament view: the phase
 * ("Round 2/8", "Group stage"), "12/30 matches" ("No matches yet" before any
 * exist), a review chip (only while
 * disputes / unconfirmed scores exist; scrolls to the review queue) and an
 * icon-only Settings gear. During play-offs, pass `rounds` (from
 * `_buildBracketRounds`): each bracket's current round then gets its own
 * progress group in place of the phase and the overall count.
 *
 * @param {object} opts
 * @param {string} opts.id            DOM id ('gp-ops-header' | 'po-ops-header' | 'mex-ops-header').
 * @param {{completed: number, total: number, review: number}} opts.stats  From `_buildOpsStats`.
 * @param {string} opts.reviewCardId  DOM id of the review queue card to scroll to.
 * @param {string} [opts.phase]       Plain-text phase label; omitted when empty.
 * @param {{side: string, round: string, completed: number, total: number}[]} [opts.rounds]  Bracket rounds in progress.
 * @returns {string} HTML
 */
function _renderTournamentStatusBar({ id, stats, reviewCardId, phase = '', rounds = [] }) {
  const { completed, total, review } = stats;
  let html = `<div class="card tournament-status-bar ops-bar" id="${id}">`;
  if (rounds.length) {
    for (const r of rounds) html += _renderOpsBarProgress(r.completed, r.total, r.round, r.side);
  } else {
    if (phase) html += `<span class="ops-bar-phase">${esc(phase)}</span>`;
    html += total > 0
      ? _renderOpsBarProgress(completed, total)
      : `<span class="ops-bar-empty">${esc(t('txt_admin_status_no_matches'))}</span>`;
  }
  if (review > 0) {
    const label = review === 1
      ? t('txt_admin_status_attention_one')
      : t('txt_admin_status_attention', { n: review });
    html += `<button type="button" class="gp-ops-attention ops-bar-review" onclick="document.getElementById('${reviewCardId}')?.scrollIntoView({behavior:'smooth', block:'center'})">`;
    html += `<span class="gp-ops-attention-icon" aria-hidden="true">${_ic('alert')}</span>${esc(label)}`;
    html += `</button>`;
  }
  const settingsLabel = escAttr(t('txt_admin_status_jump_settings'));
  html += `<button type="button" class="btn btn-sm compact-icon-btn status-bar-settings-btn ops-bar-settings" onclick="_jumpToSettings('tv')" aria-label="${settingsLabel}" title="${settingsLabel}">${_ic('settings')}</button>`;
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

/**
 * Themed replacement for window.confirm() — same look as the
 * delete-tournament modal (.modal-overlay / .modal-dialog / .modal-actions).
 *
 * @param {string}  message        Question shown to the user (plain text).
 * @param {object}  [opts]
 * @param {boolean} [opts.danger]  Style the confirm button as destructive.
 * @param {string}  [opts.title]   Optional dialog title.
 * @param {string}  [opts.confirmLabel] Confirm button label (defaults to
 *                                 Delete for danger, Confirm otherwise).
 * @returns {Promise<boolean>} true when confirmed, false otherwise.
 */
function uiConfirm(message, opts = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return Promise.resolve(window.confirm(message));
  }
  const danger = !!opts.danger;
  const confirmLabel = opts.confirmLabel || t(danger ? 'txt_txt_delete' : 'txt_txt_confirm_score');
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-md ui-confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleHtml = opts.title
      ? `<div class="modal-header"><h2 class="modal-title">${esc(opts.title)}</h2></div>`
      : '';
    dialog.innerHTML = `
      ${titleHtml}
      <p class="ui-confirm-message">${esc(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-muted" data-action="cancel">${esc(t('txt_txt_cancel'))}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${esc(confirmLabel)}</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let resolved = false;
    function finish(result) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') finish(false);
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) finish(false); });
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
    // Focus the safe action first so Enter doesn't accidentally destroy.
    dialog.querySelector('[data-action="cancel"]').focus();
  });
}


// ─── Club admin Events card: pure row derivation ──────────
// BEGIN deriveEventRows (kept dependency-free: scripts/verify_club_events_logic.mjs
// extracts this block and runs it under node).

/** Tabs of the club admin Events card, keyed by row state. */
const CLUB_EVENT_TAB_OF_STATE = {
  live: 'active',
  ready_to_convert: 'active',
  open_registration: 'active',
  upcoming: 'active',
  finished: 'finished',
  closed: 'finished',
  archived: 'archived',
};

/**
 * Derive the rows of the club admin "Events" card from the browser-side data.
 *
 * Filters by `club_id === clubId` (never by community). One row per
 * tournament; a closed lobby whose converted tournaments are all visible gets
 * no row of its own (its tournaments carry `fromLobby`). A lobby still open
 * after a partial conversion keeps its row. A closed lobby with no visible
 * converted tournament (never converted, or the tournament was deleted) is
 * `ready_to_convert` with 2+ registrants, else a plain `closed` row. Public
 * items the user cannot edit (from the club's public list) are appended as
 * read-only rows.
 *
 * @param {object[]} tournaments   /api/tournaments items
 * @param {object[]} registrations /api/registrations?include_archived=1 items
 * @param {{clubId: string, publicItems?: object[], authUser?: string|null, admin?: boolean}} opts
 * @returns {object[]} rows: {key, kind, id, name, sport, type, alias, state, tab,
 *   isPublic, canEdit, seasonId, communityId, fromLobby, registrantCount, createdAt}
 */
function deriveEventRows(tournaments, registrations, opts = {}) {
  const clubId = opts.clubId;
  const publicItems = Array.isArray(opts.publicItems) ? opts.publicItems : [];
  const authUser = opts.authUser || null;
  const admin = Boolean(opts.admin);
  const T = (Array.isArray(tournaments) ? tournaments : []).filter(t => t && t.club_id === clubId);
  const R = (Array.isArray(registrations) ? registrations : []).filter(r => r && r.club_id === clubId);
  const tIds = new Set(T.map(t => t.id));
  const lobbyByTid = new Map();
  for (const r of R) {
    for (const tid of (Array.isArray(r.converted_to_tids) ? r.converted_to_tids : [])) {
      if (!lobbyByTid.has(tid)) lobbyByTid.set(tid, r);
    }
  }
  const rows = [];
  for (const t of T) {
    const phase = String(t.phase || '');
    let state = 'live';
    if (phase === 'finished') state = 'finished';
    else if (phase === 'setup' && t.type === 'group_playoff') state = 'upcoming';
    const lobby = lobbyByTid.get(t.id) || null;
    rows.push({
      key: 'tn:' + t.id,
      kind: 'tournament',
      id: t.id,
      name: t.name || '',
      sport: t.sport || 'padel',
      type: t.type || 'group_playoff',
      alias: t.alias || null,
      state,
      tab: CLUB_EVENT_TAB_OF_STATE[state],
      isPublic: t.public !== false,
      canEdit: admin || (authUser !== null && t.owner === authUser) || t.shared === true,
      seasonId: t.season_id || null,
      communityId: t.community_id || 'open',
      fromLobby: lobby ? { id: lobby.id, name: lobby.name || '' } : null,
      registrantCount: null,
      createdAt: t.created_at || '',
    });
  }
  for (const r of R) {
    const tids = Array.isArray(r.converted_to_tids) ? r.converted_to_tids : [];
    const visibleConverted = tids.filter(tid => tIds.has(tid));
    const count = Number(r.registrant_count) || 0;
    let state;
    if (r.archived) state = 'archived';
    else if (r.open) state = 'open_registration';
    else if (visibleConverted.length) continue; // represented by its tournament rows
    else state = count >= 2 ? 'ready_to_convert' : 'closed';
    rows.push({
      key: 'reg:' + r.id,
      kind: 'lobby',
      id: r.id,
      name: r.name || '',
      sport: r.sport || 'padel',
      type: 'registration',
      alias: r.alias || null,
      state,
      tab: CLUB_EVENT_TAB_OF_STATE[state],
      // A lobby is "public" on the club page only while it is open and listed.
      isPublic: Boolean(r.open) && r.listed !== false && r.listed !== 0 && !r.archived,
      canEdit: true, // /api/registrations only returns own + shared lobbies
      seasonId: r.season_id || null,
      communityId: r.community_id || 'open',
      fromLobby: null,
      registrantCount: count,
      createdAt: r.created_at || '',
    });
  }
  const seen = new Set(rows.map(r => r.key));
  const publicState = { in_progress: 'live', upcoming: 'upcoming', finished: 'finished', open_registration: 'open_registration' };
  for (const it of publicItems) {
    if (!it || !it.id) continue;
    const isLobby = it.kind === 'registration';
    const key = it.pin_key || ((isLobby ? 'reg:' : 'tn:') + it.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const state = publicState[it.status] || 'live';
    rows.push({
      key,
      kind: isLobby ? 'lobby' : 'tournament',
      id: it.id,
      name: it.name || '',
      sport: it.sport || 'padel',
      type: it.type || (isLobby ? 'registration' : 'group_playoff'),
      alias: it.alias || null,
      state,
      tab: CLUB_EVENT_TAB_OF_STATE[state],
      isPublic: true,
      canEdit: false,
      seasonId: null,
      communityId: null,
      fromLobby: null,
      registrantCount: isLobby ? (Number(it.registrant_count) || 0) : null,
      createdAt: '',
    });
  }
  return rows;
}
// END deriveEventRows

// BEGIN deriveAttachCandidates (dependency-free, exercised by scripts/verify_club_events_logic.mjs)
/**
 * Suggestions for the club admin "Attach existing" panel.
 *
 * Only events the user can edit that belong to NO club yet are suggested —
 * an event in another club has to be removed there first ("Remove from
 * club"), so clubs never silently steal each other's events. Dismissed keys
 * are split out so the UI can offer "Show dismissed" + Restore.
 *
 * @param {object[]} tournaments   /api/tournaments items
 * @param {object[]} registrations /api/registrations?include_archived=1 items
 * @param {{clubId: string, clubCommunityId?: string, authUser?: string|null, admin?: boolean,
 *          dismissed?: string[], query?: string, communityName?: (id: string) => string}} opts
 * @returns {{candidates: object[], dismissed: object[]}} both sorted newest first; items are
 *   {key, kind, id, name, communityId, communityName, createdAt, movesCommunity, dismissed}
 */
function deriveAttachCandidates(tournaments, registrations, opts = {}) {
  const clubId = opts.clubId;
  const clubCommunityId = opts.clubCommunityId || 'open';
  const authUser = opts.authUser || null;
  const admin = Boolean(opts.admin);
  const dismissedKeys = new Set(Array.isArray(opts.dismissed) ? opts.dismissed : []);
  const q = (opts.query || '').trim().toLowerCase();
  const commName = typeof opts.communityName === 'function' ? opts.communityName : () => '';
  const canEdit = (t) => admin || (authUser !== null && t.owner === authUser) || t.shared === true;
  const item = (key, kind, src) => {
    const communityId = src.community_id || 'open';
    return {
      key, kind, id: src.id, name: src.name || '', communityId,
      communityName: commName(communityId) || '',
      createdAt: src.created_at || '',
      movesCommunity: communityId !== clubCommunityId,
      dismissed: dismissedKeys.has(key),
    };
  };
  const all = [];
  for (const t of (Array.isArray(tournaments) ? tournaments : [])) {
    if (!t || t.club_id || t.club_id === clubId) continue; // already in a club (this or another)
    if (!canEdit(t)) continue;
    all.push(item('tn:' + t.id, 'tournament', t));
  }
  for (const r of (Array.isArray(registrations) ? registrations : [])) {
    if (!r || r.club_id || r.archived) continue;
    all.push(item('reg:' + r.id, 'lobby', r));
  }
  const matches = (it) => !q || `${it.name} ${it.communityName}`.toLowerCase().includes(q);
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (a.name || '').localeCompare(b.name || ''));
  return {
    candidates: all.filter(it => !it.dismissed && matches(it)),
    dismissed: all.filter(it => it.dismissed && matches(it)),
  };
}
// END deriveAttachCandidates
