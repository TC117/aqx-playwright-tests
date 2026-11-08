import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import {
  closeTo,
  formatPrice,
  offsetByPoints,
  parseUiNumber,
  roundTo,
} from '../../src/helpers/numbers';
import type { TradePage } from '../../src/pages/TradePage';
import type {
  OrderDealRecord,
  PositionHistoryRecord,
} from '../../src/pages/components/TradeHistory';

/**
 * Real orders on the demo account, followed through every record: toast, order notifications,
 * Open Positions, Positions History, Orders & Deals, the order details dialog and the balance.
 * Each test skips while its market is closed. The balance check assumes no other test trades on
 * the account at the same time (the suite runs with one worker).
 *
 * Not verified live yet (the market was closed while this was written): toast text, the shape
 * of real deal rows and what the details dialog shows for a position closed in two steps.
 */

/** Distance of SL/TP and the pending price from the market, on top of the stops level. */
const BUFFER_POINTS = 200;

/** First number of a volume cell, e.g. 0.01 for `0.01 / 0.02`. */
function closedVolume(volumeText: string): number {
  return Number(volumeText.split('/')[0]!.trim());
}

/** What a record adds to the balance. */
function booked(record: { profit: number | null; commission: number | null; swap: number | null }) {
  return (record.profit ?? 0) + (record.commission ?? 0) + (record.swap ?? 0);
}

/** Order notifications of one position, newest first, reloaded by reopening the panel. */
async function orderNotificationsOf(tradePage: TradePage, orderId: string) {
  const { notifications } = tradePage;
  await notifications.close();
  await notifications.openTab('order');
  return (await notifications.items()).filter((i) => i.orderId === orderId);
}

/** Positions History rows of one position, refetched by leaving and reopening the tab. */
async function freshPositionRows(
  tradePage: TradePage,
  orderId: string,
): Promise<PositionHistoryRecord[]> {
  await tradePage.openPositions.open();
  return tradePage.history.readPositionRows(orderId);
}

test.describe('Records of real orders', { tag: '@market-open' }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test(
    'TC-DTL-01 TC-DTL-03 A Buy opened, partly closed and closed appears consistently in every record',
    { tag: ['@R6', '@R7'] },
    async ({ tradePage, api, orders, symbol }) => {
      await skipUnlessMarketOpen(api, symbol);
      const spec = await api.symbolDetail(symbol);
      const { orderPanel, openPositions, history, notifications } = tradePage;
      const volume = roundTo(spec.minContractLotSize * 2, 2);
      const partial = spec.minContractLotSize;
      const remaining = roundTo(volume - partial, 2);
      const price = (value: number | null) => formatPrice(value ?? NaN, spec.digits);

      const balanceBefore = (await api.account()).balance;
      const ordersBefore = new Set(await history.orderDealIds());
      const positionsBefore = await orders.positionIds();

      const id = await test.step('place a Buy with SL and TP', async () => {
        const quote = await orderPanel.quote();
        const distance = spec.stopsLevel + BUFFER_POINTS;
        await orderPanel.placeMarketOrder({
          side: 'BUY',
          volume,
          stopLoss: offsetByPoints(quote.bid, -distance, spec.pointStep, spec.digits),
          takeProfit: offsetByPoints(quote.bid, distance, spec.pointStep, spec.digits),
        });
        // Toast text not seen live yet; a public source quotes "Position has been created."
        expect(await notifications.lastToast()).toMatch(/created|placed|success/i);
        return orders.newPosition(positionsBefore);
      });

      const opened = await openPositions.read(id);
      expect(opened).toMatchObject({ symbol, side: 'BUY', volume });

      await test.step('"Position Created" notification names the new position', async () => {
        await expect
          .poll(async () => (await orderNotificationsOf(tradePage, id)).map((i) => i.title))
          .toEqual(['Position Created']);
        const [created] = await orderNotificationsOf(tradePage, id);
        expect(created!.meta).toBe(`${symbol}  |  Order No. ${id}`);
        expect(created!.text).toMatch(
          new RegExp(`^BUY ${volume} \\S+ at ${price(opened.entryPrice)}$`),
        );
        await notifications.close();
      });

      const firstClose = await test.step(`close ${partial} of ${volume}`, async () => {
        await openPositions.close(id, { volume: partial });
        await expect.poll(async () => (await openPositions.read(id)).volume).toBe(remaining);
        let rows: PositionHistoryRecord[] = [];
        await expect(async () => {
          rows = await freshPositionRows(tradePage, id);
        }).toPass({ timeout: 30_000 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          orderId: id,
          symbol,
          type: 'BUY',
          volumeText: `${partial} / ${volume}`,
          entryPrice: opened.entryPrice,
          stopLoss: opened.stopLoss,
          takeProfit: opened.takeProfit,
        });
        expect(rows[0]!.profit).not.toBeNull();
        return rows[0]!;
      });

      await test.step('close the rest', async () => {
        await openPositions.close(id);
        orders.release(id);
        await expect(openPositions.row(id)).toHaveCount(0);
      });

      const historyRows = await test.step('Positions History holds both closes', async () => {
        let rows: PositionHistoryRecord[] = [];
        await expect(async () => {
          rows = await freshPositionRows(tradePage, id);
          expect(rows).toHaveLength(2);
        }).toPass({ timeout: 30_000 });
        const last = rows.find((r) => r.closeDate !== firstClose.closeDate);
        expect(last).toMatchObject({
          volumeText: `${remaining} / ${volume}`,
          entryPrice: opened.entryPrice,
          stopLoss: opened.stopLoss,
          takeProfit: opened.takeProfit,
        });
        const total = rows.reduce((sum, r) => sum + closedVolume(r.volumeText), 0);
        expect(roundTo(total, 2)).toBe(volume);
        return rows;
      });

      const lastClose = historyRows.find((r) => r.closeDate !== firstClose.closeDate)!;

      const deals =
        await test.step('Orders & Deals: opening and closing orders are FILLED', async () => {
          const newOrders = (await history.orderDealIds()).filter((o) => !ordersBefore.has(o));
          expect(newOrders, 'one opening and two closing orders').toHaveLength(3);
          expect(newOrders).toContain(id);

          const [openingOrder, ...openingDeals] = await history.readOrdersAndDeals(id);
          expect(openingOrder).toMatchObject({
            kind: 'order',
            symbol,
            type: 'Buy',
            volumeText: `${volume} / ${volume}`,
            stopLoss: opened.stopLoss,
            takeProfit: opened.takeProfit,
          });
          expect(openingOrder!.state).toMatch(/^filled$/i);
          expect(
            openingDeals.map((d) => [d.type, parseUiNumber(d.volumeText), d.entryPrice]),
          ).toEqual([['In', volume, opened.entryPrice]]);

          const closingDeals: OrderDealRecord[] = [];
          for (const closingId of newOrders.filter((o) => o !== id)) {
            const [closingOrder, ...out] = await history.readOrdersAndDeals(closingId);
            expect(closingOrder).toMatchObject({ kind: 'order', symbol, type: 'Sell' });
            expect(closingOrder!.state).toMatch(/^filled$/i);
            expect(out.map((d) => d.type)).toEqual(['Out']);
            closingDeals.push(...out);
          }
          // R7: each Out deal is one of the Positions History closes (volume, price and P/L).
          const fromDeals = closingDeals
            .map((d) => [parseUiNumber(d.volumeText), d.entryPrice, d.profit])
            .sort();
          const fromHistory = historyRows
            .map((r) => [closedVolume(r.volumeText), r.closePrice, r.profit])
            .sort();
          expect(fromDeals).toEqual(fromHistory);
          return [...openingDeals, ...closingDeals];
        });

      await test.step('server history and balance agree with the UI', async () => {
        const server = (await api.positionHistory()).filter((e) => e.positionId === id);
        expect(server.map((e) => [e.profit, e.closePrice]).sort()).toEqual(
          historyRows.map((r) => [r.profit, r.closePrice]).sort(),
        );

        // Every deal (In and Out) books P/L + commission + swap on the balance.
        const expectedChange = deals.reduce((sum, d) => sum + booked(d), 0);
        const balanceAfter = (await api.account()).balance;
        const change = balanceAfter - balanceBefore;
        expect(
          closeTo(change, expectedChange, 0.01),
          `balance moved ${change}, deals booked ${expectedChange}`,
        ).toBe(true);
        expect((await tradePage.account.summary()).balance).toBe(balanceAfter);
      });

      await test.step('"Position Closed" notifications and the details dialog match', async () => {
        let items: Awaited<ReturnType<typeof orderNotificationsOf>> = [];
        await expect(async () => {
          items = await orderNotificationsOf(tradePage, id);
          expect(items.map((i) => i.title)).toEqual([
            'Position Closed',
            'Position Closed',
            'Position Created',
          ]);
        }).toPass({ timeout: 30_000 });
        // Newest first: the last close, then the partial close.
        expect(items[0]!.text).toMatch(
          new RegExp(`BUY ${remaining} \\S+ at ${price(lastClose.closePrice)}$`),
        );
        expect(items[1]!.text).toMatch(
          new RegExp(`BUY ${partial} \\S+ at ${price(firstClose.closePrice)}$`),
        );

        const item = notifications.listItems
          .filter({ hasText: 'Position Closed' })
          .filter({ hasText: `Order No. ${id}` });
        const details = await notifications.openOrderDetails(item.first());
        expect(details).toMatchObject({ title: 'Position Closed', symbol, side: 'BUY' });
        expect(details.fields).toMatchObject({
          'Order No.': id,
          'Entry Price': price(opened.entryPrice),
          'Stop Loss': price(opened.stopLoss),
          'Take Profit': price(opened.takeProfit),
        });
        await notifications.closeOrderDetails();
      });
    },
  );

  test(
    'TC-DTL-02 A cancelled pending order shows CANCELED in Orders & Deals and never reaches Positions History',
    { tag: ['@R6', '@R7'] },
    async ({ tradePage, api, orders, symbol }) => {
      await skipUnlessMarketOpen(api, symbol);
      const spec = await api.symbolDetail(symbol);
      const { orderPanel, pendingOrders, history } = tradePage;
      const volume = spec.minContractLotSize;
      const quote = await orderPanel.quote();
      // A Buy Limit far below the market, so it cannot fill before it is deleted.
      const limitPrice = offsetByPoints(
        quote.ask,
        -(spec.stopsLevel + 5 * BUFFER_POINTS),
        spec.pointStep,
        spec.digits,
      );

      const before = await orders.pendingIds();
      await orderPanel.placePendingOrder({
        type: 'Limit',
        side: 'BUY',
        volume,
        price: limitPrice,
        expiry: 'Good Till Canceled',
      });
      const id = await orders.newPendingOrder(before);
      await pendingOrders.delete(id);
      orders.release(id);

      const rows = await history.readOrdersAndDeals(id);
      // No deals: nothing was filled.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'order',
        orderId: id,
        symbol,
        type: 'Buy Limit',
        volumeText: `${volume} / 0`,
        fillPolicy: 'Return',
        entryPrice: limitPrice,
        profit: null,
      });
      expect(rows[0]!.state).toMatch(/^cancell?ed$/i);

      await history.openPositionsHistory();
      // "All" keeps the initial deposit in range, proving the list has loaded.
      await history.selectDateRange('All');
      await expect(history.positionRows.first()).toBeVisible();
      await expect(history.row(id)).toHaveCount(0);
    },
  );
});
