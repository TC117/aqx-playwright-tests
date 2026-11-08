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
import { RENDERED_ROW_LIMIT } from '../pages/components/OpenPositions';
import { TRADE_WRITES } from '../pages/components/tradeRequests';

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
  /** Automatic: after each logged-in test, One-Click Trading must be off on the server. */
  oneClickSafetyNet: void;
};

/** Paths of every order write (place, modify, close, delete, bulk). */
const isOrderWrite = (url: URL): boolean => url.pathname.startsWith(TRADE_WRITES);

const LOGGED_IN_PROJECTS = new Set(['terminal', 'mocked', 'trading']);

/** Room left for one trading test: the most it creates of one kind is 3 (the bulk tests). */
const MAX_ITEMS_PER_TEST = 5;

/** Playwright `test` with page objects available as fixtures. Import `test` from here in specs. */
export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
    // After a timeout the test body keeps running in the background; stop it entering the
    // password from now on.
    loginPage.close();
    // A test with errors gets a snapshot of the page, taken when the browser closes, and the
    // setup project's `screenshot: 'off'` does not turn it off. Empty password fields first,
    // whatever the outcome (an expected failure is snapshotted too). This also runs after a
    // timeout, when the test's own code never gets the chance.
    await loginPage.clearPassword().catch(() => {});
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

  orders: async ({ api, tradePage, symbol }, use, testInfo) => {
    // Opt-in: a run only places orders when someone asked for it on purpose.
    testInfo.skip(!env.allowTrading, TRADING_NOT_ALLOWED_REASON);
    // Safety guard: never place orders on anything but a demo account, checked on the server and
    // on the account the UI is actually trading on.
    const account = await api.account();
    expect(account.isDemo, `account ${account.accountId} must be a demo account`).toBe(true);
    await expect(tradePage.account.typeTag, 'the UI must be on a demo account').toHaveText(/demo/i);
    // The tables render at most 30 rows, and an item beyond them can be neither checked nor
    // removed through the UI. Leave room for what one test creates.
    const [positions, pending] = await Promise.all([api.openPositions(), api.pendingOrders()]);
    testInfo.skip(
      Math.max(positions.length, pending.length) + MAX_ITEMS_PER_TEST > RENDERED_ROW_LIMIT,
      `the shared account holds ${positions.length} positions and ${pending.length} pending orders; the tables list only ${RENDERED_ROW_LIMIT}, so this test could not follow its own`,
    );
    const tracker = new OrderTracker(tradePage, api, symbol);
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

  // The setting is account-wide: left on, every later order skips its confirmation. Declared
  // before the specs' own fixtures, so it checks after they have torn down. A test that leaves
  // it on fails, and the setting is switched off for everyone else.
  oneClickSafetyNet: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      await use();
      if (!hasCredentials || !LOGGED_IN_PROJECTS.has(testInfo.project.name)) return;
      const api = await AqxApi.create();
      try {
        if (await api.isOneClickTradingEnabled()) {
          await api.switchOneClickTradingOff();
          throw new Error(
            'The test left One-Click Trading on for the account; it was switched off',
          );
        }
      } finally {
        await api.dispose();
      }
    },
    { auto: true },
  ],
});

export { expect };
