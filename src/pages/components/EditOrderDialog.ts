import { expect, type Locator, type Page } from '@playwright/test';
import type { Expiry } from '../../models/trading';
import { VALIDATION_TEXT } from './validation';
import { pickExpiry } from './OrderPanel';
import { TradeConfirmation } from './TradeConfirmation';
import { submitTradeRequest, TRADE_API } from './tradeRequests';

export interface PendingOrderChanges {
  price?: number;
  /** `null` removes the value. */
  stopLoss?: number | null;
  takeProfit?: number | null;
  expiry?: Expiry;
  /** Expiry moment for "Specified Date" / "Specified Date and Time". */
  expiresAt?: Date;
}

/**
 * "Edit Order" dialog, opened by a Pending Orders row's edit button.
 *
 * Verified with fabricated orders (mocked reads, writes blocked): symbol, type, Order No., volume,
 * units, fill policy, then Price (`input[name="price"]`, no test id), Stop Loss / Take Profit as
 * price and points (the order panel's test ids, so always scoped to the dialog), and Expiry (Good
 * Till Canceled, Good Till Day, Specified Date and Time, Specified Date). The two "Specified"
 * options add `edit-input-expiry-date` (and `edit-input-expiry-time`). CONFIRM opens the shared
 * "Order Confirmation" dialog; its Confirm sends PATCH /api/trade/trade/v1/limit. Client-side
 * checks: SL/TP against the order price ("Stop Loss must be less than price."); a Buy Limit price
 * above the market is not checked here (the server decides).
 */
export class EditOrderDialog {
  readonly root: Locator;
  readonly symbol: Locator;
  readonly orderType: Locator;
  readonly orderId: Locator;
  readonly volume: Locator;
  readonly price: Locator;
  readonly stopLossPrice: Locator;
  readonly takeProfitPrice: Locator;
  readonly expiry: Locator;
  readonly expiryDate: Locator;
  readonly expiryTime: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  readonly errors: Locator;
  readonly confirmation: TradeConfirmation;

  constructor(protected readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'Edit Order' });
    this.symbol = this.root.getByTestId('edit-symbol-value');
    this.orderType = this.root.getByTestId('edit-order-type-value');
    this.orderId = this.root.getByTestId('edit-order-id-value');
    this.volume = this.root.getByTestId('edit-volume-value');
    this.price = this.root.locator('input[name="price"]');
    this.stopLossPrice = this.root.getByTestId('trade-input-stoploss-price');
    this.takeProfitPrice = this.root.getByTestId('trade-input-takeprofit-price');
    this.expiry = this.root.getByTestId('edit-dropdown-expiry');
    this.expiryDate = this.root.getByTestId('edit-input-expiry-date');
    this.expiryTime = this.root.getByTestId('edit-input-expiry-time');
    this.confirmButton = this.root.getByTestId('edit-button-order');
    this.cancelButton = this.root.getByTestId('edit-button-cancel');
    this.errors = this.root.getByText(VALIDATION_TEXT);
    this.confirmation = new TradeConfirmation(page);
  }

  /** Applies the changes; a key that is left out keeps its current value. */
  async fill(changes: PendingOrderChanges): Promise<void> {
    // SL/TP are validated against the order price, so the price goes in first.
    if (changes.price !== undefined) await this.setPrice(this.price, changes.price);
    if (changes.stopLoss !== undefined) await this.setPrice(this.stopLossPrice, changes.stopLoss);
    if (changes.takeProfit !== undefined) {
      await this.setPrice(this.takeProfitPrice, changes.takeProfit);
    }
    if (changes.expiry !== undefined) await this.selectExpiry(changes.expiry, changes.expiresAt);
  }

  async setPrice(input: Locator, value: number | null): Promise<void> {
    await input.fill(value === null ? '' : String(value));
    await input.blur();
  }

  /** Picks an expiry; for the "Specified" options `expiresAt` is entered in server time. */
  async selectExpiry(expiry: Expiry, expiresAt?: Date): Promise<void> {
    const inputs = { dropdown: this.expiry, date: this.expiryDate, time: this.expiryTime };
    await pickExpiry(this.page, inputs, expiry, expiresAt);
  }

  /**
   * Clicks CONFIRM, confirms the "Order Confirmation" dialog when it is shown, and resolves once
   * the server accepted the change and the dialog closed.
   */
  async submit(orderId: string): Promise<void> {
    await submitTradeRequest(this.page, {
      action: `Modifying pending order ${orderId}`,
      trigger: this.confirmButton,
      confirm: this.confirmation.confirmButton,
      matches: (r) =>
        r.method() === 'PATCH' &&
        new URL(r.url()).pathname === TRADE_API.modifyPending &&
        String((r.postDataJSON() as { orderId?: unknown } | null)?.orderId) === orderId,
      errors: this.errors,
    });
    await expect(this.root).toBeHidden();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.root).toBeHidden();
  }
}
