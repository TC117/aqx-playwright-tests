import type { Locator, Page } from '@playwright/test';
import type { OrderDealRow, PositionHistoryRow } from '../../models/trading';
import { notImplemented } from './notImplemented';

/**
 * Assets module > "Positions History" and "Orders & Deals" tabs.
 *
 * Verified: Positions History columns are Open Date, Symbol, Close Date, Order No., Type,
 * Profit/Loss, Volume, Units, Entry Price, Close Price, Take Profit, Stop Loss, Swap, Commission,
 * Remarks, Comment, Share (cells `asset-history-column-*`, rows `asset-history-position-list-item`).
 * A new demo account shows one BALANCE row for the initial deposit. Orders & Deals columns are
 * Open Date, Symbol, Close Date, Order No., Type, State, Volume, Units, Fill Policy, Entry Price,
 * Take Profit, Stop Loss, Profit/Loss, Swap, Commission, Remarks, Comment; empty state "You have
 * no orders & deals history."
 * Owner: records work (R6, R7).
 */
export class TradeHistory {
  readonly positionsHistoryTab: Locator;
  readonly ordersAndDealsTab: Locator;
  readonly positionRows: Locator;

  constructor(protected readonly page: Page) {
    this.positionsHistoryTab = page.getByTestId('tab-asset-order-type-history-positions-history');
    this.ordersAndDealsTab = page.getByTestId('tab-asset-order-type-history-orders-and-deals');
    this.positionRows = page.getByTestId('asset-history-position-list-item');
  }

  async openPositionsHistory(): Promise<void> {
    await this.positionsHistoryTab.click();
  }

  async openOrdersAndDeals(): Promise<void> {
    await this.ordersAndDealsTab.click();
  }

  /** Positions History row of a closed (or partly closed) position. */
  async readPosition(_orderId: string): Promise<PositionHistoryRow> {
    return notImplemented('TradeHistory.readPosition');
  }

  /** Orders & Deals rows that belong to one position (opening and closing orders). */
  async readOrdersAndDeals(_orderId: string): Promise<OrderDealRow[]> {
    return notImplemented('TradeHistory.readOrdersAndDeals');
  }
}
