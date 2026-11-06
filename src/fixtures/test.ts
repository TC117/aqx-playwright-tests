import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

type PageObjects = {
  loginPage: LoginPage;
};

/** Playwright `test` with page objects available as fixtures. Import `test` from here in specs. */
export const test = base.extend<PageObjects>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

export { expect };
