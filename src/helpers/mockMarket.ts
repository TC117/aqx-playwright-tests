import type { Page, Route } from '@playwright/test';
import { test as base } from '../fixtures/test';

/**
 * Mocks for the `mocked` project: make a closed market look open, and answer order requests in
 * the browser so that they never reach the server.
 *
 * Learned from the live demo and the app's own code (2026-11-08):
 * - The order panel enables trading when the symbol's `status` is `TRADING` (and
 *   `tradableExeMode` is true). It reads the status from `/api/market/v1/symbol/detail` and
 *   `/api/market/v1/symbols/all`; replacing it there is enough: BUY / SELL and "Place Buy Order"
 *   become enabled and show the last real quote. The price stream (STOMP over SockJS) is not needed.
 * - Every trade write goes to `/api/trade/trade/...`: POST `v1/market` places a market order,
 *   POST `v1/limit` a pending one, PATCH modifies them, PUT `v1` closes a position, DELETE `v1`
 *   deletes a pending order, PUT `v1/bulk` and `v1/limit/bulk` are the bulk actions.
 * - The app judges a reply by its HTTP status only (a 200 reply is a success whatever its body).
 *   Errors are shown as a toast: HTTP 4xx with a known `code` shows that code's text (e.g.
 *   `MT4_1004` → "Insufficient balance"), HTTP 500 shows "Something went wrong. Please contact
 *   customer support.", a failed request shows "Network error. Please try again later.", and a
 *   request that is never answered shows nothing (no time-out).
 */

/** What the app sends to place a market order. */
export interface MarketOrderRequest {
  /** 0 = Buy, 1 = Sell. */
  orderType: number;
  symbol: string;
  lotSize: number;
  /** 0 = Fill or Kill. */
  fillPolicy: number;
  indicate: string;
  stopLoss?: number;
  takeProfit?: number;
}

export const ORDER_TYPE = { BUY: 0, SELL: 1 } as const;

/** A trade write the page tried to send. It was answered by the mock, never by the server. */
export interface CapturedOrder {
  method: string;
  /** e.g. `/api/trade/trade/v1/market`. */
  path: string;
  body: MarketOrderRequest;
}

/** How the mock answers order requests. */
export type OrderReply =
  | { kind: 'success' }
  | { kind: 'error'; status: number; code: string; message: string }
  | { kind: 'network-failure' }
  | { kind: 'no-response' };

const TRADE_WRITES = '/api/trade/trade/';
const OPEN_STATUS = { status: 'TRADING', marketStatus: 'TRADING', online: true };

interface Envelope<T> {
  code: string;
  result: T;
}

const isTradeWrite = (url: URL): boolean => url.pathname.startsWith(TRADE_WRITES);

/**
 * Reports `symbol`'s market as open to the page. Call before the page loads.
 *
 * Also stops every trade write from leaving the browser, so a page that believes the market is
 * open can never place a real order. Use {@link captureOrderRequests} to record and answer them.
 */
export async function openMarketFor(page: Page, symbol: string): Promise<void> {
  await page.route(isTradeWrite, (route) => route.abort('blockedbyclient'));
  await page.route(
    (url) =>
      url.pathname === '/api/market/v1/symbol/detail' && url.searchParams.get('symbol') === symbol,
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Envelope<Record<string, unknown>>;
      Object.assign(body.result, OPEN_STATUS);
      await route.fulfill({ response, json: body });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/market/v1/symbols/all',
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Envelope<{ symbol: string }[]>;
      for (const s of body.result) if (s.symbol === symbol) Object.assign(s, OPEN_STATUS);
      await route.fulfill({ response, json: body });
    },
  );
}

/**
 * Reports One-Click Trading as on or off to the page, without touching the real (shared) setting:
 * attempts to change it are answered locally. Call before the page loads.
 */
export async function mockOneClickSetting(page: Page, enabled: boolean): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/user/setting/v1/preference',
    async (route) => {
      const request = route.request();
      const isOneClick =
        new URL(request.url()).searchParams.get('type') === 'OCT_ENABLE' ||
        (request.postData() ?? '').includes('OCT_ENABLE');
      if (!isOneClick) return route.fallback();
      if (request.method() !== 'GET') return route.fulfill({ status: 200, body: '' });
      const setting = {
        category: 'ONE_CLICK_TRADING',
        type: 'OCT_ENABLE',
        value: String(enabled),
        symbol: 'ALL',
      };
      return route.fulfill({ json: { code: '200', result: [setting] } });
    },
  );
}

/**
 * Records every trade write the page sends and answers it with `reply`. Nothing is forwarded to
 * the server. Returns the live list of recorded requests.
 */
export async function captureOrderRequests(
  page: Page,
  reply: OrderReply = { kind: 'success' },
): Promise<CapturedOrder[]> {
  const requests: CapturedOrder[] = [];
  await page.route(isTradeWrite, async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON() as MarketOrderRequest,
    });
    await answer(route, reply);
  });
  return requests;
}

async function answer(route: Route, reply: OrderReply): Promise<void> {
  switch (reply.kind) {
    case 'success':
      // The app ignores the body of a successful reply.
      return route.fulfill({ json: { code: '200', result: null } });
    case 'error':
      return route.fulfill({
        status: reply.status,
        json: { code: reply.code, message: reply.message },
      });
    case 'network-failure':
      return route.abort('failed');
    case 'no-response':
      // Leave the request pending: the page waits for an answer that never comes.
      return;
  }
}

/**
 * `test` for the mocked specs: the selected symbol's market is reported open, One-Click Trading is
 * reported as `oneClickSetting`, and `orderRequests` records the order requests, answered with
 * `orderReply`. Change the options with `test.use({ oneClickSetting: false })` etc.
 */
export const mockedTest = base.extend<{
  oneClickSetting: boolean;
  orderReply: OrderReply;
  orderRequests: CapturedOrder[];
}>({
  oneClickSetting: [true, { option: true }],
  orderReply: [{ kind: 'success' }, { option: true }],
  // The mocks must be in place before the trade screen loads, so they wrap the page itself.
  page: async ({ page, symbol, oneClickSetting }, use) => {
    await openMarketFor(page, symbol);
    await mockOneClickSetting(page, oneClickSetting);
    await use(page);
  },
  orderRequests: async ({ page, orderReply }, use) => {
    await use(await captureOrderRequests(page, orderReply));
  },
});
