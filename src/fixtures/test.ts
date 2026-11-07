import { test as base, expect } from '@playwright/test';
import { AqxApi } from '../api/AqxApi';
import { env, hasCredentials, MISSING_CREDENTIALS_REASON } from '../config/env';
import { OrderTracker } from '../helpers/OrderTracker';
import { LoginPage } from '../pages/LoginPage';
import { TradePage } from '../pages/TradePage';

type Fixtures = {
  loginPage: LoginPage;
  /** Instrument the test trades. Override per file with `test.use({ symbol: 'XAUUSD' })`. */
  symbol: string;
  /** Read-only client for the platform's API, authenticated with the saved session. */
  api: AqxApi;
  /** Trade screen, opened with `symbol` selected. */
  tradePage: TradePage;
  /** Orders created by the test; whatever is still open is removed after the test. */
  orders: OrderTracker;
};

/** Playwright `test` with page objects available as fixtures. Import `test` from here in specs. */
export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  symbol: [env.defaultSymbol, { option: true }],

  // Playwright requires the destructuring pattern even when no other fixture is used.
  // eslint-disable-next-line no-empty-pattern
  api: async ({}, use, testInfo) => {
    testInfo.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);
    const api = await AqxApi.create();
    await use(api);
    await api.dispose();
  },

  tradePage: async ({ page, symbol }, use, testInfo) => {
    testInfo.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);
    const tradePage = new TradePage(page);
    await tradePage.open();
    await tradePage.selectSymbol(symbol);
    await use(tradePage);
  },

  orders: async ({ api, tradePage }, use) => {
    // Safety guard: never place orders on anything but a demo account.
    const account = await api.account();
    expect(account.isDemo, `account ${account.accountId} must be a demo account`).toBe(true);
    const tracker = new OrderTracker(tradePage);
    await use(tracker);
    await tracker.cleanUp();
  },
});

export { expect };
