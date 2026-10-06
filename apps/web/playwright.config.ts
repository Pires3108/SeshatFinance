import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  use: {
    baseURL: 'http://localhost:3100',
    browserName: 'chromium',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'pnpm exec next dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: { SESHAT_API_URL: 'http://localhost:3101' },
    timeout: 120_000,
  },
});
