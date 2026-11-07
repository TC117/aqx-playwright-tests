import { test, expect } from '../../src/fixtures/test';
import { env, hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';

test.describe('Logged-in trade screen', { tag: '@smoke' }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test('opens on a demo account with the configured symbol selected', async ({
    tradePage,
    api,
  }) => {
    const account = await api.account();

    expect(account.isDemo).toBe(true);
    await expect(tradePage.account.typeTag).toHaveText(/demo/i);
    await expect(tradePage.selectedSymbol).toHaveText(env.defaultSymbol);
  });

  test('order button state matches the market status reported by the server', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const open = await api.isMarketOpen(symbol);
    const button = tradePage.orderPanel.placeButton;

    await expect(button).toBeEnabled({ enabled: open });
    await expect.poll(async () => /market closed/i.test(await button.innerText())).toBe(!open);
  });
});
