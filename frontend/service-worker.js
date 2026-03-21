// Minimal service worker — required for PWA installability.
// No caching strategy is applied; all requests go to the network.
self.addEventListener('fetch', () => {});
