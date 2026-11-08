import { expect, type Locator, type Page } from '@playwright/test';

/** What the "Order Confirmation" dialog shows for one order. */
export interface ConfirmationDetails {
  symbol: string;
  /** Order type badge as shown, e.g. `BUY` or `BUY LIMIT` (compare case-insensitively). */
  orderType: string;
  /**
   * Value under each label, e.g. `{ Volume: '0.02', Units: '2,000', 'Stop Loss': '1.0988',
   * 'Fill Policy': 'Fill or Kill', 'Est. Margin Required': '22.28 USD' }`. Rows without a value
   * (no Stop Loss, no expiry date) are not shown at all.
   */
  fields: Record<string, string>;
}

/**
 * "Order Confirmation" dialog, shown after the place button while One-Click Trading is off.
 *
 * Verified with the market reported open (mocked) and the order requests answered in the browser
 * (2026-11-08): title "Order Confirmation", `trade-confirmation-symbol`, `-order-type`, `-label`,
 * `-value`, `-button-confirm` and `-button-close`. There is no `trade-confirmation-modal`, so the
 * dialog is found through its Confirm button. Rows follow the order: Volume, Units, Price and
 * Stop Limit Price (pending / Stop Limit), Stop Loss and Take Profit (when set), Expiry (pending),
 * "Expiry Date" or "Expiry Date & Time" (the two "Specified" expiries), Fill Policy, then
 * "Est. Margin Required" (e.g. `22.28 USD`).
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
