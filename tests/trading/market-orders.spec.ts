import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect, test } from '../../src/fixtures/test';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { parseUiNumber } from '../../src/helpers/numbers';
import type { OrderTracker } from '../../src/helpers/OrderTracker';
import { levelsAround, marketLevels, openPrice } from '../../src/helpers/orderLevels';
import type { MarketOrderInput, Quote, Side } from '../../src/models/trading';
import type { OrderPanel } from '../../src/pages/components/OrderPanel';
import type { ConfirmationDetails } from '../../src/pages/components/TradeConfirmation';

/*
 * R1: real market orders with Stop Loss and Take Profit on the demo account. Each test skips while
 * the symbol's market is closed and owns the positions it opens (closed again by the `orders`
 * fixture). SL/TP are computed from the live quote, at the symbol's stops level plus a buffer, so
 * price movement during the test cannot make them invalid.
 *
 * Written while every market was closed: the confirmation dialog, the order API response and the
 * MT5 rejection codes come from the web trader's bundle, not from a live run.
 */

/** MT5 code the server answers for SL/TP too close to the market ("Invalid Stop loss or Take profit"). */
const INVALID_STOPS = '10016';

/** Asserts the confirmation dialog showed this order; notes it when One-Click Trading skipped it. */
function expectConfirmation(
  shown: ConfirmationDetails | null,
  symbol: string,
  order: MarketOrderInput,
): void {
  if (!shown) {
    test.info().annotations.push({
      type: 'note',
      description: 'No confirmation dialog: One-Click Trading was on during this order',
    });
    return;
  }
  expect(shown.symbol).toContain(symbol);
  expect(shown.orderType).toMatch(new RegExp(`^${order.side}$`, 'i'));
  expect(parseUiNumber(shown.fields['Volume'])).toBe(order.volume);
  expect(parseUiNumber(shown.fields['Stop Loss'])).toBe(order.stopLoss ?? null);
  expect(parseUiNumber(shown.fields['Take Profit'])).toBe(order.takeProfit ?? null);
  expect(shown.fields['Fill Policy']).toBe('Fill or Kill');
}

/** Asserts a fill price lies within the open prices seen around the click, ± 2 spreads. */
function expectFilledWithin(entry: number, side: Side, quotes: Quote[]): void {
  const prices = quotes.map((q) => openPrice(side, q));
  const tolerance = 2 * Math.max(...quotes.map((q) => q.ask - q.bid));
  expect(entry, 'entry price').toBeGreaterThanOrEqual(Math.min(...prices) - tolerance);
  expect(entry, 'entry price').toBeLessThanOrEqual(Math.max(...prices) + tolerance);
}

/**
 * Places an order that the server is expected to refuse. If it is accepted after all, the new
 * position is taken over so clean-up closes it, and the promise still resolves (failing the test).
 */
async function placeExpectingRejection(
  panel: OrderPanel,
  orders: OrderTracker,
  order: MarketOrderInput,
): Promise<void> {
  const before = await orders.positionIds();
  await panel.placeMarketOrder(order);
  await orders.newPosition(before, order);
}

test.describe(
  'R1 Market orders with Stop Loss and Take Profit',
  { tag: ['@R1', '@market-open'] },
  () => {
    test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

    test.beforeEach(async ({ api, symbol }) => {
      await skipUnlessMarketOpen(api, symbol);
    });

    const withLevels: { id: string; side: Side }[] = [
      { id: 'TC-MKT-04', side: 'BUY' },
      { id: 'TC-MKT-05', side: 'SELL' },
    ];
    for (const { id, side } of withLevels) {
      test(`${id} ${side} market order with SL and TP opens a position with exactly those values`, async ({
        tradePage,
        api,
        orders,
        symbol,
      }) => {
        const spec = await api.symbolDetail(symbol);
        const panel = tradePage.orderPanel;
        const before = await orders.positionIds();
        await panel.openTradeForm();
        const quoteBefore = await panel.quote();
        const order: MarketOrderInput = {
          side,
          volume: spec.minContractLotSize,
          ...marketLevels(side, quoteBefore, spec, spec.stopsLevel + 50),
        };

        await test.step('place the order', async () => {
          await panel.placeMarketOrder(order);
        });

        const quoteAfter = await panel.quote();
        // Owned before any check, so a failed check cannot leave the position on the account.
        const orderId = await orders.newPosition(before, order);

        await test.step('the confirmation dialog showed the order', async () => {
          expectConfirmation(panel.lastConfirmation, symbol, order);
        });

        await test.step('the new position has the symbol, side, volume, SL, TP and fill price', async () => {
          const position = await tradePage.openPositions.read(orderId);
          expect(position).toMatchObject({
            symbol,
            side,
            volume: order.volume,
            stopLoss: order.stopLoss,
            takeProfit: order.takeProfit,
          });
          expectFilledWithin(position.entryPrice, side, [quoteBefore, quoteAfter]);
        });
      });
    }

    const oneLevel: { side: Side; level: 'stopLoss' | 'takeProfit' }[] = [
      { side: 'BUY', level: 'stopLoss' },
      { side: 'BUY', level: 'takeProfit' },
      { side: 'SELL', level: 'stopLoss' },
      { side: 'SELL', level: 'takeProfit' },
    ];
    for (const { side, level } of oneLevel) {
      test(`TC-MKT-06 ${side} with only ${level === 'stopLoss' ? 'a Stop Loss' : 'a Take Profit'} leaves the other level empty`, async ({
        tradePage,
        api,
        orders,
        symbol,
      }) => {
        const spec = await api.symbolDetail(symbol);
        const panel = tradePage.orderPanel;
        const before = await orders.positionIds();
        await panel.openTradeForm();
        const levels = marketLevels(side, await panel.quote(), spec, spec.stopsLevel + 50);
        const order: MarketOrderInput = {
          side,
          volume: spec.minContractLotSize,
          [level]: levels[level],
        };

        await panel.placeMarketOrder(order);

        const position = await tradePage.openPositions.read(
          await orders.newPosition(before, order),
        );
        expect(position.stopLoss).toBe(order.stopLoss ?? null);
        expect(position.takeProfit).toBe(order.takeProfit ?? null);
      });
    }

    test('TC-MKT-13 Confirmation dialog shows the order details and Cancel sends nothing', async ({
      tradePage,
      api,
      orders,
      symbol,
      page,
    }) => {
      test.skip(
        await tradePage.oneClick.isEnabled(),
        'One-Click Trading is on (another run switched it on), so there is no confirmation dialog',
      );
      const spec = await api.symbolDetail(symbol);
      const panel = tradePage.orderPanel;
      const before = await orders.positionIds();
      const sent: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().includes('/api/trade/trade/v1/')) sent.push(r.url());
      });
      await panel.openTradeForm();
      const order: MarketOrderInput = {
        side: 'BUY',
        volume: spec.minContractLotSize,
        ...marketLevels('BUY', await panel.quote(), spec, spec.stopsLevel + 50),
      };
      await panel.fillMarketOrder(order);
      const estimate = await panel.tradeDetails();

      await panel.placeButton.click();
      const shown = await panel.confirmation.read();
      expectConfirmation(shown, symbol, order);
      expect(parseUiNumber(shown.fields['Units'])).toBe(order.volume * spec.contractSize);
      expect(shown.fields['Est. Margin Required']).toMatch(/^[\d,.]+ [A-Z]{3}$/);
      expect(
        Math.abs(
          Number(parseUiNumber(shown.fields['Est. Margin Required'])) -
            Number(estimate.marginRequired),
        ),
        'dialog margin agrees with Trade Details',
      ).toBeLessThanOrEqual(0.02);

      await panel.confirmation.cancel();

      expect(sent, 'no order request after Cancel').toEqual([]);
      expect(await orders.positionIds()).toEqual(before);
    });

    test('TC-MKT-10 Server refuses a Stop Loss inside the stops level and accepts one just outside', async ({
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

      await test.step('5 points inside the stops level: refused by the server', async () => {
        // The panel does not check the stops level itself (seen 2026-11-08), so this reaches the server.
        const { stopLoss } = levelsAround(
          'BUY',
          (await panel.quote()).bid,
          spec,
          spec.stopsLevel - 5,
        );
        const before = await orders.positionIds();
        await expect(
          placeExpectingRejection(panel, orders, {
            side: 'BUY',
            volume: spec.minContractLotSize,
            stopLoss,
          }),
        ).rejects.toMatchObject({ code: INVALID_STOPS });
        expect(await orders.positionIds()).toEqual(before);
      });

      await test.step('5 points outside the stops level: accepted with that Stop Loss', async () => {
        const { stopLoss } = levelsAround(
          'BUY',
          (await panel.quote()).bid,
          spec,
          spec.stopsLevel + 5,
        );
        const before = await orders.positionIds();
        const order: MarketOrderInput = { side: 'BUY', volume: spec.minContractLotSize, stopLoss };
        await panel.placeMarketOrder(order);
        const position = await tradePage.openPositions.read(
          await orders.newPosition(before, order),
        );
        expect(position.stopLoss).toBe(stopLoss);
      });
    });
  },
);
