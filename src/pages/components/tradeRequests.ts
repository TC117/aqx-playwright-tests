import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';

/** Path prefix of every trade write (place, modify, close, delete, bulk). */
export const TRADE_WRITES = '/api/trade/trade/';

/**
 * Trade write endpoints, read from the web trader's bundle and confirmed as the requests the UI
 * sends (with fabricated rows, or a mocked open market, and the requests answered in the browser).
 * The same path can serve two actions, told apart by the HTTP method:
 * - place a market order: POST `marketOrder` `{orderType, symbol, lotSize, fillPolicy, indicate,
 *   stopLoss?, takeProfit?}`
 * - place a pending order: POST `pendingOrder` `{orderType, symbol, lotSize, price, priceTrigger,
 *   fillPolicy, indicate, stopLoss?, takeProfit?, tradeExpiry, expiration?}`
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
  marketOrder: '/api/trade/trade/v1/market',
  pendingOrder: '/api/trade/trade/v1/limit',
  closeOrDelete: '/api/trade/trade/v1',
  modifyPosition: '/api/trade/trade/v1/market',
  modifyPending: '/api/trade/trade/v1/limit',
  bulkClose: '/api/trade/trade/v1/bulk',
  bulkDelete: '/api/trade/trade/v1/limit/bulk',
} as const;

/** MT5 codes the server answers for refused orders (from the web trader's bundle). */
export const MT5_CODE = {
  /** "Invalid price": an order price on the wrong side of, or too close to, the market. */
  INVALID_PRICE: '10015',
  /** "Invalid Stop loss or Take profit": SL/TP too close to the market. */
  INVALID_STOPS: '10016',
} as const;

/** How long the UI may take to send a trade request, and then the server to answer it. */
const REQUEST_TIMEOUT = 30_000;

/**
 * The server turned an order down. `code` is the platform's code (e.g. MT5 `10016`), else the HTTP
 * status, or `NO_RESPONSE` when the request failed or got no answer in time.
 */
export class OrderRejectedError extends Error {
  constructor(
    readonly code: string,
    readonly serverMessage: string,
    readonly httpStatus: number,
  ) {
    super(`Order rejected (HTTP ${httpStatus}, code ${code}): ${serverMessage}`);
    this.name = 'OrderRejectedError';
  }
}

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
  /** The request to wait for. An Order No. in its body may be a number, so compare it as text. */
  matches: (request: Request) => boolean;
  /** Inline validation messages, quoted when nothing was sent. */
  errors?: Locator;
}

/**
 * Clicks `trigger`, completes the confirmation dialog when one is shown, and resolves with the
 * server's answer once it accepted the request (see {@link expectAccepted}). Throws
 * {@link OrderRejectedError} when the server refused, or when the request failed or got no answer
 * (`NO_RESPONSE`), and a plain error quoting the validation messages when the UI sent nothing.
 */
export async function submitTradeRequest(page: Page, s: TradeSubmission): Promise<Response> {
  const sent = page.waitForRequest(s.matches, { timeout: REQUEST_TIMEOUT });
  let settled = false;
  // Settles `settled` either way; a late rejection is then handled and never surfaces.
  sent.then(
    () => (settled = true),
    () => (settled = true),
  );
  const nothingSent = async (): Promise<Error> => {
    const shown = s.errors ? await s.errors.allInnerTexts() : [];
    return new Error(
      `${s.action}: the UI sent nothing${shown.length ? `; it shows: ${shown.join(' / ')}` : ''}`,
    );
  };

  await s.trigger.click();
  const confirm = s.confirm;
  try {
    await expect
      .poll(async () => settled || (confirm !== undefined && (await confirm.isVisible())))
      .toBe(true);
  } catch {
    throw await nothingSent();
  }
  if (!settled && confirm) await (s.completeDialog ? s.completeDialog() : confirm.click());

  const request = await sent.catch(() => null);
  if (!request) throw await nothingSent();
  const response = await answerTo(request);
  if (!response) {
    throw new OrderRejectedError(
      'NO_RESPONSE',
      [
        `${s.action} failed`,
        request.failure()?.errorText ?? `no answer within ${REQUEST_TIMEOUT / 1000} s`,
        await shownToast(page),
      ]
        .filter(Boolean)
        .join(' | '),
      0,
    );
  }
  await expectAccepted(page, response, s.action);
  return response;
}

/**
 * Fails with the server's code and message, and the toast the UI showed, unless the server
 * accepted: HTTP 2xx and body code "200". The web trader itself trusts the HTTP status alone; the
 * body code is checked too so that a refusal wrapped in an HTTP 200 is not taken for a success.
 */
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
  throw new OrderRejectedError(
    code,
    [`${action} failed`, body?.message, await shownToast(page)].filter(Boolean).join(' | '),
    response.status(),
  );
}

/** The answer to `request`; `null` when it failed or none came within the time-out. */
async function answerTo(request: Request): Promise<Response | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT);
  });
  try {
    // `response()` resolves with null when the request failed, and never for an unanswered one.
    return await Promise.race([request.response(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The toasts on screen, for error messages; empty when there is none. */
async function shownToast(page: Page): Promise<string> {
  const shown = await page.getByTestId('notification-box-description').allInnerTexts();
  return shown.length ? `UI: ${shown.join(' / ')}` : '';
}
