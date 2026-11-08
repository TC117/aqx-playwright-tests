import type { Page } from '@playwright/test';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';
import { closeTo } from '../../src/helpers/numbers';
import { TradePage } from '../../src/pages/TradePage';
import {
  BULK_CLOSE_OPTIONS,
  BULK_DELETE_OPTIONS,
  BULK_DIALOG_TEXT,
  type BulkCloseKind,
  type BulkDeleteKind,
} from '../../src/pages/components/BulkActions';
import { TRADE_API } from '../../src/pages/components/tradeRequests';

/**
 * Open Positions, Pending Orders and their dialogs rendered from fabricated server data.
 *
 * Only the three list reads are replaced: GET /api/trade/order/v1 (positions),
 * /api/trade/order/v1/pending and /api/trade/order/v1/counts, each `{ code: '200', result }`.
 * Every other request under /api/trade/ that is not a GET is ABORTED and recorded, so the
 * fabricated Order Nos. can never reach the real account; tests that submit a dialog assert on
 * the request the UI tried to send, never on a fake answer.
 *
 * Item schemas were read from the app's JavaScript (the table's accessor keys) and are confirmed
 * by these tests rendering them. Enums from the same code: orderType 0 BUY, 1 SELL, 2 BUY LIMIT,
 * 3 SELL LIMIT, 4 BUY STOP, 5 SELL STOP, 8/9 BUY/SELL STOP LIMIT; fillPolicy 0 Fill or Kill,
 * 1 Immediate or Cancel, 2 Return; tradeExpiry GTC "Good Till Canceled", GTD "Good Till Day".
 * The row buttons are enabled by the item's `closable` / `editable` flags. P/L is recalculated in
 * the browser as (Bid − entry) for a Buy, (entry − Ask) for a Sell, × contractSize × lots ×
 * exchangeRate; items without an exchangeRate show the server's `profit` as is.
 */

const HOUR = 3_600_000;
const NOW = Date.now();
/** Far-future expiry, shown as this date in any server time zone. */
const EXPIRY = Date.UTC(2030, 0, 15, 12, 0, 0);

const BUY = {
  orderId: '90000001',
  positionId: '90000001',
  symbol: 'EURUSD',
  orderType: 0,
  lotSize: 0.05,
  units: 5000,
  openPrice: 1.0501,
  currentPrice: 1.1138,
  stopLoss: 1.0001,
  takeProfit: 1.3,
  profit: 68.5,
  swap: -0.12,
  commission: 0,
  comment: 'mock buy',
  fillPolicy: 0,
  openTime: NOW - HOUR,
  decimal: 4,
  contractSize: 100_000,
  closable: true,
  editable: true,
  trackable: true,
};

const SELL = {
  ...BUY,
  orderId: '90000002',
  positionId: '90000002',
  orderType: 1,
  lotSize: 0.02,
  units: 2000,
  openPrice: 1.0001,
  currentPrice: 1.1141,
  stopLoss: 0,
  takeProfit: 0,
  profit: -1234.5,
  swap: 0,
  comment: '',
  openTime: NOW - 2 * HOUR,
};

const BUY_LIMIT = {
  orderId: '90000011',
  symbol: 'EURUSD',
  orderType: 2,
  lotSize: 0.03,
  filledLotSize: 0,
  units: 3000,
  price: 1.05,
  priceTrigger: 0,
  stopLoss: 1.04,
  takeProfit: 1.07,
  fillPolicy: 2,
  tradeExpiry: 'GTC',
  expiration: 0,
  openTime: NOW - HOUR,
  decimal: 4,
  contractSize: 100_000,
  closable: true,
  editable: true,
  trackable: true,
};

const SELL_STOP = {
  ...BUY_LIMIT,
  orderId: '90000012',
  orderType: 5,
  lotSize: 0.04,
  units: 4000,
  price: 1.0,
  stopLoss: 0,
  takeProfit: 0,
  tradeExpiry: 'GTD',
  expiration: EXPIRY,
  openTime: NOW - 2 * HOUR,
};

interface BlockedWrite {
  method: string;
  path: string;
  body: unknown;
}

/** Serves fabricated lists and blocks every trading write; returns the writes the UI attempted. */
async function mockAssets(
  page: Page,
  data: { positions: object[]; pending: object[] },
): Promise<BlockedWrite[]> {
  const blocked: BlockedWrite[] = [];
  await page.route('**/api/trade/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      blocked.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      return route.abort();
    }
    const lists: Record<string, unknown> = {
      '/api/trade/order/v1': data.positions,
      '/api/trade/order/v1/pending': data.pending,
      '/api/trade/order/v1/counts': {
        marketOrderCounts: data.positions.length,
        pendingOrderCounts: data.pending.length,
      },
    };
    const result = lists[url.pathname];
    if (result === undefined) return route.continue();
    return route.fulfill({ json: { code: '200', result } });
  });
  return blocked;
}

async function openWith(
  page: Page,
  data: { positions: object[]; pending: object[] },
): Promise<{ tradePage: TradePage; blocked: BlockedWrite[] }> {
  const blocked = await mockAssets(page, data);
  const tradePage = new TradePage(page);
  await tradePage.open();
  return { tradePage, blocked };
}

test.describe('Positions and pending orders rendered from mocked server data', () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test.describe('Open Positions', { tag: ['@R4', '@mocked'] }, () => {
    test('TC-POS-01 each field of the server positions is shown in the table', async ({ page }) => {
      const { tradePage, blocked } = await openWith(page, {
        positions: [BUY, SELL],
        pending: [],
      });
      const positions = tradePage.openPositions;
      await positions.open();

      await expect(positions.tab).toHaveText('Open Positions (2)');
      expect(await positions.orderIds()).toEqual([BUY.orderId, SELL.orderId]);
      expect(await positions.read(BUY.orderId)).toEqual({
        orderId: BUY.orderId,
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.05,
        entryPrice: 1.0501,
        currentPrice: expect.any(Number),
        stopLoss: 1.0001,
        takeProfit: 1.3,
        profit: 68.5,
      });
      expect(await positions.read(SELL.orderId)).toEqual({
        orderId: SELL.orderId,
        symbol: 'EURUSD',
        side: 'SELL',
        volume: 0.02,
        entryPrice: 1.0001,
        currentPrice: expect.any(Number),
        stopLoss: null,
        takeProfit: null,
        profit: -1234.5,
      });

      // Display format: symbol digits, `--` for no SL/TP, signed P/L with thousands separators.
      const buyRow = positions.row(BUY.orderId);
      const sellRow = positions.row(SELL.orderId);
      await expect(buyRow.getByTestId('asset-open-column-take-profit')).toHaveText('1.3000');
      await expect(buyRow.getByTestId('asset-open-column-profit')).toHaveText('+68.50');
      await expect(buyRow.getByTestId('asset-open-column-units')).toHaveText('5,000');
      await expect(buyRow.getByTestId('asset-open-column-swap')).toHaveText('-0.12');
      await expect(buyRow.getByTestId('asset-open-column-comment')).toHaveText('mock buy');
      await expect(sellRow.getByTestId('asset-open-column-stop-loss')).toHaveText('--');
      await expect(sellRow.getByTestId('asset-open-column-take-profit')).toHaveText('--');
      await expect(sellRow.getByTestId('asset-open-column-profit')).toHaveText('-1,234.50');
      // Margin Used = lots x contract size x entry / leverage (1:100 on this account).
      await expect(buyRow.getByTestId('asset-open-column-margin-used')).toHaveText('52.51');
      await expect(sellRow.getByTestId('asset-open-column-margin-used')).toHaveText('20.00');
      expect(blocked).toEqual([]);
    });

    test('TC-POS-02 floating P/L uses the Bid for a Buy and the Ask for a Sell', async ({
      page,
    }) => {
      // With an exchange rate the browser recalculates P/L from the live quote.
      const { tradePage } = await openWith(page, {
        positions: [
          { ...BUY, exchangeRate: 1 },
          { ...SELL, exchangeRate: 1 },
        ],
        pending: [],
      });
      await tradePage.selectSymbol('EURUSD');
      const positions = tradePage.openPositions;
      await positions.open();

      // Prices may tick between reads, so compare quote and P/L read together until they agree.
      const formulaHolds = async (): Promise<{ buy: boolean; sell: boolean }> => {
        const { bid, ask } = await tradePage.orderPanel.quote();
        const buy = await positions.read(BUY.orderId);
        const sell = await positions.read(SELL.orderId);
        const buyPl = (bid - BUY.openPrice) * BUY.contractSize * BUY.lotSize;
        const sellPl = (SELL.openPrice - ask) * SELL.contractSize * SELL.lotSize;
        return {
          buy: closeTo(Number(buy.profit), buyPl, 0.01),
          sell: closeTo(Number(sell.profit), sellPl, 0.01),
        };
      };
      await expect
        .poll(formulaHolds, { message: 'P/L should follow the quote' })
        .toEqual({ buy: true, sell: true });
    });

    test('TC-POS-06 the Edit dialog blocks SL/TP on the wrong side and sends nothing', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, { positions: [BUY], pending: [] });
      const positions = tradePage.openPositions;
      await positions.open();
      const dialog = await positions.openEdit(BUY.orderId);

      await expect(dialog.symbol).toHaveText('EURUSD');
      await expect(dialog.side).toHaveText('BUY');
      await expect(dialog.entryPrice).toHaveText('1.0501');
      await expect(dialog.volume).toHaveText('0.05');
      await expect(dialog.stopLossPrice).toHaveValue('1.0001');
      await expect(dialog.takeProfitPrice).toHaveValue('1.3');

      // A Buy closes at the Bid: SL must be below it and TP above it.
      await dialog.fill({ stopLoss: 1.5, takeProfit: 0.9 });
      await expect(dialog.errors).toHaveText([
        'Stop Loss must be less than Sell Price.',
        'Take Profit must be greater than Sell Price.',
      ]);
      await dialog.updateButton.click();
      await expect(dialog.root).toBeVisible();
      await expect(dialog.confirmation.confirmButton).toBeHidden();
      await dialog.cancel();

      await expect(
        positions.row(BUY.orderId).getByTestId('asset-open-column-stop-loss'),
      ).toHaveText('1.0001');
      expect(blocked).toEqual([]);
    });

    test('TC-POS-08 the Close dialog limits the volume to the position; TC-POS-10 Cancel keeps it', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, { positions: [BUY], pending: [] });
      const positions = tradePage.openPositions;
      await positions.open();
      await positions.row(BUY.orderId).getByTestId('asset-open-button-close').click();
      const dialog = tradePage.openPositions.closeDialog;

      await expect(dialog.root).toContainText('EURUSD');
      await expect(dialog.root).toContainText(BUY.orderId);
      await expect(dialog.volumeLimit).toHaveText('/0.05');
      await expect(dialog.volume).toHaveAttribute('placeholder', 'Min: 0.01');
      await expect(dialog.fillPolicy).toHaveText('Fill or Kill');
      await expect(dialog.confirmButton, 'nothing to confirm before a volume').toBeDisabled();

      await test.step('more than the position volume', async () => {
        await dialog.setVolume(0.06);
        await expect(dialog.errors).toHaveText('Maximum volume is 0.05.');
        await expect(dialog.confirmButton).toBeDisabled();
      });

      await test.step('zero', async () => {
        await dialog.setVolume(0);
        await expect(dialog.errors).toHaveText('Please enter a valid volume.');
        await expect(dialog.confirmButton).toBeDisabled();
      });

      await test.step('MIN and MAX fill in the limits', async () => {
        await dialog.minButton.click();
        await expect(dialog.volume).toHaveValue('0.01');
        await dialog.maxButton.click();
        await expect(dialog.volume).toHaveValue('0.05');
        await expect(dialog.errors).toHaveCount(0);
        await expect(dialog.confirmButton).toBeEnabled();
      });

      await dialog.cancel();
      expect(await positions.read(BUY.orderId)).toMatchObject({ volume: 0.05, side: 'BUY' });
      expect(blocked).toEqual([]);
    });
  });

  test.describe('Pending Orders', { tag: ['@R3', '@mocked'] }, () => {
    test('TC-PND-01 (display part) each field of the server pending orders is shown in the table', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, {
        positions: [],
        pending: [BUY_LIMIT, SELL_STOP],
      });
      const pending = tradePage.pendingOrders;
      await pending.open();

      await expect(pending.tab).toHaveText('Pending Orders (2)');
      expect(await pending.orderIds()).toEqual([BUY_LIMIT.orderId, SELL_STOP.orderId]);
      expect(await pending.read(BUY_LIMIT.orderId)).toEqual({
        orderId: BUY_LIMIT.orderId,
        symbol: 'EURUSD',
        type: 'BUY LIMIT',
        volumeText: '0.03 / 0',
        expiry: 'Good Till Canceled',
        expiryDate: '--',
        price: 1.05,
        stopLoss: 1.04,
        takeProfit: 1.07,
      });
      expect(await pending.read(SELL_STOP.orderId)).toEqual({
        orderId: SELL_STOP.orderId,
        symbol: 'EURUSD',
        type: 'SELL STOP',
        volumeText: '0.04 / 0',
        expiry: 'Good Till Day',
        expiryDate: '2030-01-15',
        price: 1,
        stopLoss: null,
        takeProfit: null,
      });
      const row = pending.row(BUY_LIMIT.orderId);
      await expect(row.getByTestId('asset-pending-column-entry-price')).toHaveText('1.0500');
      await expect(row.getByTestId('asset-pending-column-fill-policy')).toHaveText('Return');
      await expect(row.getByTestId('asset-pending-column-units')).toHaveText('3,000');
      expect(blocked).toEqual([]);
    });

    test('TC-PND-19 the Edit Order dialog blocks an SL above a Buy Limit price', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, { positions: [], pending: [BUY_LIMIT] });
      const pending = tradePage.pendingOrders;
      await pending.open();
      const dialog = await pending.openEdit(BUY_LIMIT.orderId);

      await expect(dialog.orderType).toHaveText('BUY LIMIT');
      await expect(dialog.price).toHaveValue('1.0500');
      await expect(dialog.expiry).toHaveText('Good Till Canceled');

      await dialog.fill({ stopLoss: 1.06 });
      await expect(dialog.errors).toHaveText('Stop Loss must be less than price.');
      await dialog.confirmButton.click();
      await expect(dialog.confirmation.confirmButton).toBeHidden();
      await dialog.cancel();

      expect(await pending.read(BUY_LIMIT.orderId)).toMatchObject({ price: 1.05, stopLoss: 1.04 });
      expect(blocked).toEqual([]);
    });

    test('TC-PND-18 the Edit Order dialog offers every expiry and picks a date and time', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, { positions: [], pending: [BUY_LIMIT] });
      const pending = tradePage.pendingOrders;
      await pending.open();
      const dialog = await pending.openEdit(BUY_LIMIT.orderId);

      await test.step('expiry options', async () => {
        const options = await tradePage.orderPanel.dropdownOptions(dialog.expiry);
        expect(options).toEqual([
          'Good Till Canceled',
          'Good Till Day',
          'Specified Date and Time',
          'Specified Date',
        ]);
      });

      await test.step('Specified Date and Time, tomorrow 10:30 server time', async () => {
        const offset = await tradePage.orderPanel.serverTimeOffsetMs();
        const serverNow = new Date(Date.now() + offset);
        const tomorrow = Date.UTC(
          serverNow.getUTCFullYear(),
          serverNow.getUTCMonth(),
          serverNow.getUTCDate() + 1,
          10,
          30,
        );
        await dialog.selectExpiry('Specified Date and Time', new Date(tomorrow - offset));
        const expected = new Date(tomorrow).toISOString();
        await expect(dialog.expiryDate).toHaveText(expected.slice(0, 10));
        await expect(dialog.expiryTime).toHaveText('10:30');
      });

      await dialog.cancel();
      expect(blocked).toEqual([]);
    });

    test('TC-PND-20 the delete dialog names the order and Cancel keeps it', async ({ page }) => {
      const { tradePage, blocked } = await openWith(page, { positions: [], pending: [BUY_LIMIT] });
      const pending = tradePage.pendingOrders;
      await pending.open();
      await pending.row(BUY_LIMIT.orderId).getByTestId('asset-open-button-close').click();
      const dialog = pending.deleteDialog;

      await expect(dialog.root).toContainText('EURUSD');
      await expect(dialog.root).toContainText('BUY LIMIT');
      await expect(dialog.root).toContainText(BUY_LIMIT.orderId);
      await expect(dialog.question).toBeVisible();
      await dialog.cancel();

      await expect(pending.row(BUY_LIMIT.orderId)).toHaveCount(1);
      expect(blocked).toEqual([]);
    });
  });

  test.describe('Bulk actions', { tag: ['@R5', '@mocked'] }, () => {
    test('TC-BLK-06 Bulk Close offers all / profitable / losing; each dialog states the cap and Cancel changes nothing', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, { positions: [BUY, SELL], pending: [] });
      await tradePage.openPositions.open();
      const bulk = tradePage.bulk;

      await bulk.openCloseMenu();
      for (const label of Object.values(BULK_CLOSE_OPTIONS)) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      for (const kind of Object.keys(BULK_CLOSE_OPTIONS) as BulkCloseKind[]) {
        await test.step(BULK_CLOSE_OPTIONS[kind], async () => {
          await bulk.requestClose(kind);
          for (const line of BULK_DIALOG_TEXT.close[kind]) {
            await expect(bulk.closeDialog).toContainText(line);
          }
          await expect(page.getByTestId(`bulk-close-modal-button-submit-${kind}`)).toHaveText(
            'Confirm',
          );
          await bulk.cancel();
        });
      }
      expect(await tradePage.openPositions.orderIds()).toEqual([BUY.orderId, SELL.orderId]);
      expect(blocked).toEqual([]);
    });

    test('TC-BLK-06 Bulk Delete offers all / limit / stop orders; each dialog states the cap and Cancel changes nothing', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, {
        positions: [],
        pending: [BUY_LIMIT, SELL_STOP],
      });
      await tradePage.pendingOrders.open();
      const bulk = tradePage.bulk;

      await bulk.openDeleteMenu();
      for (const label of Object.values(BULK_DELETE_OPTIONS)) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      for (const kind of Object.keys(BULK_DELETE_OPTIONS) as BulkDeleteKind[]) {
        await test.step(BULK_DELETE_OPTIONS[kind], async () => {
          await bulk.requestDelete(kind);
          for (const line of BULK_DIALOG_TEXT.delete[kind]) {
            await expect(bulk.deleteDialog).toContainText(line);
          }
          await bulk.cancel();
        });
      }
      expect(await tradePage.pendingOrders.orderIds()).toEqual([
        BUY_LIMIT.orderId,
        SELL_STOP.orderId,
      ]);
      expect(blocked).toEqual([]);
    });

    const SELECTION: Record<BulkCloseKind, (typeof BUY)[]> = {
      all: [BUY, SELL],
      profit: [BUY],
      loss: [SELL],
    };
    const CASE: Record<BulkCloseKind, string> = {
      all: 'TC-BLK-01',
      profit: 'TC-BLK-02',
      loss: 'TC-BLK-03',
    };
    for (const kind of Object.keys(SELECTION) as BulkCloseKind[]) {
      test(`${CASE[kind]} (request part) "${BULK_CLOSE_OPTIONS[kind]}" sends exactly the matching positions`, async ({
        page,
      }) => {
        const { tradePage, blocked } = await openWith(page, {
          positions: [BUY, SELL],
          pending: [],
        });
        await tradePage.openPositions.open();
        await tradePage.bulk.requestClose(kind);

        // The request is blocked by the mock; only what the UI tried to send is checked.
        await page.getByTestId(`bulk-close-modal-button-submit-${kind}`).click();
        await expect.poll(() => blocked.length).toBe(1);
        expect(blocked[0]).toEqual({
          method: 'PUT',
          path: TRADE_API.bulkClose,
          body: {
            orderList: SELECTION[kind].map((p) => ({
              orderId: p.orderId,
              symbol: p.symbol,
              lotSize: p.lotSize,
              fillPolicy: p.fillPolicy,
            })),
          },
        });
      });
    }

    test('TC-BLK-05 (request part) "All Orders" sends every listed pending order', async ({
      page,
    }) => {
      const { tradePage, blocked } = await openWith(page, {
        positions: [],
        pending: [BUY_LIMIT, SELL_STOP],
      });
      await tradePage.pendingOrders.open();
      await tradePage.bulk.requestDelete('all');

      await tradePage.bulk.deleteDialog
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect.poll(() => blocked.length).toBe(1);
      expect(blocked[0]).toEqual({
        method: 'PUT',
        path: TRADE_API.bulkDelete,
        body: [
          { orderId: BUY_LIMIT.orderId, symbol: 'EURUSD' },
          { orderId: SELL_STOP.orderId, symbol: 'EURUSD' },
        ],
      });
      // The failed request leaves both orders listed and says so.
      await expect(page.getByTestId('notification-box-description')).toHaveText(
        'Order action failed',
      );
      await expect(tradePage.pendingOrders.rows).toHaveCount(2);
    });
  });
});
