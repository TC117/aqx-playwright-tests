import { request, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import { API_TOKEN_FILE, env } from '../config/env';

/**
 * Client for the web trader's own REST API (the same calls the UI makes).
 *
 * Tests use it to read state the UI shows in several places (market status, symbol spec, account
 * balance, order counts, history), to check that the UI and the server agree, and to decide
 * whether a market-dependent test can run. It never places, modifies or closes orders: those go
 * through the UI, because that is what the tests are about. Its only write switches One-Click
 * Trading back off when a failed test left it on.
 *
 * Shapes below were recorded from the live demo; only the fields the tests use are typed.
 */

interface Envelope<T> {
  code: string;
  result: T;
  message?: string;
}

export interface SymbolSummary {
  symbol: string;
  type: string;
  decimal: number;
  bid: number;
  ask: number;
  /** e.g. `TRADING`, `CLOSED`. */
  status: string;
  /** e.g. `TRADING`, `CLOSED`, `OFFQUOTES` (no quotes even inside the session). */
  marketStatus: string;
  online: boolean;
}

export interface TradingSession {
  /** 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

export interface SymbolDetail {
  symbol: string;
  type: string;
  digits: number;
  /** Minimum distance, in points, between the market price and SL/TP/pending prices. */
  stopsLevel: number;
  contractSize: number;
  minContractLotSize: number;
  maxContractLotSize: number;
  lotSizeStep: number;
  /** Size of one point, e.g. 0.0001 for EURUSD. */
  pointStep: number;
  tradingSessions: TradingSession[];
}

export interface TradingAccount {
  accountId: string;
  accountType: string;
  isDemo: boolean;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  baseCurrency: string;
}

export interface OrderCounts {
  marketOrderCounts: number;
  pendingOrderCounts: number;
}

/** An entry of `/api/order/v3/histories` (Positions History). Balance operations have orderType 6. */
export interface HistoryEntry {
  orderId: string;
  positionId: string;
  dealId: string;
  symbol: string;
  volume: number;
  openPrice: number;
  closePrice: number;
  stopLoss: number;
  takeProfit: number;
  profit: number;
  deposit: number;
  withdrawal: number;
  commission: number;
  swap: number;
  orderType: number;
  status: string;
  openTime: number;
  closeTime: number;
}

/**
 * An open position of `/api/trade/order/v1`. Field names come from the web trader's table code
 * and were confirmed by the table rendering fabricated items (the account had no positions).
 * `orderType` 0 = BUY, 1 = SELL; `stopLoss` / `takeProfit` 0 = none; `fillPolicy` 0 FOK, 1 IOC,
 * 2 RETURN.
 */
export interface ServerPosition {
  orderId: string | number;
  positionId: string | number;
  symbol: string;
  orderType: number;
  lotSize: number;
  openPrice: number;
  stopLoss: number;
  takeProfit: number;
  profit: number;
  fillPolicy: number;
  [field: string]: unknown;
}

/**
 * A pending order of `/api/trade/order/v1/pending` (same provenance as {@link ServerPosition}).
 * `orderType` 2 BUY LIMIT, 3 SELL LIMIT, 4 BUY STOP, 5 SELL STOP, 8/9 STOP LIMIT; `tradeExpiry`
 * e.g. `GTC`, `GTD`.
 */
export interface ServerPendingOrder {
  orderId: string | number;
  symbol: string;
  orderType: number;
  lotSize: number;
  price: number;
  stopLoss: number;
  takeProfit: number;
  tradeExpiry: string;
  expiration: number | null;
  [field: string]: unknown;
}

/** Market states that mean "no trading possible right now". */
const CLOSED_STATES = new Set(['CLOSED', 'OFFQUOTES']);

/** True when the symbol is quoting and can be traded right now. */
export function isTradable(s: Pick<SymbolSummary, 'status' | 'marketStatus'>): boolean {
  return !CLOSED_STATES.has(s.status) && !CLOSED_STATES.has(s.marketStatus);
}

export class AqxApi {
  private constructor(private readonly http: APIRequestContext) {}

  /** Creates a client from the bearer token saved by `tests/auth.setup.ts`. */
  static async create(): Promise<AqxApi> {
    if (!fs.existsSync(API_TOKEN_FILE)) {
      throw new Error(`No API token at ${API_TOKEN_FILE}; run the setup project first`);
    }
    const { authorization } = JSON.parse(fs.readFileSync(API_TOKEN_FILE, 'utf8')) as {
      authorization: string;
    };
    const http = await request.newContext({
      baseURL: env.baseUrl,
      extraHTTPHeaders: { authorization, accept: 'application/json' },
    });
    return new AqxApi(http);
  }

  async dispose(): Promise<void> {
    await this.http.dispose();
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.http.get(path);
    if (!response.ok()) {
      throw new Error(`GET ${path} responded ${response.status()}`);
    }
    const body = (await response.json()) as Envelope<T>;
    if (body.code !== '200')
      throw new Error(`GET ${path} returned code ${body.code}: ${body.message ?? ''}`);
    return body.result;
  }

  symbols(): Promise<SymbolSummary[]> {
    return this.get('/api/market/v1/symbols/all');
  }

  async symbol(symbol: string): Promise<SymbolSummary> {
    const found = (await this.symbols()).find((s) => s.symbol === symbol);
    if (!found) throw new Error(`Symbol ${symbol} is not offered on this account`);
    return found;
  }

  symbolDetail(symbol: string): Promise<SymbolDetail> {
    return this.get(`/api/market/v1/symbol/detail?symbol=${encodeURIComponent(symbol)}`);
  }

  /** True when the symbol is quoting and can be traded right now. */
  async isMarketOpen(symbol: string): Promise<boolean> {
    return isTradable(await this.symbol(symbol));
  }

  async account(): Promise<TradingAccount> {
    const result = await this.get<{ tradingAccounts: (TradingAccount & { selected?: boolean })[] }>(
      '/api/user/account/v1',
    );
    const accounts = result.tradingAccounts;
    // Never guess between several accounts: the demo-account guard relies on this answer.
    const account =
      accounts.find((a) => a.selected) ?? (accounts.length === 1 ? accounts[0] : undefined);
    if (!account) {
      throw new Error(
        accounts.length
          ? `Cannot tell which of the ${accounts.length} trading accounts is selected`
          : 'The user has no trading account',
      );
    }
    return account;
  }

  orderCounts(): Promise<OrderCounts> {
    return this.get('/api/trade/order/v1/counts');
  }

  /** Every open position of the account (an empty list when the server answers `null`). */
  async openPositions(): Promise<ServerPosition[]> {
    return (await this.get<ServerPosition[] | null>('/api/trade/order/v1')) ?? [];
  }

  /** Every pending order of the account (an empty list when the server answers `null`). */
  async pendingOrders(): Promise<ServerPendingOrder[]> {
    return (await this.get<ServerPendingOrder[] | null>('/api/trade/order/v1/pending')) ?? [];
  }

  /** Positions History between two moments (defaults: the last 30 days). */
  positionHistory(
    from = Date.now() - 30 * 86_400_000,
    to = Date.now() + 86_400_000,
  ): Promise<HistoryEntry[]> {
    return this.get(`/api/order/v3/histories?from=${from}&to=${to}&type=POSITION`);
  }

  /** One-Click Trading preference as stored on the server for this account. */
  async isOneClickTradingEnabled(): Promise<boolean> {
    // An account that never saved the preference may get `null` instead of a list.
    const result =
      (await this.get<{ value?: string }[] | null>(
        '/api/user/setting/v1/preference?type=OCT_ENABLE&category=ONE_CLICK_TRADING',
      )) ?? [];
    return result.some((p) => String(p.value).toLowerCase() === 'true');
  }

  /** Switches One-Click Trading off for the account, the same request the settings menu sends. */
  async switchOneClickTradingOff(): Promise<void> {
    const response = await this.http.patch('/api/user/setting/v1/preference', {
      data: { type: 'OCT_ENABLE', category: 'ONE_CLICK_TRADING', value: 'false' },
    });
    if (!response.ok()) {
      throw new Error(`Switching One-Click Trading off responded ${response.status()}`);
    }
  }
}
