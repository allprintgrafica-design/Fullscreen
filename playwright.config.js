import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullscreen-e2e-'));
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const environment = {
  DATA_DIR: dataDir,
  JWT_SECRET: 'e2e-only-secret-never-use-in-production-123456789',
  ADMIN_EMAIL: 'e2e-owner@test.local',
  ADMIN_PASSWORD: 'E2eOwnerSecure2026!',
  APP_ORIGIN: 'http://localhost:5174',
  NODE_ENV: 'test',
  PORT: '3002',
  TRUST_PROXY: '0',
};

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node server/index.js',
      url: 'http://127.0.0.1:3002/api/health',
      env: environment,
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174',
      url: 'http://localhost:5174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3002' },
      reuseExistingServer: false,
    },
  ],
});
