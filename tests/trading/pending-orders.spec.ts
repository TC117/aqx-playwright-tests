import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect, test } from '../../src/fixtures/test';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { parseUiNumber } from '../../src/helpers/numbers';
import type { OrderTracker } from '../../src/helpers/OrderTracker';
import {
  executionPrice,
  levelsAround,
  pendingPrices,
  pendingTypeText,
  wrongSidePendingPrice,
} from '../../src/helpers/orderLevels';
import type {
  Expiry,
  PendingOrderInput,
  PendingOrderRow,
  PendingOrderType,
  Side,
} from '../../src/models/trading';
import {
  serverClock,
  type OrderPanel,
  type ServerClock,
} from '../../src/pages/components/OrderPanel';
import type { ConfirmationDetails } from '../../src/pages/components/TradeConfirmation';

/*
 * R3: placing real pending orders on the demo account. Each test skips while the symbol's market
 * is closed and owns the orders it creates (deleted again by the `orders` fixture). Prices are
 * computed from the live quote, well beyond the stops level, so the orders stay pending.
 *
 * Written while every market was closed: the confirmation dialog, the order API and the MT5
 * rejection codes come from the web trader's bundle. How the Pending Orders table words the
 * expiry is not known yet, so those checks accept the usual spellings.
 */

/** MT5 code for an order price on the wrong side or too close to the market ("Invalid price"). */
const INVALID_PRICE = '10015';

const EXPIRIES: Expiry[] = [
  'Good Till Canceled',
  'Good Till Day',
  'Specified Date',
  'Specified Date and Time',
];
const PENDING_TYPES: PendingOrderType[] = ['Limit', 'Stop', 'Stop Limit'];

/** Expiry column text for each option (table wording not seen yet). */
const EXPIRY_IN_LIST: Record<Expiry, RegExp> = {
  'Good Till Canceled': /^(good till cancell?ed|gtc)$/i,
  'Good Till Day': /^(good till day|gtd|day)$/i,
  'Specified Date': /^specified date$/i,
  'Specified Date and Time': /^specified date and time$/i,
};

/** The expiry moment the test asks for, or `undefined` for options without a date. */
function expiryMoment(expiry: Expiry, today: ServerClock, offsetMs: number): Date | undefined {
  if (expiry !== 'Specified Date' && expiry !== 'Specified Date and Time') return undefined;
  // Tomorrow 12:30 on the server clock (the date-only option keeps just the day).
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 30) - offsetMs);
}

/**
 * What the Expiry Date column should show for each option, given the moment the test asked for.
 * Dates and times hold only digits, `-` and `:`, so they need no regex escaping.
 */
function expectedExpiryDate(
  expiry: Expiry,
  today: ServerClock,
  expiresAt: Date | undefined,
  offsetMs: number,
): RegExp {
  const at = expiresAt ? serverClock(expiresAt, offsetMs) : today;
  switch (expiry) {
    case 'Good Till Canceled':
      return /^(--)?$/;
    case 'Good Till Day':
      // Expires at the end of the trading day on the server clock.
      return new RegExp(today.date);
    case 'Specified Date':
      return new RegExp(at.date);
    case 'Specified Date and Time':
      return new RegExp(`${at.date} ${at.time}`);
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

/** Requested volume of a Volume cell such as `0.01 / 0` (requested / filled). */
function requestedVolume(row: PendingOrderRow): number | null {
  return parseUiNumber(row.volumeText.split('/')[0]);
}

/**
 * Places an order that the server is expected to refuse. If it is accepted after all, the new
 * order is taken over so clean-up deletes it, and the promise still resolves (failing the test).
 */
async function placeExpectingRejection(
  panel: OrderPanel,
  orders: OrderTracker,
  order: PendingOrderInput,
): Promise<void> {
  const before = await orders.pendingIds();
  await panel.placePendingOrder(order);
  await orders.newPendingOrder(before);
}

test.describe('R3 Place pending orders', { tag: ['@R3', '@market-open'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

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
      const before = await orders.pendingIds();
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

      await test.step('place the order', async () => {
        await panel.placePendingOrder(order);
      });

      await test.step('the confirmation dialog showed the order', async () => {
        expectConfirmation(panel.lastConfirmation, order);
      });

      await test.step('Pending Orders lists it with type, volume, price, SL, TP and GTC', async () => {
        const row = await tradePage.pendingOrders.read(await orders.newPendingOrder(before));
        expect(row).toMatchObject({
          symbol,
          type: pendingTypeText(side, type),
          price: order.price,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
        });
        expect(requestedVolume(row)).toBe(order.volume);
        expect(row.expiry).toMatch(EXPIRY_IN_LIST['Good Till Canceled']);
      });

      // A pending order holds no margin until it fills (account used serially, see §10).
      expect(Math.abs((await api.account()).margin - marginBefore)).toBeLessThanOrEqual(0.01);
    });
  }

  for (const type of PENDING_TYPES) {
    for (const expiry of EXPIRIES) {
      test(`TC-PND-25 BUY ${type} with expiry "${expiry}" keeps that expiry`, async ({
        tradePage,
        api,
        orders,
        symbol,
      }) => {
        const spec = await api.symbolDetail(symbol);
        const panel = tradePage.orderPanel;
        const before = await orders.pendingIds();
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
        expectConfirmation(panel.lastConfirmation, order);

        const row = await tradePage.pendingOrders.read(await orders.newPendingOrder(before));
        expect(row.type).toBe(pendingTypeText('BUY', type));
        expect(row.expiry).toMatch(EXPIRY_IN_LIST[expiry]);
        expect(row.expiryDate).toMatch(expectedExpiryDate(expiry, today, expiresAt, offset));
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
    const before = await orders.pendingIds();
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

    const row = await tradePage.pendingOrders.read(await orders.newPendingOrder(before));
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
        placeExpectingRejection(panel, orders, {
          type,
          side,
          volume: spec.minContractLotSize,
          price,
        }),
      ).rejects.toMatchObject({ code: INVALID_PRICE });
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
        placeExpectingRejection(panel, orders, await buyLimit(spec.stopsLevel - 5)),
      ).rejects.toMatchObject({ code: INVALID_PRICE });
      expect(await orders.pendingIds()).toEqual(before);
    });

    await test.step('5 points outside the stops level: accepted at that price', async () => {
      const before = await orders.pendingIds();
      const outside = await buyLimit(spec.stopsLevel + 5);
      await panel.placePendingOrder(outside);
      const row = await tradePage.pendingOrders.read(await orders.newPendingOrder(before));
      expect(row.price).toBe(outside.price);
    });
  });
});
