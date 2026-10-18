import { defineConfig, devices } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: '.',
  testMatch: ['**/e2e/*.pw.ts', '**/tests/e2e/*.e2e.ts'],
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${String(port)}`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --hostname localhost --port ${String(port)}`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      SESHAT_API_URL: 'http://localhost:3101',
    },
  },
});
