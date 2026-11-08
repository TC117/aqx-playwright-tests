import { expect, type Locator, type Page } from '@playwright/test';

/**
 * "Confirm To Delete Order" dialog, opened by a Pending Orders row's delete button while One-Click
 * Trading is off (with it on, the click deletes at once).
 *
 * Verified with fabricated orders (mocked reads, writes blocked): symbol, type (e.g. BUY LIMIT),
 * Order No., "Would you like to delete the pending order?" and CANCEL / CONFIRM. Confirm sends
 * DELETE /api/trade/trade/v1?symbol=…&orderId=…; on a failure the dialog stays open.
 */
export class DeleteOrderDialog {
  readonly root: Locator;
  readonly question: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(protected readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'Confirm To Delete Order' });
    this.question = this.root.getByText('Would you like to delete the pending order?');
    this.confirmButton = this.root.getByRole('button', { name: 'Confirm', exact: true });
    this.cancelButton = this.root.getByRole('button', { name: 'Cancel', exact: true });
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.root).toBeHidden();
  }
}
