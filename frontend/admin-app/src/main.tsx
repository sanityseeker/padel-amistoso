// Registers the beforeinstallprompt listener at load, before React renders.
import './pwa/install';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Providers } from './app/providers';
import { ready as languageReady } from './i18n';
import { createAppRouter } from './router';
import { applyHashMigration } from './shell/hashMigration';

declare global {
  interface Window {
    /** Changes only when the document is reloaded; e2e uses it to prove no-reload switching. */
    __bootId?: string;
  }
}
window.__bootId = Math.random().toString(36).slice(2);

// This tab now counts as a started browser session. The old vanilla pages (still served for the
// no-build fallback) apply a cold-start redirect unless this flag is set.
try {
  sessionStorage.setItem('amistoso-session-active', '1');
} catch {
  /* Storage unavailable: those pages simply apply their cold-start rule. */
}

// After a deploy the previous build's hashed chunks are gone. Reload once into the
// new build instead of leaving a blank screen; the guard prevents a reload loop.
const CHUNK_RELOAD_KEY = 'amistoso-chunk-reload';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  } catch {
    return;
  }
  window.location.reload();
});
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* Nothing to clear. */
  }
}, 10_000);

// Offline shell + precached build (the backend fills in the file list). Registered
// after load so it never competes with first paint; skipped under the Vite dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => undefined);
  });

applyHashMigration();
const router = createAppRouter();

// Render once the stored language's texts are in; a failed load falls back to English.
void languageReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
});
