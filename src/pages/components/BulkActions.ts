import { expect, type Locator, type Page } from '@playwright/test';
import { submitTradeRequest, TRADE_API } from './tradeRequests';

export type BulkCloseKind = 'all' | 'profit' | 'loss';
export type BulkDeleteKind = 'all' | 'limit' | 'stop';

/** Menu entries as labelled in the UI. */
export const BULK_CLOSE_OPTIONS: Record<BulkCloseKind, string> = {
  all: 'All Positions',
  profit: 'Profitable Positions',
  loss: 'Loss Positions',
};
export const BULK_DELETE_OPTIONS: Record<BulkDeleteKind, string> = {
  all: 'All Orders',
  limit: 'Limit Orders',
  stop: 'Stop Orders',
};

/** What each confirmation dialog says. "30" is the platform's cap per bulk action. */
export const BULK_DIALOG_TEXT = {
  close: {
    all: ['Up to 30 positions can be closed.', 'Would you like to close all positions?'],
    profit: [
      'Up to 30 open profitable positions can be closed.',
      'Would you like to close all profitable positions?',
    ],
    loss: [
      'Up to 30 open losing positions can be closed.',
      'Would you like to close all losing positions?',
    ],
  },
  delete: {
    all: [
      'Up to 30 pending orders can be deleted.',
      'Would you like to delete all pending orders?',
    ],
    limit: ['Up to 30 limit orders can be deleted.', 'Would you like to delete all limit orders?'],
    stop: ['Up to 30 stop orders can be deleted.', 'Would you like to delete all stop orders?'],
  },
} as const;

/**
 * Bulk actions of the assets module: "Bulk Close" on Open Positions (`bulk-close`) and
 * "Bulk Delete" on Pending Orders (`bulk-delete`).
 *
 * Verified live: with nothing listed, clicking either opens nothing (no menu, no request).
 * Verified with fabricated rows (mocked reads, writes blocked): the click opens a menu (entries
 * have no test ids) — Bulk Close: All Positions, Profitable Positions, Loss Positions; Bulk Delete:
 * All Orders, Limit Orders, Stop Orders (Limit / Stop disabled when no such order is listed). Each
 * entry opens a "Bulk Close" / "Bulk Delete" dialog with the texts in {@link BULK_DIALOG_TEXT} and
 * CANCEL / CONFIRM (`bulk-close-modal-button-{cancel,submit}-{all,profit,loss}`; Bulk Delete reuses
 * the `-all` ids for "All Orders" and has none for the others). The UI itself picks the items it
 * sends (at most 30, from the rows it has; "profitable" by the P/L it shows) in one request.
 * Quirk: while the selected symbol's market is closed and the account never saved the "Hide Other
 * Symbols" preference, the menu does not open even with rows listed.
 * Owner: positions and bulk work (R5).
 */
export class BulkActions {
  readonly closeButton: Locator;
  readonly deleteButton: Locator;
  /** The confirmation dialog of either action (no accessible name; found by its title). */
  readonly closeDialog: Locator;
  readonly deleteDialog: Locator;

  constructor(protected readonly page: Page) {
    this.closeButton = page.getByTestId('bulk-close');
    this.deleteButton = page.getByTestId('bulk-delete');
    this.closeDialog = page.getByRole('dialog').filter({ hasText: /^Bulk Close/ });
    this.deleteDialog = page.getByRole('dialog').filter({ hasText: /^Bulk Delete/ });
  }

  closeOption(kind: BulkCloseKind): Locator {
    return this.page.getByText(BULK_CLOSE_OPTIONS[kind], { exact: true });
  }

  deleteOption(kind: BulkDeleteKind): Locator {
    return this.page.getByText(BULK_DELETE_OPTIONS[kind], { exact: true });
  }

  /** Opens the Bulk Close menu (Open Positions tab). */
  async openCloseMenu(): Promise<void> {
    if (!(await this.closeOption('all').isVisible())) await this.closeButton.click();
    await expect(this.closeOption('all')).toBeVisible();
  }

  /** Opens the Bulk Delete menu (Pending Orders tab). */
  async openDeleteMenu(): Promise<void> {
    if (!(await this.deleteOption('all').isVisible())) await this.deleteButton.click();
    await expect(this.deleteOption('all')).toBeVisible();
  }

  /** Chooses a Bulk Close entry and waits for its confirmation dialog (nothing is sent yet). */
  async requestClose(kind: BulkCloseKind): Promise<void> {
    await this.openCloseMenu();
    await this.closeOption(kind).click();
    await expect(this.closeDialog).toBeVisible();
  }

  /** Chooses a Bulk Delete entry and waits for its confirmation dialog (nothing is sent yet). */
  async requestDelete(kind: BulkDeleteKind): Promise<void> {
    await this.openDeleteMenu();
    await this.deleteOption(kind).click();
    await expect(this.deleteDialog).toBeVisible();
  }

  /** Cancels whichever bulk dialog is open. */
  async cancel(): Promise<void> {
    const dialog = this.closeDialog.or(this.deleteDialog);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  /**
   * Bulk-closes open positions of the given kind and confirms the dialog. Resolves once the server
   * accepted the request (the rows then leave the table; callers check which ones).
   */
  async closePositions(kind: BulkCloseKind): Promise<void> {
    await this.openCloseMenu();
    await submitTradeRequest(this.page, {
      action: `Bulk close (${BULK_CLOSE_OPTIONS[kind]})`,
      trigger: this.closeOption(kind),
      confirm: this.page.getByTestId(`bulk-close-modal-button-submit-${kind}`),
      matches: (r) => r.method() === 'PUT' && new URL(r.url()).pathname === TRADE_API.bulkClose,
    });
    await expect(this.closeDialog).toBeHidden();
  }

  /** Bulk-deletes all pending orders and confirms the dialog. Resolves once the server accepted. */
  async deleteAllPendingOrders(): Promise<void> {
    await this.openDeleteMenu();
    await submitTradeRequest(this.page, {
      action: 'Bulk delete (All Orders)',
      trigger: this.deleteOption('all'),
      confirm: this.deleteDialog.getByRole('button', { name: 'Confirm', exact: true }),
      matches: (r) => r.method() === 'PUT' && new URL(r.url()).pathname === TRADE_API.bulkDelete,
    });
    await expect(this.deleteDialog).toBeHidden();
  }
}
