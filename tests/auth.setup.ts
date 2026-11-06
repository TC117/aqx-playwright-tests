import { test as setup, expect } from '../src/fixtures/test';
import { AUTH_FILE, env, hasCredentials, MISSING_CREDENTIALS_REASON } from '../src/config/env';

setup('log in to the demo account and save the session', async ({ loginPage, page }) => {
  setup.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  await loginPage.open();
  await loginPage.login(env.username, env.password);
  await expect(loginPage.passwordInput).toBeHidden({ timeout: 30_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
