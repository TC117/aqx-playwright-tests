import { test as setup, expect } from '../src/fixtures/test';
import { AUTH_FILE, env, hasCredentials, MISSING_CREDENTIALS_REASON } from '../src/config/env';

setup('log in to the demo account and save the session', async ({ loginPage, page }) => {
  setup.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  await loginPage.open();
  // Throws with the server's reason if the credentials are rejected.
  await loginPage.login(env.username, env.password);

  // Check the URL rather than the password input: that input's failure log prints the typed password.
  await expect(page).not.toHaveURL(/\/web\/login/, { timeout: 30_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
