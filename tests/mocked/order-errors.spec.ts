import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect } from '../../src/fixtures/test';
import { mockedTest as test, type OrderReply } from '../../src/helpers/mockMarket';

/**
 * A One-Click order that fails (R2 with TC-OCT-12 / TC-ERR-05): the order request is answered in
 * the browser with an error and never reaches the server. The UI must say why, create nothing,
 * keep One-Click Trading on and not send the order again by itself.
 */
const VOLUME = 0.01;

const failures: { id: string; what: string; reply: OrderReply; message: string }[] = [
  {
    id: 'TC-OCT-12',
    what: 'a server error (HTTP 500)',
    reply: { kind: 'error', status: 500, code: '500', message: 'Internal Server Error' },
    message: 'Something went wrong. Please contact customer support.',
  },
  {
    // The app maps known trading error codes to its own text.
    id: 'TC-OCT-12',
    what: 'a rejection for insufficient balance (HTTP 400, MT4_1004)',
    reply: { kind: 'error', status: 400, code: 'MT4_1004', message: 'Not enough money' },
    message: 'Insufficient balance',
  },
  {
    id: 'TC-ERR-05',
    what: 'a network failure',
    reply: { kind: 'network-failure' },
    message: 'Network error. Please try again later.',
  },
];

test.describe('Failed One-Click orders', { tag: ['@R2', '@mocked'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  for (const { id, what, reply, message } of failures) {
    test.describe(what, () => {
      test.use({ orderReply: reply });

      test(`${id} One-Click Buy answered with ${what} shows "${message}" and creates nothing`, async ({
        tradePage,
        orderRequests,
      }) => {
        const { oneClick, openPositions, notifications } = tradePage;
        const positionsBefore = (await openPositions.tab.innerText()).trim();

        await oneClick.buy(VOLUME);

        await expect(notifications.toast).toHaveText(message);
        // Once the message is gone there has been time for an automatic resend to show up.
        await expect(notifications.toast).toBeHidden();
        expect(orderRequests, 'the order is sent once and not resent').toHaveLength(1);
        await expect(openPositions.tab).toHaveText(positionsBefore);

        await test.step('One-Click Trading stays on and ready, with the volume kept', async () => {
          await expect(oneClick.panelTab).toHaveClass(/\bselected\b/);
          await expect(oneClick.buyButton).toBeEnabled();
          await expect(oneClick.sellButton).toBeEnabled();
          expect(Number(await oneClick.volume.inputValue())).toBe(VOLUME);
        });
      });
    });
  }
});
