const API = '';

// ── Remember this page for the root redirect ──────────────
try { localStorage.setItem('amistoso-last-page', 'events'); } catch (_) {}

// ── Theme ─────────────────────────────────────────────────
_applyTheme(_loadSavedTheme());
let _lang = _loadSavedLanguage();
setAppLanguage(_lang);

// Both the Events page and the live board use the shared footer Display line
// (shared.js); this keeps the module's language in sync with it.

document.addEventListener('app-language-changed', () => {
  _lang = getAppLanguage();
  if (TID) loadTV();
  else if (typeof _pickerStore !== 'undefined') _pickerStore.lang = _lang;
});

// ── URL params ────────────────────────────────────────────
const _params = new URLSearchParams(location.search);
// Extract slug from path: /tv/<slug>
const _pathSlug = (() => {
  const m = location.pathname.match(/^\/tv\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
})();
// Legacy query-param support (?tid= / ?t=) kept for backwards compat
let TID = _params.get('tid') || null;
const _aliasParam = _params.get('t') || (!TID ? _pathSlug : null);

// ── State ─────────────────────────────────────────────────
const tvState = {
  tournamentType: null,
  tournamentName: '',
  tournamentSport: 'padel',
  tournamentAlias: null,    // alias string or null
  refreshIntervalSecs: 15,
  countdown: 15,
  countdownInterval: null,
  isRefreshing: false,
  breakdowns: {},           // {match_id: {...}} for Mex breakdowns
  playerMap: {},            // {player_id: player_name}
  sectionOpenState: {},     // {data-tv-key: boolean} — persisted across refreshes
  lastKnownVersion: null,   // for on-update mode
  scoreMode: {},            // {ctx: 'points'|'sets'} from admin TV settings
  setDecider: 'full_set',   // tournament default third-set decider (tv_settings.set_decider)
  totalPts: 0,              // total_points_per_match for Mexicano auto-fill
  matchTargets: {},         // match id → effective points target (per-match override)
  matchDeciders: {},        // match id → third-set decider in effect ('full_set' | 'match_tiebreak')
  versionPollTimer: null,   // setInterval handle for version polling
  pickerPollTimer: null,    // setInterval handle for picker auto-refresh
  // Player auth state
  playerJwt: null,          // JWT string
  playerId: null,           // player ID from auth response
  playerName: null,         // player name from auth response
  allowPlayerScoring: true, // controlled by admin TV setting
  teamRoster: null,         // {team_pid: [member_pid, ...]} for composite teams
  abbrevPopupBtn: null,     // currently active abbreviation popup button
  playerOpponents: [],      // [{player_id, name, contact, match_id, round_number}]
  playerOpponentsLoaded: false, // whether we have fetched at least once
  playerPanelOpen: false,   // whether the expand panel was open (survives re-renders)
  scoreConfirmationMode: 'immediate', // 'immediate' or 'required'
  correctionWindowSecs: 0,           // correction window duration from TV settings
  // Mexicano leaderboard sort state
  mexLeaderboard: [],       // cached leaderboard rows for client-side sort
  mexTeamMode: false,       // mirrors status.team_mode
  mexSortCol: null,         // null = server default order
  mexSortDir: 'desc',       // 'asc' | 'desc'
  _pendingReload: false,    // true when SSE detected a change while tab was hidden
  clubLogoUrl: null,        // club logo URL for the current tournament (or null)
  clubLogoVersion: 0,       // cache-bust token updated when logo source context changes
  clubLogoKey: '',          // branding key to detect logo context changes
  communityName: null,
  clubName: null,
};

// ── In-flight guards for version polling ──────────────────
let _tvVersionFetching = false;
let _tokenLoginFailed = false;     // set when QR/email auto-login fails
let _pickerFetching = false;
let _tvVersionEtag = null;
let _pickerVersionEtag = null;
const _TV_VERSION_POLL_INTERVAL_MS = 3000;
const _TV_PICKER_POLL_INTERVAL_MS = 3000;
// SSE stream controllers — closed on teardown / navigation.
let _tvVersionStream = null;
let _pickerVersionStream = null;
// ── Events directory island (public /events page) ─────────
// Shown when no tournament is selected. `_pickerStore` holds the raw list from
// /api/public-events + UI state (tab, sport); the markup is bound in
// `#tv-picker-island` (injected into #tv-root by _renderPickerHtml, card
// template #tpl-tv-picker-item in public.html). SSE/polling (_showPicker's
// onVersion) and the tab/sport controls mutate the store instead of
// rebuilding HTML. The live panel still owns #tv-root via innerHTML when a
// tournament is selected — the two views are mutually exclusive, so the island
// shell is re-injected + re-mounted each time the directory is shown (a fresh
// element, so mountIsland's double-mount guard is a no-op) while the store
// itself persists across mounts.
const _EVENTS_TAB_KEY = 'amistoso-events-tab';
const _EVENTS_SPORT_KEY = 'amistoso-events-sport';
const _EVENTS_LIVE_STATUSES = new Set(['in_progress', 'open_registration', 'upcoming']);

function _savedEventsTab() {
  try {
    const v = localStorage.getItem(_EVENTS_TAB_KEY);
    if (v === 'live' || v === 'finished') return v;
  } catch (_) {}
  return 'live';
}

function _savedEventsSport() {
  try {
    const v = localStorage.getItem(_EVENTS_SPORT_KEY);
    if (v === 'padel' || v === 'tennis') return v;
  } catch (_) {}
  return null;
}

const _pickerStore = reactiveStore({
  events: [],            // raw list from /api/public-events
  tab: _savedEventsTab(),      // 'live' | 'finished'
  sport: _savedEventsSport(),  // null = both, 'padel' | 'tennis'
  findValue: '',
  findError: '',         // inline not-found / error message under the find box
  finding: false,
  lang: 'en',            // tracked so t() bindings re-render on language switch

  // Lang-tracking t() wrapper (petite-vue only re-renders on reactive reads).
  t(key, params) { void this.lang; return window.t(key, params); },

  get headerHtml() { void this.lang; return buildPublicHeaderHtml('events'); },

  _forTab(tab) {
    return this.events.filter(it => {
      const isLive = _EVENTS_LIVE_STATUSES.has(it.status);
      const tabMatch = tab === 'live' ? isLive : !isLive;
      const sportMatch = !this.sport || !it.sport || it.sport === this.sport;
      return tabMatch && sportMatch;
    });
  },
  get liveCount() { return this._forTab('live').length; },
  get finishedCount() { return this._forTab('finished').length; },
  get visible() { return this._forTab(this.tab); },
  // Live tab: "Tournaments" + "Sign-ups open" groups (shared rule with the club page).
  get groups() { void this.lang; return publicEventGroups(this.visible); },
  get emptyLabel() {
    return this.t(this.tab === 'live' ? 'txt_events_empty_live' : 'txt_events_empty_finished');
  },

  setTab(tab) {
    if (tab !== 'live' && tab !== 'finished') return;
    this.tab = tab;
    try { localStorage.setItem(_EVENTS_TAB_KEY, tab); } catch (_) {}
  },
  toggleSport(sport) {
    this.sport = this.sport === sport ? null : sport;
    try {
      if (this.sport) localStorage.setItem(_EVENTS_SPORT_KEY, this.sport);
      else localStorage.removeItem(_EVENTS_SPORT_KEY);
    } catch (_) {}
  },
  // Never land on an empty tab when the other one has items.
  _settleTab() {
    if (this.tab === 'live' && this.liveCount === 0 && this.finishedCount > 0) this.tab = 'finished';
    else if (this.tab === 'finished' && this.finishedCount === 0 && this.liveCount > 0) this.tab = 'live';
  },

  // Per-item view-model for the card template.
  item(it) {
    void this.lang;
    return {
      name: it.name,
      status: it.status,
      pinned: false, // pins are a per-club concept; the directory lists every club
      href: publicEventHref(it),
      badges: publicEventBadges(it, { hideSport: Boolean(this.sport) }),
      origin: it.club_name || ((it.community_id && it.community_id !== 'open') ? (it.community_name || '') : ''),
    };
  },

  refresh() { _showPicker(); },
  submitFind(e) { return _findEventById(e); },
});

function _tvLabel() {
  return tvState.tournamentSport === 'tennis' ? t('txt_txt_tennis_tv') : t('txt_txt_padel_tv');
}

function _tvLogoSrc(url) {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${tvState.clubLogoVersion || 0}`;
}

function _tvIdentityLabel() {
  return tvState.clubName || tvState.communityName || '';
}

/** Returns true if a player score entry form is currently open */
function _hasOpenScoreForm() {
  return !!document.querySelector('.score-form-body:not(.hidden)');
}

function _playerStorageKey() { return `padel-player-${TID}`; }

function _readPlayerSessionRaw() {
  const key = _playerStorageKey();
  if (!key) return null;
  try {
    const localValue = localStorage.getItem(key);
    if (localValue) return localValue;
  } catch (_) {}
  try {
    const sessionValue = sessionStorage.getItem(key);
    if (sessionValue) {
      try { localStorage.setItem(key, sessionValue); } catch (_) {}
      return sessionValue;
    }
  } catch (_) {}
  return null;
}

function _writePlayerSessionRaw(value) {
  const key = _playerStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
  }
}

function _removePlayerSessionRaw() {
  const key = _playerStorageKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch (_) {}
  try { sessionStorage.removeItem(key); } catch (_) {}
}

function _loadPlayerSession() {
  if (!TID) return;
  try {
    const raw = _readPlayerSessionRaw();
    if (!raw) return;
    const data = JSON.parse(raw);
    tvState.playerJwt = data.jwt || null;
    tvState.playerId = data.playerId || null;
    tvState.playerName = data.playerName || null;
    tvState.playerHasHubProfile = data.hasHubProfile;
    tvState.playerLoginPassphrase = data.loginPassphrase || null;
    tvState.hubPassphrase = data.hubPassphrase || null;
    tvState.hubAccessToken = data.hubAccessToken || null;
  } catch { _clearPlayerSession(); }
}

function _savePlayerSession() {
  if (!TID || !tvState.playerJwt) return;
  _writePlayerSessionRaw(JSON.stringify({
    jwt: tvState.playerJwt,
    playerId: tvState.playerId,
    playerName: tvState.playerName,
    hasHubProfile: tvState.playerHasHubProfile,
    loginPassphrase: tvState.playerLoginPassphrase,
    hubPassphrase: tvState.hubPassphrase,
    hubAccessToken: tvState.hubAccessToken,
  }));
}

function _clearPlayerSession() {
  tvState.playerJwt = null; tvState.playerId = null; tvState.playerName = null;
  tvState.playerOpponents = []; tvState.playerOpponentsLoaded = false;
  tvState.playerHasHubProfile = undefined;
  tvState.playerLoginPassphrase = null;
  tvState.hubPassphrase = null;
  tvState.hubAccessToken = null;
  try {
    const key = _hubCtaDismissedKey();
    if (key) sessionStorage.removeItem(key);
  } catch (_) {}
  _removePlayerSessionRaw();
}

function _isPlayerLoggedIn() { return !!tvState.playerJwt; }

/** Check whether a match involves the authenticated player (direct or via team_roster composite expansion) */
function _playerIsInMatch(m) {
  if (!tvState.playerId) return false;
  const roster = tvState.teamRoster || {};
  const t1Ids = _expandTeamIds(m.team1_ids || [], roster);
  const t2Ids = _expandTeamIds(m.team2_ids || [], roster);
  return t1Ids.has(tvState.playerId) || t2Ids.has(tvState.playerId);
}

/** Authenticate using passphrase or token */
async function _playerAuth(passphrase, token) {
  const body = {};
  if (passphrase) body.passphrase = passphrase;
  if (token) body.token = token;
  const res = await fetch(`${API}/api/tournaments/${TID}/player-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Authentication failed');
  }
  const data = await res.json();
  tvState.playerJwt = data.access_token;
  tvState.playerId = data.player_id;
  tvState.playerName = data.player_name;
  tvState.playerHasHubProfile = !!data.has_hub_profile;
  // Stash the passphrase used to log in so the hub-CTA banner can deep-link
  // it into /player. Token-only logins leave this null (banner stays hidden).
  tvState.playerLoginPassphrase = passphrase || null;
  // Stash the linked Hub profile credentials so the player menu can show
  // the passphrase and offer one-click auto-login to the Hub. Null when
  // there is no real (non-ghost) Hub profile linked.
  tvState.hubPassphrase = data.hub_passphrase || null;
  tvState.hubAccessToken = data.hub_access_token || null;
  _savePlayerSession();
  _setNoProfileAutoLogin(false);
  return data;
}

/** Authenticated fetch for player score submission */
async function _playerApi(path, opts = {}) {
  if (!tvState.playerJwt) throw new Error('Not authenticated');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  headers['Authorization'] = `Bearer ${tvState.playerJwt}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    _clearPlayerSession();
    _renderPlayerBar();
    throw new Error(t('txt_txt_player_session_expired'));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Handle QR auto-login via player_token URL parameter */
async function _handleTokenAutoLogin() {
  const playerToken = _params.get('player_token');
  if (!playerToken || !TID) return;
  // Remove token from URL to prevent re-login on refresh
  const url = new URL(location.href);
  url.searchParams.delete('player_token');
  history.replaceState(null, '', url.toString());
  try {
    await _playerAuth(null, playerToken);
  } catch (e) {
    _tokenLoginFailed = true;
    console.warn('Auto-login failed:', e.message);
  }
}

// After an explicit logout, don't silently log back in from the stored Hub
// profile on the next load. Cleared by any successful login (_playerAuth).
function _noProfileAutoLoginKey() { return `padel-tv-no-autologin-${TID}`; }
function _noProfileAutoLogin() {
  try { return localStorage.getItem(_noProfileAutoLoginKey()) === '1'; } catch (_) { return false; }
}
function _setNoProfileAutoLogin(on) {
  try {
    if (on) localStorage.setItem(_noProfileAutoLoginKey(), '1');
    else localStorage.removeItem(_noProfileAutoLoginKey());
  } catch (_) {}
}

/** True when a JWT's `exp` claim is still in the future (unverified client-side read). */
function _jwtStillValid(token) {
  try {
    const part = String(token).split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp !== 'number' || payload.exp * 1000 > Date.now();
  } catch (_) {
    return false;
  }
}

/**
 * Does the stored Player Hub session take part in this tournament? Asks the
 * Hub dashboard (`/api/player-profile/space`, the profile's own data) so the
 * common "hub player opens someone else's TV page" case never sends a
 * player-auth request that is bound to fail — a failed fetch is logged to the
 * console by the browser and counts against the player-auth rate limit.
 * Any doubt (no / expired Hub token, network error) answers false.
 */
async function _hubSessionInTournament() {
  let jwt = null;
  try { jwt = localStorage.getItem('padel-player-profile'); } catch (_) { return false; }
  if (!jwt || !_jwtStillValid(jwt)) return false;
  try {
    const res = await fetch(`${API}/api/player-profile/space`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.entries || []).some(e => e.entity_type === 'tournament' && e.entity_id === TID);
  } catch (_) {
    return false;
  }
}

/** Try auto-login via Player Hub profile passphrase stored in localStorage */
async function _tryProfileAutoLogin() {
  if (!TID || _isPlayerLoggedIn() || _noProfileAutoLogin()) return;
  try {
    const raw = localStorage.getItem('padel-player-profile-data');
    if (!raw) return;
    const profile = JSON.parse(raw);
    if (!profile.passphrase) return;
    // Not a participant: stay silent instead of a 401 from player-auth.
    if (!(await _hubSessionInTournament())) return;
    await _playerAuth(profile.passphrase, null);
  } catch {
    // Profile passphrase doesn't match this tournament — ignore silently
  }
}

/** Show the player login modal */
function _showPlayerLoginModal() {
  const existing = document.getElementById('player-login-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'player-login-overlay';
  overlay.className = 'player-login-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="player-login-modal">
      <button class="player-login-modal-close" onclick="document.getElementById('player-login-overlay').remove()" title="${t('txt_txt_close')}">✕</button>
      <h3>${_ic('key')} ${t('txt_txt_player_login')}</h3>
      <div class="login-error" id="player-login-error"></div>
      <input type="text" id="player-passphrase-input" placeholder="${t('txt_txt_enter_passphrase')}" autocomplete="off" spellcheck="false">
      <p class="login-passphrase-hint">${t('txt_txt_passphrase_hint')}</p>
      <div class="d-flex justify-center mt-1-5">
        <button class="btn btn-primary" onclick="_doPlayerLogin()">${t('txt_txt_login')}</button>
      </div>
      ${isDemoInstance() ? '' : `<div class="player-login-separator"><span>${t('txt_txt_or_separator')}</span></div>
      <button class="btn btn-player-hub" onclick="_doPlayerHubLogin()">
        <span class="player-hub-icon">${_ic('user')}</span> ${t('txt_txt_login_player_hub')}
      </button>`}
    </div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById('player-passphrase-input');
  input.focus();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doPlayerLogin(); });
}

/** Execute login from modal */
async function _doPlayerLogin() {
  const input = document.getElementById('player-passphrase-input');
  const errEl = document.getElementById('player-login-error');
  const passphrase = (input?.value || '').trim();
  if (!passphrase) { errEl.textContent = t('txt_txt_enter_passphrase'); return; }
  errEl.textContent = '';
  try {
    await _playerAuth(passphrase, null);
    document.getElementById('player-login-overlay')?.remove();
    loadTV(); // re-render with score inputs
  } catch (e) {
    errEl.textContent = e.message;
  }
}

/** Attempt login using Player Hub profile passphrase from localStorage */
async function _doPlayerHubLogin() {
  const errEl = document.getElementById('player-login-error');
  if (errEl) errEl.textContent = '';
  try {
    const raw = localStorage.getItem('padel-player-profile-data');
    if (!raw) {
      // No Player Hub profile — redirect to set one up
      if (errEl) errEl.textContent = t('txt_txt_player_hub_no_profile');
      setTimeout(() => { window.open('/player', '_blank'); }, 800);
      return;
    }
    const profile = JSON.parse(raw);
    if (!profile.passphrase) {
      if (errEl) errEl.textContent = t('txt_txt_player_hub_no_profile');
      setTimeout(() => { window.open('/player', '_blank'); }, 800);
      return;
    }
    await _playerAuth(profile.passphrase, null);
    document.getElementById('player-login-overlay')?.remove();
    loadTV();
  } catch {
    if (errEl) errEl.textContent = t('txt_txt_player_hub_login_failed');
  }
}

/** Logout player */
function _playerLogout() {
  _clearPlayerSession();
  _setNoProfileAutoLogin(true);
  loadTV(); // re-render without score inputs
}

// ── Web Push Notifications ──────────────────────────────────────────────────

/** Check whether push notifications are supported by the browser */
function _pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Check whether push is currently subscribed for this tournament */
function _isPushSubscribed() {
  if (!TID) return false;
  return localStorage.getItem(`padel-push-${TID}`) === '1';
}

/** Fetch the VAPID public key from the server (cached per session) */
let _vapidKeyCache = null;
async function _getVapidKey() {
  if (_vapidKeyCache) return _vapidKeyCache;
  const res = await fetch(`${API}/api/tournaments/${TID}/push/vapid-key`);
  if (!res.ok) return null;
  const data = await res.json();
  _vapidKeyCache = data.public_key;
  return _vapidKeyCache;
}

/** Convert a URL-safe base64 string to a Uint8Array (for applicationServerKey) */
function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribe to push notifications for the current tournament */
async function _pushSubscribe() {
  if (!TID || !tvState.playerJwt) return;
  const vapidKey = await _getVapidKey();
  if (!vapidKey) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: _urlBase64ToUint8Array(vapidKey),
  });

  const subJson = sub.toJSON();
  await _playerApi(`/api/tournaments/${TID}/push/subscribe`, {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
    }),
  });
  localStorage.setItem(`padel-push-${TID}`, '1');
}

/** Unsubscribe from push notifications for the current tournament */
async function _pushUnsubscribe() {
  if (!TID || !tvState.playerJwt) return;
  try {
    await _playerApi(`/api/tournaments/${TID}/push/unsubscribe`, { method: 'POST' });
  } catch (_) { /* best effort */ }
  localStorage.removeItem(`padel-push-${TID}`);
  // Also unsubscribe the browser PushSubscription
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (_) { /* ignore */ }
}

/** Toggle push subscription on/off */
async function _togglePush() {
  const btn = document.getElementById('push-toggle-btn');
  if (!btn) return;
  btn.disabled = true;
  try {
    if (_isPushSubscribed()) {
      await _pushUnsubscribe();
    } else {
      await _pushSubscribe();
    }
  } catch (e) {
    console.warn('Push toggle error:', e);
  }
  _updatePushToggleUI();
  if (btn) btn.disabled = false;
}

/** Update the push toggle button's visual state */
function _updatePushToggleUI() {
  const btn = document.getElementById('push-toggle-btn');
  if (!btn) return;
  const subscribed = _isPushSubscribed();
  btn.innerHTML = subscribed
    ? `<span class="push-toggle-icon">${_ic('bell')}</span> ${t('txt_txt_notifications_on')}`
    : `<span class="push-toggle-icon">${_ic('belloff')}</span> ${t('txt_txt_notifications_off')}`;
  btn.classList.toggle('push-toggle-btn--active', subscribed);
}

/** Copy contact info to clipboard with brief visual feedback */
function _copyContact(el) {
  const text = el.dataset.contact;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    flashSuccess(el, t('txt_txt_copied'));
  }).catch(() => {});
}

/** Build the opponents HTML string from current tvState */
function _buildPlayerOpponentsHtml() {
  const opponents = tvState.playerOpponents || [];
  if (opponents.length === 0) {
    return tvState.playerOpponentsLoaded
      ? `<div class="player-opponents-empty">${t('txt_txt_no_upcoming_opponents')}</div>`
      : '';
  }
  const byRound = {};
  for (const o of opponents) {
    const key = o.round_number > 0 ? String(o.round_number) : '';
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(o);
  }
  let html = `<div class="player-opponents-body">`;
  for (const [round, list] of Object.entries(byRound)) {
    html += `<div class="player-opponents-group">`;
    if (round) html += `<div class="player-opponents-round">${t('txt_txt_round')} ${esc(round)}</div>`;
    for (const o of list) {
      const contactHtml = o.contact
        ? `<span class="player-opponents-contact" data-contact="${esc(o.contact)}" onclick="_copyContact(this)" title="${t('txt_txt_click_to_copy')}">${esc(o.contact)}</span>`
        : '';
      html += `<div class="player-opponents-row"><span class="player-opponents-name">${esc(o.name)}</span>${contactHtml}</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/** Build the optional Player Hub section (passphrase + auto-login button) */
function _buildPlayerHubSectionHtml() {
  const passphrase = tvState.hubPassphrase;
  if (!passphrase || isDemoInstance()) return '';
  const hasToken = !!tvState.hubAccessToken;
  const openBtn = hasToken
    ? `<button class="player-hub-section-open" onclick="_openHubAutoLogin()" title="${t('txt_player_hub_open')}">${t('txt_player_hub_open')}</button>`
    : '';
  return `
    <div class="player-hub-section">
      <span class="player-hub-section-title">${t('txt_player_hub_section_title')}</span>
      <code class="player-hub-section-passphrase" data-passphrase="${esc(passphrase)}" onclick="_copyHubPassphrase(this)" title="${t('txt_txt_click_to_copy')}">${esc(passphrase)}</code>
      ${openBtn}
    </div>`;
}

/** Click-to-copy the Hub passphrase with brief visual feedback */
function _copyHubPassphrase(el) {
  const text = el.dataset.passphrase;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    flashSuccess(el, t('txt_txt_copied'));
  }).catch(() => {});
}

/** Open the Player Hub in a new tab using the short-lived auto-login token */
function _openHubAutoLogin() {
  const token = tvState.hubAccessToken;
  if (!token) return;
  const url = `/player#token=${encodeURIComponent(token)}`;
  window.open(url, '_blank', 'noopener');
}

/** Build the expand panel DOM element using current tvState */
function _buildPlayerPanel() {
  const panel = document.createElement('div');
  panel.id = 'player-expand-panel';
  panel.className = 'player-expand-panel';
  const pushBtnHtml = _pushSupported()
    ? `<button id="push-toggle-btn" class="push-toggle-btn" onclick="_togglePush()"></button>`
    : '';
  const hubSectionHtml = _buildPlayerHubSectionHtml();
  panel.innerHTML = `
    <button class="player-expand-close" onclick="_closePlayerPanel()" title="${t('txt_txt_close')}">✕</button>
    <div class="player-expand-inner">
      <span class="player-expand-title">${t('txt_txt_upcoming_opponents')}</span>
      ${_buildPlayerOpponentsHtml()}
      ${hubSectionHtml}
    </div>
    <div class="player-expand-footer">
      ${pushBtnHtml}
      <button class="player-dropdown-logout-btn" onclick="_playerLogout()">${t('txt_txt_logout')}</button>
    </div>`;
  // Initialise push toggle UI after insertion
  if (_pushSupported()) {
    requestAnimationFrame(() => _updatePushToggleUI());
  }
  return panel;
}

/** Close the expand panel */
function _closePlayerPanel() {
  document.getElementById('player-expand-panel')?.remove();
  tvState.playerPanelOpen = false;
  const tr = document.getElementById('player-session-trigger');
  if (tr) {
    tr.classList.remove('player-session-trigger--open');
    const chevron = tr.querySelector('.player-session-chevron');
    if (chevron) chevron.textContent = '▾';
  }
}

/** Toggle the expand panel open/closed — called from inline onclick */
function _togglePlayerPanel() {
  const existing = document.getElementById('player-expand-panel');
  if (existing) {
    _closePlayerPanel();
  } else {
    const header = document.getElementById('tv-header-main');
    if (!header) return;
    header.appendChild(_buildPlayerPanel());
    tvState.playerPanelOpen = true;
    const tr = document.getElementById('player-session-trigger');
    if (tr) {
      tr.classList.add('player-session-trigger--open');
      const chevron = tr.querySelector('.player-session-chevron');
      if (chevron) chevron.textContent = '▴';
    }
  }
}

/** sessionStorage key remembering that the player dismissed the hub-CTA banner this tab session */
function _hubCtaDismissedKey() { return TID ? `padel-hub-cta-dismissed:${TID}` : null; }

/** Should the inline "register on Player Hub" banner be shown for this logged-in player? */
function _shouldShowHubCta() {
  // No Player Hub on the demo instance: never invite players to create a profile.
  if (isDemoInstance()) return false;
  if (!_isPlayerLoggedIn()) return false;
  if (tvState.playerHasHubProfile !== false) return false;
  if (!tvState.playerLoginPassphrase) return false;
  try {
    const key = _hubCtaDismissedKey();
    if (key && sessionStorage.getItem(key) === '1') return false;
    if (localStorage.getItem('padel-player-profile-data')) return false;
  } catch (_) {}
  return true;
}

/** Render the inline hub-CTA banner as a full-width row below the TV header */
function _renderHubCtaBanner() {
  if (!_shouldShowHubCta()) return;
  const header = document.getElementById('tv-header-main');
  if (!header) return;
  const banner = document.createElement('div');
  banner.id = 'hub-cta-banner';
  banner.className = 'hub-cta-banner';
  const href = `/player#participant_passphrase=${encodeURIComponent(tvState.playerLoginPassphrase)}`;
  banner.innerHTML = `
    <span class="hub-cta-banner-text">${t('txt_hub_cta_banner_title')}</span>
    <a class="hub-cta-banner-action" href="${href}" target="_blank" rel="noopener">${t('txt_hub_cta_banner_action')}</a>
    <button type="button" class="hub-cta-banner-dismiss" aria-label="${t('txt_hub_cta_banner_dismiss')}" title="${t('txt_hub_cta_banner_dismiss')}" onclick="_dismissHubCta()">✕</button>
  `;
  header.appendChild(banner);
}

/** Dismiss the hub-CTA banner for the current tab session (per tournament) */
function _dismissHubCta() {
  try {
    const key = _hubCtaDismissedKey();
    if (key) sessionStorage.setItem(key, '1');
  } catch (_) {}
  document.getElementById('hub-cta-banner')?.remove();
}

/** Render the player bar at the top (or the floating login button) */
function _renderPlayerBar() {
  // Remove existing
  document.getElementById('player-bar')?.remove();
  document.getElementById('player-login-fab')?.remove();
  document.getElementById('player-name-btn')?.remove();
  document.getElementById('player-session-widget')?.remove();
  document.getElementById('hub-cta-banner')?.remove();
  // Capture panel open state before removing it
  if (document.getElementById('player-expand-panel')) tvState.playerPanelOpen = true;
  document.getElementById('player-expand-panel')?.remove();
  document.getElementById('player-dropdown')?.remove();

  if (!TID) return;

  // When player scoring is disabled by the admin, hide everything and clear any session
  if (!tvState.allowPlayerScoring) {
    if (_isPlayerLoggedIn()) _clearPlayerSession();
    return;
  }

  if (_isPlayerLoggedIn()) {
    const slot = document.getElementById('player-login-slot');
    if (!slot) return;
    slot.innerHTML = '';

    // Single compact pill button — inline onclick calls global _togglePlayerPanel()
    const widget = document.createElement('div');
    widget.id = 'player-session-widget';
    widget.className = 'player-session-widget';

    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'player-session-trigger';
    triggerBtn.className = 'player-session-trigger';
    triggerBtn.setAttribute('onclick', '_togglePlayerPanel()');
    triggerBtn.innerHTML = `${_ic('key')} <span class="player-name">${esc(tvState.playerName || tvState.playerId)}</span> <span class="player-session-chevron">▾</span>`;

    widget.appendChild(triggerBtn);
    slot.appendChild(widget);

    _renderHubCtaBanner();

    // Restore open state after re-render
    if (tvState.playerPanelOpen) {
      const header = document.getElementById('tv-header-main');
      if (header) {
        header.appendChild(_buildPlayerPanel());
        triggerBtn.classList.add('player-session-trigger--open');
        triggerBtn.querySelector('.player-session-chevron').textContent = '▴';
      }
    }
  } else {
    const slot = document.getElementById('player-login-slot');
    if (slot) {
      slot.innerHTML = '';
      const btn = document.createElement('button');
      btn.id = 'player-login-fab';
      btn.className = 'player-login-btn';
      btn.title = t('txt_txt_player_login');
      btn.innerHTML = `${_ic('key')} ${t('txt_txt_player_login')}`;
      btn.onclick = _showPlayerLoginModal;
      slot.appendChild(btn);
      if (_tokenLoginFailed) {
        const notice = document.createElement('div');
        notice.className = 'token-expired-notice';
        notice.textContent = t('txt_tv_token_expired');
        slot.appendChild(notice);
      }
    }
  }
}

/** Fetch upcoming opponents + their contacts for the logged-in player */
async function _fetchPlayerOpponents() {
  if (!TID || !_isPlayerLoggedIn()) return;
  try {
    const data = await _playerApi(`/api/tournaments/${TID}/player/opponents`);
    tvState.playerOpponents = (data && data.opponents) ? data.opponents : [];
  } catch (_) {
    tvState.playerOpponents = [];
  }
  tvState.playerOpponentsLoaded = true;
  // Update the panel in-place if it's currently open, otherwise just update state
  const panel = document.getElementById('player-expand-panel');
  if (panel) {
    const inner = panel.querySelector('.player-expand-inner');
    if (inner) {
      inner.innerHTML = `<span class="player-expand-title">${t('txt_txt_upcoming_opponents')}</span>${_buildPlayerOpponentsHtml()}`;
    }
  }
}

// ── Player score submission ────────────────────────────────

/** Map scoring context to API path suffix — mirrors admin _SCORE_ENDPOINTS. */
const _PLAYER_SCORE_ENDPOINTS = {
  'gp-group':   { points: 'gp/record-group',    tennis: 'gp/record-group-tennis' },
  'gp-playoff': { points: 'gp/record-playoff',  tennis: 'gp/record-playoff-tennis' },
  'mex':        { points: 'mex/record',          tennis: null },
  'mex-playoff':{ points: 'mex/record-playoff',  tennis: 'mex/record-playoff-tennis' },
  'po-playoff': { points: 'po/record',           tennis: 'po/record-tennis' },
};

/**
 * Points a Mexicano round score must sum to: the match's own target when an
 * organiser overrode it, else the tournament total.  0 = no sum rule.
 */
function _tvMatchTarget(m, scoreCtx) {
  if (scoreCtx !== 'mex') return 0;
  const target = m.effective_points_target || m.format_override?.points_target || tvState.totalPts || 0;
  if (m.id) tvState.matchTargets[m.id] = target;
  return target;
}

/** Same as _tvMatchTarget, for handlers that only know the match id. */
function _tvMatchTargetById(matchId, scoreCtx) {
  if (scoreCtx !== 'mex') return 0;
  return tvState.matchTargets[matchId] || tvState.totalPts || 0;
}

/** Third-set decider in effect for a match: its own (or recorded) value, else the tournament default. */
function _tvMatchDecider(m) {
  const decider = (m && m.effective_decider) || tvState.setDecider || 'full_set';
  if (m && m.id) tvState.matchDeciders[m.id] = decider;
  return decider;
}

/** Same as _tvMatchDecider, for handlers that only know the match id. */
function _tvMatchDeciderById(matchId) {
  return tvState.matchDeciders[matchId] || tvState.setDecider || 'full_set';
}

/** Three set-input rows; the third is labelled "Match TB" under a match tie-break decider. */
function _tvRenderSetRows(idPrefix1, idPrefix2, decider) {
  let html = '';
  for (let i = 0; i < 3; i++) {
    const isTb = i === 2 && decider === 'match_tiebreak';
    const maxAttr = i < 2 ? 'max="7"' : '';
    const label = isTb ? esc(t('txt_match_tb_label')) : `S${i + 1}`;
    const title = isTb ? ` title="${escAttr(t('txt_match_tb_rule'))}"` : '';
    html += `<div class="player-set-row">`;
    html += `<span class="player-set-label${isTb ? ' is-tb' : ''}"${title}>${label}</span>`;
    html += `<input type="number" inputmode="numeric" pattern="[0-9]*" id="${idPrefix1}-${i}" min="0" ${maxAttr} value="" placeholder="0">`;
    html += `<span class="text-muted">-</span>`;
    html += `<input type="number" inputmode="numeric" pattern="[0-9]*" id="${idPrefix2}-${i}" min="0" ${maxAttr} value="" placeholder="0">`;
    html += `</div>`;
  }
  return html;
}

/** Input mode a player form opens in: the match's own format, else the stage default. */
function _tvDefaultScoreMode(m, scoreCtx, hasTennis) {
  if (!hasTennis) return 'points';
  const mode = m.format_override?.mode || tvState.scoreMode[scoreCtx];
  return mode === 'sets' ? 'sets' : 'points';
}

/**
 * Large-type note on matches whose format differs from the tournament
 * default ("Played to 24", or "Sets" when this match alone is in sets).
 */
function _tvFormatNote(m, scoreCtx) {
  const fo = m.format_override;
  if (!fo || !scoreCtx) return '';
  if (scoreCtx === 'mex' && fo.points_target && fo.points_target !== tvState.totalPts) {
    return `<div class="tv-format-note">${esc(t('txt_match_format_played_to', { n: fo.points_target }))}</div>`;
  }
  if (fo.mode && fo.mode !== (tvState.scoreMode[scoreCtx] || 'points')) {
    return `<div class="tv-format-note">${esc(fo.mode === 'sets' ? t('txt_txt_sets') : t('txt_txt_points_label'))}</div>`;
  }
  return '';
}

/**
 * Validate score inputs and return { body, path, displayScore } or null on error.
 * Purely reads from the DOM — no side effects.
 */
function _validatePlayerScore(matchId, scoreCtx) {
  const errDiv = document.getElementById('ps-err-' + matchId);
  const saveBtn = document.getElementById('ps-save-' + matchId);
  const _showErr = (msg) => { if (errDiv) errDiv.textContent = msg; };

  const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
  if (!entry) { _showErr('Unknown score context'); return null; }

  const setsDiv = document.getElementById('ps-sets-' + matchId);
  const isTennis = setsDiv && !setsDiv.classList.contains('hidden');

  if (isTennis && entry.tennis) {
    const rawSets = [];
    for (let i = 0; i < 10; i++) {
      const e1 = document.getElementById('pts1-' + matchId + '-' + i);
      const e2 = document.getElementById('pts2-' + matchId + '-' + i);
      if (!e1 || !e2) break;
      rawSets.push([+e1.value || 0, +e2.value || 0]);
    }
    const sets = [];
    for (let i = 0; i < rawSets.length; i++) {
      const [v1, v2] = rawSets[i];
      if (v1 === 0 && v2 === 0) continue;
      if (v1 === v2) { _showErr(t('txt_txt_set_equal_scores', { n: i + 1 })); return null; }
      sets.push([v1, v2]);
    }
    if (sets.length === 0) { _showErr(t('txt_txt_enter_at_least_one_set_score')); return null; }
    if (sets.length === 3) {
      const w1 = sets[0][0] > sets[0][1] ? 'a' : 'b';
      const w2 = sets[1][0] > sets[1][1] ? 'a' : 'b';
      if (w1 === w2) { _showErr(t('txt_txt_third_set_needs_split')); return null; }
    }
    const decider = setsDiv.dataset.decider || _tvMatchDeciderById(matchId);
    const display = formatSetScore(sets, decider, ' / ');
    return { body: JSON.stringify({ match_id: matchId, sets, decider }), path: entry.tennis, displayScore: display };
  } else {
    const s1 = +(document.getElementById('ps1-' + matchId)?.value) || 0;
    const s2 = +(document.getElementById('ps2-' + matchId)?.value) || 0;
    const target = _tvMatchTargetById(matchId, scoreCtx);
    if (target > 0 && s1 + s2 !== target) {
      _showErr(t('txt_txt_score_must_sum', { n: target }));
      return null;
    }
    if (s1 === 0 && s2 === 0 && !saveBtn?.dataset.zeroWarned) {
      _showErr(t('txt_txt_zero_zero_confirm'));
      if (saveBtn) saveBtn.dataset.zeroWarned = '1';
      return null;
    }
    const display = `${s1} – ${s2}`;
    return { body: JSON.stringify({ match_id: matchId, score1: s1, score2: s2 }), path: entry.points, displayScore: display };
  }
}

/** Submit a score from the public player view.
 *  First click shows a confirmation overlay; second click sends. */
function _playerSubmitScore(matchId, scoreCtx) {
  const validated = _validatePlayerScore(matchId, scoreCtx);
  if (!validated) return;
  const { body, path, displayScore } = validated;
  const errDiv = document.getElementById('ps-err-' + matchId);
  if (errDiv) errDiv.textContent = '';

  // ── Show confirmation overlay before sending ──────────
  const formBody = document.getElementById('ps-body-' + matchId);
  if (!formBody) { _doPlayerSubmit(matchId, path, body); return; }

  // Build the overlay inside the form
  const overlay = document.createElement('div');
  overlay.className = 'score-confirm-overlay';
  const reviewNote = _isOffFormatEntry(matchId)
    ? `<div class="player-format-warning">${esc(t('txt_tv_score_in_review_help'))}</div>`
    : '';
  overlay.innerHTML = `
    <div class="confirm-score-value">${displayScore}</div>
    ${reviewNote}
    <div class="confirm-score-actions">
      <button type="button" class="score-confirm-btn" id="ps-confirm-${matchId}">${t('txt_txt_confirm_score')}</button>
      <button type="button" class="score-cancel-btn" id="ps-cancel-${matchId}">${t('txt_txt_cancel')}</button>
    </div>
    <div id="ps-err-${matchId}" class="score-error-msg"></div>
  `;

  // Hide the original inputs & save button, show overlay
  for (const ch of formBody.children) ch.style.display = 'none';
  formBody.appendChild(overlay);

  // Wire the confirm button
  document.getElementById('ps-confirm-' + matchId)?.addEventListener('click', () => {
    _doPlayerSubmit(matchId, path, body);
  });

  // Wire the cancel button — remove overlay, restore inputs
  document.getElementById('ps-cancel-' + matchId)?.addEventListener('click', () => {
    overlay.remove();
    for (const ch of formBody.children) ch.style.display = '';
  });
}

/** Actually POST the score to the backend. */
async function _doPlayerSubmit(matchId, path, body) {
  const saveBtn = document.getElementById('ps-save-' + matchId)
    || document.getElementById('ps-confirm-' + matchId);
  const errDiv = document.getElementById('ps-err-' + matchId);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
  if (errDiv) errDiv.textContent = '';
  try {
    await _playerApi(`/api/tournaments/${TID}/${path}`, { method: 'POST', body });
    if (saveBtn) {
      saveBtn.textContent = t('txt_txt_save');
      flashSuccess(saveBtn, t('txt_txt_saved'));
    }
    setTimeout(() => loadTV(), 900);
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('txt_txt_save'); }
    if (errDiv) errDiv.textContent = e.message;
    if (!_isPlayerLoggedIn()) setTimeout(() => loadTV(), 1500);
  }
}

/** Build inline score form HTML for a match the player can score */
function _buildPlayerScoreForm(m, scoreCtx) {
  if (!tvState.allowPlayerScoring) return '';
  if (!_isPlayerLoggedIn() || !_playerIsInMatch(m)) return '';
  const hasTbd = !m.team1?.join('').trim() || !m.team2?.join('').trim();
  if (hasTbd) return '';

  // ── Score lifecycle overlays (post-submission) ──────────────
  // In 'required' mode, a submitted-but-unconfirmed score shows the
  // lifecycle UI (opponent accept/correct).  In 'immediate' mode the
  // confirmation happens client-side *before* the score is sent, so
  // no server-side lifecycle panel is needed.
  if (m.scored_by && m.score && !m.score_confirmed && tvState.scoreConfirmationMode !== 'immediate') {
    return _buildScoreLifecyclePanel(m, scoreCtx);
  }

  // Off-format score parked for the organiser — nothing to enter until they decide.
  if (m.format_review) return _buildFormatReviewPanel(m);

  // Don't show the input form for completed/confirmed matches.
  if (m.score) return '';

  const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
  const hasTennis = !!(entry && entry.tennis);
  const defaultMode = _tvDefaultScoreMode(m, scoreCtx, hasTennis);
  const target = _tvMatchTarget(m, scoreCtx);
  const autoCalc = target > 0;
  const onInput = autoCalc ? `oninput="_playerAutoFillScore('${m.id}', ${target})"` : '';

  let html = '<div class="player-score-form">';
  html += `<button type="button" class="score-toggle-btn" id="ps-toggle-${m.id}" onclick="_toggleScoreForm('${m.id}')">${t('txt_txt_submit_score')}</button>`;
  html += `<div class="score-form-body hidden" id="ps-body-${m.id}">`;

  // Format chip (only when tennis scoring is available for this context).
  // The form opens in the organiser's format; picking the other one in the
  // chip's popover sends the score to the organiser for review instead.
  const decider = _tvMatchDecider(m);
  if (hasTennis) {
    const defaultFmt = _tvFormatKey(defaultMode, decider);
    html += _tvFormatChip(m.id, defaultFmt, defaultFmt);
    html += `<div id="ps-fmt-warn-${m.id}" class="player-format-warning hidden">${esc(t('txt_tv_format_review_warning', { format: _tvFormatLabel(defaultFmt) }))}</div>`;
  }

  // Points inputs — compact single row: Alice [0] – [0] Bob [Save]
  html += `<div class="score-inline-row">`;
  html += `<div id="ps-points-${m.id}" class="score-teams-row${defaultMode === 'sets' ? ' hidden' : ''}">`;
  html += `<input type="number" id="ps1-${m.id}" min="0" value="" placeholder="0" ${onInput}>`;
  html += `<span class="score-dash">–</span>`;
  html += `<input type="number" id="ps2-${m.id}" min="0" value="" placeholder="${autoCalc ? '–' : 0}" ${onInput}>`;
  html += `</div>`;

  // Sets inputs (hidden by default unless admin chose sets)
  // S1 and S2: standard sets capped at 7; S3: uncapped (super tie-break can go beyond 7)
  if (hasTennis) {
    html += `<div id="ps-sets-${m.id}" data-decider="${decider}"${defaultMode === 'sets' ? '' : ' class="hidden"'}><div class="player-sets-grid">`;
    html += _tvRenderSetRows(`pts1-${m.id}`, `pts2-${m.id}`, decider);
    html += `</div></div>`;
  }

  html += `<button id="ps-save-${m.id}" class="score-submit-btn" onclick="_playerSubmitScore('${m.id}','${scoreCtx}')">${t('txt_tv_submit_score_btn')}</button>`;
  html += `</div>`;
  html += `<div id="ps-err-${m.id}" class="score-error-msg"></div>`;
  html += `</div>`; // close score-form-body
  html += `</div>`;
  return html;
}

/** Toggle visibility of the score input form for a match */
function _toggleScoreForm(matchId) {
  const body = document.getElementById('ps-body-' + matchId);
  const btn = document.getElementById('ps-toggle-' + matchId);
  if (!body || !btn) return;
  // The toggle reads "Cancel" while the form is open so only one submit
  // button (the form's own) is ever visible.
  const closed = body.classList.toggle('hidden');
  btn.classList.toggle('active', !closed);
  btn.textContent = closed ? t('txt_txt_submit_score') : t('txt_txt_cancel');
  if (closed && _psFmtStore.matchId === matchId) _psFmtStore.open = false;
}

/**
 * Build the score lifecycle panel for a match that has a pending/disputed score.
 * Shows different UI depending on the player's role (submitter vs opponent).
 */
function _buildScoreLifecyclePanel(m, scoreCtx) {
  const isSubmitter = _playerIsInSubmitterTeam(m);
  const isOpponent = _playerIsInOpponentTeam(m);
  const scoreDisplay = _formatMatchScore(m);

  // ── Disputed state ──────────────────────────────────────
  if (m.disputed) {
    const corrDisplay = _formatDisputeScore(m);
    let html = '<div class="player-score-dispute">';

    if (m.dispute_escalated) {
      // Both teams have seen it — awaiting admin
      html += `<div class="dispute-header">${_ic('alert')} ${t('txt_txt_dispute_escalated')}</div>`;
      html += `<p class="dispute-admin-help">${t('txt_tv_dispute_admin_help')}</p>`;
      html += `<div class="dispute-row"><span>${t('txt_txt_submitted')}:</span> <strong>${scoreDisplay}</strong></div>`;
      html += `<div class="dispute-row"><span>${t('txt_txt_correction')}:</span> <strong>${corrDisplay}</strong></div>`;
    } else if (isSubmitter) {
      // Submitter can accept correction or escalate
      html += `<div class="dispute-header">${_ic('edit')} ${t('txt_txt_opponent_proposes_correction')}</div>`;
      html += `<div class="dispute-row"><span>${t('txt_txt_your_score')}:</span> <strong>${scoreDisplay}</strong></div>`;
      html += `<div class="dispute-row"><span>${t('txt_txt_proposed')}:</span> <strong>${corrDisplay}</strong></div>`;
      html += `<div class="pending-score-actions">`;
      html += `<button class="score-accept-btn" onclick="_playerAcceptCorrection('${m.id}')">${t('txt_txt_accept_correction')}</button>`;
      html += `<button class="score-escalate-btn" onclick="_playerEscalateDispute('${m.id}')">${t('txt_txt_escalate_to_admin')}</button>`;
      html += `</div>`;
      html += `<div id="ps-err-${m.id}" class="score-error-msg"></div>`;
    } else {
      // Opponent sees waiting for submitter response
      html += `<div class="dispute-header">${_ic('edit')} ${t('txt_txt_correction_sent')}</div>`;
      html += `<div class="dispute-row"><span>${t('txt_txt_original')}:</span> <strong>${scoreDisplay}</strong></div>`;
      html += `<div class="dispute-row"><span>${t('txt_txt_your_correction')}:</span> <strong>${corrDisplay}</strong></div>`;
      html += `<div class="submitted-waiting">${t('txt_txt_waiting_for_response')}</div>`;
    }
    html += '</div>';
    return html;
  }

  // ── Pending state (not yet confirmed, not disputed) ─────
  // In 'required' mode the submitter simply waits for the opponent.

  if (isSubmitter) {
    // Submitter sees "waiting for opponent" status
    let html = '<div class="player-score-submitted">';
    html += `<div class="submitted-score-label">✓ ${t('txt_txt_score_submitted')}</div>`;
    html += `<div class="submitted-score-value">${scoreDisplay}</div>`;
    html += `<div class="submitted-waiting">${t('txt_txt_waiting_for_opponent')}</div>`;
    const _cw = tvState.correctionWindowSecs || 0;
    if (_cw > 0 && m.scored_at) {
      const _elapsed = Math.floor(Date.now() / 1000 - m.scored_at);
      const _remaining = Math.max(0, _cw - _elapsed);
      if (_remaining > 0) {
        html += `<div class="correction-window-countdown">${t('txt_tv_correction_window_remaining', { n: _remaining })}</div>`;
      } else {
        html += `<div class="correction-window-expired">${t('txt_tv_correction_window_expired')}</div>`;
      }
    }
    html += `<div id="ps-err-${m.id}" class="score-error-msg"></div>`;
    html += '</div>';
    return html;
  }

  if (isOpponent) {
    // Opponent sees accept / correct buttons
    const entry = _PLAYER_SCORE_ENDPOINTS[scoreCtx];
    const hasTennis = !!(entry && entry.tennis);
    const target = _tvMatchTarget(m, scoreCtx);
    const autoCalc = target > 0;

    let html = '<div class="player-score-pending">';
    html += `<div class="pending-score-label">${t('txt_txt_pending_score')}</div>`;
    html += `<div class="pending-score-value">${scoreDisplay}</div>`;
    html += `<div class="pending-score-actions">`;
    html += `<button class="score-accept-btn" id="ps-accept-${m.id}" onclick="_playerAcceptScore('${m.id}')">${t('txt_txt_accept')}</button>`;
    html += `<button class="score-correct-btn" id="ps-correct-btn-${m.id}" onclick="_playerShowCorrectForm('${m.id}')">${t('txt_txt_correct')}</button>`;
    html += `</div>`;

    // Hidden correction form (revealed on click)
    html += `<div class="correct-score-panel hidden" id="ps-correct-panel-${m.id}">`;

    // Points / Sets toggle for correction (only when tennis scoring is available)
    const defaultCorrMode = _tvDefaultScoreMode(m, scoreCtx, hasTennis);
    if (hasTennis) {
      html += `<div class="player-score-mode-toggle" data-match="${m.id}-corr">`;
      html += `<button type="button" class="${defaultCorrMode === 'points' ? 'active' : ''}" onclick="_setCorrectionScoreMode('${m.id}','points')">${t('txt_txt_points_label')}</button>`;
      html += `<button type="button" class="${defaultCorrMode === 'sets' ? 'active' : ''}" onclick="_setCorrectionScoreMode('${m.id}','sets')">${t('txt_txt_sets')}</button>`;
      html += `</div>`;
    }

    // Points correction inputs
    html += `<div class="correct-score-inputs${defaultCorrMode === 'sets' ? ' hidden' : ''}" id="pc-points-${m.id}">`;
    const onInput = autoCalc ? `oninput="_playerAutoFillCorrection('${m.id}', ${target})"` : '';
    html += `<input type="number" inputmode="numeric" pattern="[0-9]*" id="pc1-${m.id}" min="0" value="" placeholder="0" ${onInput}>`;
    html += `<span class="score-dash">–</span>`;
    html += `<input type="number" inputmode="numeric" pattern="[0-9]*" id="pc2-${m.id}" min="0" value="" placeholder="${autoCalc ? target : 0}" ${onInput}>`;
    html += `</div>`;

    // Sets correction inputs (hidden by default unless mode=sets)
    if (hasTennis) {
      html += `<div id="pc-sets-${m.id}"${defaultCorrMode === 'sets' ? '' : ' class="hidden"'}><div class="player-sets-grid">`;
      html += _tvRenderSetRows(`pcs1-${m.id}`, `pcs2-${m.id}`, _tvMatchDecider(m));
      html += `</div></div>`;
    }

    html += `<button class="score-submit-btn" id="ps-correct-save-${m.id}" onclick="_playerSubmitCorrection('${m.id}','${scoreCtx}')">${t('txt_txt_send')}</button>`;
    html += `</div>`;

    html += `<div id="ps-err-${m.id}" class="score-error-msg"></div>`;
    html += '</div>';
    return html;
  }

  return '';
}

/** Auto-fill the complementary score field for Mexicano matches in the player panel. */
function _playerAutoFillScore(matchId, total) {
  const s1El = document.getElementById('ps1-' + matchId);
  const s2El = document.getElementById('ps2-' + matchId);
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

/**
 * Entry format of a player score form: 'points', 'sets' (full third set) or
 * 'sets_tb' (sets with a super tie-break deciding the third).
 */
function _tvFormatKey(mode, decider) {
  if (mode !== 'sets') return 'points';
  return decider === 'match_tiebreak' ? 'sets_tb' : 'sets';
}

/** Display label for a format key. */
function _tvFormatLabel(fmt) {
  if (fmt === 'points') return t('txt_txt_points_label');
  if (fmt === 'sets_tb') return `${t('txt_txt_sets')} + ${t('txt_match_format_decider_tiebreak').toLowerCase()}`;
  return t('txt_txt_sets');
}

/** Switch a player score form to *fmt*; off the organiser's format shows the review warning. */
function _setPlayerScoreMode(matchId, fmt) {
  const pointsDiv = document.getElementById('ps-points-' + matchId);
  const setsDiv = document.getElementById('ps-sets-' + matchId);
  if (!pointsDiv || !setsDiv) return;
  const isSets = fmt !== 'points';
  pointsDiv.classList.toggle('hidden', isSets);
  setsDiv.classList.toggle('hidden', !isSets);
  if (isSets) {
    // The third row is a set or a match tie-break — rebuild the rows when the decider changes.
    const decider = fmt === 'sets_tb' ? 'match_tiebreak' : 'full_set';
    if (setsDiv.dataset.decider !== decider) {
      setsDiv.dataset.decider = decider;
      const grid = setsDiv.querySelector('.player-sets-grid');
      if (grid) grid.innerHTML = _tvRenderSetRows(`pts1-${matchId}`, `pts2-${matchId}`, decider);
    }
  }
  const chip = document.getElementById('ps-fmt-btn-' + matchId);
  if (chip) {
    const defaultFmt = chip.dataset.defaultFmt;
    chip.outerHTML = _tvFormatChip(matchId, fmt, defaultFmt);
    document.getElementById('ps-fmt-warn-' + matchId)?.classList.toggle('hidden', fmt === defaultFmt);
  }
}

/** Small format chip (admin-panel style) that opens the format popover. */
function _tvFormatChip(matchId, fmt, defaultFmt) {
  const cls = `match-format-btn${fmt !== defaultFmt ? ' is-override' : ''}`;
  const label = fmt === 'sets_tb'
    ? `${esc(t('txt_txt_sets'))}</span> <span class="match-format-tb">${esc(t('txt_match_tb_label'))}`
    : esc(_tvFormatLabel(fmt));
  return `<button type="button" class="${cls}" id="ps-fmt-btn-${matchId}" data-fmt="${fmt}" data-default-fmt="${defaultFmt}" aria-haspopup="dialog" aria-label="${escAttr(t('txt_match_format_btn_label'))}" onclick="_openPlayerFormatPopover('${matchId}', this)">${_ic('settings')} <span class="match-format-mode">${label}</span><span class="match-format-caret" aria-hidden="true"></span></button>`;
}

// ─── Player format popover (Petite-Vue island) ─────────
// Markup: #ps-format-popover in public.html, outside #tv-root so live
// re-renders never destroy it.  Opened from the chip in a player score form.

/** Chip that opened the popover; focus returns here on close. */
let _psFmtTrigger = null;

const _psFmtStore = reactiveStore({
  open: false,
  matchId: '',
  fmt: 'points',         // 'points' | 'sets' | 'sets_tb' — see _tvFormatKey
  defaultFmt: 'points',
  top: 0,
  left: 0,
  lang: 'en',            // tracked so t() bindings re-render on language switch

  t(key, params) { void this.lang; return window.t(key, params); },
  label(fmt) { void this.lang; return _tvFormatLabel(fmt); },
  choose(fmt) {
    this.fmt = fmt;
    _setPlayerScoreMode(this.matchId, fmt);
    this.close();
  },
  close() {
    this.open = false;
    const back = document.getElementById('ps-fmt-btn-' + this.matchId) || _psFmtTrigger;
    back?.focus();
    _psFmtTrigger = null;
  },
});

/** Open the format popover under *btn* for one match's score form. */
function _openPlayerFormatPopover(matchId, btn) {
  if (_psFmtStore.open && _psFmtStore.matchId === matchId) { _psFmtStore.close(); return; }
  mountIsland('#ps-format-popover', _psFmtStore);
  _psFmtTrigger = btn;
  const r = btn.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 32);
  _psFmtStore.top = Math.round(r.bottom + window.scrollY + 6);
  _psFmtStore.left = Math.round(Math.max(16, Math.min(r.right + window.scrollX - width, window.scrollX + window.innerWidth - width - 16)));
  _psFmtStore.lang = getAppLanguage();
  _psFmtStore.matchId = matchId;
  _psFmtStore.fmt = btn.dataset.fmt;
  _psFmtStore.defaultFmt = btn.dataset.defaultFmt;
  _psFmtStore.open = true;
}

// Click outside the popover (and not on a format chip) closes it; so does Esc.
document.addEventListener('mousedown', (ev) => {
  if (!_psFmtStore.open) return;
  if (ev.target.closest?.('#ps-format-popover') || ev.target.closest?.('.match-format-btn')) return;
  _psFmtStore.open = false;
  _psFmtTrigger = null;
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && _psFmtStore.open) _psFmtStore.close();
});

/** True when the player switched the form away from the organiser's format. */
function _isOffFormatEntry(matchId) {
  const warn = document.getElementById('ps-fmt-warn-' + matchId);
  return !!warn && !warn.classList.contains('hidden');
}

/** Read-only panel for a score parked for organiser review (entered off-format). */
function _buildFormatReviewPanel(m) {
  const score = (m.review_sets && m.review_sets.length > 0)
    ? formatSetScore(m.review_sets, m.review_decider || _tvMatchDecider(m), ' / ')
    : (m.review_score ? `${m.review_score[0]} – ${m.review_score[1]}` : '');
  let html = '<div class="player-score-form player-score-submitted player-score-review">';
  html += `<span class="submitted-score-label">${t('txt_tv_score_in_review')}</span>`;
  if (score) html += `<span class="submitted-score-value">${esc(score)}</span>`;
  html += `<span class="submitted-waiting">${t('txt_tv_score_in_review_help')}</span>`;
  html += '</div>';
  return html;
}

// ── Score lifecycle helpers ───────────────────────────────

/** Check whether the logged-in player is on the same team as the score submitter */
function _playerIsInSubmitterTeam(m) {
  if (!tvState.playerId || !m.scored_by) return false;
  const roster = tvState.teamRoster || {};
  // Determine which team the submitter is on
  const t1Ids = _expandTeamIds(m.team1_ids || [], roster);
  const t2Ids = _expandTeamIds(m.team2_ids || [], roster);
  const submitterInT1 = t1Ids.has(m.scored_by);
  const submitterInT2 = t2Ids.has(m.scored_by);
  if (submitterInT1) return t1Ids.has(tvState.playerId);
  if (submitterInT2) return t2Ids.has(tvState.playerId);
  return false;
}

/** Check whether the logged-in player is on the opposing team from the submitter */
function _playerIsInOpponentTeam(m) {
  if (!tvState.playerId || !m.scored_by) return false;
  const roster = tvState.teamRoster || {};
  const t1Ids = _expandTeamIds(m.team1_ids || [], roster);
  const t2Ids = _expandTeamIds(m.team2_ids || [], roster);
  const submitterInT1 = t1Ids.has(m.scored_by);
  const submitterInT2 = t2Ids.has(m.scored_by);
  if (submitterInT1) return t2Ids.has(tvState.playerId);
  if (submitterInT2) return t1Ids.has(tvState.playerId);
  return false;
}

/** Expand team IDs to include roster members for composite teams */
function _expandTeamIds(ids, roster) {
  const expanded = new Set(ids);
  for (const pid of ids) {
    if (roster[pid]) roster[pid].forEach(mid => expanded.add(mid));
  }
  return expanded;
}

/** Format the main score of a match for display */
function _formatMatchScore(m) {
  if (!m.score) return '—';
  if (m.sets && m.sets.length > 0) {
    return formatSetScore(m.sets, _tvMatchDecider(m), ' / ');
  }
  return `${m.score[0]} – ${m.score[1]}`;
}

/** Format the dispute/correction score for display */
function _formatDisputeScore(m) {
  if (!m.dispute_score) return '—';
  if (m.dispute_sets && m.dispute_sets.length > 0) {
    return formatSetScore(m.dispute_sets, _tvMatchDecider(m), ' / ');
  }
  return `${m.dispute_score[0]} – ${m.dispute_score[1]}`;
}

// ── Score lifecycle actions ───────────────────────────────

/** Accept a pending score submitted by the opposing team */
async function _playerAcceptScore(matchId) {
  const btn = document.getElementById('ps-accept-' + matchId);
  const errDiv = document.getElementById('ps-err-' + matchId);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  if (errDiv) errDiv.textContent = '';
  try {
    await _playerApi(`/api/tournaments/${TID}/matches/${matchId}/accept`, { method: 'POST' });
    setTimeout(() => loadTV(), 600);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_accept'); }
    if (errDiv) errDiv.textContent = e.message;
  }
}

/** Show the correction form when the opponent clicks "Correct" */
function _playerShowCorrectForm(matchId) {
  const panel = document.getElementById('ps-correct-panel-' + matchId);
  if (panel) panel.classList.toggle('hidden');
}

/** Toggle between points and sets input for the correction form */
function _setCorrectionScoreMode(matchId, mode) {
  const pointsDiv = document.getElementById('pc-points-' + matchId);
  const setsDiv = document.getElementById('pc-sets-' + matchId);
  if (!pointsDiv || !setsDiv) return;
  if (mode === 'sets') {
    pointsDiv.classList.add('hidden');
    setsDiv.classList.remove('hidden');
  } else {
    pointsDiv.classList.remove('hidden');
    setsDiv.classList.add('hidden');
  }
  // Update toggle button states
  const panel = pointsDiv.closest('.correct-score-panel');
  const toggle = panel?.querySelector('.player-score-mode-toggle');
  if (toggle) {
    toggle.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
    const idx = mode === 'sets' ? 1 : 0;
    toggle.children[idx]?.classList.add('active');
  }
}

/** Submit a score correction (opposing team disagrees with submitted score) */
async function _playerSubmitCorrection(matchId, scoreCtx) {
  const errDiv = document.getElementById('ps-err-' + matchId);
  const btn = document.getElementById('ps-correct-save-' + matchId);
  const _showErr = (msg) => { if (errDiv) errDiv.textContent = msg; };

  // Detect whether the player has the sets view active for corrections
  const setsDiv = document.getElementById('pc-sets-' + matchId);
  const isTennis = setsDiv && !setsDiv.classList.contains('hidden');

  let body;
  let endpoint;
  if (isTennis) {
    // Gather set scores from correction inputs
    const rawSets = [];
    for (let i = 0; i < 10; i++) {
      const e1 = document.getElementById('pcs1-' + matchId + '-' + i);
      const e2 = document.getElementById('pcs2-' + matchId + '-' + i);
      if (!e1 || !e2) break;
      rawSets.push([+e1.value || 0, +e2.value || 0]);
    }
    const sets = [];
    for (let i = 0; i < rawSets.length; i++) {
      const [v1, v2] = rawSets[i];
      if (v1 === 0 && v2 === 0) continue;
      if (v1 === v2) { _showErr(t('txt_txt_set_equal_scores', { n: i + 1 })); return; }
      sets.push([v1, v2]);
    }
    if (sets.length === 0) { _showErr(t('txt_txt_enter_at_least_one_set_score')); return; }
    if (sets.length === 3) {
      const w1 = sets[0][0] > sets[0][1] ? 'a' : 'b';
      const w2 = sets[1][0] > sets[1][1] ? 'a' : 'b';
      if (w1 === w2) { _showErr(t('txt_txt_third_set_needs_split')); return; }
    }
    body = JSON.stringify({ match_id: matchId, sets });
    endpoint = 'correct-tennis';
  } else {
    const s1 = +(document.getElementById('pc1-' + matchId)?.value) || 0;
    const s2 = +(document.getElementById('pc2-' + matchId)?.value) || 0;
    // Mexicano sum validation
    const target = _tvMatchTargetById(matchId, scoreCtx);
    if (target > 0 && s1 + s2 !== target) {
      _showErr(t('txt_txt_score_must_sum', { n: target }));
      return;
    }
    body = JSON.stringify({ match_id: matchId, score1: s1, score2: s2 });
    endpoint = 'correct';
  }

  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  if (errDiv) errDiv.textContent = '';
  try {
    await _playerApi(`/api/tournaments/${TID}/matches/${matchId}/${endpoint}`, {
      method: 'POST', body,
    });
    setTimeout(() => loadTV(), 600);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_send'); }
    _showErr(e.message);
  }
}

/** Accept a correction proposed by the opposing team (submitter's action) */
async function _playerAcceptCorrection(matchId) {
  const errDiv = document.getElementById('ps-err-' + matchId);
  if (errDiv) errDiv.textContent = '';
  try {
    await _playerApi(`/api/tournaments/${TID}/matches/${matchId}/accept-correction`, { method: 'POST' });
    setTimeout(() => loadTV(), 600);
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  }
}

/** Escalate disputed score to admin (submitter rejects the correction) */
async function _playerEscalateDispute(matchId) {
  const errDiv = document.getElementById('ps-err-' + matchId);
  if (errDiv) errDiv.textContent = '';
  try {
    await _playerApi(`/api/tournaments/${TID}/matches/${matchId}/escalate-dispute`, { method: 'POST' });
    setTimeout(() => loadTV(), 600);
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  }
}

/** Auto-fill for Mexicano correction form */
function _playerAutoFillCorrection(matchId, total) {
  const s1El = document.getElementById('pc1-' + matchId);
  const s2El = document.getElementById('pc2-' + matchId);
  if (!s1El || !s2El) return;
  const changed = document.activeElement === s1El ? 's1' : 's2';
  if (changed === 's1') {
    const v = Math.max(0, Math.min(total, +s1El.value || 0));
    s2El.value = total - v;
  } else {
    const v = Math.max(0, Math.min(total, +s2El.value || 0));
    s1El.value = total - v;
  }
}

// ── API ───────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.detail || res.statusText);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function _redirectToNotFoundPage(message, redirectTo = '/tv') {
  const params = new URLSearchParams();
  if (message) params.set('m', message);
  if (redirectTo) params.set('to', redirectTo);
  window.location.replace(`/404?${params.toString()}`);
}


// ── Open-state persistence ───────────────────────────────
function _sectionStateKey() { return TID ? `padel-tv-sections-${TID}` : null; }

function _captureOpenState() {
  document.querySelectorAll('details[data-tv-key]').forEach(el => {
    tvState.sectionOpenState[el.dataset.tvKey] = el.open;
  });
  // Persist to localStorage so preference survives page reload
  const key = _sectionStateKey();
  if (key && Object.keys(tvState.sectionOpenState).length > 0) {
    try { localStorage.setItem(key, JSON.stringify(tvState.sectionOpenState)); } catch (_) {}
  }
}

function _applyOpenState() {
  // On first render sectionOpenState is empty — load from localStorage
  if (Object.keys(tvState.sectionOpenState).length === 0) {
    const key = _sectionStateKey();
    if (key) {
      try {
        const saved = localStorage.getItem(key);
        if (saved) tvState.sectionOpenState = JSON.parse(saved);
      } catch (_) {}
    }
  }
  document.querySelectorAll('details[data-tv-key]').forEach(el => {
    const key = el.dataset.tvKey;
    if (key in tvState.sectionOpenState) el.open = tvState.sectionOpenState[key];
  });
}

// ── Refresh scheduling ────────────────────────────────────────────

function _stopAllSchedules() {
  if (tvState.countdownInterval) { clearInterval(tvState.countdownInterval); tvState.countdownInterval = null; }
  if (tvState.versionPollTimer) { clearInterval(tvState.versionPollTimer); tvState.versionPollTimer = null; }
  if (tvState.pickerPollTimer) { clearInterval(tvState.pickerPollTimer); tvState.pickerPollTimer = null; }
  if (_tvVersionStream) { _tvVersionStream.close(); _tvVersionStream = null; }
  if (_pickerVersionStream) { _pickerVersionStream.close(); _pickerVersionStream = null; }
  _tvVersionFetching = false;
  _pickerFetching = false;
  _tvVersionEtag = null;
  _pickerVersionEtag = null;
}

// Catch-up when the tab becomes visible again.  In "On update" mode the SSE
// stream always updates lastKnownVersion — even when the tab is hidden — but
// defers the expensive loadTV() call and sets _pendingReload instead.  This
// listener fires as soon as the user switches back and instantly reloads
// without a redundant version fetch.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !TID) return;
  if (tvState._pendingReload) {
    tvState._pendingReload = false;
    if (!tvState.isRefreshing && !_hasOpenScoreForm()) loadTV();
    return;
  }
  // Fallback: if the SSE stream was down while the tab was hidden, we may
  // have missed version bumps entirely.  A cheap server check covers that.
  if (tvState.refreshIntervalSecs !== -1 || tvState.lastKnownVersion === null) return;
  fetch(`${API}/api/tournaments/${TID}/version`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || data.version === tvState.lastKnownVersion) return;
      tvState.lastKnownVersion = data.version;
      if (!tvState.isRefreshing && !_hasOpenScoreForm()) loadTV();
    })
    .catch(() => {});
});

function _updateCountdownEl(text) {
  const el = document.getElementById('tv-countdown');
  if (el) el.textContent = text;
}

function _startCountdown() {
  _stopAllSchedules();
  // If a version change was deferred while loadTV() was refreshing, process it
  // now rather than waiting for a visibilitychange that may never come.
  if (tvState._pendingReload && !document.hidden && !_hasOpenScoreForm()) {
    tvState._pendingReload = false;
    loadTV();
    return;
  }
  if (tvState.refreshIntervalSecs === 0) {
    // “Never” — no auto-refresh
    _updateCountdownEl(t('txt_txt_manual_only'));
    return;
  }
  if (tvState.refreshIntervalSecs === -1) {
    // “On update” — use SSE (with polling fallback) for instant updates.
    _updateCountdownEl('');
    _tvVersionStream = createVersionStream({
      url: `/api/tournaments/${TID}/events`,
      pollUrl: `/api/tournaments/${TID}/version`,
      pollIntervalMs: _TV_VERSION_POLL_INTERVAL_MS,
      onVersion(data) {
        const changed = tvState.lastKnownVersion !== null && data.version !== tvState.lastKnownVersion;
        tvState.lastKnownVersion = data.version;
        if (changed) {
          if (document.hidden || tvState.isRefreshing || _hasOpenScoreForm()) {
            tvState._pendingReload = true;
          } else {
            loadTV();
          }
        }
      },
    });
    return;
  }
  // Timer mode
  tvState.countdown = tvState.refreshIntervalSecs;
  _updateCountdownEl(`↻ ${tvState.countdown}s`);
  tvState.countdownInterval = setInterval(() => {
    tvState.countdown--;
    _updateCountdownEl(`↻ ${tvState.countdown}s`);
    if (tvState.countdown <= 0) {
      clearInterval(tvState.countdownInterval);
      tvState.countdownInterval = null;
      if (!_hasOpenScoreForm()) loadTV();
    }
  }, 1000);
}

// ── Load & render ─────────────────────────────────────────
async function loadTV() {
  if (tvState.isRefreshing) return;
  tvState.isRefreshing = true;
  tvState._pendingReload = false;
  if (tvState.countdownInterval) clearInterval(tvState.countdownInterval);

  const dot = document.getElementById('refresh-dot');
  if (dot) dot.classList.add('refreshing');

  try {
    if (!TID) {
      await _showPicker();
      return;
    }

    // Resolve tournament metadata — use /meta endpoint so private tournaments
    // are still accessible when reached by alias or direct ID.
    const meta = await api(`/api/tournaments/${TID}/meta`);
    tvState.tournamentType = meta.type;
    tvState.tournamentName = meta.name;
    tvState.tournamentSport = meta.sport || 'padel';
    tvState.tournamentAlias = meta.alias || null;
    tvState.communityName = meta.community_name || null;
    tvState.clubName = meta.club_name || null;
    tvState.clubLogoUrl = meta.club_logo_url || null;
    const nextLogoKey = `${meta.community_id || ''}:${tvState.clubName || ''}:${tvState.clubLogoUrl || ''}`;
    if (tvState.clubLogoKey !== nextLogoKey) {
      tvState.clubLogoKey = nextLogoKey;
      tvState.clubLogoVersion = Date.now();
    }
    document.title = `${_tvLabel()} | ${meta.name}`;

    // Load TV settings and tournament data in parallel
    const [tvSettings, ...dataResults] = await Promise.all([
      api(`/api/tournaments/${TID}/tv-settings`),
      ...(
        tvState.tournamentType === 'group_playoff'
          ? [
              api(`/api/tournaments/${TID}/gp/status`),
              api(`/api/tournaments/${TID}/gp/groups`),
              api(`/api/tournaments/${TID}/gp/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
          : tvState.tournamentType === 'playoff'
          ? [
              api(`/api/tournaments/${TID}/po/status`),
              api(`/api/tournaments/${TID}/po/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
          : [
              api(`/api/tournaments/${TID}/mex/status`),
              api(`/api/tournaments/${TID}/mex/matches`),
              api(`/api/tournaments/${TID}/mex/playoffs`).catch(() => ({ matches: [], pending: [] })),
            ]
      ),
    ]);

    tvState.refreshIntervalSecs = tvSettings.refresh_interval ?? 15;
    tvState.scoreMode = tvSettings.score_mode || {};
    tvState.setDecider = tvSettings.set_decider || 'full_set';
    tvState.allowPlayerScoring = tvSettings.allow_player_scoring !== false;
    tvState.scoreConfirmationMode = tvSettings.score_confirmation || 'immediate';
    tvState.correctionWindowSecs = tvSettings.correction_window_seconds ?? 0;
    // Seed tvState.lastKnownVersion so first poll doesn’t trigger an immediate reload
    if (tvState.refreshIntervalSecs === -1 && tvState.lastKnownVersion === null) {
      try {
        const vd = await fetch(`/api/tournaments/${TID}/version`).then(r => r.json());
        tvState.lastKnownVersion = vd.version;
      } catch (_) {}
    }
    if (tvState.tournamentType === 'group_playoff') {
      const [status, groups, playoffs] = dataResults;
      tvState.teamRoster = status.team_roster || null;
      _captureOpenState();
      _renderGP(tvSettings, status, groups, playoffs);
      _applyOpenState();
      _swapPendingBracketImages();
    } else if (tvState.tournamentType === 'playoff') {
      const [status, playoffs] = dataResults;
      _captureOpenState();
      _renderPO(tvSettings, status, playoffs);
      _applyOpenState();
      _swapPendingBracketImages();
    } else {
      const [status, matches, playoffs] = dataResults;
      tvState.breakdowns = matches.breakdowns || {};
      tvState.totalPts = status.total_points_per_match || 0;
      tvState.strengthWeight = status.strength_weight || 0;
      tvState.playerMap = {};
      for (const p of (status.players || [])) tvState.playerMap[p.id] = p.name;
      tvState.mexLeaderboard = status.leaderboard || [];
      tvState.mexTeamMode = status.team_mode || false;
      tvState.teamRoster = status.team_roster || null;
      _captureOpenState();
      _renderMex(tvSettings, status, matches, playoffs);
      _applyOpenState();
      _swapPendingBracketImages();
    }
  } catch (e) {
    if (e?.status === 404) {
      _redirectToNotFoundPage(t('txt_tv_not_found_deleted_hint'), '/tv');
      return;
    }
    const root = document.getElementById('tv-root');
    if (root) root.innerHTML = `<div class="tv-error">${t('txt_txt_error_loading_data_value', { value: esc(e.message) })}</div>`;
  } finally {
    tvState.isRefreshing = false;
    const dot = document.getElementById('refresh-dot');
    if (dot) dot.classList.remove('refreshing');
    // Fetch opponent contacts for the logged-in player (fire-and-forget, won't block render)
    if (_isPlayerLoggedIn()) _fetchPlayerOpponents();
    _renderPlayerBar();
    _startCountdown();
  }
}

// ── GP tournament renderer ────────────────────────────────
function _renderGP(tvSettings, status, groups, playoffs) {
  const phase = status.phase || '';
  const isPlayoffs = phase === 'playoffs' || phase === 'finished';
  const champion = status.champion;

  // Court assignments: pending group OR playoff matches
  const pendingGroup = _sortTbdLast(
    Object.values(groups.matches || {}).flat().filter(m => m.status !== 'completed')
  );
  const pendingPlayoff = _sortTbdLast(
    (playoffs?.pending || []).filter(m => m.status !== 'completed')
  );
  const assignmentMatches = isPlayoffs ? pendingPlayoff : pendingGroup;
  const courtTitle = isPlayoffs ? t('txt_txt_court_assignments_play_offs') : t('txt_txt_court_assignments_group_stage');

  // Group-keyed pending map for collapsible-by-group pending view (group stage only)
  const pendingByGroup = {};
  if (!isPlayoffs) {
    for (const [gName, gMatches] of Object.entries(groups.matches || {})) {
      const gPending = _sortTbdLast(gMatches.filter(m => m.status !== 'completed'));
      if (gPending.length > 0) pendingByGroup[gName] = gPending;
    }
  }

  let html = _buildHeader(tvState.tournamentName, phase, champion);
  html += _buildBanner(tvSettings);

  html += _buildChampionBanners(status);

  const hasCourts = status.assign_courts !== false;
  const _gpScoreCtx = isPlayoffs ? 'gp-playoff' : 'gp-group';
  html += _buildCourts(assignmentMatches, courtTitle, hasCourts && tvSettings.show_courts !== false, tvSettings.show_pending_matches === true, _gpScoreCtx, Object.keys(pendingByGroup).length > 0 ? pendingByGroup : null);

  if (isPlayoffs) {
    // Play-offs phase: past playoff matches → bracket → group past
    if (tvSettings.show_past_matches) {
      const playoffPast = (playoffs?.matches || []).filter(m => m.status === 'completed');
      if (playoffPast.length > 0)
        html += _buildPastMatches(playoffPast, tvSettings, false, t('txt_txt_play_off_matches'), 'past-playoffs', 'gp-playoff', status.espejo_split === true);
    }

  if (tvSettings.show_bracket) {
      const imgUrl = _bracketImgUrl('gp', tvSettings, playoffs);
      html += _buildBracketSection(imgUrl, status.double_elimination === true && status.espejo !== true, status.espejo === true, status.espejo_split === true);
    }

    if (tvSettings.show_past_matches) {
      const groupPast = Object.values(groups.matches || {}).flat().filter(m => m.status === 'completed');
      if (groupPast.length > 0)
        html += _buildPastMatches(groupPast, tvSettings, false, t('txt_txt_group_stage_matches'), 'past-groups', 'gp-group');
    }
  } else {
    // Group phase: standings → group past matches
    if (tvSettings.show_standings) {
      html += `<details class="tv-collapsible" data-tv-key="standings" open>`;
      html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_group_standings')}</h2> <button class="format-info-btn" onclick="showAbbrevPopup(event,'standings')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></summary>`;
      html += `<div class="tv-section">`;
      for (const [gName, rows] of Object.entries(groups.standings || {})) {
        const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
        html += `<div class="group-block"><h3>${t('txt_txt_group_name_value', { value: esc(gName) })}</h3>`;
        html += `<table class="standings-table" data-type="gp"><thead><tr>`;
        html += `<th class="col-hash">#</th><th class="col-player">${(status.team_roster && Object.keys(status.team_roster).length > 0) ? t('txt_txt_team') : t('txt_txt_player')}</th><th class="col-played">${t('txt_txt_p_abbrev')}</th><th class="col-w">${t('txt_txt_w_abbrev')}</th><th class="col-d">${t('txt_txt_d_abbrev')}</th><th class="col-l">${t('txt_txt_l_abbrev')}</th>`;
        if (hasSets) html += `<th class="col-sw">${t('txt_txt_sw_abbrev')}</th><th class="col-sl">${t('txt_txt_sl_abbrev')}</th><th class="col-sd">${t('txt_txt_sd_abbrev')}</th>`;
        html += `<th class="col-pf">${t('txt_txt_pf_abbrev')}</th><th class="col-pa">${t('txt_txt_pa_abbrev')}</th><th class="col-diff">${t('txt_txt_diff_abbrev')}</th>`;
        html += `</tr></thead><tbody>`;
        rows.forEach((r, i) => {
          const isMe = tvState.playerId && r.player_id === tvState.playerId;
          const eloHtml = r.elo ? ` <span class="elo-badge">${Math.round(r.elo)}</span>` : '';
          const nameHtml = _tvPlayerNameCell(r.player_id, r.player);
          html += `<tr${isMe ? ' class="my-row"' : ''}><td class="rank-cell col-hash">${i + 1}</td><td class="player-cell col-player">${nameHtml}${eloHtml}</td>`;
          html += `<td class="col-played">${r.played}</td><td class="col-w">${r.wins}</td><td class="col-d">${r.draws}</td><td class="col-l">${r.losses}</td>`;
          if (hasSets) html += `<td class="col-sw">${r.sets_won}</td><td class="col-sl">${r.sets_lost}</td><td class="col-sd">${r.sets_diff}</td>`;
          html += `<td class="col-pf">${r.points_for}</td><td class="col-pa">${r.points_against}</td>`;
          html += `<td class="col-diff">${r.point_diff}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      }
      html += `</div></details>`;
    }

    if (tvSettings.show_past_matches) {
      const groupPast = Object.values(groups.matches || {}).flat().filter(m => m.status === 'completed');
      if (groupPast.length > 0)
        html += _buildPastMatches(groupPast, tvSettings, false, t('txt_txt_group_stage_matches'), 'past-groups', 'gp-group');
    }
  }

  document.getElementById('tv-root').innerHTML = html;
}

// ── Standalone Playoff renderer ──────────────────────────
function _renderPO(tvSettings, status, playoffs) {
  const phase = status.phase || '';
  const champion = status.champion;

  const pending = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));

  let html = _buildHeader(tvState.tournamentName, phase, champion);
  html += _buildBanner(tvSettings);

  html += _buildChampionBanners(status);

  const hasCourts = status.assign_courts !== false;
  html += _buildCourts(pending, t('txt_txt_court_assignments_play_offs'), hasCourts && tvSettings.show_courts !== false, tvSettings.show_pending_matches === true, 'po-playoff');

  if (tvSettings.show_bracket) {
    const imgUrl = _bracketImgUrl('po', tvSettings, playoffs);
    html += _buildBracketSection(imgUrl, status.double_elimination === true, status.espejo === true);
  }

  if (tvSettings.show_past_matches) {
    const past = (playoffs?.matches || []).filter(m => m.status === 'completed');
    if (past.length > 0)
      html += _buildPastMatches(past, tvSettings, false, t('txt_txt_play_off_matches'), 'past-playoffs', 'po-playoff');
  }

  document.getElementById('tv-root').innerHTML = html;
}

// ── Mex tournament renderer ───────────────────────────────
function _renderMex(tvSettings, status, matches, playoffs) {
  const phase = status.phase || '';
  const isPlayoffs = phase === 'playoffs' || phase === 'finished';
  const champion = status.champion;

  const pendingCurrent = _sortTbdLast((matches.current_matches || []).filter(m => m.status !== 'completed'));
  const pendingPlayoff = _sortTbdLast((playoffs?.pending || []).filter(m => m.status !== 'completed'));
  const assignmentMatches = isPlayoffs ? pendingPlayoff : pendingCurrent;
  const courtTitle = isPlayoffs ? t('txt_txt_court_assignments_mexicano_play_offs') : t('txt_txt_court_assignments_current_round');

  let html = _buildHeader(tvState.tournamentName, phase, champion);
  html += _buildBanner(tvSettings);

  if (champion) {
    html += `<div class="champion-banner">${_ic('trophy')} ${t('txt_txt_champion')}: ${esc(champion.join(' & '))}</div>`;
  }

  const hasCourts = status.assign_courts !== false;
  const _mexScoreCtx = isPlayoffs ? 'mex-playoff' : 'mex';
  html += _buildCourts(assignmentMatches, courtTitle, hasCourts && tvSettings.show_courts !== false, tvSettings.show_pending_matches === true, _mexScoreCtx);

  if (isPlayoffs) {
    // Play-offs phase: past playoff matches → bracket → leaderboard → mexicano rounds
    if (tvSettings.show_past_matches) {
      const playoffPast = (playoffs?.matches || []).filter(m => m.status === 'completed');
      if (playoffPast.length > 0)
        html += _buildPastMatches(playoffPast, tvSettings, false, t('txt_txt_play_off_matches'), 'past-playoffs', 'mex-playoff');
    }

    if (tvSettings.show_bracket) {
      const imgUrl = _bracketImgUrl('mex', tvSettings, playoffs);
      html += _buildBracketSection(imgUrl, status.double_elimination === true);
    }

    if (tvSettings.show_standings) {
      html += _buildMexLeaderboard(status);
    }

    if (tvSettings.show_past_matches) {
      const mexPast = (matches.all_matches || []).filter(m => m.status === 'completed');
      if (mexPast.length > 0)
        html += _buildPastMatches(mexPast, tvSettings, true, t('txt_txt_mexicano_rounds'), 'past-mexicano', 'mex');
    }
  } else {
    // Mexicano phase: leaderboard → mexicano rounds
    if (tvSettings.show_standings) {
      html += _buildMexLeaderboard(status);
    }

    if (tvSettings.show_past_matches) {
      const mexPast = (matches.all_matches || []).filter(m => m.status === 'completed');
      if (mexPast.length > 0)
        html += _buildPastMatches(mexPast, tvSettings, true, t('txt_txt_mexicano_rounds'), 'past-mexicano', 'mex');
    }
  }

  document.getElementById('tv-root').innerHTML = html;
  _tvRenderMexLeaderboard();
}

function _tvMexSetSort(col) {
  if (tvState.mexSortCol === col) {
    tvState.mexSortDir = tvState.mexSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    tvState.mexSortCol = col;
    tvState.mexSortDir = (col === 'player' || col === 'rank') ? 'asc' : 'desc';
  }
  _tvRenderMexLeaderboard();
}

function _tvRenderMexLeaderboard() {
  const container = document.getElementById('tv-mex-leaderboard-inner');
  if (!container) return;
  const lb = tvState.mexLeaderboard;
  const byAvg = lb.length > 0 && lb[0].ranked_by_avg;

  const rows = [...lb];
  if (tvState.mexSortCol !== null) {
    rows.sort((a, b) => {
      let va = a[tvState.mexSortCol];
      let vb = b[tvState.mexSortCol];
      if (typeof va === 'string' || typeof vb === 'string') {
        const cmp = (va || '').localeCompare(vb || '');
        return tvState.mexSortDir === 'asc' ? cmp : -cmp;
      }
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      return tvState.mexSortDir === 'desc' ? vb - va : va - vb;
    });
  }

  const indicator = (col) => {
    if (tvState.mexSortCol !== col) return '';
    return tvState.mexSortDir === 'desc' ? ' ↓' : ' ↑';
  };
  const thHtml = (col, label) => {
    const isDefaultRankCol = tvState.mexSortCol === null && ((col === 'total_points' && !byAvg) || (col === 'avg_points' && byAvg));
    const isActive = tvState.mexSortCol === col;
    const inner = isDefaultRankCol
      ? `<strong>${label} ↓</strong>`
      : isActive
        ? `<strong>${label}${indicator(col)}</strong>`
        : label;
    return `<th class="tv-sortable-col${isActive ? ' tv-sort-active' : ''}" onclick="_tvMexSetSort('${col}')">${inner}</th>`;
  };

  let html = `<table class="standings-table" data-type="mex"><thead><tr>`;
  html += thHtml('rank', '#');
  html += thHtml('player', (tvState.teamRoster && Object.keys(tvState.teamRoster).length > 0) ? t('txt_txt_team') : t('txt_txt_player'));
  html += thHtml('total_points', t('txt_txt_total_pts_abbrev'));
  html += thHtml('matches_played', t('txt_txt_played_abbrev'));
  html += thHtml('wins', t('txt_txt_w_abbrev'));
  html += thHtml('draws', t('txt_txt_d_abbrev'));
  html += thHtml('losses', t('txt_txt_l_abbrev'));
  html += thHtml('avg_points', t('txt_txt_avg_pts_abbrev'));
  html += `</tr></thead><tbody>`;

  for (const r of rows) {
    const isMe = tvState.playerId && r.player_id === tvState.playerId;
    const rowClasses = [isMe ? 'my-row' : '', r.removed ? 'is-removed' : ''].filter(Boolean).join(' ');
    const rankCell = r.removed ? `<span class="text-muted">—</span>` : r.rank;
    const nameCell = r.removed
      ? `${esc(r.player)} <span class="tv-removed-tag">(${t('txt_txt_removed')})</span>`
      : _tvPlayerNameCell(r.player_id, r.player) + (r.elo ? ` <span class="elo-badge">${Math.round(r.elo)}</span>` : '');
    html += `<tr${rowClasses ? ` class="${rowClasses}"` : ''}><td class="rank-cell">${rankCell}</td><td class="player-cell">${nameCell}</td>`;
    const totalCell = byAvg ? r.total_points : `<strong>${r.total_points}</strong>`;
    const avgCell   = byAvg ? `<strong>${r.avg_points.toFixed(2)}</strong>` : r.avg_points.toFixed(2);
    html += `<td class="${byAvg ? '' : 'pts-cell'}">${totalCell}</td>`;
    html += `<td>${r.matches_played}</td><td>${r.wins ?? 0}</td><td>${r.draws ?? 0}</td><td>${r.losses ?? 0}</td>`;
    html += `<td class="${byAvg ? 'pts-cell' : ''}">${avgCell}</td></tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ── Shared builders ───────────────────────────────────────

// ── Abbreviation legend popup ──────────────────────────────

function _buildAbbrevLegend(type) {
  if (type === 'double_elim') {
    // i18n strings carry trusted inline markup (<b>, <em>), so no esc() here.
    return `<div class="de-explainer"><strong>${t('txt_double_elim_explain_title')}</strong>`
      + `<ul><li>${t('txt_double_elim_explain_purpose')}</li><li>${t('txt_double_elim_explain_loss')}</li></ul>`
      + `<span class="de-legend">${t('txt_double_elim_explain_colors')}</span></div>`;
  }
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
  const tiebreakerKey = type === 'standings' ? 'txt_txt_abbrev_tiebreaker_standings' : 'txt_txt_abbrev_tiebreaker_leaderboard';
  const tiebreakerHtml = `<p class="tiebreaker-note"><strong>${esc(t('txt_txt_abbrev_tiebreaker_title'))}</strong><br>${esc(t(tiebreakerKey))}</p>`;
  return `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>${tiebreakerHtml}`;
}

function showAbbrevPopup(event, type) {
  event.preventDefault();
  event.stopPropagation();
  const popup = document.getElementById('abbrev-popup');
  const btn = event.currentTarget;
  if (popup.style.display === 'block' && tvState.abbrevPopupBtn === btn) {
    popup.style.display = 'none';
    tvState.abbrevPopupBtn = null;
    return;
  }
  tvState.abbrevPopupBtn = btn;
  popup.classList.toggle('abbrev-popup-prose', type === 'double_elim');
  popup.innerHTML = _buildAbbrevLegend(type);
  popup.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  const pw = popup.offsetWidth || 210;
  const ph = popup.offsetHeight || 200;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
  // Clamp vertically so the popup stays on screen near the bottom of a phone.
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - ph - 8));
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

document.addEventListener('click', (e) => {
  const p = document.getElementById('abbrev-popup');
  if (p && p.style.display === 'block' && !p.contains(e.target) && e.target !== tvState.abbrevPopupBtn) {
    p.style.display = 'none';
    tvState.abbrevPopupBtn = null;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const p = document.getElementById('abbrev-popup');
    if (p) { p.style.display = 'none'; tvState.abbrevPopupBtn = null; }
  }
});

function _buildMexLeaderboard(_status) {
  let html = `<details class="tv-collapsible" data-tv-key="standings" open>`;
  html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_leaderboard')}</h2> <button class="format-info-btn" onclick="showAbbrevPopup(event,'leaderboard')" aria-label="${esc(t('txt_txt_column_legend'))}">i</button></summary>`;
  html += `<div class="tv-section"><div id="tv-mex-leaderboard-inner"></div></div></details>`;
  return html;
}

function _copyTournamentSlug() {
  const slug = tvState.tournamentAlias || TID;
  if (!slug) return;
  navigator.clipboard.writeText(slug).then(() => {
    flashSuccess('tv-slug-chip', t('txt_txt_copied'));
  });
}

function _buildHeader(name, phase, champion) {
  const phaseLabel = _phaseLabel(phase);
  const _slug = tvState.tournamentAlias || TID || '';
  const identityLabel = _tvIdentityLabel();
  const logoHtml = tvState.clubLogoUrl
    ? `<img src="${escAttr(_tvLogoSrc(tvState.clubLogoUrl))}" alt="" class="club-logo-inline club-logo-inline--lg">`
    : '';
  const brandingHtml = identityLabel
    ? `<div class="tv-identity-label">${esc(identityLabel)}</div>`
    : '';
  return `
    <div class="tv-header" id="tv-header-main">
      ${buildDisplayButtonHtml()}
      <div class="tv-title-center">
        <h1 class="tv-tournament-name tv-tournament-name--branded">${logoHtml}${esc(name)}</h1>
      </div>
      ${brandingHtml}
      <div class="tv-header-badges">
        ${phaseLabel && phase !== 'finished' ? `<span class="tv-badge tv-badge-phase">${esc(phaseLabel)}</span>` : ''}
        ${champion || phase === 'finished' ? `<span class="tv-badge tv-badge-champion">${_ic('trophy')} ${t('txt_txt_finished')}</span>` : ''}
      </div>
      ${_slug ? `<div class="d-flex justify-center mt-1"><span id="tv-slug-chip" onclick="_copyTournamentSlug()" title="${escAttr(t('txt_tv_slug_copy_hint'))}" class="tv-slug-chip">${esc(_slug)}</span></div>` : ''}
      <div class="tv-header-row">
        <div class="tv-title">
          <button type="button" onclick="_backToTournaments()" class="tv-back-btn" title="${t('txt_txt_back_to_tournaments')}">← ${t('txt_nav_events')}</button>
        </div>
        <div class="tv-meta">
          <div id="player-login-slot"></div>
          <div class="refresh-indicator">
            <div class="refresh-dot" id="refresh-dot"></div>
            <span id="tv-countdown">↻ ${tvState.refreshIntervalSecs}s</span>
            <button type="button" onclick="loadTV()" class="btn-refresh" title="${t('txt_txt_refresh_now')}">↻</button>
          </div>
        </div>
      </div>
    </div>`;
}

/** Bracket schema URL. The `_k` key is derived from the play-off data, so the
 *  URL (and the multi-hundred-KB image download) only changes when the bracket
 *  does — unchanged refreshes are served from the browser cache. */
function _bracketImgUrl(kind, tvSettings, playoffs) {
  const q = new URLSearchParams({
    fmt:              tvSettings.schema_format || 'svg',
    box_scale:        tvSettings.schema_box_scale || 1.0,
    line_width:       tvSettings.schema_line_width || 1.0,
    arrow_scale:      tvSettings.schema_arrow_scale || 1.0,
    title_font_scale: tvSettings.schema_title_font_scale || 1.0,
    output_scale:     tvSettings.schema_output_scale || 1.0,
    _k:               _hashString(JSON.stringify(playoffs || {})),
  });
  return `/api/tournaments/${TID}/${kind}/playoffs-schema?${q}`;
}

/** Small non-cryptographic FNV-1a string hash, base-36 encoded. */
function _hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Last successfully loaded bracket URL per bracket (URL minus its `_k` key).
// When the bracket changes, the re-rendered <img> keeps showing that image
// until the new one has loaded, instead of collapsing to zero height for the
// ~1s the server needs to render it (which made the page jump on phones).
const _bracketShown = new Map();

function _bracketBaseUrl(url) {
  return url.replace(/([?&])_k=[^&]*&?/, '$1').replace(/[?&]$/, '');
}

/** `src` attributes for a bracket <img>: current image + pending next one. */
function _bracketSrcAttrs(url) {
  url = new URL(url, location.href).href; // match the absolute `this.src` in onload
  const shown = _bracketShown.get(_bracketBaseUrl(url));
  const loaded = `onload="_bracketShown.set(_bracketBaseUrl(this.src), this.src)"`;
  if (shown && shown !== url) {
    return `src="${escAttr(shown)}" data-next-src="${escAttr(url)}" ${loaded}`;
  }
  return `src="${escAttr(url)}" ${loaded}`;
}

/** Swap bracket images rendered with a pending `data-next-src` once it loads. */
function _swapPendingBracketImages() {
  document.querySelectorAll('#tv-root img.bracket-img[data-next-src]').forEach(img => {
    const next = img.dataset.nextSrc;
    img.removeAttribute('data-next-src');
    const pre = new Image();
    // On error too, so the <img>'s own onerror (hide / "pending" note) runs.
    pre.onload = pre.onerror = () => { if (img.isConnected) img.src = next; };
    pre.src = next;
  });
}

/**
 * Champion banner(s) for GP and standalone play-off views.
 * Espejo: the champion is the Winners-bracket champion (shown as soon as the
 * Winners final is played) and the Losers-bracket winner is the consolation
 * winner, shown side by side.  Legacy tournaments with a Super Final keep its
 * winner (status.champion) as the only champion.
 */
function _buildChampionBanners(status) {
  const espejo = status.espejo === true;
  const legacySuperFinal = espejo && status.espejo_super_final === true;
  const champion = status.champion || (espejo && !legacySuperFinal ? status.winners_champion : null);
  const consolation = espejo && !legacySuperFinal ? status.losers_champion : null;
  const half = champion && consolation ? ' champion-banner--half' : '';
  let html = '';
  // Several equal winners (multi-winner single elimination): one banner listing every team.
  if (Array.isArray(status.winners) && status.winners.length > 1) {
    html += `<div class="champion-banner">${_ic('trophy')} ${t('txt_winners_word')}: ${status.winners.map(w => esc(w.join(' & '))).join(' · ')}</div>`;
    return html;
  }
  if (champion) {
    html += `<div class="champion-banner${half}">${_ic('trophy')} ${t('txt_txt_champion')}: ${esc(champion.join(' & '))}</div>`;
  }
  if (consolation) {
    html += `<div class="champion-banner champion-banner--consolation${half}">${t(status.espejo_split ? 'txt_txt_silver_winner' : 'txt_txt_consolation_winner')}: ${esc(consolation.join(' & '))}</div>`;
  }
  return html;
}

/** Build bracket section HTML with scrollable wrapper for mobile */
function _buildBracketSection(imgUrl, isDouble = false, isEspejo = false, isSplit = false) {
  let html = `<details class="tv-collapsible" data-tv-key="bracket" open>`;
  const infoBtn = isDouble && !isEspejo
    ? ` <button type="button" class="format-info-btn" onclick="showAbbrevPopup(event,'double_elim')" aria-label="${escAttr(t('txt_double_elim_info_btn'))}" title="${escAttr(t('txt_double_elim_info_btn'))}">i</button>`
    : '';
  html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${t('txt_txt_play_off_bracket')}</h2>${infoBtn}</summary>`;
  html += `<div class="tv-section bracket-section">`;
  if (isEspejo || isDouble) {
    html += `<div class="espejo-brackets-row">`;
    html += `<div class="espejo-bracket-half">`;
    html += `<div class="espejo-bracket-label">${esc(t(isSplit ? 'txt_txt_espejo_gold_bracket' : 'txt_txt_espejo_winners_bracket'))}</div>`;
    html += `<div class="bracket-scroll-wrapper"><img class="bracket-img" ${_bracketSrcAttrs(`${imgUrl}&side=winners`)} alt="Winners" onclick="_openBracketLightbox(this.src)" title="${t('txt_txt_click_to_expand')}" onerror="this.style.display='none'"></div>`;
    html += `</div>`;
    html += `<div class="espejo-bracket-half">`;
    html += `<div class="espejo-bracket-label">${esc(t(isSplit ? 'txt_txt_espejo_silver_bracket' : 'txt_txt_espejo_losers_bracket'))}</div>`;
    if (isEspejo) {
      html += `<div class="bracket-scroll-wrapper">` +
        `<img class="bracket-img" ${_bracketSrcAttrs(`${imgUrl}&side=losers`)} alt="Losers" onclick="_openBracketLightbox(this.src)" title="${t('txt_txt_click_to_expand')}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` +
        `<div class="bracket-pending-note" style="display:none">${t('txt_espejo_lb_pending')}</div>` +
        `</div>`;
    } else {
      html += `<div class="bracket-scroll-wrapper"><img class="bracket-img" ${_bracketSrcAttrs(`${imgUrl}&side=losers`)} alt="Losers" onclick="_openBracketLightbox(this.src)" title="${t('txt_txt_click_to_expand')}" onerror="this.style.display='none'"></div>`;
    }
    html += `</div>`;
    html += `</div>`;
  } else {
    html += `<div class="bracket-scroll-wrapper">`;
    html += `<img class="bracket-img" ${_bracketSrcAttrs(imgUrl)} alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox(this.src)" title="${t('txt_txt_click_to_expand')}" onerror="this.style.display='none'">`;
    html += `</div>`;
  }
  html += `<p class="bracket-tap-hint">${t('txt_txt_tap_to_expand_bracket')}</p>`;
  html += `</div></details>`;
  return html;
}

function _buildBanner(tvSettings) {
  const text = (tvSettings && tvSettings.banner_text) ? tvSettings.banner_text.trim() : '';
  if (!text) return '';
  return `<div class="admin-banner">${_ic('megaphone')} ${esc(text)}</div>`;
}

// Render a list of pending matches grouped by group name as collapsible <details> blocks.
function _buildPendingGroupCollapsibles(pendingByGroup, _tl, _hasTbd, _commentHtml, scoreCtx) {
  let html = '';
  for (const [gName, gMatches] of Object.entries(pendingByGroup)) {
    const tvKey = `pending-group-${gName}`;
    // Group by round_label within this group
    const byRound = {};
    const roundOrder = [];
    for (const m of gMatches) {
      const key = m.round_label || '';
      if (!byRound[key]) { byRound[key] = []; roundOrder.push(key); }
      byRound[key].push(m);
    }
    // Respect previously saved open/closed state; default open on first render
    const isOpen = tvKey in tvState.sectionOpenState ? tvState.sectionOpenState[tvKey] : true;
    html += `<details class="round-block" data-tv-key="${esc(tvKey)}"${isOpen ? ' open' : ''}>`;
    html += `<summary class="round-summary"><span class="chevron">▶</span>${esc(gName)}</summary>`;
    html += `<div class="round-body"><div class="court-board">`;
    for (const key of roundOrder) {
      html += `<div class="court-card">`;
      if (key) html += `<div class="court-name">${esc(trl(key))}</div>`;
      for (const m of byRound[key]) {
        const tbd = _hasTbd(m);
        html += `<div class="court-match${tbd ? ' opacity-50' : ''}">`;
        html += `<div class="court-match-info"><div class="court-match-teams">${esc(_tl(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl(m.team2))}</div>`;
        html += _commentHtml(m);
        html += `</div>`;
        html += _tvFormatNote(m, scoreCtx);
        if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div></div></details>`;
  }
  return html;
}

function _buildCourts(matches, title, assignCourts = true, showPending = false, scoreCtx = null, pendingByGroup = null) {
  const _commentHtml = (m) => m.comment ? `<div class="match-comment">${esc(m.comment)}</div>` : '';
  if (!assignCourts && !showPending) return '';
  if (!assignCourts) {
    // Courts disabled — show all planned matches; grouped by group name when available
    let html = `<div class="tv-section">`;
    html += `<div class="tv-section-header"><h2>${t('txt_txt_pending_matches')}</h2></div>`;
    if (!matches || matches.length === 0) {
      html += `<p class="tv-empty">${t('txt_txt_no_pending_court_assignments')}</p>`;
      html += `</div>`;
      return html;
    }
    const _tl = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
    const _hasTbd = (m) => !m.team1?.join('').trim() || !m.team2?.join('').trim();
    if (pendingByGroup) {
      html += _buildPendingGroupCollapsibles(pendingByGroup, _tl, _hasTbd, _commentHtml, scoreCtx);
    } else {
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
      html += `<div class="court-board">`;
      for (const key of _roundOrder) {
        const hasMyMatch = scoreCtx && _byRound[key].some(bm => !_hasTbd(bm) && _playerIsInMatch(bm));
        html += `<div class="court-card${hasMyMatch ? ' court-card--yours' : ''}">`;
        if (key) html += `<div class="court-name">${esc(trl(key))}</div>`;
        for (const m of _byRound[key]) {
          const tbd = _hasTbd(m);
          html += `<div class="court-match${tbd ? ' opacity-50' : ''}">`;
          html += `<div class="court-match-info"><div class="court-match-teams">${esc(_tl(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl(m.team2))}</div>`;
          html += _commentHtml(m);
          html += `</div>`;
          html += _tvFormatNote(m, scoreCtx);
          if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
          html += `</div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  let html = `<div class="tv-section">`;
  html += `<div class="tv-section-header"><h2>${esc(title)}</h2></div>`;
  if (!matches || matches.length === 0) {
    html += `<p class="tv-empty">${t('txt_txt_no_pending_court_assignments')}</p>`;
    html += `</div>`;
    return html;
  }

  // For each court show only the current (lowest slot_number) pending match.
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
    html += `<p class="tv-empty">${t('txt_txt_no_pending_court_assignments')}</p>`;
    html += `</div>`;
    return html;
  }

  const _teamLabel = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';

  html += `<div class="court-board">`;
  for (const courtName of courtNames) {
    const m = currentByCourt[courtName];
    const t1 = _teamLabel(m.team1);
    const t2 = _teamLabel(m.team2);
    const isMyMatch = scoreCtx && _playerIsInMatch(m);
    html += `<div class="court-card${isMyMatch ? ' court-card--yours' : ''}">`;
    html += `<div class="court-card-header">`;
    html += `<div class="court-name">${esc(courtName)}</div>`;
    if (isMyMatch) html += `<div class="court-yours-badge">${t('txt_tv_your_match_badge')}</div>`;
    html += `</div>`;
    html += `<div class="court-match">`;
    html += `<div class="court-match-info"><div class="court-match-teams">${esc(t1)}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(t2)}</div>`;
    if (m.round_label) html += `<div class="court-match-meta">${esc(trl(m.round_label))}</div>`;
    html += _commentHtml(m);
    html += `</div>`;
    html += _tvFormatNote(m, scoreCtx);
    if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
    html += `</div>`;
    html += `</div>`;
  }
  html += `</div></div>`;

  if (!showPending) return html;

  // Also show pending matches view below court board
  const _tl2 = (team) => (team && team.length > 0) ? team.join(' & ') : 'TBD';
  const _hasTbd2 = (m) => !m.team1?.join('').trim() || !m.team2?.join('').trim();
  html += `<div class="tv-section">`;
  html += `<div class="tv-section-header"><h2>${t('txt_txt_pending_matches')}</h2></div>`;
  if (pendingByGroup) {
    html += _buildPendingGroupCollapsibles(pendingByGroup, _tl2, _hasTbd2, _commentHtml, scoreCtx);
  } else {
    const byRound2 = {};
    const roundOrder2 = [];
    for (const m of matches) {
      const key = m.round_label || '';
      if (!byRound2[key]) { byRound2[key] = []; roundOrder2.push(key); }
      byRound2[key].push(m);
    }
    for (const key of roundOrder2) {
      byRound2[key].sort((a, b) => _hasTbd2(a) - _hasTbd2(b));
    }
    html += `<div class="court-board">`;
    for (const key of roundOrder2) {
      const hasMyMatch2 = scoreCtx && byRound2[key].some(bm => !_hasTbd2(bm) && _playerIsInMatch(bm));
      html += `<div class="court-card${hasMyMatch2 ? ' court-card--yours' : ''}">`;
      if (key) html += `<div class="court-name">${esc(key)}</div>`;
      for (const m of byRound2[key]) {
        const tbd = _hasTbd2(m);
        html += `<div class="court-match${tbd ? ' opacity-50' : ''}">`;
        html += `<div class="court-match-info"><div class="court-match-teams">${esc(_tl2(m.team1))}<span class="court-match-vs">${t('txt_txt_vs')}</span>${esc(_tl2(m.team2))}</div>`;
        html += _commentHtml(m);
        html += `</div>`;
        html += _tvFormatNote(m, scoreCtx);
        if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/** Display name of an Espejo bracket side (a match's `bracket_side`) on the TV. */
function _tvEspejoSideLabel(side, isSplit) {
  if (side === 'losers') return t(isSplit ? 'txt_txt_espejo_silver_bracket' : 'txt_txt_espejo_losers_bracket');
  if (side === 'super_final') return t('txt_txt_espejo_super_final');
  return t(isSplit ? 'txt_txt_espejo_gold_bracket' : 'txt_txt_espejo_winners_bracket');
}

function _buildPastMatches(matches, tvSettings, isMex, sectionTitle = t('txt_txt_past_matches'), tvKey = 'past-matches', scoreCtx = null, isSplit = false) {
  if (!matches || matches.length === 0) return '';

  // Group by round_label first (more descriptive), fall back to round_number.
  // Espejo matches carry bracket_side: both brackets have e.g. a "Semi-Final",
  // so the side is part of the key and shown as a prefix.
  const byRound = {};
  const roundOrder = [];
  for (const m of matches) {
    const baseKey = m.round_label || `Round ${m.round_number ?? 0}`;
    const key = m.bracket_side ? `${m.bracket_side}|${baseKey}` : baseKey;
    if (!byRound[key]) { byRound[key] = []; roundOrder.push(key); }
    byRound[key].push(m);
  }
  // Reverse so most recent is first; dedupe while preserving order
  const orderedKeys = [...new Set(roundOrder)].reverse();

  let html = `<details class="tv-collapsible" data-tv-key="${tvKey}" open>`;
  html += `<summary class="tv-collapsible-header"><span class="chevron">▶</span><h2>${esc(sectionTitle)}</h2></summary>`;
  html += `<div class="tv-section">`;

  for (let ri = 0; ri < orderedKeys.length; ri++) {
    const key = orderedKeys[ri];
    const rMatches = byRound[key];
    const openAttr = ri === 0 ? ' open' : ''; // most recent open by default

    html += `<details class="round-block" data-tv-key="${tvKey}-${esc(key)}"${openAttr}>`;
    const sideSep = key.indexOf('|');
    const roundTitle = (rMatches[0].bracket_side && sideSep > 0)
      ? `${_tvEspejoSideLabel(rMatches[0].bracket_side, isSplit)}: ${trl(key.slice(sideSep + 1))}`
      : trl(key);
    html += `<summary class="round-summary">▶ ${esc(roundTitle)} — ${rMatches.length} ${rMatches.length > 1 ? t('txt_txt_matches') : t('txt_txt_match')}</summary>`;
    html += `<div class="round-body">`;
    for (const m of rMatches) {
      html += _buildHistoryMatch(m, tvSettings, isMex, scoreCtx);
    }
    html += `</div></details>`;
  }

  html += `</div></details>`;
  return html;
}

function _buildHistoryMatch(m, tvSettings, isMex, scoreCtx = null) {
  const t1 = (m.team1 || []).join(' & ') || 'TBD';
  const t2 = (m.team2 || []).join(' & ') || 'TBD';
  const court = m.court ? `<span class="history-court">${esc(m.court)}</span>` : '';

  // Pending confirmation indicator — only shown in 'required' mode where
  // the score genuinely awaits opponent acceptance; in immediate mode the
  // score counts right away so no indicator is needed (disputed still shows).
  let pendingBadge = '';
  if (m.scored_by && !m.score_confirmed && m.score) {
    if (m.disputed) {
      pendingBadge = `<span class="history-badge history-badge-dispute" role="img" aria-label="${escAttr(t('txt_txt_dispute_label'))}">${_ic('alert')}</span>`;
    } else if (tvState.scoreConfirmationMode !== 'immediate') {
      pendingBadge = `<span class="history-badge history-badge-pending" role="img" aria-label="${escAttr(t('txt_txt_pending_confirmation'))}">${_ic('clock')}</span>`;
    }
  }
  let scoreHtml;
  if (m.score) {
    if (m.sets && m.sets.length > 0) {
      scoreHtml = `<span class="history-score sets-stack">`;
      scoreHtml += formatSetScore(m.sets, _tvMatchDecider(m), '|').split('|').map(x => `<span>${x}</span>`).join('');
      scoreHtml += `</span>`;
    } else {
      scoreHtml = `<span class="history-score">${m.score[0]} – ${m.score[1]}</span>`;
    }
  } else {
    scoreHtml = `<span class="history-score text-muted">—</span>`;
  }

  let html = `<div class="history-match">`;
  html += `<div class="history-teams">${esc(t1)}<span class="history-vs">${t('txt_txt_vs')}</span>${esc(t2)}</div>`;
  html += scoreHtml;
  html += pendingBadge;
  html += court;
  html += `</div>`;

  // Score lifecycle panel for unconfirmed matches in history view
  html += _tvFormatNote(m, scoreCtx);
  if (scoreCtx) html += _buildPlayerScoreForm(m, scoreCtx);

  // Score breakdown for Mexicano matches
  if (isMex && tvSettings.show_score_breakdown) {
    const bd = tvState.breakdowns[m.id];
    if (bd && Object.keys(bd).length > 0) {
      html += `<details class="tv-breakdown-details">`;
      html += `<summary class="breakdown-toggle">${_ic('chart')} ${t('txt_txt_score_breakdown')}</summary>`;
      html += `<div class="breakdown-panel">`;
      html += `<table class="breakdown-table"><thead><tr>`;
      html += `<th>${t('txt_txt_player')}</th><th>${t('txt_txt_raw')}</th><th>${t('txt_txt_relative_strength')}</th><th>${t('txt_txt_strength_weight')}</th><th>${t('txt_txt_strength_multiplier')}</th><th>${t('txt_txt_loss_disc_multiplier')}</th><th>${t('txt_txt_win_bonus_header')}</th><th>${t('txt_txt_final')}</th>`;
      html += `</tr></thead><tbody>`;
      for (const [pid, d] of Object.entries(bd)) {
        const rs = d.relative_strength || 0;
        html += `<tr><td>${esc(tvState.playerMap[pid] || pid)}</td><td>${d.raw}</td>`;
        html += `<td>${rs > 0 ? rs.toFixed(3) : '—'}</td>`;
        html += `<td>${tvState.strengthWeight > 0 ? '×' + tvState.strengthWeight : '—'}</td>`;
        html += `<td>${d.strength_mult !== 1 ? '×' + d.strength_mult.toFixed(2) : '—'}</td>`;
        html += `<td>${d.loss_disc !== 1 ? '×' + d.loss_disc.toFixed(2) : '—'}</td>`;
        html += `<td>${d.win_bonus > 0 ? '+' + d.win_bonus : '—'}</td>`;
        html += `<td><strong>${d.final}</strong></td></tr>`;
      }
      html += `</tbody></table></div></details>`;
    }
  }

  return html;
}

// ── Helpers ───────────────────────────────────────────────
function _phaseLabel(phase) {
  const map = {
    setup: t('txt_txt_setup'), groups: t('txt_txt_group_stage'), playoffs: t('txt_txt_play_offs'),
    finished: t('txt_txt_finished'), mexicano: t('txt_txt_mexicano'),
  };
  return map[phase] || phase;
}

// ── Bootstrap ─────────────────────────────────────────────

async function _resolveAlias() {
  if (_aliasParam && !TID) {
    try {
      const data = await api(`/api/tournaments/resolve-alias/${encodeURIComponent(_aliasParam)}`);
      TID = data.id;
    } catch (error) {
      if (error?.status === 404) {
        TID = _aliasParam;
      } else {
        await _showPicker();
        return false;
      }
    }
  }
  return true;
}

// Static shell for the Events island. Re-injected into #tv-root on each
// _showPicker() (the live panel clobbers #tv-root when a tournament is shown),
// then mounted via mountIsland(). The per-item card markup lives in the
// #tpl-tv-picker-item <template> in public.html.
const _PICKER_ISLAND_HTML = `
<div id="tv-picker-island" v-scope class="tv-picker events-page">
  <div v-html="headerHtml"></div>
  <h1 class="sr-only">{{ t('txt_events_title') }}</h1>
  <div class="events-toolbar">
    <div class="club-sport-selector" role="group" :aria-label="t('txt_txt_sport')">
      <button type="button" class="club-sport-pill" data-sport="padel" :class="{ active: sport === 'padel' }"
              :aria-pressed="sport === 'padel'" @click="toggleSport('padel')">{{ t('txt_txt_sport_padel') }}</button>
      <button type="button" class="club-sport-pill" data-sport="tennis" :class="{ active: sport === 'tennis' }"
              :aria-pressed="sport === 'tennis'" @click="toggleSport('tennis')">{{ t('txt_txt_sport_tennis') }}</button>
    </div>
    <button type="button" class="theme-btn btn-refresh" @click="refresh()"
            :title="t('txt_txt_refresh_now')" :aria-label="t('txt_txt_refresh_now')">↻</button>
  </div>
  <section class="club-items-section">
    <header class="club-items-header">
      <div class="home-filter-row" role="tablist" :aria-label="t('txt_txt_filter_dim_status')">
        <button type="button" class="home-filter-chip" :class="{ active: tab === 'live' }" role="tab"
                :aria-selected="tab === 'live'" @click="setTab('live')">
          <span>{{ t('txt_club_items_tab_live') }}</span>
          <span v-if="liveCount" class="home-filter-chip-count">{{ liveCount }}</span>
        </button>
        <button type="button" class="home-filter-chip" :class="{ active: tab === 'finished' }" role="tab"
                :aria-selected="tab === 'finished'" @click="setTab('finished')">
          <span>{{ t('txt_club_items_tab_finished') }}</span>
          <span v-if="finishedCount" class="home-filter-chip-count">{{ finishedCount }}</span>
        </button>
      </div>
    </header>
    <div class="club-items-body">
      <div v-if="!visible.length" class="club-items-empty">{{ emptyLabel }}</div>
      <div v-else-if="tab === 'live'">
        <div v-for="g in groups" :key="g.key" class="club-items-group">
          <h3 class="club-items-group-title">{{ t(g.labelKey) }}</h3>
          <div v-for="ev in g.items" :key="ev.kind + ':' + ev.id" v-scope="{ $template: '#tpl-tv-picker-item', it: item(ev) }"></div>
        </div>
      </div>
      <div v-else>
        <div v-for="ev in visible" :key="ev.kind + ':' + ev.id" v-scope="{ $template: '#tpl-tv-picker-item', it: item(ev) }"></div>
      </div>
    </div>
  </section>
  <section class="club-search-section">
    <form class="home-search-row club-search-form" @submit="submitFind($event)">
      <label class="sr-only" for="picker-input">{{ t('txt_events_find_label') }}</label>
      <input id="picker-input" type="search" class="home-search-input" v-model="findValue"
             :placeholder="t('txt_events_find_placeholder')" autocomplete="off" spellcheck="false">
      <button type="submit" class="btn btn-sm btn-primary" :disabled="finding">{{ t('txt_club_search_btn') }}</button>
    </form>
    <div v-if="findError" class="club-search-result tv-error" role="alert">{{ findError }}</div>
  </section>
</div>`;

function _renderPickerHtml(events) {
  _pickerStore.events = Array.isArray(events) ? events : [];
  _pickerStore.lang = getAppLanguage();
  _pickerStore._settleTab();
  const root = document.getElementById('tv-root');
  // The live panel owns #tv-root via innerHTML; re-inject the island shell so
  // it exists as a fresh element, then mount the persistent store onto it.
  root.innerHTML = _PICKER_ISLAND_HTML;
  mountIsland('#tv-picker-island', _pickerStore);
}

async function _showPicker() {
  // On a club subdomain the club page is the directory (the server also
  // redirects /events there; this covers in-page "back" navigation).
  if (getClubSubdomain()) {
    location.replace('/');
    return;
  }
  let events = [];
  try { events = await api('/api/public-events'); } catch (_) { events = []; }
  _renderPickerHtml(events);

  // Use SSE (with polling fallback) to detect list changes instantly.
  if (_pickerVersionStream) return; // already running
  let _pickerVersion = null;
  _pickerVersionStream = createVersionStream({
    url: '/api/events',
    pollUrl: '/api/version',
    pollIntervalMs: _TV_PICKER_POLL_INTERVAL_MS,
    async onVersion(data) {
      if (_pickerVersion !== null && data.version !== _pickerVersion) {
        _pickerVersion = data.version;
        let list = [];
        try { list = await api('/api/public-events'); } catch (_) {}
        // Island already mounted: assign into the store, Petite-Vue patches the DOM.
        _pickerStore.events = Array.isArray(list) ? list : [];
        _pickerStore._settleTab();
      } else {
        _pickerVersion = data.version;
      }
    },
  });
}

function _backToTournaments() {
  _stopAllSchedules();
  TID = null;
  history.replaceState(null, '', '/events');
  _showPicker();
}

/**
 * "Find by ID or alias": exact match only (no name search, to avoid
 * enumeration). Tries a tournament first, then a sign-up lobby.
 */
async function _findEventById(e) {
  e.preventDefault();
  const val = (_pickerStore.findValue || '').trim();
  if (!val) return false;
  _pickerStore.findError = '';
  _pickerStore.finding = true;
  const enc = encodeURIComponent(val);
  try {
    try {
      await api(`/api/tournaments/resolve-alias/${enc}`);
      location.href = `/tv/${enc}`;
      return false;
    } catch (aliasErr) {
      if (aliasErr?.status !== 404) throw aliasErr;
    }
    try {
      await api(`/api/tournaments/${enc}/meta`);
      location.href = `/tv/${enc}`;
      return false;
    } catch (metaErr) {
      if (metaErr?.status !== 404) throw metaErr;
    }
    const res = await fetch(`/api/registrations/${enc}/public`);
    if (res.ok) {
      location.href = `/register/${enc}`;
      return false;
    }
    if (res.status !== 404) throw new Error(`HTTP ${res.status}`);
    _pickerStore.findError = t('txt_events_not_found', { val });
  } catch (_) {
    _pickerStore.findError = t('txt_reg_error');
  } finally {
    _pickerStore.finding = false;
  }
  return false;
}

(async () => {
  if (!TID && !_aliasParam) {
    await _showPicker();
    return;
  }
  const resolved = await _resolveAlias();
  if (!resolved) return;
  _loadPlayerSession();
  await _handleTokenAutoLogin();
  await _tryProfileAutoLogin();
  loadTV();
})();

// ---------------------------------------------------------------------------
// Tournament-scoped player mini-card (clickable name on TV standings)
// ---------------------------------------------------------------------------

const _TV_PLAYER_CARD_AUTO_CLOSE_MS = 30_000;
const _TV_PLAYER_CARD_PREFETCH = new Map();
let _tvPlayerCardAutoCloseTimer = null;

function _tvPlayerNameCell(playerId, playerName) {
  const safe = esc(playerName || playerId || '');
  if (!playerId) return safe;
  const aria = esc(t('txt_tv_open_player_card', { name: playerName || playerId || '' }) || `Open profile for ${playerName || playerId}`);
  return `<button type="button" class="tv-name-btn" aria-label="${aria}" `
    + `onclick="_tvOpenPlayerCard('${esc(playerId)}')" `
    + `onmouseenter="_tvPrefetchPlayerCard('${esc(playerId)}')" `
    + `onfocus="_tvPrefetchPlayerCard('${esc(playerId)}')">${safe}</button>`;
}

function _tvPrefetchPlayerCard(playerId) {
  if (!playerId || !TID) return;
  const key = `${TID}:${playerId}`;
  if (_TV_PLAYER_CARD_PREFETCH.has(key)) return;
  const url = `/api/tournaments/${encodeURIComponent(TID)}/players/${encodeURIComponent(playerId)}/public-card`;
  const promise = fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
  _TV_PLAYER_CARD_PREFETCH.set(key, promise);
  setTimeout(() => _TV_PLAYER_CARD_PREFETCH.delete(key), 12_000);
}

function _tvPlayerCardEnsureOverlay() {
  return ensureMiniCardOverlay({
    id: 'tv-player-card-overlay',
    className: 'tv-player-card-overlay',
    onClose: _tvClosePlayerCard,
  });
}

function _tvClosePlayerCard() {
  if (_tvPlayerCardAutoCloseTimer) {
    clearTimeout(_tvPlayerCardAutoCloseTimer);
    _tvPlayerCardAutoCloseTimer = null;
  }
  hideMiniCardOverlay(document.getElementById('tv-player-card-overlay'));
}

function _tvScheduleAutoClose() {
  if (_tvPlayerCardAutoCloseTimer) clearTimeout(_tvPlayerCardAutoCloseTimer);
  _tvPlayerCardAutoCloseTimer = setTimeout(_tvClosePlayerCard, _TV_PLAYER_CARD_AUTO_CLOSE_MS);
}

async function _tvOpenPlayerCard(playerId) {
  if (!playerId || !TID) return;
  const overlay = _tvPlayerCardEnsureOverlay();
  const loadingLabel = esc(t('txt_txt_loading', {}) || 'Loading…');
  const closeLabel = esc(t('txt_txt_close', {}) || 'Close');
  overlay.innerHTML = `
    <div class="tv-player-card" role="document">
      <button type="button" class="tv-player-card-close" aria-label="${closeLabel}" onclick="_tvClosePlayerCard()">×</button>
      <div class="tv-player-card-loading">${loadingLabel}</div>
    </div>`;
  showMiniCardOverlay(overlay);
  // Reset the inactivity timer on any user activity inside the card.
  overlay.addEventListener('mousemove', _tvScheduleAutoClose);
  overlay.addEventListener('keydown', _tvScheduleAutoClose);
  overlay.addEventListener('click', _tvScheduleAutoClose);
  let card;
  try {
    const key = `${TID}:${playerId}`;
    const prefetched = _TV_PLAYER_CARD_PREFETCH.get(key);
    if (prefetched) {
      card = await prefetched;
      _TV_PLAYER_CARD_PREFETCH.delete(key);
    }
    if (!card) {
      const res = await fetch(`/api/tournaments/${encodeURIComponent(TID)}/players/${encodeURIComponent(playerId)}/public-card`);
      if (!res.ok) throw new Error('http ' + res.status);
      card = await res.json();
    }
  } catch (e) {
    overlay.querySelector('.tv-player-card').innerHTML = `
      <button type="button" class="tv-player-card-close" aria-label="${closeLabel}" onclick="_tvClosePlayerCard()">×</button>
      <div class="tv-player-card-error">${esc(t('txt_tv_player_card_error', {}) || 'Could not load player.')}</div>`;
    _tvScheduleAutoClose();
    return;
  }
  _tvRenderPlayerCard(overlay, card);
  if (typeof applyI18n === 'function') applyI18n(overlay);
  const closeBtn = overlay.querySelector('.tv-player-card-close');
  if (closeBtn) closeBtn.focus();
  _tvScheduleAutoClose();
}

function _tvRenderPlayerCard(overlay, card) {
  const closeLabel = esc(t('txt_txt_close', {}) || 'Close');
  const eloLabel = esc(t('txt_player_elo_label', {}) || 'ELO');
  const matchesLabel = esc(t('txt_txt_matches', {}) || 'Matches');
  const wLabel = esc(t('txt_txt_w_abbrev', {}) || 'W');
  const dLabel = esc(t('txt_txt_d_abbrev', {}) || 'D');
  const lLabel = esc(t('txt_txt_l_abbrev', {}) || 'L');
  const recentLabel = esc(t('txt_tv_player_card_recent', {}) || 'Recent matches in this tournament');
  const emptyRecent = esc(t('txt_tv_player_card_no_recent', {}) || 'No matches yet.');
  const deltaLabel = esc(t('txt_tv_player_card_elo_delta', {}) || 'ELO change');

  const elo = card.elo;
  const delta = card.elo_delta_total;
  const deltaClass = delta > 0 ? 'tv-player-delta-up' : delta < 0 ? 'tv-player-delta-down' : 'tv-player-delta-flat';
  const deltaStr = delta == null ? '—' : (delta > 0 ? '+' : '') + Number(delta).toFixed(1);

  const recent = Array.isArray(card.recent_matches) ? card.recent_matches : [];
  const recentHtml = recent.length === 0
    ? `<div class="tv-player-recent-empty">${emptyRecent}</div>`
    : `<div class="elo-log">${recent.map(m => {
        const d = m.elo_delta;
        const dCls = d > 0 ? 'elo-transition--gain' : d < 0 ? 'elo-transition--loss' : 'elo-transition--neutral';
        const dStr = d == null ? '' : (d > 0 ? '+' : '') + Number(d).toFixed(1);
        const roundTxt = m.round_label || (m.round_number ? `R${m.round_number}` : '');
        const roundChip = roundTxt ? `<span class="elo-log-round">${esc(roundTxt)}</span>` : '';
        const mid = eloScoreSepHtml(m);
        return `<div class="elo-log-row elo-log-row--inline">
          ${roundChip}
          <div class="elo-log-teams">
            <span class="elo-team elo-team--a">${eloTeamPlayersHtml(m.team1)}</span>
            ${mid}
            <span class="elo-team elo-team--b">${eloTeamPlayersHtml(m.team2)}</span>
          </div>
          <span class="elo-transition ${dCls}">${esc(dStr)}</span>
        </div>`;
      }).join('')}</div>`;

  overlay.innerHTML = `
    <div class="tv-player-card" role="document">
      <button type="button" class="tv-player-card-close" aria-label="${closeLabel}" onclick="_tvClosePlayerCard()">×</button>
      <div class="tv-player-card-name">${esc(card.player_name)}</div>
      <div class="tv-player-card-stats">
        <div class="tv-player-stat"><div class="tv-player-stat-label">${eloLabel}</div><div class="tv-player-stat-value">${elo == null ? '—' : Math.round(elo)}</div></div>
        <div class="tv-player-stat"><div class="tv-player-stat-label">${deltaLabel}</div><div class="tv-player-stat-value ${deltaClass}">${deltaStr}</div></div>
        <div class="tv-player-stat"><div class="tv-player-stat-label">${matchesLabel}</div><div class="tv-player-stat-value">${card.matches || 0}</div></div>
        <div class="tv-player-stat"><div class="tv-player-stat-label">${wLabel}/${dLabel}/${lLabel}</div><div class="tv-player-stat-value">${card.wins || 0}/${card.draws || 0}/${card.losses || 0}</div></div>
      </div>
      <div class="tv-player-recent">
        ${recentHtml}
      </div>
    </div>`;
}
