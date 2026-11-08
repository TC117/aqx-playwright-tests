import type { Request } from '@playwright/test';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test as base, expect } from '../../src/fixtures/test';
import { skipUnlessMarketClosed } from '../../src/helpers/market';

/**
 * One-Click Trading as a setting (R2): the terms dialog, switching it on and off, what the order
 * panel shows, and that the server keeps it. None of these tests places an order.
 *
 * The setting is shared by every test on the demo account, so each test here starts and ends with
 * it off, and keeps it on for a few seconds at most.
 */
const test = base.extend<{ oneClickOff: void }>({
  oneClickOff: [
    async ({ tradePage, api }, use, testInfo) => {
      if (await api.isOneClickTradingEnabled()) {
        testInfo.annotations.push({
          type: 'warning',
          description: 'One-Click Trading was left on by an earlier run; switched it off first',
        });
        await tradePage.oneClick.disable();
      }
      await use();
      // Runs after failures too. A fresh page avoids whatever state a failed test left behind.
      if (await api.isOneClickTradingEnabled()) {
        await tradePage.open();
        await tradePage.oneClick.disable();
      }
      expect(await api.isOneClickTradingEnabled(), 'One-Click Trading must be off again').toBe(
        false,
      );
    },
    { auto: true },
  ],
});

const CONSEQUENCES = [
  'Click either the Buy or Sell buttons on the One-Click trading panel.',
  'Click either the Place Buy Order or Place Sell Order buttons on the Trade Form trading panel.',
  "Click on a cell in the Price Ladder's Buy or Sell columns.",
  "Close/delete orders in the positions' module and price ladder.",
];

const isPreferenceWrite = (r: Request): boolean =>
  r.method() !== 'GET' && new URL(r.url()).pathname === '/api/user/setting/v1/preference';

test.describe('One-Click Trading setting', { tag: ['@R2'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test('TC-OCT-01 The terms dialog explains what One-Click Trading does before it is switched on', async ({
    tradePage,
  }) => {
    const { oneClick } = tradePage;
    const dialog = oneClick.termsDialog;

    await oneClick.requestEnable();

    await expect(dialog).toContainText('One-Click Trading');
    await expect(dialog).toContainText('Terms and Conditions');
    await expect(dialog).toContainText(
      'One-Click Trading enables trade execution with a single click, without any additional confirmations. Your order will be immediately submitted when you:',
    );
    for (const consequence of CONSEQUENCES) {
      await expect(dialog.getByText(consequence, { exact: true })).toBeVisible();
    }
    await expect(dialog).toContainText(
      'Please note that Market and Stop Orders default to Immediate or Cancel and apply exclusively to Options and Futures.',
    );
    await expect(dialog).toContainText(
      'By clicking on "Agree and continue" below, I consent to the Terms and Conditions for activating One-Click Trading.',
    );
    await expect(dialog.getByRole('link', { name: 'Terms and Conditions' })).toHaveAttribute(
      'href',
      /\/assets\/tnc\/.+\.pdf$/,
    );
    await expect(oneClick.cancelButton).toHaveText(/^cancel$/i);
    await expect(oneClick.agreeButton).toHaveText(/^agree and continue$/i);
    await expect(dialog.getByRole('button')).toHaveCount(2);
  });

  test('TC-OCT-10 Cancelling the terms dialog keeps One-Click Trading off', async ({
    tradePage,
    api,
    page,
  }) => {
    const { oneClick, orderPanel } = tradePage;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (isPreferenceWrite(r)) writes.push(r.postData() ?? '');
    });

    await oneClick.requestEnable();
    await oneClick.cancelButton.click();

    await expect(oneClick.termsDialog).toBeHidden();
    await expect(oneClick.panelTab).toBeHidden();
    await expect(orderPanel.placeButton).toBeVisible();
    await oneClick.expectSwitch('off');
    expect(await api.isOneClickTradingEnabled(), 'setting stored on the server').toBe(false);
    expect(writes, 'no preference should be saved').toEqual([]);
  });

  test('TC-OCT-01 Agreeing to the terms switches One-Click Trading on and opens the One Click panel', async ({
    tradePage,
    api,
  }) => {
    const { oneClick } = tradePage;

    await test.step('agree to the terms', async () => {
      await oneClick.requestEnable();
      await oneClick.agreeButton.click();
      await expect(tradePage.notifications.toast).toHaveText('One-Click Trading activated.');
      await expect(oneClick.termsDialog).toBeHidden();
    });

    await test.step('the One Click tab is added and selected instead of Trade', async () => {
      await expect(oneClick.panelTab).toHaveText('One Click');
      await expect(oneClick.panelTab).toHaveClass(/\bselected\b/);
      await expect(tradePage.orderPanel.tradeTab).not.toHaveClass(/\bselected\b/);
      await expect(oneClick.volume).toBeEditable();
    });

    await test.step('the switch and the server both say on', async () => {
      await oneClick.expectSwitch('on');
      await expect.poll(() => api.isOneClickTradingEnabled()).toBe(true);
    });
  });

  test('TC-OCT-11 While the market is closed the One Click panel offers no Buy or Sell', async ({
    tradePage,
    api,
    symbol,
  }) => {
    await skipUnlessMarketClosed(api, symbol);
    const { oneClick } = tradePage;

    await oneClick.enable();
    await oneClick.openPanel();

    await expect(oneClick.marketClosedButton).toHaveText(/^market closed$/i);
    await expect(oneClick.marketClosedButton).toBeDisabled();
    await expect(oneClick.buyButton).toHaveCount(0);
    await expect(oneClick.sellButton).toHaveCount(0);
  });

  test('TC-OCT-05 Switching One-Click Trading off removes the One Click panel and brings back the Trade form', async ({
    tradePage,
    api,
  }) => {
    const { oneClick, orderPanel } = tradePage;
    await oneClick.enable();

    await oneClick.disable();

    await expect(oneClick.panelTab).toBeHidden();
    await expect(orderPanel.tradeTab).toHaveClass(/\bselected\b/);
    await expect(orderPanel.buySide).toBeVisible();
    await expect(orderPanel.sellSide).toBeVisible();
    await expect(orderPanel.placeButton).toBeVisible();
    await oneClick.expectSwitch('off');
    expect(await api.isOneClickTradingEnabled(), 'setting stored on the server').toBe(false);
  });

  test('TC-OCT-06 One-Click Trading stays on after the page is reloaded', async ({
    tradePage,
    api,
    page,
  }) => {
    const { oneClick } = tradePage;
    await oneClick.enable();

    await page.reload();
    await tradePage.waitUntilLoaded();

    await expect(oneClick.panelTab).toHaveClass(/\bselected\b/);
    await oneClick.expectSwitch('on');
    expect(await api.isOneClickTradingEnabled(), 'setting stored on the server').toBe(true);
  });
});
