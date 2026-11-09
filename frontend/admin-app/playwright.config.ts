import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exported so specs can mint invite/reset tokens straight into the server's database.
process.env.AMISTOSO_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'amistoso-admin-e2e-'));
const dataDir = process.env.AMISTOSO_E2E_DATA_DIR;
const demoDir = mkdtempSync(join(tmpdir(), 'amistoso-admin-e2e-demo-'));
const testPort = Number(process.env.AMISTOSO_E2E_PORT ?? 8011);
const server = (port: number, dir: string, extra: Record<string, string> = {}) => ({
  command: `../../.venv/bin/python -m uvicorn backend.api:app --app-dir ../.. --host 127.0.0.1 --port ${port}`,
  url: `http://127.0.0.1:${port}/api/config`,
  reuseExistingServer: false,
  env: {
    AMISTOSO_DATA_DIR: dir,
    PADEL_DATA_DIR: dir,
    PADEL_ADMIN_PASSWORD: 'test-admin-2026',
    // Never send real mail from browser tests, whatever the developer's .env says.
    AMISTOSO_SMTP_HOST: '',
    AMISTOSO_DEMO_INSTANCE: '0',
    AMISTOSO_DOMAIN: '',
    PADEL_JWT_SECRET: 'isolated-browser-tests-signing-secret-2026',
    ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    ...extra,
  },
});
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${testPort}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The second server is the demo instance (port 8012): it mints throwaway sandbox accounts.
  webServer: [
    server(testPort, dataDir),
    server(testPort + 1, demoDir, { AMISTOSO_DEMO_INSTANCE: '1' }),
  ],
});
