import type { AqxApi, SymbolDetail } from '../../src/api/AqxApi';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';
import type { OrderTracker } from '../../src/helpers/OrderTracker';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { closeTo, offsetByPoints, roundTo } from '../../src/helpers/numbers';
import type { MarketOrderInput, PositionRow } from '../../src/models/trading';
import type { TradePage } from '../../src/pages/TradePage';

/**
 * Managing real positions and pending orders on the demo account (R4, and TC-PND-18 / 20 of R3).
 * Every test opens its own items through `orders`, which closes or deletes whatever is left.
 *
 * Server records are read from GET /api/trade/order/v1 and /pending. Their item fields (orderId,
 * openPrice / price, lotSize, stopLoss, takeProfit; 0 = no SL/TP) are the ones the UI tables read,
 * confirmed by tests/mocked/positions.spec.ts rendering them.
 */

/** Extra points on top of the stops level, so moving prices do not make a valid level invalid. */
const BUFFER_POINTS = 50;

interface Levels {
  spec: SymbolDetail;
  /** Smallest valid SL/TP/pending distance plus the buffer, in points. */
  points: number;
  /** Moves a price by `n` times that distance. */
  away: (price: number, n: number) => number;
}

async function levels(api: AqxApi, symbol: string): Promise<Levels> {
  const spec = await api.symbolDetail(symbol);
  const points = spec.stopsLevel + BUFFER_POINTS;
  return {
    spec,
    points,
    away: (price, n) => offsetByPoints(price, n * points, spec.pointStep, spec.digits),
  };
}

/** Places a market order and returns the Order No. of the position it opened. */
async function openPosition(
  tradePage: TradePage,
  orders: OrderTracker,
  order: MarketOrderInput,
): Promise<string> {
  const before = await orders.positionIds();
  await tradePage.orderPanel.placeMarketOrder(order);
  return orders.newPosition(before);
}

type ServerItem = Record<string, unknown>;

async function serverPosition(api: AqxApi, orderId: string): Promise<ServerItem | undefined> {
  return (await api.openPositions()).find((p) => String(p.orderId) === orderId);
}

async function serverPendingOrder(api: AqxApi, orderId: string): Promise<ServerItem | undefined> {
  return (await api.pendingOrders()).find((p) => String(p.orderId) === orderId);
}

/** SL/TP as the server stores them: 0 (or nothing) means "not set". */
function level(value: unknown): number | null {
  const n = Number(value ?? 0);
  return n ? n : null;
}

/** Checks that a row and the server's record of the same position agree. */
async function expectServerAgrees(api: AqxApi, row: PositionRow, digits: number): Promise<void> {
  const server = await serverPosition(api, row.orderId);
  expect(server, `the server should hold position ${row.orderId}`).toBeDefined();
  expect({
    entryPrice: roundTo(Number(server?.openPrice), digits),
    volume: Number(server?.lotSize),
    stopLoss: level(server?.stopLoss),
    takeProfit: level(server?.takeProfit),
  }).toEqual({
    entryPrice: row.entryPrice,
    volume: row.volume,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
  });
}

test.describe('Managing positions and pending orders', { tag: ['@market-open'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test.beforeEach(async ({ api, symbol }) => {
    await skipUnlessMarketOpen(api, symbol);
  });

  test.describe('Open positions', { tag: '@R4' }, () => {
    test('TC-POS-01 a Buy and a Sell are listed with the values the server holds', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec, away } = await levels(api, symbol);
      const quote = await tradePage.orderPanel.quote();
      const buy: MarketOrderInput = {
        side: 'BUY',
        volume: spec.minContractLotSize,
        stopLoss: away(quote.bid, -2),
        takeProfit: away(quote.bid, 2),
      };
      const sell: MarketOrderInput = {
        side: 'SELL',
        volume: spec.minContractLotSize,
        stopLoss: away(quote.ask, 2),
        takeProfit: away(quote.ask, -2),
      };
      const buyId = await openPosition(tradePage, orders, buy);
      const sellId = await openPosition(tradePage, orders, sell);
      const after = await tradePage.orderPanel.quote();

      for (const [id, order, price] of [
        [buyId, buy, [quote.ask, after.ask]],
        [sellId, sell, [quote.bid, after.bid]],
      ] as const) {
        await test.step(`${order.side} ${id}`, async () => {
          const row = await tradePage.openPositions.read(id);
          expect(row).toMatchObject({
            orderId: id,
            symbol,
            side: order.side,
            volume: order.volume,
            stopLoss: order.stopLoss,
            takeProfit: order.takeProfit,
          });
          // A Buy opens at the Ask and a Sell at the Bid, between the quotes before and after.
          const spread = Math.abs(after.ask - after.bid);
          const low = Math.min(...price) - 2 * spread;
          const high = Math.max(...price) + 2 * spread;
          expect(row.entryPrice).toBeGreaterThanOrEqual(low);
          expect(row.entryPrice).toBeLessThanOrEqual(high);
          expect(row.currentPrice).not.toBeNull();
          expect(row.profit).not.toBeNull();
          await expectServerAgrees(api, row, spec.digits);
        });
      }
    });

    test('TC-POS-03 TC-POS-04 TC-POS-05 SL/TP can be added, moved and removed', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec, away } = await levels(api, symbol);
      const id = await openPosition(tradePage, orders, {
        side: 'BUY',
        volume: spec.minContractLotSize,
      });
      const positions = tradePage.openPositions;
      const opened = await positions.read(id);
      expect(opened).toMatchObject({ stopLoss: null, takeProfit: null });

      // A Buy closes at the Bid: SL below it, TP above it.
      for (const [step, n] of [
        ['TC-POS-03 add SL and TP', 2],
        ['TC-POS-04 move SL and TP', 3],
      ] as const) {
        await test.step(step, async () => {
          const { bid } = await tradePage.orderPanel.quote();
          const changes = { stopLoss: away(bid, -n), takeProfit: away(bid, n) };
          await positions.edit(id, changes);
          const row = await positions.read(id);
          expect(row).toMatchObject({
            ...changes,
            orderId: id,
            volume: opened.volume,
            entryPrice: opened.entryPrice,
          });
          await expectServerAgrees(api, row, spec.digits);
        });
      }

      await test.step('TC-POS-05 remove SL and TP', async () => {
        await positions.edit(id, { stopLoss: null, takeProfit: null });
        const row = await positions.read(id);
        expect(row).toMatchObject({ stopLoss: null, takeProfit: null, volume: opened.volume });
        await expectServerAgrees(api, row, spec.digits);
      });
    });

    test('TC-POS-06 an invalid SL is rejected and the position keeps its values', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec, away } = await levels(api, symbol);
      const quote = await tradePage.orderPanel.quote();
      const id = await openPosition(tradePage, orders, {
        side: 'BUY',
        volume: spec.minContractLotSize,
        stopLoss: away(quote.bid, -2),
        takeProfit: away(quote.bid, 2),
      });
      const positions = tradePage.openPositions;
      const before = await positions.read(id);

      await test.step('SL above the Bid (wrong side) is blocked in the dialog', async () => {
        const dialog = await positions.openEdit(id);
        const { bid } = await tradePage.orderPanel.quote();
        await dialog.fill({ stopLoss: away(bid, 2) });
        await expect(dialog.errors).toHaveText('Stop Loss must be less than Sell Price.');
        await expect(dialog.submit(id)).rejects.toThrow(/sent nothing/);
        await dialog.cancel();
      });

      await test.step('SL inside the stops level is rejected', async () => {
        const dialog = await positions.openEdit(id);
        const { bid } = await tradePage.orderPanel.quote();
        // One point below the Bid: right side, but closer than the stops level allows.
        await dialog.fill({ stopLoss: offsetByPoints(bid, -1, spec.pointStep, spec.digits) });
        await expect(dialog.submit(id)).rejects.toThrow();
        await dialog.dismiss();
      });

      const after = await positions.read(id);
      expect(after).toMatchObject({ stopLoss: before.stopLoss, takeProfit: before.takeProfit });
      await expectServerAgrees(api, after, spec.digits);
    });

    test('TC-POS-07 a partial close keeps the rest open and records the closed part', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec, away } = await levels(api, symbol);
      const step = spec.lotSizeStep;
      const quote = await tradePage.orderPanel.quote();
      const volume = roundTo(2 * spec.minContractLotSize, 2);
      const id = await openPosition(tradePage, orders, {
        side: 'BUY',
        volume,
        stopLoss: away(quote.bid, -2),
        takeProfit: away(quote.bid, 2),
      });
      const positions = tradePage.openPositions;
      const before = await positions.read(id);
      const closed = spec.minContractLotSize;

      await positions.close(id, { volume: closed });

      await test.step('the rest stays open under the same Order No. with the same levels', async () => {
        expect(await positions.read(id)).toMatchObject({
          orderId: id,
          volume: roundTo(volume - closed, 2),
          entryPrice: before.entryPrice,
          stopLoss: before.stopLoss,
          takeProfit: before.takeProfit,
        });
      });

      await test.step('the closed part is in Positions History', async () => {
        await expect
          .poll(async () =>
            (await api.positionHistory()).some(
              (h) => h.positionId === id && closeTo(h.volume, closed, step / 2) && h.closePrice > 0,
            ),
          )
          .toBe(true);
        const rows = await tradePage.history.readPositionRows(id);
        expect(rows.map((r) => r.volumeText)).toContainEqual(
          expect.stringContaining(String(closed)),
        );
      });
    });

    test('TC-POS-09 TC-POS-10 positions close fully at the right price; Cancel keeps them', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec } = await levels(api, symbol);
      const volume = spec.minContractLotSize;
      const buyId = await openPosition(tradePage, orders, { side: 'BUY', volume });
      const sellId = await openPosition(tradePage, orders, { side: 'SELL', volume });
      const positions = tradePage.openPositions;

      await test.step('TC-POS-10 cancelling the close dialog keeps the position', async () => {
        const row = positions.row(buyId);
        await row.getByTestId('asset-open-button-close').click();
        // One-Click Trading would close at once; the account keeps it off between tests.
        await expect(positions.closeDialog.root).toContainText(buyId);
        await positions.closeDialog.cancel();
        expect(await positions.read(buyId)).toMatchObject({ volume });
      });

      // A Buy closes at the Bid and a Sell at the Ask.
      for (const [id, side] of [
        [buyId, 'bid'],
        [sellId, 'ask'],
      ] as const) {
        await test.step(`TC-POS-09 close ${id} at the ${side}`, async () => {
          const q1 = await tradePage.orderPanel.quote();
          await positions.open();
          await positions.close(id);
          orders.release(id);
          const q2 = await tradePage.orderPanel.quote();
          const spread = Math.abs(q2.ask - q2.bid);
          let closePrice = 0;
          await expect
            .poll(async () => {
              const entry = (await api.positionHistory()).find(
                (h) => h.positionId === id && h.closePrice > 0,
              );
              closePrice = entry?.closePrice ?? 0;
              return closePrice;
            })
            .toBeGreaterThan(0);
          expect(closePrice).toBeGreaterThanOrEqual(Math.min(q1[side], q2[side]) - 2 * spread);
          expect(closePrice).toBeLessThanOrEqual(Math.max(q1[side], q2[side]) + 2 * spread);
        });
      }
    });
  });

  test.describe('Pending orders', { tag: '@R3' }, () => {
    test('TC-PND-18 a pending order can be modified and keeps its Order No.', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec, away } = await levels(api, symbol);
      const { ask } = await tradePage.orderPanel.quote();
      const price = away(ask, -3);
      const before = await orders.pendingIds();
      await tradePage.orderPanel.placePendingOrder({
        type: 'Limit',
        side: 'BUY',
        volume: spec.minContractLotSize,
        price,
        stopLoss: away(price, -1),
        takeProfit: away(price, 1),
        expiry: 'Good Till Canceled',
      });
      const id = await orders.newPendingOrder(before);

      const newPrice = away(ask, -4);
      const changes = {
        price: newPrice,
        stopLoss: away(newPrice, -2),
        takeProfit: away(newPrice, 2),
        expiry: 'Good Till Day' as const,
      };
      await tradePage.pendingOrders.edit(id, changes);

      expect(await tradePage.pendingOrders.read(id)).toMatchObject({
        orderId: id,
        type: 'BUY LIMIT',
        price: changes.price,
        stopLoss: changes.stopLoss,
        takeProfit: changes.takeProfit,
        expiry: 'Good Till Day',
      });
      const server = await serverPendingOrder(api, id);
      expect({
        price: roundTo(Number(server?.price), spec.digits),
        stopLoss: level(server?.stopLoss),
        takeProfit: level(server?.takeProfit),
      }).toEqual({
        price: changes.price,
        stopLoss: changes.stopLoss,
        takeProfit: changes.takeProfit,
      });
    });

    test('TC-PND-20 deleting a pending order removes it and records it as cancelled', async ({
      tradePage,
      orders,
      api,
      symbol,
    }) => {
      const { spec, away } = await levels(api, symbol);
      const { ask } = await tradePage.orderPanel.quote();
      const before = await orders.pendingIds();
      await tradePage.orderPanel.placePendingOrder({
        type: 'Limit',
        side: 'BUY',
        volume: spec.minContractLotSize,
        price: away(ask, -3),
      });
      const id = await orders.newPendingOrder(before);

      await tradePage.pendingOrders.delete(id);
      orders.release(id);

      expect(await serverPendingOrder(api, id)).toBeUndefined();
      const [order] = await tradePage.history.readOrdersAndDeals(id);
      expect(order?.state).toMatch(/cancel/i);
    });
  });
});
