// Service worker — optimal caching for performance + freshness.
const CACHE_NAME = 'amistoso-v24';
const STATIC_ASSETS = [
  '/shared.js', '/auth.js', '/i18n.js', '/manifest.json',
  '/admin-utils.js', '/admin-tournaments.js', '/admin-create.js',
  '/admin-gp.js', '/admin-mex.js', '/admin-player-codes.js',
  '/admin-tv-email.js', '/admin-registration.js', '/admin-convert.js',
  '/admin-collaborators.js',
  '/tv.js', '/register.js',
  '/admin.css', '/tv.css', '/register.css',
];
const SHELL = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([...SHELL, ...STATIC_ASSETS])
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

  // Let API calls pass through to the network (no caching).
  if (url.pathname.startsWith('/api/')) return;

  // HTML pages: network-first (always fresh, offline fallback from cache).
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
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
      icon: '/assets/icons/icon-192x192.png',
      badge: '/assets/icons/icon-192x192.png',
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
