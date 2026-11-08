import { test } from '@playwright/test';
import { isTradable, type AqxApi } from '../api/AqxApi';

/**
 * Skips the current test unless `symbol` can be traded right now.
 *
 * The decision comes from the platform's own market status (`/api/market/v1/symbols/all`), never
 * from missing prices, so an outage while the market is open still fails the test.
 */
export async function skipUnlessMarketOpen(api: AqxApi, symbol: string): Promise<void> {
  const s = await api.symbol(symbol);
  test.skip(
    !isTradable(s),
    `${symbol} market is closed (status ${s.status}, market status ${s.marketStatus}); this test needs live order execution`,
  );
}

/** Skips the current test unless `symbol`'s market is closed (for market-closed behaviour). */
export async function skipUnlessMarketClosed(api: AqxApi, symbol: string): Promise<void> {
  test.skip(
    await api.isMarketOpen(symbol),
    `${symbol} market is open; this test checks closed-market behaviour`,
  );
}
