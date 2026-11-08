import { expect, type Locator, type Page } from '@playwright/test';
import { TradeConfirmation } from './TradeConfirmation';
import { submitTradeRequest, TRADE_API } from './tradeRequests';

/** Inline validation texts, e.g. "Stop Loss must be less than Sell Price." */
export const VALIDATION_TEXT =
  /must be (less|greater) than|^Please enter|^(Minimum|Maximum) .+ is /;

/**
 * "Edit Position" dialog, opened by a row's edit button in Open Positions.
 *
 * Verified with fabricated positions (mocked reads, writes blocked): the dialog shows symbol, side,
 * Order No., entry price, volume, units and fill policy, and Stop Loss / Take Profit as price and
 * points inputs. The inputs reuse the order panel's test ids, so they are always looked up inside
 * the dialog. "UPDATE POSITION" opens the shared "Order Confirmation" dialog; its Confirm sends
 * PATCH /api/trade/trade/v1/market `{orderId, symbol, indicate: "PRICE", stopLoss, takeProfit,
 * units, fillPolicy}`. On a failure the dialog stays open and a toast explains why. Client-side
 * checks: SL/TP on the wrong side of the price show a message and nothing is sent; the stops level
 * is not checked here (the server decides).
 */
export class EditPositionDialog {
  readonly root: Locator;
  readonly symbol: Locator;
  readonly side: Locator;
  readonly orderId: Locator;
  readonly entryPrice: Locator;
  readonly volume: Locator;
  readonly stopLossPrice: Locator;
  readonly stopLossPoints: Locator;
  readonly takeProfitPrice: Locator;
  readonly takeProfitPoints: Locator;
  readonly updateButton: Locator;
  readonly cancelButton: Locator;
  /** Inline validation messages currently shown in the dialog. */
  readonly errors: Locator;
  readonly confirmation: TradeConfirmation;

  constructor(protected readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'Edit Position' });
    this.symbol = this.root.getByTestId('edit-symbol-value');
    this.side = this.root.getByTestId('edit-order-type-value');
    this.orderId = this.root.getByTestId('edit-order-id-value');
    this.entryPrice = this.root.getByTestId('edit-entry-price-value');
    this.volume = this.root.getByTestId('edit-volume-value');
    this.stopLossPrice = this.root.getByTestId('trade-input-stoploss-price');
    this.stopLossPoints = this.root.getByTestId('trade-input-stoploss-points');
    this.takeProfitPrice = this.root.getByTestId('trade-input-takeprofit-price');
    this.takeProfitPoints = this.root.getByTestId('trade-input-takeprofit-points');
    this.updateButton = this.root.getByTestId('edit-button-order');
    this.cancelButton = this.root.getByTestId('edit-button-cancel');
    this.errors = this.root.getByText(VALIDATION_TEXT);
    this.confirmation = new TradeConfirmation(page);
  }

  /** Types a price, or clears the field for `null`, and commits it with blur. */
  async setPrice(input: Locator, value: number | null): Promise<void> {
    await input.fill(value === null ? '' : String(value));
    await input.blur();
  }

  /** Applies the changes; a key that is left out keeps its current value. */
  async fill(changes: { stopLoss?: number | null; takeProfit?: number | null }): Promise<void> {
    if (changes.stopLoss !== undefined) await this.setPrice(this.stopLossPrice, changes.stopLoss);
    if (changes.takeProfit !== undefined) {
      await this.setPrice(this.takeProfitPrice, changes.takeProfit);
    }
  }

  /**
   * Clicks UPDATE POSITION, confirms the "Order Confirmation" dialog when it is shown, and resolves
   * once the server accepted the change and the dialog closed.
   */
  async submit(orderId: string): Promise<void> {
    await submitTradeRequest(this.page, {
      action: `Modifying position ${orderId}`,
      trigger: this.updateButton,
      confirm: this.confirmation.confirmButton,
      matches: (r) =>
        r.method() === 'PATCH' &&
        new URL(r.url()).pathname === TRADE_API.modifyPosition &&
        (r.postDataJSON() as { orderId?: string } | null)?.orderId === orderId,
      errors: this.errors,
    });
    await expect(this.root).toBeHidden();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.root).toBeHidden();
  }

  /** Cancels the dialog if it is still open (it stays open after a rejected change). */
  async dismiss(): Promise<void> {
    if (await this.root.isVisible()) await this.cancel();
  }
}
