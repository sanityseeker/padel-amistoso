/**
 * auth.js — Authentication module for the Padel Tournament Manager.
 *
 * Handles login, logout, token storage, and authenticated API requests.
 */

const AUTH_TOKEN_KEY = 'padel-auth-token';
const AUTH_USERNAME_KEY = 'padel-auth-username';

// ── Token Management ──────────────────────────────────────

/**
 * Save authentication token to localStorage.
 * @param {string} token - JWT token
 * @param {string} username - Username
 */
function _saveAuthToken(token, username) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USERNAME_KEY, username);
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
    _saveAuthToken(data.access_token, data.username);
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

  // Handle 401 - show login dialog
  if (res.status === 401) {
    clearAuth();
    await showLoginDialog();
    // Retry the request after login
    return apiAuth(path, opts);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }

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
  }
  // Clear inputs
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  const errorDiv = document.getElementById('auth-error');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (errorDiv) errorDiv.textContent = '';
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
      authStatus.innerHTML = `
        <strong style="margin-right:0.5rem">${esc(username)}</strong>
        <button class="btn btn-sm" onclick="logout()" style="padding:0.3rem 0.6rem">${t('txt_txt_logout')}</button>
      `;
    } else {
      authStatus.innerHTML = `
        <button class="btn btn-sm" onclick="showLoginDialog()" style="background:var(--green);color:#fff;border:none;padding:0.4rem 0.8rem;font-weight:600">🔓 ${t('txt_txt_login')}</button>
      `;
    }
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
