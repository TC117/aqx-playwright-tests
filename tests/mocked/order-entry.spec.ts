import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect } from '../../src/fixtures/test';
import { mockedTest as test, ORDER_TYPE, type CapturedOrder } from '../../src/helpers/mockMarket';
import { parseUiNumber } from '../../src/helpers/numbers';
import {
  executionPrice,
  levelsAround,
  marketLevels,
  pendingPrices,
  pendingTypeText,
} from '../../src/helpers/orderLevels';
import type {
  Expiry,
  MarketOrderInput,
  PendingOrderInput,
  PendingOrderType,
  Side,
} from '../../src/models/trading';
import { OrderRejectedError, serverClock } from '../../src/pages/components/OrderPanel';
import type { ConfirmationDetails } from '../../src/pages/components/TradeConfirmation';

/*
 * The order panel's place flows against a mocked open market (R1, R3): the server keeps serving
 * everything else, only the market status it reports is replaced, and order requests are answered
 * in the browser, so nothing reaches the server. This proves today, with every market closed, that
 * `placeMarketOrder` / `placePendingOrder` send exactly the order they were given, show it in the
 * confirmation dialog, and surface a refusal. What the server then does with an order is covered
 * by tests/trading (market open).
 */

const MARKET_API = '/api/trade/trade/v1/market';
const PENDING_API = '/api/trade/trade/v1/limit';

/** Order type codes the web trader sends (from its bundle). */
const PENDING_ORDER_TYPE: Record<Side, Record<PendingOrderType, number>> = {
  BUY: { Limit: 2, Stop: 4, 'Stop Limit': 8 },
  SELL: { Limit: 3, Stop: 5, 'Stop Limit': 9 },
};
const TRADE_EXPIRY: Record<Expiry, string> = {
  'Good Till Canceled': 'GTC',
  'Good Till Day': 'GTD',
  'Specified Date and Time': 'SPECIFIED_TIMESTAMP',
  'Specified Date': 'SPECIFIED_DAY',
};
/** Fill policy codes: 0 = Fill or Kill (market orders), 2 = Return (pending orders). */
const FILL_OR_KILL = 0;
const RETURN = 2;

const VOLUME = 0.02;

/** Values of the confirmation dialog, as numbers where they are numbers. */
function confirmationNumbers(shown: ConfirmationDetails | null): Record<string, number | null> {
  const fields = shown?.fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseUiNumber(v)]));
}

/** Tomorrow 12:30 on the server clock, for the expiry options that take a date. */
function tomorrowAt1230(expiry: Expiry, offsetMs: number): Date | undefined {
  if (expiry !== 'Specified Date' && expiry !== 'Specified Date and Time') return undefined;
  const today = serverClock(new Date(), offsetMs);
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 30) - offsetMs);
}

/**
 * `expiration` the app sends (seen 2026-11-08 with the requests answered in the browser): the
 * picked moment for "Specified Date and Time", 00:00 of the picked day on the server clock for
 * "Specified Date", nothing otherwise.
 */
function expirationSent(
  expiry: Expiry,
  expiresAt: Date | undefined,
  offsetMs: number,
): number | undefined {
  if (!expiresAt) return undefined;
  if (expiry === 'Specified Date and Time') return expiresAt.getTime();
  const day = serverClock(expiresAt, offsetMs);
  return Date.UTC(day.year, day.month - 1, day.day) - offsetMs;
}

/** A captured request body as a plain object (empty when no request was captured). */
function bodyOf(request: CapturedOrder | undefined): Record<string, unknown> {
  return { ...request?.body };
}

test.describe('R1 Placing market orders (mocked open market)', { tag: ['@R1', '@mocked'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);
  test.use({ oneClickSetting: false });

  const sides: { id: string; side: Side }[] = [
    { id: 'TC-MKT-04', side: 'BUY' },
    { id: 'TC-MKT-05', side: 'SELL' },
  ];
  for (const { id, side } of sides) {
    test(`${id} placeMarketOrder sends one ${side} order with the volume, SL and TP shown in the confirmation`, async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const { orderPanel: panel, notifications } = tradePage;
      await panel.openTradeForm();
      const order: MarketOrderInput = {
        side,
        volume: VOLUME,
        ...marketLevels(side, await panel.quote(), spec, spec.stopsLevel + 100),
      };

      await panel.placeMarketOrder(order);

      await test.step('the confirmation dialog showed the order', async () => {
        expect(panel.lastConfirmation).toMatchObject({ symbol, orderType: side });
        expect(confirmationNumbers(panel.lastConfirmation)).toMatchObject({
          Volume: VOLUME,
          Units: VOLUME * spec.contractSize,
          'Stop Loss': order.stopLoss,
          'Take Profit': order.takeProfit,
        });
        expect(panel.lastConfirmation?.fields['Fill Policy']).toBe('Fill or Kill');
        expect(panel.lastConfirmation?.fields['Est. Margin Required']).toMatch(/^[\d,.]+ USD$/);
      });

      await test.step('exactly one request went out, with the order', async () => {
        await expect(notifications.toast).toHaveText('Position has been created.');
        // Once the toast is gone there has been time for a duplicate request to show up.
        await expect(notifications.toast).toBeHidden();
        expect(orderRequests).toHaveLength(1);
        expect(orderRequests[0]).toMatchObject({ method: 'POST', path: MARKET_API });
        expect(bodyOf(orderRequests[0])).toEqual({
          orderType: ORDER_TYPE[side],
          symbol,
          lotSize: VOLUME,
          fillPolicy: FILL_OR_KILL,
          indicate: 'PRICE',
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
        });
      });
    });
  }

  test('TC-MKT-02 A market order without SL and TP sends neither and shows neither', async ({
    tradePage,
    orderRequests,
    symbol,
  }) => {
    const panel = tradePage.orderPanel;

    await panel.placeMarketOrder({ side: 'BUY', volume: VOLUME });

    expect(Object.keys(panel.lastConfirmation?.fields ?? {})).not.toContain('Stop Loss');
    expect(Object.keys(panel.lastConfirmation?.fields ?? {})).not.toContain('Take Profit');
    expect(orderRequests.map(bodyOf)).toEqual([
      {
        orderType: ORDER_TYPE.BUY,
        symbol,
        lotSize: VOLUME,
        fillPolicy: FILL_OR_KILL,
        indicate: 'PRICE',
      },
    ]);
  });

  test('TC-MKT-13 Cancel in the confirmation dialog sends nothing', async ({
    tradePage,
    orderRequests,
    api,
    symbol,
  }) => {
    const spec = await api.symbolDetail(symbol);
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    await panel.fillMarketOrder({
      side: 'SELL',
      volume: VOLUME,
      ...marketLevels('SELL', await panel.quote(), spec, spec.stopsLevel + 100),
    });

    await panel.placeButton.click();
    await expect(panel.confirmation.title).toBeVisible();
    await expect(panel.confirmation.orderType).toHaveText('SELL');
    await panel.confirmation.cancel();

    expect(orderRequests).toEqual([]);
  });

  test.describe('with One-Click Trading on', () => {
    test.use({ oneClickSetting: true });

    test('TC-OCT-04 placeMarketOrder sends the order at once, without a confirmation', async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();
      const levels = marketLevels('SELL', await panel.quote(), spec, spec.stopsLevel + 100);

      await panel.placeMarketOrder({ side: 'SELL', volume: VOLUME, ...levels });

      expect(panel.lastConfirmation).toBeNull();
      expect(orderRequests.map(bodyOf)).toEqual([
        {
          orderType: ORDER_TYPE.SELL,
          symbol,
          lotSize: VOLUME,
          fillPolicy: FILL_OR_KILL,
          indicate: 'PRICE',
          ...levels,
        },
      ]);
    });
  });
});

test.describe('R3 Placing pending orders (mocked open market)', { tag: ['@R3', '@mocked'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);
  test.use({ oneClickSetting: false });

  const typeCases: { id: string; type: PendingOrderType; side: Side }[] = [
    { id: 'TC-PND-01', type: 'Limit', side: 'BUY' },
    { id: 'TC-PND-02', type: 'Limit', side: 'SELL' },
    { id: 'TC-PND-03', type: 'Stop', side: 'BUY' },
    { id: 'TC-PND-04', type: 'Stop', side: 'SELL' },
    { id: 'TC-PND-05', type: 'Stop Limit', side: 'BUY' },
    { id: 'TC-PND-06', type: 'Stop Limit', side: 'SELL' },
  ];
  for (const { id, type, side } of typeCases) {
    test(`${id} placePendingOrder sends one ${pendingTypeText(side, type)} with its prices, SL, TP and GTC`, async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const { orderPanel: panel, notifications } = tradePage;
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
        volume: VOLUME,
        ...prices,
        ...levelsAround(side, executionPrice(prices), spec, spec.stopsLevel + 50),
      };

      await panel.placePendingOrder(order);

      await test.step('the confirmation dialog showed the order', async () => {
        expect(panel.lastConfirmation?.orderType).toBe(pendingTypeText(side, type));
        expect(confirmationNumbers(panel.lastConfirmation)).toMatchObject({
          Volume: VOLUME,
          Price: order.price,
          'Stop Loss': order.stopLoss,
          'Take Profit': order.takeProfit,
        });
        expect(confirmationNumbers(panel.lastConfirmation)['Stop Limit Price'] ?? null).toBe(
          order.stopLimitPrice ?? null,
        );
        expect(panel.lastConfirmation?.fields).toMatchObject({
          Expiry: 'Good Till Canceled',
          'Fill Policy': 'Return',
        });
      });

      await test.step('exactly one request went out, with the order', async () => {
        await expect(notifications.toast).toHaveText('Order has been created.');
        await expect(notifications.toast).toBeHidden();
        expect(orderRequests).toHaveLength(1);
        expect(orderRequests[0]).toMatchObject({ method: 'POST', path: PENDING_API });
        expect(bodyOf(orderRequests[0])).toEqual({
          orderType: PENDING_ORDER_TYPE[side][type],
          symbol,
          lotSize: VOLUME,
          price: order.price,
          priceTrigger: order.stopLimitPrice ?? null,
          fillPolicy: RETURN,
          indicate: 'PRICE',
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          tradeExpiry: 'GTC',
        });
      });
    });
  }

  for (const expiry of [
    'Good Till Day',
    'Specified Date',
    'Specified Date and Time',
  ] as const satisfies Expiry[]) {
    test(`TC-PND-25 placePendingOrder sends the expiry "${expiry}"`, async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();
      const offset = await panel.serverTimeOffsetMs();
      const expiresAt = tomorrowAt1230(expiry, offset);
      const order: PendingOrderInput = {
        type: 'Limit',
        side: 'BUY',
        volume: VOLUME,
        ...pendingPrices('Limit', 'BUY', await panel.quote(), spec, spec.stopsLevel + 100),
        expiry,
        expiresAt,
      };

      await panel.placePendingOrder(order);

      expect(panel.lastConfirmation?.fields['Expiry']).toBe(expiry);
      expect(orderRequests.map(bodyOf)).toEqual([
        {
          orderType: PENDING_ORDER_TYPE.BUY.Limit,
          symbol,
          lotSize: VOLUME,
          price: order.price,
          priceTrigger: null,
          fillPolicy: RETURN,
          indicate: 'PRICE',
          tradeExpiry: TRADE_EXPIRY[expiry],
          // Epoch milliseconds; toEqual treats an undefined value as an absent key.
          expiration: expirationSent(expiry, expiresAt, offset),
        },
      ]);
    });
  }
});

test.describe('Refused orders (mocked open market)', { tag: ['@R1', '@R3', '@mocked'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);
  test.use({ oneClickSetting: false });

  test.describe('SL/TP refused by the server', () => {
    test.use({
      orderReply: { kind: 'error', status: 400, code: '10016', message: 'Invalid stops' },
    });

    test('TC-MKT-10 placeMarketOrder rejects with the server code and the app shows its message', async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const { orderPanel: panel, notifications } = tradePage;
      await panel.openTradeForm();
      const order: MarketOrderInput = {
        side: 'BUY',
        volume: VOLUME,
        ...marketLevels('BUY', await panel.quote(), spec, spec.stopsLevel + 100),
      };

      const placing = panel.placeMarketOrder(order);

      await expect(placing).rejects.toBeInstanceOf(OrderRejectedError);
      await expect(placing).rejects.toMatchObject({ code: '10016', httpStatus: 400 });
      await expect(notifications.toast).toHaveText('Invalid Stop loss or Take profit');
      expect(orderRequests).toHaveLength(1);
    });
  });

  test.describe('price refused by the server', () => {
    test.use({
      orderReply: { kind: 'error', status: 400, code: '10015', message: 'Invalid price' },
    });

    test('TC-PND-09 placePendingOrder rejects with the server code and the app shows its message', async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const { orderPanel: panel, notifications } = tradePage;
      await panel.openTradeForm();
      const order: PendingOrderInput = {
        type: 'Limit',
        side: 'SELL',
        volume: VOLUME,
        ...pendingPrices('Limit', 'SELL', await panel.quote(), spec, spec.stopsLevel + 100),
      };

      const placing = panel.placePendingOrder(order);

      await expect(placing).rejects.toMatchObject({ code: '10015', httpStatus: 400 });
      await expect(notifications.toast).toHaveText('Invalid Price submitted.');
      expect(orderRequests).toHaveLength(1);
    });
  });

  test.describe('no answer at all', () => {
    test.use({ orderReply: { kind: 'network-failure' } });

    test('TC-ERR-05 placeMarketOrder rejects when the order request fails', async ({
      tradePage,
      orderRequests,
    }) => {
      const { orderPanel: panel, notifications } = tradePage;

      await expect(panel.placeMarketOrder({ side: 'SELL', volume: VOLUME })).rejects.toMatchObject({
        code: 'NO_RESPONSE',
        httpStatus: 0,
      });
      await expect(notifications.toast).toHaveText('Network error. Please try again later.');
      expect(orderRequests).toHaveLength(1);
    });
  });
});
