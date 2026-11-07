import fs from 'node:fs';
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

setup('log in to the demo account and save the session', async ({ loginPage, page }) => {
  setup.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  setup.skip(
    await savedSessionStillWorks(),
    'Reusing the saved session: the server still accepts it',
  );

  // The trade page's first API call carries the bearer header the API client reuses.
  const authorizedRequest = page.waitForRequest(
    (req) => req.url().includes('/api/') && Boolean(req.headers().authorization),
    { timeout: 30_000 },
  );

  await loginPage.open();
  // Throws with the server's reason if the credentials are rejected.
  await loginPage.login(env.username, env.password);

  // Check the URL rather than the password input: that input's failure log prints the typed password.
  await expect(page).toHaveURL(/\/web\/trade/, { timeout: 30_000 });
  await expect(page.getByTestId('symbol-overview-id').first()).not.toBeEmpty();

  const { authorization } = (await authorizedRequest).headers();
  await page.context().storageState({ path: AUTH_FILE });
  fs.writeFileSync(API_TOKEN_FILE, JSON.stringify({ authorization }));
});
