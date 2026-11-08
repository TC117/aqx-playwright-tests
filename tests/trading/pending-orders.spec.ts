import {
  env,
  hasCredentials,
  MISSING_CREDENTIALS_REASON,
  TRADING_NOT_ALLOWED_REASON,
} from '../../src/config/env';
import { expect, test } from '../../src/fixtures/test';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { firstVolume, parseUiNumber } from '../../src/helpers/numbers';
import {
  executionPrice,
  levelsAround,
  pendingPrices,
  pendingTypeText,
  wrongSidePendingPrice,
} from '../../src/helpers/orderLevels';
import type { Expiry, PendingOrderInput, PendingOrderType, Side } from '../../src/models/trading';
import { serverClock, type ServerClock } from '../../src/pages/components/OrderPanel';
import type { ConfirmationDetails } from '../../src/pages/components/TradeConfirmation';
import { placeExpectingRejection } from '../../src/helpers/tradingSteps';
import { MT5_CODE } from '../../src/pages/components/tradeRequests';

/*
 * R3: placing real pending orders on the demo account. Each test skips while the symbol's market
 * is closed and owns the orders it creates (deleted again by the `orders` fixture). Prices are
 * computed from the live quote, well beyond the stops level, so the orders stay pending.
 *
 * Written while every market was closed: the confirmation dialog and the order requests were seen
 * with mocked responses (tests/mocked), the MT5 rejection codes come from the web trader's bundle.
 * The Expiry column shows the option's label; the Expiry Date cells were checked with fabricated
 * rows (see expectedExpiryDate).
 */

const EXPIRIES: Expiry[] = [
  'Good Till Canceled',
  'Good Till Day',
  'Specified Date',
  'Specified Date and Time',
];
const PENDING_TYPES: PendingOrderType[] = ['Limit', 'Stop', 'Stop Limit'];

/** Cases a TC-PND-25 combination also implements: pick a date (and time), see it listed. */
const ALSO_COVERS: Partial<Record<Expiry, string>> = {
  'Specified Date': 'TC-PND-24',
  'Specified Date and Time': 'TC-PND-14',
};

/** The expiry moment the test asks for, or `undefined` for options without a date. */
function expiryMoment(expiry: Expiry, today: ServerClock, offsetMs: number): Date | undefined {
  if (expiry !== 'Specified Date' && expiry !== 'Specified Date and Time') return undefined;
  // Tomorrow 12:30 on the server clock (the date-only option keeps just the day).
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 30) - offsetMs);
}

/**
 * What the Expiry Date cell should show for each option, given the moment the test asked for. The
 * table uses server time: `--` without an expiry, `YYYY-MM-DD` for Good Till Day and Specified
 * Date, `YYYY-MM-DD HH:mm:ss` for Specified Date and Time (the web trader's formatter, checked
 * with fabricated rows).
 */
function expectedExpiryDate(
  expiry: Expiry,
  today: ServerClock,
  expiresAt: Date | undefined,
  offsetMs: number,
): string {
  const at = expiresAt ? serverClock(expiresAt, offsetMs) : today;
  switch (expiry) {
    case 'Good Till Canceled':
      return '--';
    case 'Good Till Day':
      // TC-PND-13: expires at the end of today's trading day on the server clock. The date the
      // server stores for a Day order has not been seen live yet.
      return today.date;
    case 'Specified Date':
      return at.date;
    case 'Specified Date and Time':
      // The time picker sets whole minutes.
      return `${at.date} ${at.time}:00`;
  }
}

/** Asserts the confirmation dialog showed this order; notes it when One-Click Trading skipped it. */
function expectConfirmation(shown: ConfirmationDetails | null, order: PendingOrderInput): void {
  if (!shown) {
    test.info().annotations.push({
      type: 'note',
      description: 'No confirmation dialog: One-Click Trading was on during this order',
    });
    return;
  }
  expect(shown.orderType.toUpperCase()).toBe(pendingTypeText(order.side, order.type));
  expect(parseUiNumber(shown.fields['Volume'])).toBe(order.volume);
  expect(parseUiNumber(shown.fields['Price'])).toBe(order.price);
  expect(parseUiNumber(shown.fields['Stop Limit Price'])).toBe(order.stopLimitPrice ?? null);
  expect(parseUiNumber(shown.fields['Stop Loss'])).toBe(order.stopLoss ?? null);
  expect(parseUiNumber(shown.fields['Take Profit'])).toBe(order.takeProfit ?? null);
  expect(shown.fields['Expiry']).toBe(order.expiry ?? 'Good Till Canceled');
  expect(shown.fields['Fill Policy']).toBe('Return');
}

test.describe('R3 Place pending orders', { tag: ['@R3', '@market-open'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);
  // Before any fixture opens the trade screen; the `orders` fixture checks it again.
  test.skip(!env.allowTrading, TRADING_NOT_ALLOWED_REASON);

  test.beforeEach(async ({ api, symbol }) => {
    await skipUnlessMarketOpen(api, symbol);
  });

  const typeCases: { id: string; type: PendingOrderType; side: Side }[] = [
    { id: 'TC-PND-01', type: 'Limit', side: 'BUY' },
    { id: 'TC-PND-02', type: 'Limit', side: 'SELL' },
    { id: 'TC-PND-03', type: 'Stop', side: 'BUY' },
    { id: 'TC-PND-04', type: 'Stop', side: 'SELL' },
    { id: 'TC-PND-05', type: 'Stop Limit', side: 'BUY' },
    { id: 'TC-PND-06', type: 'Stop Limit', side: 'SELL' },
  ];
  for (const { id, type, side } of typeCases) {
    test(`${id} ${pendingTypeText(side, type)} with SL and TP is listed in Pending Orders with those values`, async ({
      tradePage,
      api,
      orders,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const panel = tradePage.orderPanel;
      const marginBefore = (await api.account()).margin;
      const before = await orders.snapshot();
      await panel.openTradeForm();
      const prices = pendingPrices(
        type,
        side,
        await panel.quote(),
        spec,
        spec.stopsLevel + 100,
        spec.stopsLevel + 50,
      );
      const order: PendingOrderInput = {
        type,
        side,
        volume: spec.minContractLotSize,
        ...prices,
        // SL/TP are checked against the price the order fills at.
        ...levelsAround(side, executionPrice(prices), spec, spec.stopsLevel + 50),
      };

      // Owned before any check, so a failed check cannot leave the order on the account.
      const orderId = await test.step('place the order', async () => {
        await panel.placePendingOrder(order);
        return orders.newPendingOrder(before, order);
      });

      await test.step('the confirmation dialog showed the order', async () => {
        expectConfirmation(panel.lastConfirmation, order);
      });

      await test.step('Pending Orders lists it with type, volume, price, SL, TP and GTC', async () => {
        const row = await tradePage.pendingOrders.read(orderId);
        expect(row).toMatchObject({
          symbol,
          type: pendingTypeText(side, type),
          price: order.price,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          expiry: 'Good Till Canceled',
          expiryDate: '--',
        });
        expect(firstVolume(row.volumeText)).toBe(order.volume);
      });

      // A pending order holds no margin until it fills (account used serially, see §10).
      expect(Math.abs((await api.account()).margin - marginBefore)).toBeLessThanOrEqual(0.01);
    });
  }

  for (const type of PENDING_TYPES) {
    for (const expiry of EXPIRIES) {
      const ids = ['TC-PND-25', ALSO_COVERS[expiry]].filter(Boolean).join(' ');

      test(`${ids} BUY ${type} with expiry "${expiry}" keeps that expiry`, async ({
        tradePage,
        api,
        orders,
        symbol,
      }) => {
        const spec = await api.symbolDetail(symbol);
        const panel = tradePage.orderPanel;
        const before = await orders.snapshot();
        await panel.openTradeForm();
        const offset = await panel.serverTimeOffsetMs();
        const today = serverClock(new Date(), offset);
        const expiresAt = expiryMoment(expiry, today, offset);
        const prices = pendingPrices(
          type,
          'BUY',
          await panel.quote(),
          spec,
          spec.stopsLevel + 100,
          spec.stopsLevel + 50,
        );
        const order: PendingOrderInput = {
          type,
          side: 'BUY',
          volume: spec.minContractLotSize,
          ...prices,
          expiry,
          expiresAt,
        };

        await panel.placePendingOrder(order);
        const orderId = await orders.newPendingOrder(before, order);
        expectConfirmation(panel.lastConfirmation, order);

        expect(await tradePage.pendingOrders.read(orderId)).toMatchObject({
          type: pendingTypeText('BUY', type),
          expiry,
          expiryDate: expectedExpiryDate(expiry, today, expiresAt, offset),
        });
      });
    }
  }

  test('TC-PND-08 A Buy Limit TP below the current Bid is accepted when it is above the order price', async ({
    tradePage,
    api,
    orders,
    symbol,
  }) => {
    const spec = await api.symbolDetail(symbol);
    const panel = tradePage.orderPanel;
    const gap = spec.stopsLevel + 20;
    const before = await orders.snapshot();
    await panel.openTradeForm();
    const quote = await panel.quote();
    const spreadPoints = Math.round((quote.ask - quote.bid) / spec.pointStep);
    const prices = pendingPrices('Limit', 'BUY', quote, spec, 2 * gap + spreadPoints + 50);
    const order: PendingOrderInput = {
      type: 'Limit',
      side: 'BUY',
      volume: spec.minContractLotSize,
      ...prices,
      ...levelsAround('BUY', prices.price, spec, gap),
    };
    expect(order.takeProfit, 'test data: TP below the Bid').toBeLessThan(quote.bid);

    await panel.placePendingOrder(order);

    const row = await tradePage.pendingOrders.read(await orders.newPendingOrder(before, order));
    expect(row).toMatchObject({ takeProfit: order.takeProfit, stopLoss: order.stopLoss });
  });

  const wrongSide: { type: 'Limit' | 'Stop'; side: Side }[] = [
    { type: 'Limit', side: 'BUY' },
    { type: 'Limit', side: 'SELL' },
    { type: 'Stop', side: 'BUY' },
    { type: 'Stop', side: 'SELL' },
  ];
  for (const { type, side } of wrongSide) {
    test(`TC-PND-09 ${pendingTypeText(side, type)} on the wrong side of the market is refused by the server`, async ({
      tradePage,
      api,
      orders,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();
      // The panel itself accepts any price here (seen 2026-11-08), so the server decides.
      const price = wrongSidePendingPrice(
        type,
        side,
        await panel.quote(),
        spec,
        spec.stopsLevel + 100,
      );
      const before = await orders.pendingIds();

      await expect(
        placeExpectingRejection(tradePage, orders, {
          type,
          side,
          volume: spec.minContractLotSize,
          price,
        }),
      ).rejects.toMatchObject({ code: MT5_CODE.INVALID_PRICE });
      expect(await orders.pendingIds()).toEqual(before);
    });
  }

  test('TC-PND-10 Server refuses a Buy Limit inside the stops level and accepts one just outside', async ({
    tradePage,
    api,
    orders,
    symbol,
  }) => {
    const spec = await api.symbolDetail(symbol);
    test.skip(
      spec.stopsLevel < 10,
      `stops level ${spec.stopsLevel} is too small for a stable check`,
    );
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    // Priced from a fresh quote each time, `points` below the Ask.
    const buyLimit = async (points: number): Promise<PendingOrderInput> => ({
      type: 'Limit',
      side: 'BUY',
      volume: spec.minContractLotSize,
      ...pendingPrices('Limit', 'BUY', await panel.quote(), spec, points),
    });

    await test.step('5 points inside the stops level: refused', async () => {
      const before = await orders.pendingIds();
      await expect(
        placeExpectingRejection(tradePage, orders, await buyLimit(spec.stopsLevel - 5)),
      ).rejects.toMatchObject({ code: MT5_CODE.INVALID_PRICE });
      expect(await orders.pendingIds()).toEqual(before);
    });

    await test.step('5 points outside the stops level: accepted at that price', async () => {
      const before = await orders.snapshot();
      const outside = await buyLimit(spec.stopsLevel + 5);
      await panel.placePendingOrder(outside);
      const row = await tradePage.pendingOrders.read(await orders.newPendingOrder(before, outside));
      expect(row.price).toBe(outside.price);
    });
  });

  test(
    'TC-PND-17 A Buy Limit expiring at a specified time leaves Pending Orders then and shows EXPIRED',
    { tag: '@slow' },
    async ({ tradePage, api, orders, symbol }) => {
      test.setTimeout(8 * 60_000);
      const spec = await api.symbolDetail(symbol);
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();
      const offset = await panel.serverTimeOffsetMs();
      // 3 to 4 minutes ahead, on a whole minute (the time picker has no seconds).
      const expiresAt = new Date(Math.ceil((Date.now() + 3 * 60_000) / 60_000) * 60_000);
      const expiry = 'Specified Date and Time';
      const order: PendingOrderInput = {
        type: 'Limit',
        side: 'BUY',
        volume: spec.minContractLotSize,
        // Far below the market, so it cannot fill before it expires.
        ...pendingPrices('Limit', 'BUY', await panel.quote(), spec, spec.stopsLevel + 500),
        expiry,
        expiresAt,
      };
      const before = await orders.snapshot();
      await panel.placePendingOrder(order);
      const orderId = await orders.newPendingOrder(before, order);
      expect(await tradePage.pendingOrders.read(orderId)).toMatchObject({
        expiry,
        expiryDate: expectedExpiryDate(expiry, serverClock(new Date(), offset), expiresAt, offset),
      });

      await test.step('the server drops it once the expiry time has passed', async () => {
        await expect
          .poll(
            async () => (await api.pendingOrders()).some((p) => String(p.orderId) === orderId),
            {
              message: `pending order ${orderId} should expire`,
              timeout: expiresAt.getTime() - Date.now() + 2 * 60_000,
              intervals: [5_000],
            },
          )
          .toBe(false);
        // Not early; 30 s allow for the difference between this machine's and the server's clock.
        expect(Date.now()).toBeGreaterThanOrEqual(expiresAt.getTime() - 30_000);
      });

      await test.step('Pending Orders drops it and Orders & Deals shows it EXPIRED', async () => {
        await tradePage.pendingOrders.open();
        await expect(tradePage.pendingOrders.row(orderId)).toHaveCount(0);
        const [record] = await tradePage.history.readOrdersAndDeals(orderId);
        expect(record).toMatchObject({
          kind: 'order',
          orderId,
          type: 'Buy Limit',
          volumeText: `${order.volume} / 0`,
          state: 'EXPIRED',
        });
      });
    },
  );
});
