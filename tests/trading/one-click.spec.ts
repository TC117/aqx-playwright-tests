import type { Page } from '@playwright/test';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test as base, expect } from '../../src/fixtures/test';
import { skipUnlessMarketOpen } from '../../src/helpers/market';
import { roundLots, roundTo } from '../../src/helpers/numbers';
import type { Quote, Side } from '../../src/models/trading';
import type { OneClickTrading } from '../../src/pages/components/OneClickTrading';

/**
 * R2 on the real demo server: market orders placed with One-Click Trading on execute at once,
 * without the confirmation dialog. Needs an open market; skips with the reason otherwise.
 */
const test = base.extend<{ oneClickOn: OneClickTrading }>({
  // Depends on `orders` so it is torn down first: the test's positions are then closed with
  // One-Click Trading off, through the normal Close dialog.
  oneClickOn: async ({ tradePage, api, symbol, orders: _orders }, use) => {
    // Before switching anything on: the setting is shared by every test on the account.
    await skipUnlessMarketOpen(api, symbol);
    try {
      await tradePage.oneClick.enable();
      await use(tradePage.oneClick);
    } finally {
      // Also when enable() failed after the server had saved the setting. The server's value
      // decides, and a fresh page avoids whatever state a failed test left behind.
      if (await api.isOneClickTradingEnabled()) {
        await tradePage.open();
        await tradePage.oneClick.disable();
      }
      expect(await api.isOneClickTradingEnabled(), 'One-Click Trading must be off again').toBe(
        false,
      );
    }
  },
});

const SUCCESS = 'Position has been created.';

/**
 * Records whether the order confirmation dialog appears at any moment from now on, so the check
 * also holds for helpers that would confirm the dialog themselves.
 */
async function watchForConfirmation(page: Page): Promise<() => Promise<boolean>> {
  type Flagged = Window & { confirmationSeen?: boolean };
  await page.evaluate(() => {
    const w = window as Flagged;
    w.confirmationSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="trade-confirmation-button-confirm"]')) {
        w.confirmationSeen = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as Flagged).confirmationSeen === true);
}

/** Fill price check from the test design: inside the quotes seen around the click ± 2 spreads. */
function expectFilledBetween(entry: number, before: number, after: number, spread: number): void {
  const tolerance = 2 * spread;
  expect(entry, 'entry price, low side').toBeGreaterThanOrEqual(
    Math.min(before, after) - tolerance,
  );
  expect(entry, 'entry price, high side').toBeLessThanOrEqual(Math.max(before, after) + tolerance);
}

const ONE_CLICK_CASES: {
  id: string;
  side: Side;
  place: (oneClick: OneClickTrading, volume: number) => Promise<void>;
  /** A Buy opens at the Ask, a Sell at the Bid. */
  fillPrice: (quote: Quote) => number;
}[] = [
  { id: 'TC-OCT-02', side: 'BUY', place: (o, v) => o.buy(v), fillPrice: (q) => q.ask },
  { id: 'TC-OCT-03', side: 'SELL', place: (o, v) => o.sell(v), fillPrice: (q) => q.bid },
];

/** Valid SL / TP for a market order: beyond the stops level on the correct side of the price. */
const PRESETS: {
  side: Side;
  levels: (quote: Quote, distance: number) => { stopLoss: number; takeProfit: number };
}[] = [
  // A Buy is valued at the Bid: SL below it, TP above it.
  { side: 'BUY', levels: (q, d) => ({ stopLoss: q.bid - d, takeProfit: q.bid + d }) },
  // A Sell is valued at the Ask: SL above it, TP below it.
  { side: 'SELL', levels: (q, d) => ({ stopLoss: q.ask + d, takeProfit: q.ask - d }) },
];

test.describe('One-Click Trading on the real server', { tag: ['@R2', '@market-open'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  for (const { id, side, place, fillPrice } of ONE_CLICK_CASES) {
    test(`${id} One-Click ${side} opens one ${side} position at once, without a confirmation`, async ({
      oneClickOn,
      orders,
      tradePage,
      api,
      symbol,
      page,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const volume = spec.minContractLotSize;
      const before = await orders.positionIds();
      await oneClickOn.openPanel();
      const quoteBefore = await oneClickOn.quote();

      await test.step(`click ${side} once`, async () => {
        await place(oneClickOn, volume);
        // Soft, so a failed check still lets the test take ownership of the position below. The
        // newest toast: "One-Click Trading activated." from the fixture can still be on screen.
        await expect.soft(tradePage.notifications.toast.last()).toHaveText(SUCCESS);
        await expect.soft(page.getByTestId('trade-confirmation-button-confirm')).toBeHidden();
      });

      const quoteAfter = await oneClickOn.quote();

      await test.step('exactly one new position, with the side, volume and price clicked', async () => {
        const orderId = await orders.newPosition(before, { side, volume });
        const row = await tradePage.openPositions.read(orderId);
        expect(row).toMatchObject({ orderId, symbol, side, volume });
        expectFilledBetween(
          row.entryPrice,
          fillPrice(quoteBefore),
          fillPrice(quoteAfter),
          quoteBefore.ask - quoteBefore.bid,
        );
      });
    });
  }

  for (const { side, levels } of PRESETS) {
    test(`TC-OCT-04 With One-Click Trading on, a ${side} from the Trade form opens at once with its volume, SL and TP`, async ({
      oneClickOn,
      orders,
      tradePage,
      api,
      symbol,
      page,
    }) => {
      const { orderPanel } = tradePage;
      const spec = await api.symbolDetail(symbol);
      const volume = roundLots(spec.minContractLotSize * 2, spec.lotSizeStep);
      // One-Click Trading selects its own tab; the Trade form is still one click away.
      await oneClickOn.expectSwitch('on');
      await orderPanel.tradeTab.click();
      const quote = await orderPanel.quote();
      const distance = (spec.stopsLevel + 50) * spec.pointStep;
      const { stopLoss, takeProfit } = levels(quote, distance);
      const order = {
        side,
        volume,
        stopLoss: roundTo(stopLoss, spec.digits),
        takeProfit: roundTo(takeProfit, spec.digits),
      };
      const before = await orders.positionIds();
      const confirmationSeen = await watchForConfirmation(page);

      await orderPanel.placeMarketOrder(order);

      const orderId = await orders.newPosition(before, order);
      expect(await confirmationSeen(), 'the confirmation dialog should not appear').toBe(false);
      expect(await tradePage.openPositions.read(orderId)).toMatchObject({
        orderId,
        symbol,
        side,
        volume,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
      });
    });
  }
});
