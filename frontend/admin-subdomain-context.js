/* ── Admin subdomain context banner ───────────────────────
 *
 * When the admin SPA is loaded on a club subdomain (e.g.
 * ``myclub.amistoso.club/admin``), inject a sticky top banner that tells the
 * operator which club they're managing and links back to the platform-wide
 * admin at the apex.
 *
 * The full admin SPA stays unchanged — this is purely informational. All
 * admin API calls remain subject to the same server-side permission checks.
 */
'use strict';

(async function _adminSubdomainContextInit() {
  if (typeof resolveClubSubdomainContext !== 'function') return;
  let club = null;
  try { club = await resolveClubSubdomainContext(); } catch (_) { /* ignore */ }
  if (!club || !club.club_id) return;
  if (sessionStorage.getItem('admin-subdomain-banner-dismissed') === '1') return;

  // Expose to the rest of the admin SPA so other modules can opportunistically
  // pre-select this club in their pickers.
  window.__ADMIN_SUBDOMAIN_CLUB__ = club;
  // Re-render the nav bar so the communities button is hidden immediately.
  if (typeof updateAuthUI === 'function') updateAuthUI();

  // Prefer the server's notion of the apex (``apex_origin`` from /api/config,
  // which honours AMISTOSO_DOMAIN); fall back to stripping one label.
  let apexOrigin = null;
  try {
    const cfg = await fetch('/api/config').then((r) => (r.ok ? r.json() : null));
    if (cfg && typeof cfg.apex_origin === 'string' && /^https?:\/\//.test(cfg.apex_origin)) apexOrigin = cfg.apex_origin;
  } catch (_) { /* ignore */ }
  const _apexUrl = new URL(apexOrigin || location.origin);
  if (!apexOrigin) {
    _apexUrl.hostname = location.hostname.split('.').slice(1).join('.') || location.hostname;
    _apexUrl.port = location.port;
  }
  _apexUrl.pathname = '/admin';
  _apexUrl.search = '';
  _apexUrl.hash = '';
  const apexUrl = _apexUrl.href;

  const banner = document.createElement('div');
  banner.className = 'admin-subdomain-banner';
  banner.setAttribute('role', 'status');

  const labelTpl = (typeof t === 'function' && t('txt_admin_subdomain_banner'))
    || '{club}';
  const label = labelTpl.replace('{club}', club.name || club.slug || '');

  const dismissLabel = (typeof t === 'function' && t('txt_admin_subdomain_dismiss')) || 'Dismiss';
  const apexLabel = (typeof t === 'function' && t('txt_admin_subdomain_open_apex')) || 'Open platform admin';

  const logo = club.logo_url
    ? `<img class="admin-subdomain-logo" src="${esc(club.logo_url)}" alt="">`
    : '';

  banner.innerHTML = `
    ${logo}
    <span class="admin-subdomain-text">${esc(label)}</span>
    <a class="admin-subdomain-link" href="${esc(apexUrl)}">${esc(apexLabel)}</a>
    <button type="button" class="admin-subdomain-dismiss" aria-label="${esc(dismissLabel)}">×</button>
  `;

  banner.querySelector('.admin-subdomain-dismiss').addEventListener('click', () => {
    try { sessionStorage.setItem('admin-subdomain-banner-dismissed', '1'); } catch (_) {}
    // Reload so any panel that auto-filtered/auto-selected by the subdomain
    // club re-evaluates with __ADMIN_SUBDOMAIN_CLUB__ unset.
    window.location.reload();
  });

  document.body.insertBefore(banner, document.body.firstChild);
})();
