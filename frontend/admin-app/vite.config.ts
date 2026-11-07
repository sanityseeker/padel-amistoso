import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { assetsDir: 'admin-assets' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      [
        '/api',
        '/legacy-admin',
        '/legacy-events',
        '/tv',
        '/register',
        '/legacy-player',
        '/club',
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
