import { expect, type Locator, type Page } from '@playwright/test';
import { parseUiNumber, requireUiNumber } from '../../helpers/numbers';
import type { Expiry, PendingOrderRow } from '../../models/trading';
import { DeleteOrderDialog } from './DeleteOrderDialog';
import { EditOrderDialog } from './EditOrderDialog';
import { exactly } from '../../helpers/text';
import { RENDERED_ROW_LIMIT, tabCount } from './OpenPositions';
import { submitTradeRequest, TRADE_API } from './tradeRequests';

/**
 * Assets module > "Pending Orders (N)" tab.
 *
 * Verified with no orders: columns are Open Date, Order No., Symbol, Type, Volume, Units, Fill
 * Policy, Expiry, Expiry Date, Price, Current Price, Take Profit, Stop Loss, Track, Edit, Delete.
 * Empty state: "You have no pending orders."
 * Verified with fabricated orders (mocked reads): rows `asset-pending-list-item`, cells
 * `asset-pending-column-*` (the Price column is `asset-pending-column-entry-price`); Type shows
 * e.g. BUY LIMIT / SELL STOP; Volume shows "requested / filled" (`0.03 / 0`); Expiry shows the
 * option label and Expiry Date `--` for Good Till Canceled. The row's edit and delete buttons
 * reuse the Open Positions ids `asset-open-button-edit` / `asset-open-button-close`.
 * Owner: positions and bulk work (R4, R5).
 */
export class PendingOrders {
  readonly tab: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;
  readonly headers: Locator;
  /** Delete dialog, shown after a row's delete button while One-Click Trading is off. */
  readonly deleteDialog: DeleteOrderDialog;

  constructor(protected readonly page: Page) {
    this.tab = page.getByTestId('tab-asset-order-type-pending-orders');
    this.rows = page.getByTestId('asset-pending-list-item');
    this.emptyState = page.getByText('You have no pending orders.');
    this.headers = page
      .getByRole('table')
      .filter({ has: this.emptyState.or(this.rows) })
      .locator('thead th');
    this.deleteDialog = new DeleteOrderDialog(page);
  }

  async open(): Promise<void> {
    await this.tab.click();
    await expect(this.rows.first().or(this.emptyState)).toBeVisible();
  }

  async count(): Promise<number> {
    return tabCount(await this.tab.innerText());
  }

  /** Order No. of every row currently listed (the tab must be open); see OpenPositions.orderIds. */
  async orderIds(): Promise<string[]> {
    await expect(this.rows.first().or(this.emptyState)).toBeVisible();
    await expect
      .poll(
        async () => (await this.rows.count()) === Math.min(await this.count(), RENDERED_ROW_LIMIT),
        { message: 'the table should list as many orders as the tab label counts' },
      )
      .toBe(true);
    const ids = await this.rows.getByTestId('asset-pending-column-order-id').allInnerTexts();
    return ids.map((id) => id.trim());
  }

  row(orderId: string): Locator {
    return this.rows.filter({
      has: this.page
        .getByTestId('asset-pending-column-order-id')
        .filter({ hasText: exactly(orderId) }),
    });
  }

  async read(orderId: string): Promise<PendingOrderRow> {
    const row = this.row(orderId);
    await expect(row, `pending order ${orderId} should be listed once`).toHaveCount(1);
    const cell = async (name: string): Promise<string> =>
      (await row.getByTestId(`asset-pending-column-${name}`).innerText()).trim();
    return {
      orderId: await cell('order-id'),
      symbol: await cell('symbol'),
      type: (await cell('order-type')).toUpperCase(),
      volumeText: await cell('volume'),
      expiry: await cell('expiry'),
      expiryDate: await cell('expiry-date'),
      price: requireUiNumber(await cell('entry-price'), 'Price'),
      stopLoss: parseUiNumber(await cell('stop-loss')),
      takeProfit: parseUiNumber(await cell('take-profit')),
    };
  }

  /** Opens the Edit dialog of an order without changing anything. */
  async openEdit(orderId: string): Promise<EditOrderDialog> {
    const dialog = new EditOrderDialog(this.page);
    await this.row(orderId).getByTestId('asset-open-button-edit').click();
    await expect(dialog.root).toBeVisible();
    await expect(dialog.orderId).toHaveText(orderId);
    return dialog;
  }

  /** Changes price, SL/TP and/or expiry. Resolves once the server accepted and the row shows it. */
  async edit(
    orderId: string,
    changes: {
      price?: number;
      stopLoss?: number | null;
      takeProfit?: number | null;
      expiry?: Expiry;
      expiresAt?: Date;
    },
  ): Promise<void> {
    const dialog = await this.openEdit(orderId);
    await dialog.fill(changes);
    await dialog.submit(orderId);
    const expected: Partial<Record<'entry-price' | 'stop-loss' | 'take-profit', number | null>> =
      {};
    if (changes.price !== undefined) expected['entry-price'] = changes.price;
    if (changes.stopLoss !== undefined) expected['stop-loss'] = changes.stopLoss;
    if (changes.takeProfit !== undefined) expected['take-profit'] = changes.takeProfit;
    const row = this.row(orderId);
    for (const [column, value] of Object.entries(expected)) {
      await expect
        .poll(
          async () =>
            parseUiNumber(await row.getByTestId(`asset-pending-column-${column}`).innerText()),
          {
            message: `pending order ${orderId} should show the new ${column}`,
          },
        )
        .toBe(value);
    }
    if (changes.expiry !== undefined) {
      await expect(row.getByTestId('asset-pending-column-expiry')).toHaveText(changes.expiry);
    }
  }

  /**
   * Deletes (cancels) one pending order, confirming the dialog unless One-Click Trading deletes at
   * once. Resolves once the server accepted and the row is gone.
   */
  async delete(orderId: string): Promise<void> {
    const row = this.row(orderId);
    await expect(row, `pending order ${orderId} should be listed once`).toHaveCount(1);
    const dialog = this.deleteDialog;
    await submitTradeRequest(this.page, {
      action: `Deleting pending order ${orderId}`,
      trigger: row.getByTestId('asset-open-button-close'),
      confirm: dialog.confirmButton,
      matches: (r) =>
        r.method() === 'DELETE' &&
        new URL(r.url()).pathname === TRADE_API.closeOrDelete &&
        new URL(r.url()).searchParams.get('orderId') === orderId,
    });
    await expect(dialog.root).toBeHidden();
    await expect(row, `pending order ${orderId} should leave the list`).toHaveCount(0);
  }
}
