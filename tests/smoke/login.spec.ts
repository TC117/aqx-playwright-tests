import { test, expect } from '../../src/fixtures/test';
import { env, MISSING_BASE_URL_REASON } from '../../src/config/env';

/** Made-up values: the form is never submitted, so they only need to be non-empty. */
const DUMMY_ACCOUNT_ID = '10000000';
const DUMMY_PASSWORD = 'not-a-real-password';

test.describe('Login page', { tag: '@smoke' }, () => {
  test.skip(!env.baseUrl, MISSING_BASE_URL_REASON);

  test('shows the demo sign-in form with LOG IN enabled only while both fields are filled', async ({
    loginPage,
    page,
  }) => {
    await loginPage.open();

    await expect(page).toHaveURL(/\/web\/login$/);
    await expect(loginPage.demoTab).toBeVisible();
    await expect(loginPage.accountIdInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.logInButton).toBeDisabled();

    await test.step('both fields filled: LOG IN is enabled', async () => {
      await loginPage.accountIdInput.fill(DUMMY_ACCOUNT_ID);
      await loginPage.passwordInput.fill(DUMMY_PASSWORD);
      await expect(loginPage.logInButton).toBeEnabled();
    });

    await test.step('password cleared: LOG IN is disabled again', async () => {
      await loginPage.passwordInput.clear();
      await expect(loginPage.logInButton).toBeDisabled();
    });

    await test.step('account ID cleared instead: LOG IN is disabled again', async () => {
      await loginPage.passwordInput.fill(DUMMY_PASSWORD);
      await expect(loginPage.logInButton).toBeEnabled();
      await loginPage.accountIdInput.clear();
      await expect(loginPage.logInButton).toBeDisabled();
    });
  });
});
