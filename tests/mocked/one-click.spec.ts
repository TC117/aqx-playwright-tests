import type { Locator, Request } from '@playwright/test';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect } from '../../src/fixtures/test';
import { mockedTest, ORDER_TYPE } from '../../src/helpers/mockMarket';
import { MARKET_ORDER_API, type OneClickTrading } from '../../src/pages/components/OneClickTrading';

/**
 * One-Click Trading against a mocked open market (R2). The server still serves everything else;
 * only the market status and the One-Click setting it reports are replaced, and order requests are
 * answered in the browser. No order reaches the server and the real setting is never changed.
 */
const test = mockedTest;

const VOLUME = 0.02;
const SUCCESS = 'Position has been created.';

const isMarketOrder = (r: Request): boolean =>
  r.method() === 'POST' && new URL(r.url()).pathname === MARKET_ORDER_API;

/**
 * Types into the Trade form. The form resets itself when the selected symbol's details arrive,
 * which can be just after the symbol switch, so retype until every value holds.
 */
async function fillTradeForm(fields: [Locator, string][]): Promise<void> {
  await expect(async () => {
    for (const [input, value] of fields) await input.fill(value);
    for (const [input, value] of fields) await expect(input).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe('One-Click Trading with a mocked open market', { tag: ['@R2', '@mocked'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  for (const { id, side, click } of [
    { id: 'TC-OCT-02', side: 'BUY', click: (o: OneClickTrading) => o.buy(VOLUME) },
    { id: 'TC-OCT-03', side: 'SELL', click: (o: OneClickTrading) => o.sell(VOLUME) },
  ] as const) {
    test(`${id} One-Click ${side} sends one market ${side} order for the panel volume, without a confirmation`, async ({
      tradePage,
      orderRequests,
      symbol,
      page,
    }) => {
      const { oneClick, notifications } = tradePage;

      await test.step('the One Click panel is tradable', async () => {
        await oneClick.openPanel();
        await expect(oneClick.buyButton).toContainText(/^BUY\s*\d+\.\d+$/);
        await expect(oneClick.sellButton).toContainText(/^SELL\s*\d+\.\d+$/);
      });

      await test.step(`click ${side} once`, async () => {
        await click(oneClick);
        await expect(notifications.toast).toHaveText(SUCCESS);
        await expect(page.getByTestId('trade-confirmation-button-confirm')).toBeHidden();
      });

      await test.step('exactly one order went out, with the right content', async () => {
        // Wait for the toast to go: time enough for a duplicate request to show up.
        await expect(notifications.toast).toBeHidden();
        expect(orderRequests).toEqual([
          {
            method: 'POST',
            path: MARKET_ORDER_API,
            body: {
              orderType: ORDER_TYPE[side],
              symbol,
              lotSize: VOLUME,
              // 0 = Fill or Kill, the only fill policy the symbol offers for market orders.
              fillPolicy: 0,
              indicate: 'PRICE',
            },
          },
        ]);
      });
    });
  }

  test('TC-OCT-04 With One-Click Trading on, the Trade form also sends the order without a confirmation', async ({
    tradePage,
    orderRequests,
    api,
    symbol,
    page,
  }) => {
    const { orderPanel, notifications } = tradePage;
    const spec = await api.symbolDetail(symbol);
    const { bid } = await api.symbol(symbol);
    // Far beyond the stops level, so the prices stay valid however the market moves.
    const distance = (spec.stopsLevel + 500) * spec.pointStep;
    const stopLoss = Number((bid - distance).toFixed(spec.digits));
    const takeProfit = Number((bid + distance).toFixed(spec.digits));

    await orderPanel.tradeTab.click();
    await orderPanel.buySide.click();
    await fillTradeForm([
      [orderPanel.volume, String(VOLUME)],
      [orderPanel.stopLossPrice, String(stopLoss)],
      [orderPanel.takeProfitPrice, String(takeProfit)],
    ]);
    await expect(orderPanel.placeButton).toHaveText(/place buy order/i);
    await orderPanel.placeButton.click();

    await expect(notifications.toast).toHaveText(SUCCESS);
    await expect(page.getByTestId('trade-confirmation-button-confirm')).toBeHidden();
    await expect(notifications.toast).toBeHidden();
    expect(orderRequests.map((r) => r.body)).toEqual([
      {
        orderType: ORDER_TYPE.BUY,
        symbol,
        lotSize: VOLUME,
        fillPolicy: 0,
        indicate: 'PRICE',
        stopLoss,
        takeProfit,
      },
    ]);
  });

  test.describe('with One-Click Trading off', () => {
    test.use({ oneClickSetting: false });

    test('TC-OCT-05 Without One-Click Trading the Trade form asks for confirmation before sending', async ({
      tradePage,
      orderRequests,
      symbol,
      page,
    }) => {
      const { orderPanel, oneClick } = tradePage;
      const confirmation = page.getByRole('dialog').filter({
        has: page.getByTestId('trade-confirmation-button-confirm'),
      });

      await expect(oneClick.panelTab).toBeHidden();
      await orderPanel.buySide.click();
      await fillTradeForm([[orderPanel.volume, String(VOLUME)]]);
      await orderPanel.placeButton.click();

      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByTestId('trade-confirmation-symbol')).toHaveText(symbol);
      await expect(confirmation.getByTestId('trade-confirmation-order-type')).toHaveText('BUY');
      await expect(confirmation.getByTestId('trade-confirmation-value').first()).toHaveText(
        String(VOLUME),
      );
      expect(orderRequests, 'nothing is sent before confirming').toEqual([]);

      await confirmation.getByTestId('trade-confirmation-button-close').click();
      await expect(confirmation).toBeHidden();
      expect(orderRequests, 'nothing is sent after cancelling').toEqual([]);
    });
  });

  test.describe('while the first order is still in flight', () => {
    test.use({ orderReply: { kind: 'no-response' } });

    test('TC-OCT-08 A double-click on One-Click Buy sends only one order', async ({
      tradePage,
      orderRequests,
      page,
    }) => {
      test.fail(
        true,
        'Known issue: the One-Click BUY button has no busy state; a second click while the first order is unanswered sends a second order',
      );
      const { oneClick } = tradePage;
      await oneClick.setVolume(VOLUME);
      let sent = 0;
      // A duplicate would follow the second click at once; five seconds is ample.
      const duplicate = page
        .waitForRequest((r) => isMarketOrder(r) && ++sent === 2, { timeout: 5_000 })
        .then(
          () => true,
          () => false,
        );

      await oneClick.buyButton.dblclick();

      expect(await duplicate, 'a second order request was sent').toBe(false);
      expect(orderRequests).toHaveLength(1);
    });
  });
});
