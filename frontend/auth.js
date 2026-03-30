/**
 * auth.js — Authentication module for the Padel Tournament Manager.
 *
 * Handles login, logout, token storage, and authenticated API requests.
 */

const AUTH_TOKEN_KEY = 'padel-auth-token';
const AUTH_USERNAME_KEY = 'padel-auth-username';
const AUTH_ROLE_KEY = 'padel-auth-role';

function _persistAuthValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      console.error('Failed to save auth value:', e);
    }
  }
}

function _readAuthValue(key) {
  try {
    const localValue = localStorage.getItem(key);
    if (localValue) return localValue;
  } catch (_) {}

  try {
    const sessionValue = sessionStorage.getItem(key);
    if (sessionValue) {
      _persistAuthValue(key, sessionValue);
      return sessionValue;
    }
  } catch (_) {}

  return null;
}

function _removeAuthValue(key) {
  try {
    localStorage.removeItem(key);
  } catch (_) {}

  try {
    sessionStorage.removeItem(key);
  } catch (_) {}
}

// ── Token Management ──────────────────────────────────────

/**
 * Save authentication token to localStorage.
 * @param {string} token - JWT token
 * @param {string} username - Username
 */
function _saveAuthToken(token, username, role) {
  _persistAuthValue(AUTH_TOKEN_KEY, token);
  _persistAuthValue(AUTH_USERNAME_KEY, username);
  _persistAuthValue(AUTH_ROLE_KEY, role || 'user');
}

/**
 * Get the current auth token.
 * @returns {string|null}
 */
function getAuthToken() {
  return _readAuthValue(AUTH_TOKEN_KEY);
}

/**
 * Get the current username.
 * @returns {string|null}
 */
function getAuthUsername() {
  return _readAuthValue(AUTH_USERNAME_KEY);
}

/**
 * Get the current user role.
 * @returns {'admin'|'user'|null}
 */
function getAuthRole() {
  return _readAuthValue(AUTH_ROLE_KEY);
}

/**
 * Return true if the current user has the admin role.
 * @returns {boolean}
 */
function isAdmin() {
  return getAuthRole() === 'admin';
}

/**
 * Check if user is currently authenticated.
 * @returns {boolean}
 */
function isAuthenticated() {
  return !!getAuthToken();
}

/**
 * Clear authentication data.
 */
function clearAuth() {
  _removeAuthValue(AUTH_TOKEN_KEY);
  _removeAuthValue(AUTH_USERNAME_KEY);
  _removeAuthValue(AUTH_ROLE_KEY);
}

// ── Login / Logout ────────────────────────────────────────

/**
 * Attempt to log in with username and password.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{success: boolean, username?: string, error?: string}>}
 */
async function login(username, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.detail || t('txt_txt_login_failed') };
    }

    const data = await res.json();
    _saveAuthToken(data.access_token, data.username, data.role);
    return { success: true, username: data.username };
  } catch (e) {
    return { success: false, error: e.message || t('txt_txt_network_error') };
  }
}

/**
 * Log out the current user.
 */
function logout() {
  clearAuth();
  // Reload the page to reset state
  window.location.reload();
}

// ── Authenticated API Requests ────────────────────────────

/**
 * Make an authenticated API request.
 * Automatically includes auth token if available.
 * Shows login dialog on 401 responses.
 * 
 * @param {string} path - API path
 * @param {object} opts - Fetch options
 * @returns {Promise<any>}
 */
async function apiAuth(path, opts = {}) {
  const retries = opts._retries || 0;
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };

  // Add auth token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...opts,
    headers,
  });

  // Handle 401 - show login dialog (max 2 retries to prevent infinite loop)
  if (res.status === 401) {
    clearAuth();
    if (retries >= 2) {
      throw new Error('Authentication failed after multiple attempts');
    }
    await showLoginDialog();
    // Retry the request after login
    return apiAuth(path, { ...opts, _retries: retries + 1 });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    const msg = Array.isArray(detail)
      ? detail.map(d => d.msg || JSON.stringify(d)).join('; ')
      : (typeof detail === 'string' ? detail : null);
    throw new Error(msg || res.statusText);
  }

  // 204 No Content — return null instead of trying to parse an empty body
  if (res.status === 204) return null;

  return res.json();
}

// ── Login Dialog ──────────────────────────────────────────

let _loginResolve = null;

/**
 * Show the login dialog and wait for user to log in.
 * @returns {Promise<void>}
 */
function showLoginDialog() {
  return new Promise((resolve) => {
    _loginResolve = resolve;
    const dialog = document.getElementById('auth-dialog');
    const overlay = document.getElementById('auth-overlay');
    if (dialog && overlay) {
      overlay.style.display = 'block';
      dialog.style.display = 'block';
      document.body.classList.add('login-dialog-open');
      // Focus username input
      const usernameInput = document.getElementById('auth-username');
      if (usernameInput) usernameInput.focus();
    }
  });
}

/**
 * Hide the login dialog.
 */
function hideLoginDialog() {
  const dialog = document.getElementById('auth-dialog');
  const overlay = document.getElementById('auth-overlay');
  if (dialog && overlay) {
    overlay.style.display = 'none';
    dialog.style.display = 'none';
    document.body.classList.remove('login-dialog-open');
  }
  // Clear inputs
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  const errorDiv = document.getElementById('auth-error');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (errorDiv) errorDiv.textContent = '';
  // If the user dismissed without logging in, redirect to the info tab
  if (!isAuthenticated() && typeof setActiveTab === 'function') {
    setActiveTab('info');
  }
}

/**
 * Handle login form submission.
 */
async function handleLogin(event) {
  if (event) event.preventDefault();

  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  const errorDiv = document.getElementById('auth-error');
  const loginBtn = document.getElementById('auth-login-btn');

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value;

  if (!username || !password) {
    if (errorDiv) errorDiv.textContent = t('txt_txt_please_enter_username_and_password');
    return;
  }

  // Disable button during login
  if (loginBtn) loginBtn.disabled = true;
  if (errorDiv) errorDiv.textContent = '';

  const result = await login(username, password);

  if (result.success) {
    hideLoginDialog();
    if (_loginResolve) {
      _loginResolve();
      _loginResolve = null;
    }
    // Update UI to show logged-in state
    updateAuthUI();
  } else {
    if (errorDiv) errorDiv.textContent = result.error || t('txt_txt_login_failed');
    if (loginBtn) loginBtn.disabled = false;
  }
}

/**
 * Update UI elements to reflect authentication state.
 */
function updateAuthUI() {
  const username = getAuthUsername();
  const authStatus = document.getElementById('auth-status');
  
  if (authStatus) {
    if (username) {
      const adminBtn = isAdmin()
        ? `<button class="btn btn-sm" onclick="showUserMgmt()" style="padding:0.3rem 0.6rem;margin-right:0.25rem" title="User management">👥</button>`
        : '';
      const changePwdBtn = `<button class="btn btn-sm" onclick="showChangePasswordDialog()" style="padding:0.3rem 0.6rem;margin-right:0.25rem" title="${t('txt_txt_change_password')}">🔑</button>`;
      authStatus.innerHTML = `
        ${adminBtn}${changePwdBtn}<strong style="margin-right:0.5rem">${esc(username)}</strong>
        <button class="btn btn-sm" onclick="logout()" style="padding:0.3rem 0.6rem">${t('txt_txt_logout')}</button>
      `;
    } else {
      authStatus.innerHTML = `
        <button class="btn btn-sm" onclick="showLoginDialog()" style="background:var(--green);color:#fff;border:none;padding:0.4rem 0.8rem;font-weight:600">🔓 ${t('txt_txt_login')}</button>
      `;
    }
  }
}

// ── User Management (admin only) ──────────────────────────

/**
 * Show the user management modal.
 */
function showUserMgmt() {
  const overlay = document.getElementById('user-mgmt-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    const search = document.getElementById('user-mgmt-search');
    if (search) search.value = '';
    loadUserMgmtList();
  }
}

/**
 * Hide the user management modal.
 */
function hideUserMgmt() {
  const overlay = document.getElementById('user-mgmt-overlay');
  if (overlay) overlay.style.display = 'none';
  const err = document.getElementById('user-mgmt-error');
  if (err) err.textContent = '';
  const success = document.getElementById('user-mgmt-success');
  if (success) success.textContent = '';
}

/** Full user list, kept in memory so filtering is instant. */
let _allUsers = [];

/**
 * Fetch and render the user list in the management modal.
 */
async function loadUserMgmtList() {
  const list = document.getElementById('user-mgmt-list');
  if (!list) return;
  list.innerHTML = '<li style="opacity:.5">Loading…</li>';
  try {
    _allUsers = await apiAuth('/api/auth/users');
    const search = document.getElementById('user-mgmt-search');
    filterUserMgmtList(search ? search.value : '');
  } catch (e) {
    list.innerHTML = `<li style="color:var(--red)">${e.message}</li>`;
  }
}

/**
 * Re-render the user list filtered by the given query.
 * @param {string} query
 */
function filterUserMgmtList(query) {
  const list = document.getElementById('user-mgmt-list');
  if (!list) return;
  const q = query.trim().toLowerCase();
  const users = q ? _allUsers.filter(u => u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)) : _allUsers;
  if (!users.length) {
    list.innerHTML = '<li style="opacity:.5">No users found.</li>';
    return;
  }
  list.innerHTML = users.map(u => `
    <li style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0">
      <span style="flex:1"><strong>${esc(u.username)}</strong>
        <span style="font-size:0.8em;opacity:.7;margin-left:0.4rem">${esc(u.role)}</span>
        ${u.email ? `<span style="font-size:0.78em;color:var(--text-muted);margin-left:0.4rem">${esc(u.email)}</span>` : ''}
      </span>
      ${u.username !== getAuthUsername() ? `<button class="btn btn-sm" onclick="showChangePasswordDialog('${esc(u.username)}')" style="padding:0.2rem 0.55rem" title="${t('txt_txt_change_password')}">🔑</button><button class="btn btn-sm btn-danger" onclick="deleteUserWithConfirm('${esc(u.username)}')" style="padding:0.2rem 0.55rem">🗑</button>` : `<span style="font-size:0.7rem;color:var(--text-muted);padding:0.15rem 0.45rem;border:1px solid var(--border);border-radius:4px;white-space:nowrap" title="${t('txt_txt_protected')}">🔒</span>`}
    </li>`).join('');
}

/**
 * Handle create-user form submission in the user management modal.
 * @param {Event} event
 */
async function handleCreateUser(event) {
  event.preventDefault();
  const errDiv = document.getElementById('user-mgmt-error');
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value;
  const email = document.getElementById('new-user-email')?.value.trim() || '';
  const roleRadio = document.querySelector('input[name="new-user-role"]:checked');
  const role = roleRadio ? roleRadio.value : 'user';
  if (!username || !password) {
    if (errDiv) errDiv.textContent = 'Username and password are required.';
    return;
  }
  try {
    await apiAuth('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role, email: email || null }),
    });
    if (errDiv) errDiv.textContent = '';
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
    const emailInput = document.getElementById('new-user-email');
    if (emailInput) emailInput.value = '';
    const userRadio = document.querySelector('input[name="new-user-role"][value="user"]');
    if (userRadio) userRadio.checked = true;
    const successDiv = document.getElementById('user-mgmt-success');
    if (successDiv) { successDiv.textContent = t('txt_txt_user_created_successfully'); setTimeout(() => { successDiv.textContent = ''; }, 3000); }
    await loadUserMgmtList();
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  }
}

/**
 * Confirm and delete a user.
 * @param {string} username
 */
async function deleteUserWithConfirm(username) {
  if (!confirm(t('txt_txt_delete_user_confirm').replace('{username}', username))) return;
  const errDiv = document.getElementById('user-mgmt-error');
  try {
    await apiAuth(`/api/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    await loadUserMgmtList();
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  }
}

// ── Invite By Email ──────────────────────────────────────

/**
 * Handle the invite-by-email form submission.
 * @param {Event} event
 */
async function handleInvite(event) {
  event.preventDefault();
  const errDiv = document.getElementById('invite-error');
  const successDiv = document.getElementById('invite-success');
  const btn = document.getElementById('invite-btn');
  const email = document.getElementById('invite-email')?.value.trim();
  const roleRadio = document.querySelector('input[name="invite-role"]:checked');
  const role = roleRadio ? roleRadio.value : 'user';

  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';

  if (!email) {
    if (errDiv) errDiv.textContent = 'Email address is required.';
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await apiAuth('/api/auth/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    document.getElementById('invite-email').value = '';
    const userInviteRadio = document.querySelector('input[name="invite-role"][value="user"]');
    if (userInviteRadio) userInviteRadio.checked = true;
    if (successDiv) { successDiv.textContent = `Invite sent to ${email}.`; setTimeout(() => { successDiv.textContent = ''; }, 4000); }
  } catch (e) {
    if (errDiv) errDiv.textContent = e.status === 503 ? 'Email is not configured on this server.' : e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Forgot / Reset Password ───────────────────────────────

/**
 * Show the forgot-password dialog.
 */
function showForgotPasswordDialog() {
  hideLoginDialog();
  const overlay = document.getElementById('forgot-pwd-overlay');
  const dialog = document.getElementById('forgot-pwd-dialog');
  if (overlay && dialog) {
    overlay.style.display = 'block';
    dialog.style.display = 'block';
    document.getElementById('forgot-pwd-email')?.focus();
  }
}

/**
 * Hide the forgot-password dialog and reset its fields.
 */
function hideForgotPasswordDialog() {
  const overlay = document.getElementById('forgot-pwd-overlay');
  const dialog = document.getElementById('forgot-pwd-dialog');
  if (overlay) overlay.style.display = 'none';
  if (dialog) dialog.style.display = 'none';
  const emailInput = document.getElementById('forgot-pwd-email');
  if (emailInput) emailInput.value = '';
  const errDiv = document.getElementById('forgot-pwd-error');
  const successDiv = document.getElementById('forgot-pwd-success');
  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';
}

/**
 * Handle the forgot-password form submission.
 * @param {Event} event
 */
async function handleForgotPassword(event) {
  event.preventDefault();
  const errDiv = document.getElementById('forgot-pwd-error');
  const successDiv = document.getElementById('forgot-pwd-success');
  const btn = document.getElementById('forgot-pwd-btn');
  const email = document.getElementById('forgot-pwd-email')?.value.trim();

  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';

  if (!email) {
    if (errDiv) errDiv.textContent = 'Please enter your email address.';
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.status === 503) {
      if (errDiv) errDiv.textContent = 'Email is not configured on this server.';
      return;
    }
    // Always show the same message regardless of whether the email exists (anti-enumeration).
    if (successDiv) successDiv.textContent = 'If that email is registered, a reset link has been sent.';
    if (document.getElementById('forgot-pwd-email')) document.getElementById('forgot-pwd-email').value = '';
  } catch (e) {
    if (errDiv) errDiv.textContent = 'An error occurred. Please try again.';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Accept Invite ─────────────────────────────────────────

/** Raw invite token from the URL (set during initAuth). */
let _inviteToken = null;

/**
 * Show the accept-invite modal for the given token.
 * @param {string} token
 */
async function showAcceptInviteDialog(token) {
  _inviteToken = token;
  const overlay = document.getElementById('accept-invite-overlay');
  const dialog = document.getElementById('accept-invite-dialog');
  const subtitle = document.getElementById('accept-invite-subtitle');
  const errDiv = document.getElementById('accept-invite-error');

  if (!overlay || !dialog) return;

  if (subtitle) subtitle.textContent = 'Validating your invite link…';
  overlay.style.display = 'block';
  dialog.style.display = 'flex';

  try {
    const res = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`);
    if (!res.ok) {
      if (subtitle) subtitle.textContent = '';
      if (errDiv) errDiv.textContent = 'This invite link is invalid or has expired.';
      document.getElementById('accept-invite-btn').disabled = true;
      return;
    }
    const data = await res.json();
    if (subtitle) subtitle.textContent = `You've been invited as ${data.role} — ${data.email}`;
    document.getElementById('accept-invite-username')?.focus();
  } catch (e) {
    if (errDiv) errDiv.textContent = 'Could not validate invite link.';
  }
}

/**
 * Handle accept-invite form submission.
 * @param {Event} event
 */
async function handleAcceptInvite(event) {
  event.preventDefault();
  const errDiv = document.getElementById('accept-invite-error');
  const successDiv = document.getElementById('accept-invite-success');
  const btn = document.getElementById('accept-invite-btn');
  const username = document.getElementById('accept-invite-username')?.value.trim();
  const password = document.getElementById('accept-invite-password')?.value;
  const confirm = document.getElementById('accept-invite-confirm')?.value;

  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';

  if (!username || !password) {
    if (errDiv) errDiv.textContent = 'Username and password are required.';
    return;
  }
  if (password !== confirm) {
    if (errDiv) errDiv.textContent = 'Passwords do not match.';
    return;
  }
  if (password.length < 8) {
    if (errDiv) errDiv.textContent = 'Password must be at least 8 characters.';
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await fetch(`/api/auth/invite/${encodeURIComponent(_inviteToken)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async res => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to create account.');
      }
      return res.json();
    });
    if (successDiv) successDiv.textContent = 'Account created! You can now log in.';
    // Remove token from URL without reloading
    const url = new URL(window.location.href);
    url.searchParams.delete('invite_token');
    window.history.replaceState({}, '', url);
    setTimeout(() => showLoginDialog(), 2000);
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Reset Password ────────────────────────────────────────

/** Raw reset token from the URL (set during initAuth). */
let _resetToken = null;

/**
 * Show the reset-password modal for the given token.
 * @param {string} token
 */
function showResetPasswordDialog(token) {
  _resetToken = token;
  const overlay = document.getElementById('reset-pwd-overlay');
  const dialog = document.getElementById('reset-pwd-dialog');
  if (overlay && dialog) {
    overlay.style.display = 'block';
    dialog.style.display = 'flex';
    document.getElementById('reset-pwd-new')?.focus();
  }
}

/**
 * Handle reset-password form submission.
 * @param {Event} event
 */
async function handleResetPassword(event) {
  event.preventDefault();
  const errDiv = document.getElementById('reset-pwd-error');
  const successDiv = document.getElementById('reset-pwd-success');
  const btn = document.getElementById('reset-pwd-btn');
  const newPwd = document.getElementById('reset-pwd-new')?.value;
  const confirmPwd = document.getElementById('reset-pwd-confirm')?.value;

  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';

  if (!newPwd || !confirmPwd) {
    if (errDiv) errDiv.textContent = 'Please fill in both password fields.';
    return;
  }
  if (newPwd !== confirmPwd) {
    if (errDiv) errDiv.textContent = 'Passwords do not match.';
    return;
  }
  if (newPwd.length < 8) {
    if (errDiv) errDiv.textContent = 'Password must be at least 8 characters.';
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/auth/reset-password/${encodeURIComponent(_resetToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: newPwd }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Reset link is invalid or has expired.');
    }
    if (successDiv) successDiv.textContent = 'Password reset! You can now log in.';
    // Remove token from URL
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', url);
    setTimeout(() => showLoginDialog(), 2000);
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Change Password ──────────────────────────────────────

/** Username whose password is being changed. Defaults to the current user. */
let _changePwdTarget = null;

/**
 * Show the change-password dialog.
 * @param {string} [targetUsername] - The user whose password will be changed.
 *   Defaults to the currently logged-in user.
 */
function showChangePasswordDialog(targetUsername) {
  _changePwdTarget = targetUsername || getAuthUsername();
  const overlay = document.getElementById('change-pwd-overlay');
  if (!overlay) return;
  const label = document.getElementById('change-pwd-for');
  if (label) {
    label.textContent = _changePwdTarget !== getAuthUsername()
      ? `${t('txt_txt_username')}: ${_changePwdTarget}`
      : '';
  }
  overlay.style.display = 'flex';
  document.getElementById('change-pwd-new')?.focus();
}

/**
 * Hide the change-password dialog and reset its fields.
 */
function hideChangePasswordDialog() {
  _changePwdTarget = null;
  const overlay = document.getElementById('change-pwd-overlay');
  if (overlay) overlay.style.display = 'none';
  const newPwd = document.getElementById('change-pwd-new');
  const confirmPwd = document.getElementById('change-pwd-confirm');
  const errDiv = document.getElementById('change-pwd-error');
  const successDiv = document.getElementById('change-pwd-success');
  if (newPwd) newPwd.value = '';
  if (confirmPwd) confirmPwd.value = '';
  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';
  const label = document.getElementById('change-pwd-for');
  if (label) label.textContent = '';
}

/**
 * Handle the change-password form submission.
 * @param {Event} event
 */
async function handleChangePassword(event) {
  event.preventDefault();
  const newPwd = document.getElementById('change-pwd-new')?.value;
  const confirmPwd = document.getElementById('change-pwd-confirm')?.value;
  const errDiv = document.getElementById('change-pwd-error');
  const successDiv = document.getElementById('change-pwd-success');
  const btn = document.getElementById('change-pwd-btn');

  if (errDiv) errDiv.textContent = '';
  if (successDiv) successDiv.textContent = '';

  if (!newPwd || !confirmPwd) {
    if (errDiv) errDiv.textContent = t('txt_txt_please_enter_username_and_password');
    return;
  }

  if (newPwd !== confirmPwd) {
    if (errDiv) errDiv.textContent = t('txt_txt_passwords_do_not_match');
    return;
  }

  const username = _changePwdTarget || getAuthUsername();
  if (!username) return;

  if (btn) btn.disabled = true;
  try {
    await apiAuth(`/api/auth/users/${encodeURIComponent(username)}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ new_password: newPwd }),
    });
    if (successDiv) successDiv.textContent = t('txt_txt_password_changed_successfully');
    document.getElementById('change-pwd-new').value = '';
    document.getElementById('change-pwd-confirm').value = '';
    setTimeout(() => hideChangePasswordDialog(), 2000);
  } catch (e) {
    if (errDiv) errDiv.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Initialization ────────────────────────────────────────

/**
 * Initialize auth module (check token, update UI).
 */
function initAuth() {
  updateAuthUI();

  // Add enter key handler to login form
  const passwordInput = document.getElementById('auth-password');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }

  // Handle invite and reset-password tokens in the URL.
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite_token');
  const resetToken = params.get('reset_token');
  if (inviteToken) {
    showAcceptInviteDialog(inviteToken);
  } else if (resetToken) {
    showResetPasswordDialog(resetToken);
  }
}
