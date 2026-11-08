import { expect, type Locator, type Page } from '@playwright/test';

/** What the "Order Confirmation" dialog shows for one order. */
export interface ConfirmationDetails {
  symbol: string;
  /** Order type badge as shown, e.g. `BUY` or `BUY LIMIT` (compare case-insensitively). */
  orderType: string;
  /**
   * Value under each label, e.g. `{ Volume: '0.01', Units: '1,000', 'Stop Loss': '1.1050',
   * 'Fill Policy': 'Fill or Kill', 'Est. Margin Required': '11.14 USD' }`. Rows without a value
   * (no Stop Loss, no expiry date) are not shown at all.
   */
  fields: Record<string, string>;
}

/**
 * "Order Confirmation" dialog, shown after the place button while One-Click Trading is off.
 *
 * Not seen live yet: every market was closed while this was written, so the place button never
 * got enabled. The test ids, the title and the Confirm / Cancel buttons come from the web trader's
 * own bundle. `trade-confirmation-modal` is declared there but never rendered, so the dialog is
 * found through its Confirm button. Rows follow the order type: Volume, Units, Price (pending),
 * Stop Limit Price (Stop Limit), Stop Loss, Take Profit, Expiry (pending), Expiry Date (or
 * "Expiry Date & Time"), Fill Policy, then "Est. Margin Required".
 */
export class TradeConfirmation {
  readonly title: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  readonly symbol: Locator;
  readonly orderType: Locator;
  readonly labels: Locator;
  readonly values: Locator;

  constructor(protected readonly page: Page) {
    this.title = page.getByText('Order Confirmation', { exact: true });
    this.confirmButton = page.getByTestId('trade-confirmation-button-confirm');
    this.cancelButton = page.getByTestId('trade-confirmation-button-close');
    this.symbol = page.getByTestId('trade-confirmation-symbol');
    this.orderType = page.getByTestId('trade-confirmation-order-type');
    this.labels = page.getByTestId('trade-confirmation-label');
    this.values = page.getByTestId('trade-confirmation-value');
  }

  /** True while the dialog is on screen (no waiting). */
  async isOpen(): Promise<boolean> {
    return this.confirmButton.isVisible();
  }

  async read(): Promise<ConfirmationDetails> {
    await expect(this.confirmButton).toBeVisible();
    // The margin row is filled in by a separate request, so wait until every label has a value.
    await expect(this.values).toHaveCount(await this.labels.count());
    const labels = await this.labels.allInnerTexts();
    const values = await this.values.allInnerTexts();
    const fields: Record<string, string> = {};
    labels.forEach((label, i) => (fields[label.trim()] = (values[i] ?? '').trim()));
    return {
      symbol: (await this.symbol.innerText()).trim(),
      orderType: (await this.orderType.innerText()).trim(),
      fields,
    };
  }

  /** Clicks Confirm. The dialog stays open (busy) until the server answers. */
  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  /** Clicks Cancel and waits for the dialog to close. */
  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.confirmButton).toBeHidden();
  }
}
