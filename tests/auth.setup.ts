import fs from 'node:fs';
import path from 'node:path';
import { request } from '@playwright/test';
import { test as setup, expect } from '../src/fixtures/test';
import {
  API_TOKEN_FILE,
  AUTH_FILE,
  env,
  hasCredentials,
  MISSING_CREDENTIALS_REASON,
} from '../src/config/env';

/**
 * Reuses the saved session while the server still accepts it. Each login starts a new session and
 * the platform only keeps a limited number per account, so logging in on every run would end the
 * sessions of other runs.
 */
async function savedSessionStillWorks(): Promise<boolean> {
  if (!fs.existsSync(AUTH_FILE) || !fs.existsSync(API_TOKEN_FILE)) return false;
  const { authorization } = JSON.parse(fs.readFileSync(API_TOKEN_FILE, 'utf8')) as {
    authorization: string;
  };
  const http = await request.newContext({
    baseURL: env.baseUrl,
    extraHTTPHeaders: { authorization },
  });
  try {
    const response = await http.get('/api/user/account/v1');
    return response.ok();
  } finally {
    await http.dispose();
  }
}

/**
 * Logged-in projects open their browser with `AUTH_FILE`. Without credentials there is no session
 * to save, so an empty state lets those tests start and skip with a clear reason instead of
 * failing on a missing file.
 */
function ensureStorageStateFile(): void {
  if (fs.existsSync(AUTH_FILE)) return;
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
}

const TRACING_REASON =
  'Tracing is on (UI mode or --trace) and there is no saved session that still works. ' +
  'Logging in now would put the password in the trace: run ' +
  'npx playwright test --project=setup without tracing first, then try again.';

/** True when this run records a trace. UI mode and `--trace` turn it on over the config. */
function traceIsOn(): boolean {
  const trace = setup.info().project.use.trace;
  const mode = typeof trace === 'object' ? trace.mode : trace;
  return mode !== undefined && mode !== 'off';
}

setup('log in to the demo account and save the session', async ({ loginPage, page }) => {
  ensureStorageStateFile();
  setup.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  setup.skip(
    await savedSessionStillWorks(),
    'Reusing the saved session: the server still accepts it',
  );
  // Fail rather than skip, so the logged-in projects do not run without a session.
  expect(traceIsOn(), TRACING_REASON).toBe(false);

  // The trade page's first API call carries the bearer header the API client reuses.
  const authorizedRequest = page.waitForRequest(
    (req) => req.url().includes('/api/') && Boolean(req.headers().authorization),
    { timeout: 30_000 },
  );

  await loginPage.open();
  // Throws with the server's reason if the credentials are rejected.
  await loginPage.login(env.username, env.password);

  // Check the URL, not the login form. A failing locator assertion on the form would take a page
  // snapshot right away, while the password is still in the field; the fixture only clears it
  // before the snapshot taken at the end of a failed test.
  await expect(page).toHaveURL(/\/web\/trade/, { timeout: 30_000 });
  await expect(page.getByTestId('symbol-overview-id').first()).not.toBeEmpty();

  const { authorization } = (await authorizedRequest).headers();
  await page.context().storageState({ path: AUTH_FILE });
  fs.writeFileSync(API_TOKEN_FILE, JSON.stringify({ authorization }));
});
