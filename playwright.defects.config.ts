import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE, env } from './src/config/env';

/**
 * Takes the screenshots in docs/defects/ from the live demo (`npm run defects:screenshots`).
 * Kept apart from the suite: it never places, changes or closes an order, and it never logs in.
 * It reuses the session the `setup` project saves (`npx playwright test --project=setup`).
 */
export default defineConfig({
  testDir: './scripts/defect-screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results/defect-screenshots',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseUrl || 'https://aqxtrader.aquariux.com',
    // Taller than the suite's 1600×900 so the whole order panel fits without scrolling. Double
    // pixel density keeps the text sharp in the docs.
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
