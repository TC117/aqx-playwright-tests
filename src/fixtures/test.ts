import { test as base, expect } from '@playwright/test';
import { AqxApi } from '../api/AqxApi';
import {
  env,
  hasCredentials,
  MISSING_CREDENTIALS_REASON,
  TRADING_NOT_ALLOWED_REASON,
} from '../config/env';
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
  /** Automatic: in the `mocked` project, order writes no test route answered are aborted. */
  mockedWriteGuard: void;
};

/** Paths of every order write (place, modify, close, delete, bulk). */
const isOrderWrite = (url: URL): boolean => url.pathname.startsWith('/api/trade/trade/');

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

  orders: async ({ api, tradePage }, use, testInfo) => {
    // Opt-in: a run only places orders when someone asked for it on purpose.
    testInfo.skip(!env.allowTrading, TRADING_NOT_ALLOWED_REASON);
    // Safety guard: never place orders on anything but a demo account.
    const account = await api.account();
    expect(account.isDemo, `account ${account.accountId} must be a demo account`).toBe(true);
    const tracker = new OrderTracker(tradePage);
    await use(tracker);
    await tracker.cleanUp();
  },

  // Registered before any test route, so a test's own routes take precedence and anything they
  // pass on with `route.fallback()` ends here. A mocked test can therefore never send an order.
  mockedWriteGuard: [
    async ({ page }, use, testInfo) => {
      if (testInfo.project.name === 'mocked') {
        await page.route(isOrderWrite, async (route) => {
          if (route.request().method() === 'GET') return route.fallback();
          testInfo.annotations.push({
            type: 'blocked write',
            description: `${route.request().method()} ${new URL(route.request().url()).pathname}`,
          });
          await route.abort('blockedbyclient');
        });
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
