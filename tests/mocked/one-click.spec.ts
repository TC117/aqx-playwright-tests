import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect } from '../../src/fixtures/test';
import { mockedTest, ORDER_TYPE } from '../../src/helpers/mockMarket';
import { marketLevels } from '../../src/helpers/orderLevels';
import { isMarketOrder, type OneClickTrading } from '../../src/pages/components/OneClickTrading';
import { TRADE_API } from '../../src/pages/components/tradeRequests';

/**
 * One-Click Trading against a mocked open market (R2). The server still serves everything else;
 * only the market status and the One-Click setting it reports are replaced, and order requests are
 * answered in the browser. No order reaches the server and the real setting is never changed:
 * switching the setting here is answered in the browser too.
 */
const test = mockedTest;

const VOLUME = 0.02;
const SUCCESS = 'Position has been created.';
/** 0 = Fill or Kill, the only fill policy the symbol offers for market orders. */
const FILL_OR_KILL = 0;

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
            path: TRADE_API.marketOrder,
            body: {
              orderType: ORDER_TYPE[side],
              symbol,
              lotSize: VOLUME,
              fillPolicy: FILL_OR_KILL,
              indicate: 'PRICE',
            },
          },
        ]);
      });
    });
  }

  for (const side of ['BUY', 'SELL'] as const) {
    test(`TC-OCT-04 With One-Click Trading on, a ${side} from the Trade form is sent at once with the preset volume, SL and TP`, async ({
      tradePage,
      orderRequests,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const { orderPanel: panel, notifications } = tradePage;
      await panel.openTradeForm();
      const levels = marketLevels(side, await panel.quote(), spec, spec.stopsLevel + 100);

      await panel.placeMarketOrder({ side, volume: VOLUME, ...levels });

      expect(panel.lastConfirmation, 'no confirmation dialog was shown').toBeNull();
      await expect(notifications.toast).toHaveText(SUCCESS);
      // Once the toast is gone there has been time for a duplicate request to show up.
      await expect(notifications.toast).toBeHidden();
      expect(orderRequests).toEqual([
        {
          method: 'POST',
          path: TRADE_API.marketOrder,
          body: {
            orderType: ORDER_TYPE[side],
            symbol,
            lotSize: VOLUME,
            fillPolicy: FILL_OR_KILL,
            indicate: 'PRICE',
            ...levels,
          },
        },
      ]);
    });
  }

  test('TC-OCT-05 After One-Click Trading is switched off, an order waits for the confirmation dialog', async ({
    tradePage,
    orderRequests,
    symbol,
    page,
  }) => {
    const { oneClick, orderPanel: panel, notifications } = tradePage;

    await test.step('switch One-Click Trading off', async () => {
      await expect(oneClick.panelTab).toBeVisible();
      await oneClick.disable();
      await expect(panel.tradeTab).toHaveClass(/\bselected\b/);
    });

    await test.step('Place Buy Order opens the confirmation and sends nothing yet', async () => {
      await panel.fillMarketOrder({ side: 'BUY', volume: VOLUME });
      await panel.placeButton.click();
      await expect(panel.confirmation.confirmButton).toBeVisible();
      await expect(panel.confirmation.symbol).toHaveText(symbol);
      await expect(panel.confirmation.orderType).toHaveText('BUY');
      expect(orderRequests, 'nothing is sent before confirming').toEqual([]);
    });

    await test.step('Confirm sends the order once', async () => {
      const sent = page.waitForRequest(isMarketOrder);
      await panel.confirmation.confirm();
      await sent;
      await expect(notifications.toast).toHaveText(SUCCESS);
      await expect(panel.confirmation.confirmButton).toBeHidden();
      await expect(notifications.toast).toBeHidden();
      expect(orderRequests.map((r) => r.body)).toEqual([
        {
          orderType: ORDER_TYPE.BUY,
          symbol,
          lotSize: VOLUME,
          fillPolicy: FILL_OR_KILL,
          indicate: 'PRICE',
        },
      ]);
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
