import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE, env } from './src/config/env';

// The web trader is a desktop-first terminal; a wide viewport keeps all panels visible.
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } };
const loggedIn = { ...desktop, storageState: AUTH_FILE };

export default defineConfig({
  testDir: './tests',
  // Every test shares one demo trading account, so orders and positions created by one test
  // are visible to the others. Run serially to keep the account state predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: env.isCI,
  // A retry could place a second order, so trading tests are never retried.
  retries: 0,
  timeout: 90_000,
  // Stop cleanly (fixtures still tear down) before the CI job's own limit would kill the run.
  globalTimeout: env.isCI ? 50 * 60_000 : undefined,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: env.baseUrl || undefined,
    // Traces record request headers and typed values, i.e. the bearer token. Keep them local.
    trace: env.isCI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      // The login step handles the password and the token: never keep evidence of it.
      use: { ...desktop, trace: 'off', video: 'off', screenshot: 'off' },
    },
    {
      // Login page checks; no session needed.
      name: 'smoke',
      testDir: './tests/smoke',
      use: desktop,
    },
    {
      // Logged-in checks that do not need the market to be open (validation, settings,
      // closed-market behaviour, records already on the account).
      name: 'terminal',
      testDir: './tests/terminal',
      dependencies: ['setup'],
      use: loggedIn,
    },
    {
      // Real orders on the demo account. Each test skips with a reason while its market is closed.
      name: 'trading',
      testDir: './tests/trading',
      dependencies: ['setup'],
      use: loggedIn,
    },
    {
      // UI checks with the server's responses replaced (page.route). Only what the server reports
      // to the UI is mocked, never what it decides.
      name: 'mocked',
      testDir: './tests/mocked',
      dependencies: ['setup'],
      use: { ...loggedIn, serviceWorkers: 'block' },
    },
  ],
});
