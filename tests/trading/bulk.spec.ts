import type { Page, Request } from '@playwright/test';
import type { AqxApi } from '../../src/api/AqxApi';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';
import type { OrderTracker } from '../../src/helpers/OrderTracker';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { offsetByPoints } from '../../src/helpers/numbers';
import type { PendingOrderInput, Side } from '../../src/models/trading';
import type { TradePage } from '../../src/pages/TradePage';
import { TRADE_API } from '../../src/pages/components/tradeRequests';

/**
 * Bulk close and bulk delete on the real demo account (R5).
 *
 * A bulk action acts on EVERY listed item of the account, and the account is shared. So each test
 * first makes sure the account holds nothing else, creates its own items, and right before
 * confirming checks again (through the API) that the account holds exactly those items; otherwise
 * it skips and `orders` removes what it created one by one.
 */

const BUFFER_POINTS = 50;

async function openPosition(
  tradePage: TradePage,
  orders: OrderTracker,
  side: Side,
  volume: number,
): Promise<string> {
  const before = await orders.positionIds();
  await tradePage.orderPanel.placeMarketOrder({ side, volume });
  return orders.newPosition(before);
}

async function placePending(
  tradePage: TradePage,
  orders: OrderTracker,
  order: PendingOrderInput,
): Promise<string> {
  const before = await orders.pendingIds();
  await tradePage.orderPanel.placePendingOrder(order);
  return orders.newPendingOrder(before);
}

/** Order Nos. the server holds, sorted. */
async function accountItems(api: AqxApi): Promise<{ positions: string[]; pending: string[] }> {
  const [positions, pending] = await Promise.all([api.openPositions(), api.pendingOrders()]);
  return {
    positions: positions.map((p) => String(p.orderId)).sort(),
    pending: pending.map((p) => String(p.orderId)).sort(),
  };
}

async function skipUnlessAccountEmpty(api: AqxApi): Promise<void> {
  const { marketOrderCounts, pendingOrderCounts } = await api.orderCounts();
  test.skip(
    marketOrderCounts + pendingOrderCounts > 0,
    `the shared account already holds ${marketOrderCounts} positions and ${pendingOrderCounts} pending orders; a bulk action would touch them`,
  );
}

async function skipUnlessAccountHoldsOnly(
  api: AqxApi,
  mine: { positions: string[]; pending: string[] },
): Promise<void> {
  const held = await accountItems(api);
  const expected = { positions: [...mine.positions].sort(), pending: [...mine.pending].sort() };
  test.skip(
    JSON.stringify(held) !== JSON.stringify(expected),
    `the shared account holds items this test did not create (${JSON.stringify(held)}); a bulk action would touch them`,
  );
}

/** [winner, loser] once one position is in profit and the other at a loss, else empty ids. */
async function winnerAndLoser(
  tradePage: TradePage,
  a: string,
  b: string,
): Promise<[string, string]> {
  const profitA = Number((await tradePage.openPositions.read(a)).profit);
  const profitB = Number((await tradePage.openPositions.read(b)).profit);
  if (profitA > 0 && profitB < 0) return [a, b];
  if (profitB > 0 && profitA < 0) return [b, a];
  return ['', ''];
}

/** Order Nos. in the next bulk request the page sends to `path`. */
function nextBulkRequest(page: Page, path: string): Promise<string[]> {
  return page
    .waitForRequest((r: Request) => r.method() === 'PUT' && new URL(r.url()).pathname === path)
    .then((r) => {
      const body = r.postDataJSON() as
        { orderList?: { orderId: string }[] } | { orderId: string }[];
      const items = Array.isArray(body) ? body : (body.orderList ?? []);
      return items.map((i) => String(i.orderId)).sort();
    });
}

test.describe('Bulk actions on the live account', { tag: ['@R5', '@market-open'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test.beforeEach(async ({ api, symbol }) => {
    await skipUnlessMarketOpen(api, symbol);
    await skipUnlessAccountEmpty(api);
  });

  test('TC-BLK-01 TC-BLK-08 Close all closes every position and leaves pending orders alone', async ({
    page,
    tradePage,
    orders,
    api,
    symbol,
  }) => {
    const spec = await api.symbolDetail(symbol);
    const lot = spec.minContractLotSize;
    const positions = [
      await openPosition(tradePage, orders, 'BUY', lot),
      await openPosition(tradePage, orders, 'SELL', lot),
      await openPosition(tradePage, orders, 'BUY', 2 * lot),
    ];
    const { ask } = await tradePage.orderPanel.quote();
    const pending = [
      await placePending(tradePage, orders, {
        type: 'Limit',
        side: 'BUY',
        volume: lot,
        price: offsetByPoints(
          ask,
          -3 * (spec.stopsLevel + BUFFER_POINTS),
          spec.pointStep,
          spec.digits,
        ),
      }),
    ];
    await tradePage.openPositions.open();
    await skipUnlessAccountHoldsOnly(api, { positions, pending });

    const sent = nextBulkRequest(page, TRADE_API.bulkClose);
    await tradePage.bulk.closePositions('all');
    for (const id of positions) orders.release(id);

    expect(await sent, 'the request should name every position').toEqual([...positions].sort());
    await expect(tradePage.openPositions.tab).toHaveText('Open Positions (0)');
    await expect(tradePage.openPositions.emptyState).toBeVisible();
    expect((await accountItems(api)).positions).toEqual([]);

    await test.step('each position is in Positions History', async () => {
      await expect
        .poll(async () => {
          const history = await api.positionHistory();
          return positions.filter((id) =>
            history.some((h) => h.positionId === id && h.closePrice > 0),
          );
        })
        .toEqual(positions);
    });

    await test.step('TC-BLK-08 the pending order is untouched', async () => {
      await tradePage.pendingOrders.open();
      expect(await tradePage.pendingOrders.orderIds()).toEqual(pending);
    });
  });

  test('TC-BLK-05 TC-BLK-08 Delete all removes every pending order and leaves positions alone', async ({
    page,
    tradePage,
    orders,
    api,
    symbol,
  }) => {
    const spec = await api.symbolDetail(symbol);
    const lot = spec.minContractLotSize;
    const distance = (spec.stopsLevel + BUFFER_POINTS) * spec.pointStep;
    const { bid, ask } = await tradePage.orderPanel.quote();
    const at = (price: number, n: number): number =>
      Number((price + n * distance).toFixed(spec.digits));
    const pending = [
      await placePending(tradePage, orders, {
        type: 'Limit',
        side: 'BUY',
        volume: lot,
        price: at(ask, -3),
      }),
      await placePending(tradePage, orders, {
        type: 'Limit',
        side: 'SELL',
        volume: lot,
        price: at(bid, 3),
      }),
      await placePending(tradePage, orders, {
        type: 'Stop',
        side: 'BUY',
        volume: lot,
        price: at(ask, 3),
      }),
    ];
    const positions = [await openPosition(tradePage, orders, 'BUY', lot)];
    await tradePage.pendingOrders.open();
    await skipUnlessAccountHoldsOnly(api, { positions, pending });

    const sent = nextBulkRequest(page, TRADE_API.bulkDelete);
    await tradePage.bulk.deleteAllPendingOrders();
    for (const id of pending) orders.release(id);

    expect(await sent, 'the request should name every pending order').toEqual([...pending].sort());
    await expect(tradePage.pendingOrders.tab).toHaveText('Pending Orders (0)');
    await expect(tradePage.pendingOrders.emptyState).toBeVisible();
    expect((await accountItems(api)).pending).toEqual([]);

    await test.step('each order is cancelled in Orders & Deals', async () => {
      for (const id of pending) {
        const [order] = await tradePage.history.readOrdersAndDeals(id);
        expect(order?.state, `order ${id}`).toMatch(/cancel/i);
      }
    });

    await test.step('TC-BLK-08 the position is untouched', async () => {
      await tradePage.openPositions.open();
      expect(await tradePage.openPositions.orderIds()).toEqual(positions);
    });
  });

  test(
    'TC-BLK-02 TC-BLK-03 Close profitable / losing closes only positions with that P/L sign',
    { tag: '@slow' },
    async ({ page, tradePage, orders, api, symbol }) => {
      // New positions start at a loss (the spread); a Buy and a Sell split into one winner and one
      // loser once the price moves more than the spread.
      test.setTimeout(300_000);
      const lot = (await api.symbolDetail(symbol)).minContractLotSize;
      const buy = await openPosition(tradePage, orders, 'BUY', lot);
      const sell = await openPosition(tradePage, orders, 'SELL', lot);
      const positions = tradePage.openPositions;
      await positions.open();

      let winner = '';
      let loser = '';
      const split = async (): Promise<boolean> => {
        [winner, loser] = await winnerAndLoser(tradePage, buy, sell);
        return winner !== '';
      };
      try {
        await expect.poll(split, { timeout: 180_000, intervals: [2_000] }).toBe(true);
      } catch {
        test.skip(true, 'the price did not move more than the spread within 3 minutes');
      }
      await skipUnlessAccountHoldsOnly(api, { positions: [buy, sell], pending: [] });

      await test.step('Profitable Positions', async () => {
        const sent = nextBulkRequest(page, TRADE_API.bulkClose);
        await tradePage.bulk.closePositions('profit');
        orders.release(winner);
        expect(await sent).toEqual([winner]);
        await expect(positions.row(winner)).toHaveCount(0);
        await expect(positions.row(loser)).toHaveCount(1);
      });

      await test.step('Loss Positions', async () => {
        // Prices may have moved: only close when the remaining position is still at a loss.
        test.skip(Number((await positions.read(loser)).profit) >= 0, 'the loser turned profitable');
        const sent = nextBulkRequest(page, TRADE_API.bulkClose);
        await tradePage.bulk.closePositions('loss');
        orders.release(loser);
        expect(await sent).toEqual([loser]);
        await expect(positions.emptyState).toBeVisible();
      });
    },
  );
});
