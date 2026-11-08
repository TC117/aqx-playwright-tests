import { expect, type Locator, type Page } from '@playwright/test';
import { VALIDATION_TEXT } from './EditPositionDialog';

/**
 * "Confirm To Close Position" dialog, opened by a row's close button while One-Click Trading is
 * off (with it on, the click closes the whole position at once).
 *
 * Verified with fabricated positions (mocked reads, writes blocked): symbol, Order No., a Volume
 * input (placeholder "Min: 0.01", suffix "/<position volume>"), MIN and MAX buttons, Fill Policy
 * (Fill or Kill) and CANCEL / CONFIRM. CONFIRM stays disabled until a volume is entered.
 * Client-side checks: above the position volume "Maximum volume is 0.05.", 0 "Please enter a valid
 * volume."; 0.005 (below the minimum) and 0.015 (off the 0.01 step) are accepted by the dialog, so
 * the server decides those.
 */
export class ClosePositionDialog {
  readonly root: Locator;
  readonly volume: Locator;
  /** Text after the input, e.g. "/0.05" (the position's volume). */
  readonly volumeLimit: Locator;
  readonly minButton: Locator;
  readonly maxButton: Locator;
  readonly fillPolicy: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  readonly errors: Locator;

  constructor(protected readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'Confirm To Close Position' });
    this.volume = this.root.locator('input[name="lotSize"]');
    this.volumeLimit = this.root.getByText(/^\/\d/);
    this.minButton = this.root.getByTestId('close-order-input-volume-static-min');
    this.maxButton = this.root.getByTestId('close-order-input-volume-static-max');
    this.fillPolicy = this.root.getByTestId('edit-dropdown-fill-policy');
    this.confirmButton = this.root.getByRole('button', { name: 'Confirm', exact: true });
    this.cancelButton = this.root.getByRole('button', { name: 'Cancel', exact: true });
    this.errors = this.root.getByText(VALIDATION_TEXT);
  }

  /** Types a volume in lots and commits it with blur. */
  async setVolume(lots: number | string): Promise<void> {
    await this.volume.fill(String(lots));
    await this.volume.blur();
  }

  /** Fills in the whole position volume. */
  async useMaxVolume(): Promise<void> {
    await this.maxButton.click();
    await expect(this.volume).not.toHaveValue('');
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.root).toBeHidden();
  }
}
