import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { OrderRejectedError } from './OrderPanel';

/**
 * Write endpoints the assets module calls, read from the web trader's bundle and confirmed as the
 * requests the UI sends (with fabricated rows and the requests blocked):
 * - close a position, fully or partly: PUT `closeOrDelete` `{orderId, symbol, lotSize, orderType,
 *   fillPolicy}`
 * - delete a pending order: DELETE `closeOrDelete?symbol=…&orderId=…`
 * - modify a position: PATCH `modifyPosition` `{orderId, symbol, indicate, stopLoss, takeProfit,
 *   units, fillPolicy}`
 * - modify a pending order: PATCH `modifyPending` `{symbol, orderId, orderType, fillPolicy,
 *   lotSize, price, stopLoss, takeProfit, tradeExpiry, indicate}`
 * - bulk close: PUT `bulkClose` `{orderList: [{orderId, symbol, lotSize, fillPolicy}]}`; the UI
 *   picks the positions itself (all, or by the sign of the P/L it shows)
 * - bulk delete: PUT `bulkDelete` `[{orderId, symbol}]`
 */
export const TRADE_API = {
  closeOrDelete: '/api/trade/trade/v1',
  modifyPosition: '/api/trade/trade/v1/market',
  modifyPending: '/api/trade/trade/v1/limit',
  bulkClose: '/api/trade/trade/v1/bulk',
  bulkDelete: '/api/trade/trade/v1/limit/bulk',
} as const;

export interface TradeSubmission {
  /** What is being done, for error messages, e.g. "Closing position 123". */
  action: string;
  /** Button that sends the request, or opens the confirmation dialog first. */
  trigger: Locator;
  /**
   * Confirm button (or dialog) the UI may show before sending; One-Click Trading skips it. While
   * it is visible the request has not been sent yet.
   */
  confirm?: Locator;
  /** Completes that dialog; clicks `confirm` by default. */
  completeDialog?: () => Promise<void>;
  matches: (request: Request) => boolean;
  /** Inline validation messages, quoted when nothing was sent. */
  errors?: Locator;
}

/**
 * Clicks `trigger`, confirms when a confirmation dialog is shown, and resolves with the server's
 * answer once it accepted the request. Throws {@link OrderRejectedError} when the server refused,
 * and a plain error quoting the validation messages when the UI sent nothing.
 */
export async function submitTradeRequest(page: Page, s: TradeSubmission): Promise<Response> {
  const sent = page.waitForResponse((r) => s.matches(r.request()), { timeout: 30_000 });
  let answered = false;
  // Settles `answered` either way; a late rejection is then handled and never surfaces.
  sent.then(
    () => (answered = true),
    () => (answered = true),
  );
  await s.trigger.click();
  const confirm = s.confirm;
  try {
    await expect
      .poll(async () => answered || (confirm !== undefined && (await confirm.isVisible())))
      .toBe(true);
  } catch {
    const shown = s.errors ? await s.errors.allInnerTexts() : [];
    throw new Error(
      `${s.action}: the UI sent nothing${shown.length ? `; it shows: ${shown.join(' / ')}` : ''}`,
    );
  }
  if (!answered && confirm) await (s.completeDialog ? s.completeDialog() : confirm.click());
  const response = await sent;
  await expectAccepted(page, response, s.action);
  return response;
}

/** Fails with the server's code and message, and the toast the UI showed, unless accepted. */
export async function expectAccepted(
  page: Page,
  response: Response,
  action: string,
): Promise<void> {
  const body = (await response.json().catch(() => null)) as {
    code?: string | number;
    message?: string;
  } | null;
  const code = String(body?.code ?? response.status());
  if (response.ok() && code === '200') return;
  const toast = (await page.getByTestId('notification-box-description').allInnerTexts()).join(
    ' / ',
  );
  throw new OrderRejectedError(
    code,
    [`${action} failed`, body?.message, toast && `UI: ${toast}`].filter(Boolean).join(' | '),
    response.status(),
  );
}
