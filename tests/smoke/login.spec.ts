import { test, expect } from '../../src/fixtures/test';
import { env, MISSING_BASE_URL_REASON } from '../../src/config/env';

test.describe('Login page', { tag: '@smoke' }, () => {
  test.skip(!env.baseUrl, MISSING_BASE_URL_REASON);

  test('shows the demo sign-in form with LOG IN disabled until it is filled', async ({
    loginPage,
    page,
  }) => {
    await loginPage.open();

    await expect(page).toHaveURL(/\/web\/login$/);
    await expect(loginPage.demoTab).toBeVisible();
    await expect(loginPage.accountIdInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.logInButton).toBeDisabled();
  });
});
