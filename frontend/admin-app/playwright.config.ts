import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'amistoso-admin-e2e-'));
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8011', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      '../../.venv/bin/python -m uvicorn backend.api:app --app-dir ../.. --host 127.0.0.1 --port 8011',
    url: 'http://127.0.0.1:8011/api/config',
    reuseExistingServer: false,
    env: {
      AMISTOSO_DATA_DIR: dataDir,
      PADEL_DATA_DIR: dataDir,
      PADEL_ADMIN_PASSWORD: 'test-admin-2026',
      AMISTOSO_DEMO_INSTANCE: '0',
      AMISTOSO_DOMAIN: '',
      PADEL_JWT_SECRET: 'isolated-browser-tests-signing-secret-2026',
      ALLOWED_ORIGINS: 'http://127.0.0.1:8011',
    },
  },
});
