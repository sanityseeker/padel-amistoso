/**
 * auth.js — Authentication module for the Padel Tournament Manager.
 *
 * Handles login, logout, token storage, and authenticated API requests.
 */

const AUTH_TOKEN_KEY = 'padel-auth-token';
const AUTH_USERNAME_KEY = 'padel-auth-username';
const AUTH_ROLE_KEY = 'padel-auth-role';

// ── Token Management ──────────────────────────────────────

/**
 * Save authentication token to localStorage.
 * @param {string} token - JWT token
 * @param {string} username - Username
 */
function _saveAuthToken(token, username, role) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USERNAME_KEY, username);
    localStorage.setItem(AUTH_ROLE_KEY, role || 'user');
  } catch (e) {
    console.error('Failed to save auth token:', e);
  }
}

/**
 * Get the current auth token from localStorage.
 * @returns {string|null}
 */
function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

/**
 * Get the current username from localStorage.
 * @returns {string|null}
 */
function getAuthUsername() {
  try {
    return localStorage.getItem(AUTH_USERNAME_KEY);
  } catch (e) {
    return null;
  }
}

/**
 * Get the current user role from localStorage.
 * @returns {'admin'|'user'|null}
 */
function getAuthRole() {
  try {
    return localStorage.getItem(AUTH_ROLE_KEY);
  } catch (e) {
    return null;
  }
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
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
  } catch (e) {
    console.error('Failed to clear auth:', e);
  }
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
    throw new Error(err.detail || res.statusText);
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

/**
 * Fetch and render the user list in the management modal.
 */
async function loadUserMgmtList() {
  const list = document.getElementById('user-mgmt-list');
  if (!list) return;
  list.innerHTML = '<li style="opacity:.5">Loading…</li>';
  try {
    const users = await apiAuth('/api/auth/users');
    if (!users.length) {
      list.innerHTML = '<li style="opacity:.5">No users found.</li>';
      return;
    }
    list.innerHTML = users.map(u => `
      <li style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0">
        <span style="flex:1"><strong>${esc(u.username)}</strong>
          <span style="font-size:0.8em;opacity:.7;margin-left:0.4rem">${esc(u.role)}</span>
        </span>
        ${u.username !== getAuthUsername() ? `<button class="btn btn-sm btn-danger" onclick="deleteUserWithConfirm('${esc(u.username)}')" style="padding:0.2rem 0.55rem">🗑</button>` : `<span style="font-size:0.7rem;color:var(--text-muted);padding:0.15rem 0.45rem;border:1px solid var(--border);border-radius:4px;white-space:nowrap" title="${t('txt_txt_protected')}">🔒</span>`}
      </li>`).join('');
  } catch (e) {
    list.innerHTML = `<li style="color:var(--red)">${e.message}</li>`;
  }
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
      body: JSON.stringify({ username, password, role }),
    });
    if (errDiv) errDiv.textContent = '';
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
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

// ── Change Password ──────────────────────────────────────

/**
 * Show the change-password dialog.
 */
function showChangePasswordDialog() {
  const overlay = document.getElementById('change-pwd-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    document.getElementById('change-pwd-new')?.focus();
  }
}

/**
 * Hide the change-password dialog and reset its fields.
 */
function hideChangePasswordDialog() {
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

  const username = getAuthUsername();
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
}
