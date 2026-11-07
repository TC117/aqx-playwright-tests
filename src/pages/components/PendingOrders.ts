import type { Locator, Page } from '@playwright/test';
import type { Expiry, PendingOrderRow } from '../../models/trading';
import { notImplemented } from './notImplemented';

/**
 * Assets module > "Pending Orders (N)" tab.
 *
 * Verified with no orders: columns are Open Date, Order No., Symbol, Type, Volume, Units, Fill
 * Policy, Expiry, Expiry Date, Price, Current Price, Take Profit, Stop Loss, Track, Edit, Delete.
 * Empty state: "You have no pending orders."
 * Owner: positions and bulk work (R4, R5).
 */
export class PendingOrders {
  readonly tab: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;

  constructor(protected readonly page: Page) {
    this.tab = page.getByTestId('tab-asset-order-type-pending-orders');
    this.rows = page.getByTestId('asset-pending-list-item');
    this.emptyState = page.getByText('You have no pending orders.');
  }

  async open(): Promise<void> {
    await this.tab.click();
  }

  async count(): Promise<number> {
    return notImplemented('PendingOrders.count');
  }

  async orderIds(): Promise<string[]> {
    return notImplemented('PendingOrders.orderIds');
  }

  row(_orderId: string): Locator {
    return notImplemented('PendingOrders.row');
  }

  async read(_orderId: string): Promise<PendingOrderRow> {
    return notImplemented('PendingOrders.read');
  }

  async edit(
    _orderId: string,
    _changes: {
      price?: number;
      stopLoss?: number | null;
      takeProfit?: number | null;
      expiry?: Expiry;
      expiresAt?: Date;
    },
  ): Promise<void> {
    return notImplemented('PendingOrders.edit');
  }

  async delete(_orderId: string): Promise<void> {
    return notImplemented('PendingOrders.delete');
  }
}
