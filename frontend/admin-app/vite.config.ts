import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // manifest.json lists every hashed file; the backend turns it into the service worker's precache list.
    assetsDir: 'admin-assets',
    manifest: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache across deploys; app code changes more often. @mantine/charts and
        // recharts stay out of the eager chunks: only the Hub and Ratings routes import them (lazy).
        // @mantine/carousel and @mantine/spotlight too: the phone swipe strip and the command palette
        // load on first use.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
            {
              name: 'mantine',
              test: /node_modules[\\/]@mantine[\\/](?!charts|carousel|spotlight)/,
            },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'i18n', test: /node_modules[\\/](i18next|react-i18next)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      [
        '/api',
        '/legacy',
        '/manifest.json',
        '/service-worker.js',
        '^/[^/]+\\.(?:js|css|png|ico|json)$',
      ].map((path) => [
        path,
        // Preserve the browser-facing Host so FastAPI's same-origin CSRF
        // validation works without weakening the backend's allowed origins.
        { target: 'http://127.0.0.1:8000', changeOrigin: false },
      ]),
    ),
  },
});
