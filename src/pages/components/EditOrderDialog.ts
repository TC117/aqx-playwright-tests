import { expect, type Locator, type Page } from '@playwright/test';
import type { Expiry } from '../../models/trading';
import { VALIDATION_TEXT } from './EditPositionDialog';
import { calendarDayLabel, OrderPanel, serverClock, type ServerClock } from './OrderPanel';
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
    if ((await this.expiry.innerText()).trim() !== expiry) {
      await this.expiry.click();
      // The open list follows the trigger, which also shows the current value.
      await this.expiry.getByText(expiry, { exact: true }).last().click();
      await expect(this.expiry).toHaveText(expiry);
    }
    if (!expiresAt) return;
    if (expiry !== 'Specified Date' && expiry !== 'Specified Date and Time') {
      throw new Error(`Expiry "${expiry}" does not take a date`);
    }
    const clock = serverClock(expiresAt, await new OrderPanel(this.page).serverTimeOffsetMs());
    await this.pickDate(clock);
    if (expiry === 'Specified Date and Time') await this.pickTime(clock);
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
        (r.postDataJSON() as { orderId?: string } | null)?.orderId === orderId,
      errors: this.errors,
    });
    await expect(this.root).toBeHidden();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.root).toBeHidden();
  }

  private async pickDate(clock: ServerClock): Promise<void> {
    const calendar = this.page.locator('.react-calendar');
    await this.expiryDate.click();
    await expect(calendar).toBeVisible();
    const monthLabel = calendar.locator('.react-calendar__navigation__label');
    const target = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(clock.year, clock.month - 1, 1)));
    for (let i = 0; !(await monthLabel.innerText()).includes(target); i++) {
      if (i > 24) throw new Error(`The expiry calendar never reached ${target}`);
      const shown = await monthLabel.innerText();
      await calendar.locator('.react-calendar__navigation__next-button').click();
      await expect(monthLabel).not.toHaveText(shown);
    }
    await calendar.getByRole('button', { name: calendarDayLabel(clock), exact: true }).click();
    await expect(this.expiryDate).toHaveText(clock.date);
  }

  private async pickTime(clock: ServerClock): Promise<void> {
    await this.expiryTime.click();
    const hourLabel = this.page.getByText('Hour', { exact: true });
    const minuteLabel = this.page.getByText('Minute', { exact: true });
    const ok = this.page.getByRole('button', { name: 'OK', exact: true });
    // Innermost element holding both columns and the OK button.
    const picker = this.page
      .locator('div')
      .filter({ has: hourLabel })
      .filter({ has: minuteLabel })
      .filter({ has: ok })
      .last();
    await expect(picker).toBeVisible();
    const pad = (n: number): string => String(n).padStart(2, '0');
    for (const [label, other, value] of [
      [hourLabel, minuteLabel, pad(clock.hour)],
      [minuteLabel, hourLabel, pad(clock.minute)],
    ] as const) {
      // Each column holds its label and a dropdown of two-digit values.
      const column = picker.locator('div').filter({ has: label }).filter({ hasNot: other }).first();
      await column.locator('[tabindex="0"]').first().click();
      await column.getByTestId('options').getByText(value, { exact: true }).click();
      await expect(column.locator('[tabindex="0"]').first()).toHaveText(value);
    }
    await picker.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(this.expiryTime).toHaveText(clock.time);
  }
}
