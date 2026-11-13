import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8788', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:8788/api/session',
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
