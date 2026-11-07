import type { Locator, Page } from '@playwright/test';
import { notImplemented } from './notImplemented';

export type BulkCloseKind = 'all' | 'profit' | 'loss';

/**
 * Bulk actions of the assets module: "Bulk Close" on Open Positions (`bulk-close`) and
 * "Bulk Delete" on Pending Orders (`bulk-delete`). Both buttons were seen with the market closed.
 * Owner: positions and bulk work (R5).
 */
export class BulkActions {
  readonly closeButton: Locator;
  readonly deleteButton: Locator;

  constructor(protected readonly page: Page) {
    this.closeButton = page.getByTestId('bulk-close');
    this.deleteButton = page.getByTestId('bulk-delete');
  }

  /** Bulk-closes open positions of the given kind and confirms the dialog. */
  async closePositions(_kind: BulkCloseKind): Promise<void> {
    return notImplemented('BulkActions.closePositions');
  }

  /** Bulk-deletes all pending orders and confirms the dialog. */
  async deleteAllPendingOrders(): Promise<void> {
    return notImplemented('BulkActions.deleteAllPendingOrders');
  }
}
