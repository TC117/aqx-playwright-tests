import type { Locator, Page } from '@playwright/test';
import type { PositionRow } from '../../models/trading';
import { notImplemented } from './notImplemented';

/**
 * Assets module > "Open Positions (N)" tab.
 *
 * Verified with no positions: columns are Open Date, Order No., Symbol, Type, Profit/Loss, ROI%,
 * Volume, Units, Margin Used, Entry Price, Current Price, Take Profit, Stop Loss, Swap, Comment,
 * Track, Edit, Share, Close. Empty state: "You have no open positions."
 * Owner: positions and bulk work (R4, R5).
 */
export class OpenPositions {
  readonly tab: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;

  constructor(protected readonly page: Page) {
    this.tab = page.getByTestId('tab-asset-order-type-open-positions');
    this.rows = page.getByTestId('asset-open-list-item');
    this.emptyState = page.getByText('You have no open positions.');
  }

  async open(): Promise<void> {
    await this.tab.click();
  }

  /** Count shown in the tab label, e.g. 3 for "Open Positions (3)". */
  async count(): Promise<number> {
    return notImplemented('OpenPositions.count');
  }

  /** Order No. of every row currently listed. */
  async orderIds(): Promise<string[]> {
    return notImplemented('OpenPositions.orderIds');
  }

  /** The row of one position, found by its Order No. */
  row(_orderId: string): Locator {
    return notImplemented('OpenPositions.row');
  }

  async read(_orderId: string): Promise<PositionRow> {
    return notImplemented('OpenPositions.read');
  }

  /** Changes SL and/or TP through the Edit dialog. Pass `null` to remove a value. */
  async edit(
    _orderId: string,
    _changes: { stopLoss?: number | null; takeProfit?: number | null },
  ): Promise<void> {
    return notImplemented('OpenPositions.edit');
  }

  /** Closes a position, fully or (with `volume`) partially, through the Close dialog. */
  async close(_orderId: string, _options?: { volume?: number }): Promise<void> {
    return notImplemented('OpenPositions.close');
  }
}
