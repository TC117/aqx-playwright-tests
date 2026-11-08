import type { Locator, Page } from '@playwright/test';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';

/**
 * Open Positions, Pending Orders and the bulk actions as the live account shows them, without
 * placing anything: table columns, empty states, where each bulk action is offered and what it
 * does when there is nothing to act on. The menus and dialogs with items listed are covered in
 * tests/mocked/positions.spec.ts (they need rows to open).
 */

const POSITION_COLUMNS = [
  'Open Date',
  'Order No.',
  'Symbol',
  'Type',
  'Profit/Loss',
  'ROI%',
  'Volume',
  'Units',
  'Margin Used',
  'Entry Price',
  'Current Price',
  'Take Profit',
  'Stop Loss',
  'Swap',
  'Comment',
  'Track',
  'Edit',
  'Share',
  'Close',
];

const PENDING_COLUMNS = [
  'Open Date',
  'Order No.',
  'Symbol',
  'Type',
  'Volume',
  'Units',
  'Fill Policy',
  'Expiry',
  'Expiry Date',
  'Price',
  'Current Price',
  'Take Profit',
  'Stop Loss',
  'Track',
  'Edit',
  'Delete',
];

/** Records every trading write the page sends (none is expected in this file). */
function recordTradingWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' && url.pathname.startsWith('/api/trade/')) {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  return writes;
}

/**
 * Clicks `target` and resolves once the page has handled the click and rendered the result, so a
 * following "nothing opened" check cannot pass just because the UI had no time to react. A window
 * listener sees the click before the app does (capture phase, so the app cannot stop it); two
 * animation frames later the app's handler has run and React has committed what it changed.
 */
async function clickAndWaitForRender(page: Page, target: Locator): Promise<void> {
  // The promise sits in an object so that creating the handle does not wait for it.
  const rendered = await page.evaluateHandle(() => ({
    done: new Promise<void>((resolve) =>
      window.addEventListener(
        'click',
        () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        { capture: true, once: true },
      ),
    ),
  }));
  await target.click();
  await rendered.evaluate((r) => r.done);
  await rendered.dispose();
}

test.describe('Assets tables on the live account', () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test.describe('Open Positions', { tag: '@R4' }, () => {
    test('TC-POS-01 Open Positions lists the expected columns', async ({ tradePage }) => {
      await tradePage.openPositions.open();
      await expect(tradePage.openPositions.headers).toHaveText(POSITION_COLUMNS);
    });
  });

  test.describe('Pending Orders', { tag: '@R3' }, () => {
    test('TC-PND-01 (table headers) Pending Orders lists the columns a placed order is shown in', async ({
      tradePage,
    }) => {
      await tradePage.pendingOrders.open();
      await expect(tradePage.pendingOrders.headers).toHaveText(PENDING_COLUMNS);
    });
  });

  test.describe('Bulk actions', { tag: '@R5' }, () => {
    test('TC-BLK-08 each list offers only its own bulk action', async ({ tradePage }) => {
      await tradePage.openPositions.open();
      await expect(tradePage.bulk.closeButton).toHaveText('Bulk Close');
      await expect(tradePage.bulk.deleteButton).toBeHidden();

      await tradePage.pendingOrders.open();
      await expect(tradePage.bulk.deleteButton).toHaveText('Bulk Delete');
      await expect(tradePage.bulk.closeButton).toBeHidden();
    });

    test('TC-BLK-07 Bulk Close with no open positions opens nothing and sends nothing', async ({
      page,
      tradePage,
      api,
    }) => {
      const { marketOrderCounts } = await api.orderCounts();
      test.skip(marketOrderCounts > 0, `the account holds ${marketOrderCounts} open positions`);
      const writes = recordTradingWrites(page);
      const { bulk, openPositions: positions } = tradePage;

      await test.step('Open Positions is empty', async () => {
        await positions.open();
        await expect(positions.tab).toHaveText('Open Positions (0)');
        await expect(positions.emptyState).toBeVisible();
        await expect(positions.rows).toHaveCount(0);
        expect(await positions.orderIds()).toEqual([]);
      });

      await test.step('Bulk Close opens no menu and no dialog', async () => {
        // With positions listed the same click opens the menu (see the mocked bulk tests).
        await clickAndWaitForRender(page, bulk.closeButton);
        await expect(bulk.closeOption('all')).toBeHidden();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      await test.step('still nothing after moving away and back', async () => {
        await tradePage.pendingOrders.open();
        await positions.open();
        await expect(positions.emptyState).toBeVisible();
        await expect(bulk.closeOption('all')).toBeHidden();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      expect(writes).toEqual([]);
    });

    test('TC-BLK-07 Bulk Delete with no pending orders opens nothing and sends nothing', async ({
      page,
      tradePage,
      api,
    }) => {
      const { pendingOrderCounts } = await api.orderCounts();
      test.skip(pendingOrderCounts > 0, `the account holds ${pendingOrderCounts} pending orders`);
      const writes = recordTradingWrites(page);
      const { bulk, pendingOrders: pending } = tradePage;

      await test.step('Pending Orders is empty', async () => {
        await pending.open();
        await expect(pending.tab).toHaveText('Pending Orders (0)');
        await expect(pending.emptyState).toBeVisible();
        await expect(pending.rows).toHaveCount(0);
        expect(await pending.orderIds()).toEqual([]);
      });

      await test.step('Bulk Delete opens no menu and no dialog', async () => {
        await clickAndWaitForRender(page, bulk.deleteButton);
        await expect(bulk.deleteOption('all')).toBeHidden();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      await test.step('still nothing after moving away and back', async () => {
        await tradePage.openPositions.open();
        await pending.open();
        await expect(pending.emptyState).toBeVisible();
        await expect(bulk.deleteOption('all')).toBeHidden();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      });

      expect(writes).toEqual([]);
    });
  });
});
