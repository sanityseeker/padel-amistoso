// Service worker — optimal caching for performance + freshness.
// The backend appends a hash of the React build to this name and fills SPA_ASSETS
// with the hashed /admin-assets/* files (see _render_service_worker in backend/api).
const CACHE_NAME = 'amistoso-v119';
const STATIC_ASSETS = [
  '/shared.js', '/auth.js', '/i18n.js', '/manifest.json',
  '/admin-utils.js', '/admin-tournaments.js', '/admin-create.js',
  '/admin-gp.js', '/admin-mex.js', '/admin-export.js', '/admin-player-codes.js',
  '/admin-tv-email.js', '/admin-registration.js', '/admin-convert.js',
  '/admin-collaborators.js', '/admin-settings-panel.js',
  '/admin-lobby-settings-panel.js', '/admin-payments.js', '/admin-players.js',
  '/admin-communities.js', '/admin-clubs-settings-panel.js',
  '/admin-clubs.js', '/admin-subdomain-context.js',
  '/tv.js', '/register.js', '/player.js', '/club.js',
  '/theme.css', '/admin.css', '/tv.css', '/register.css', '/player.css',
  '/club.css',
  '/icon-192.png', '/icon-192-maskable.png', '/icon-512.png',
  '/icon-512-maskable.png', '/404.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/petite-vue@0.4.1/dist/petite-vue.iife.js',
  'https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.3.3/dist/purify.min.js',
];
const SHELL = ['/', '/events', '/player', '/admin'];
const SPA_ASSETS = [/*__SPA_ASSETS__*/];
// React routes that all resolve to the same shell, and the cached page used offline.
const SPA_PREFIXES = ['/admin', '/player', '/events', '/tv', '/register', '/club'];
const SPA_OFFLINE_SHELL = '/events';
// Never store a page whose URL carries a credential.
const SENSITIVE_PARAMS = ['invite_token', 'reset_token', 'player_token', 'token'];

const isSpaPath = (pathname) =>
  SPA_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
const hasSensitiveParam = (url) => SENSITIVE_PARAMS.some((p) => url.searchParams.has(p));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([...SHELL, ...STATIC_ASSETS, ...SPA_ASSETS])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only GET responses are cacheable; let everything else hit the network untouched.
  if (request.method !== 'GET') return;

  // Let API calls pass through to the network (never cached, never authenticated HTML).
  if (url.pathname.startsWith('/api/')) return;

  // Hashed React build files never change: cache-first.
  if (url.pathname.startsWith('/admin-assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // HTML pages: network-first (always fresh, offline fallback from cache).
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    const sensitive = hasSensitiveParam(url);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !sensitive) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (isSpaPath(url.pathname)) return caches.match(SPA_OFFLINE_SHELL);
          return caches.match(request).then((cached) => cached || caches.match('/'));
        })
    );
    return;
  }

  // Static assets (JS, manifest, icons): stale-while-revalidate
  // — serve instantly from cache, refresh in background for next load.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

// ── Web Push Notifications ──────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Torneos', body: event.data.text() };
  }
  const { title = 'Torneos', body = '', url = '/', tag = 'amistoso' } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab navigated to the same tournament if possible.
      for (const client of clients) {
        if (new URL(client.url).pathname === target && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
