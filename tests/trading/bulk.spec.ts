import type { Page, Request } from '@playwright/test';
import type { AqxApi } from '../../src/api/AqxApi';
import {
  env,
  hasCredentials,
  MISSING_CREDENTIALS_REASON,
  TRADING_NOT_ALLOWED_REASON,
} from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { offsetByPoints } from '../../src/helpers/numbers';
import type { TradePage } from '../../src/pages/TradePage';
import { TRADE_API } from '../../src/pages/components/tradeRequests';
import { openPosition, placePendingOrder } from '../../src/helpers/tradingSteps';

/**
 * Bulk close and bulk delete on the real demo account (R5).
 *
 * A bulk action acts on EVERY listed item of the account, and the account is shared. So each test
 * first makes sure the account holds nothing else, creates its own items, and right before
 * confirming checks again (through the API) that the account holds exactly those items; otherwise
 * it skips and `orders` removes what it created one by one.
 */

const BUFFER_POINTS = 50;

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

/**
 * Whether a position is clearly in profit or at a loss. The UI picks the positions to close by
 * the P/L it shows when the menu entry is clicked, a few seconds after this check, so "clearly"
 * means by more than one spread. Compared in price, so no currency conversion is needed: Bid −
 * entry for a Buy, entry − Ask for a Sell.
 */
async function standing(tradePage: TradePage, orderId: string): Promise<'profit' | 'loss' | ''> {
  const row = await tradePage.openPositions.read(orderId);
  const { bid, ask } = await tradePage.orderPanel.quote();
  const spread = ask - bid;
  const edge = row.side === 'BUY' ? bid - row.entryPrice : row.entryPrice - ask;
  return edge > spread ? 'profit' : edge < -spread ? 'loss' : '';
}

/** [winner, loser] once one position is clearly in profit and the other clearly at a loss. */
async function winnerAndLoser(
  tradePage: TradePage,
  a: string,
  b: string,
): Promise<[string, string]> {
  const [standingA, standingB] = [await standing(tradePage, a), await standing(tradePage, b)];
  if (standingA === 'profit' && standingB === 'loss') return [a, b];
  if (standingB === 'profit' && standingA === 'loss') return [b, a];
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
  // Before any fixture opens the trade screen; the `orders` fixture checks it again.
  test.skip(!env.allowTrading, TRADING_NOT_ALLOWED_REASON);

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
      await openPosition(tradePage, orders, { side: 'BUY', volume: lot }),
      await openPosition(tradePage, orders, { side: 'SELL', volume: lot }),
      await openPosition(tradePage, orders, { side: 'BUY', volume: 2 * lot }),
    ];
    const { ask } = await tradePage.orderPanel.quote();
    const pending = [
      await placePendingOrder(tradePage, orders, {
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

    // The positions stay owned: clean-up skips the ones that are gone and closes any left behind.
    const sent = nextBulkRequest(page, TRADE_API.bulkClose);
    await tradePage.bulk.closePositions('all');

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
      await placePendingOrder(tradePage, orders, {
        type: 'Limit',
        side: 'BUY',
        volume: lot,
        price: at(ask, -3),
      }),
      await placePendingOrder(tradePage, orders, {
        type: 'Limit',
        side: 'SELL',
        volume: lot,
        price: at(bid, 3),
      }),
      await placePendingOrder(tradePage, orders, {
        type: 'Stop',
        side: 'BUY',
        volume: lot,
        price: at(ask, 3),
      }),
    ];
    const positions = [await openPosition(tradePage, orders, { side: 'BUY', volume: lot })];
    await tradePage.pendingOrders.open();
    await skipUnlessAccountHoldsOnly(api, { positions, pending });

    const sent = nextBulkRequest(page, TRADE_API.bulkDelete);
    await tradePage.bulk.deleteAllPendingOrders();

    expect(await sent, 'the request should name every pending order').toEqual([...pending].sort());
    await expect(tradePage.pendingOrders.tab).toHaveText('Pending Orders (0)');
    await expect(tradePage.pendingOrders.emptyState).toBeVisible();
    expect((await accountItems(api)).pending).toEqual([]);

    await test.step('each order is cancelled in Orders & Deals', async () => {
      for (const id of pending) {
        const [order] = await tradePage.history.readOrdersAndDeals(id);
        expect(order?.state, `order ${id}`).toBe('CANCELED');
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
      // New positions start at a loss (the spread); a Buy and a Sell split into one clear winner
      // and one clear loser once the price has moved about two spreads (see `standing`).
      test.setTimeout(300_000);
      const lot = (await api.symbolDetail(symbol)).minContractLotSize;
      const buy = await openPosition(tradePage, orders, { side: 'BUY', volume: lot });
      const sell = await openPosition(tradePage, orders, { side: 'SELL', volume: lot });
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
        test.skip(true, 'the price did not move clearly away from the open within 3 minutes');
      }
      await skipUnlessAccountHoldsOnly(api, { positions: [buy, sell], pending: [] });
      // Checked again right before the menu entry is clicked.
      test.skip(!(await split()), 'the two positions came back within one spread of their open');

      await test.step('Profitable Positions', async () => {
        const sent = nextBulkRequest(page, TRADE_API.bulkClose);
        await tradePage.bulk.closePositions('profit');
        expect(await sent).toEqual([winner]);
        await expect(positions.row(winner)).toHaveCount(0);
        await expect(positions.row(loser)).toHaveCount(1);
      });

      await test.step('Loss Positions', async () => {
        // Prices may have moved: only close when the remaining position is still clearly at a loss.
        test.skip(
          (await standing(tradePage, loser)) !== 'loss',
          'the loser is no longer clearly at a loss',
        );
        const sent = nextBulkRequest(page, TRADE_API.bulkClose);
        await tradePage.bulk.closePositions('loss');
        expect(await sent).toEqual([loser]);
        await expect(positions.emptyState).toBeVisible();
      });
    },
  );
});
