import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE, env } from './src/config/env';

// The web trader is a desktop-first terminal; a wide viewport keeps all panels visible.
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } };

export default defineConfig({
  testDir: './tests',
  // Every test shares one demo trading account, so orders and positions created by one test
  // are visible to the others. Run serially to keep the account state predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: env.isCI,
  retries: env.isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: env.baseUrl || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: desktop,
    },
    {
      name: 'smoke',
      testDir: './tests/smoke',
      use: desktop,
    },
    {
      name: 'trading',
      testDir: './tests/trading',
      dependencies: ['setup'],
      use: { ...desktop, storageState: AUTH_FILE },
    },
  ],
});
