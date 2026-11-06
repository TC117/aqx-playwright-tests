import { test, expect } from '../../src/fixtures/test';
import { env, MISSING_BASE_URL_REASON } from '../../src/config/env';

test.describe('Login page', { tag: '@smoke' }, () => {
  test.skip(!env.baseUrl, MISSING_BASE_URL_REASON);

  test('shows the sign-in form', async ({ loginPage }) => {
    await loginPage.open();

    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.signInButton).toBeEnabled();
  });
});
