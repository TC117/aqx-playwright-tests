import { expect, type Locator, type Page } from '@playwright/test';
import { parseUiNumber, requireUiNumber } from '../../helpers/numbers';
import type {
  Expiry,
  MarketOrderInput,
  OrderType,
  PendingOrderInput,
  Quote,
  Side,
} from '../../models/trading';
import { TradeConfirmation, type ConfirmationDetails } from './TradeConfirmation';
import { submitTradeRequest, TRADE_API } from './tradeRequests';
import { VALIDATION_TEXT } from './validation';

/** Numbers of the "Trade Details (USD)" block, in account currency; `null` while empty. */
export interface TradeDetails {
  tradeVolume: number | null;
  marginRequired: number | null;
  amountPerTick: number | null;
  /** Signed P/L if the Stop Loss is hit (negative for a loss). */
  potentialLoss: number | null;
  /** Signed P/L if the Take Profit is hit. */
  potentialGain: number | null;
  /** Reward per unit of risk: 1.38 for "1 : 1.38". */
  riskReward: number | null;
}

/** Trading hours as listed in the panel's Specification tab. */
export interface TradingHours {
  /** e.g. `GMT +0200`. */
  timeZone: string;
  /** One row per day, e.g. `{ day: 'Monday', hours: '00:00 - 24:00' }`. */
  sessions: { day: string; hours: string }[];
}

/** A moment on the server clock, as the expiry pickers show it. */
export interface ServerClock {
  /** `2026-11-10` */
  date: string;
  /** `12:30` */
  time: string;
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Top bar clock, "Server Time : 2026-11-08 02:01:17". */
const SERVER_TIME = /^Server Time\s*:/;

/** The server clock's UTC offset is a whole number of quarter hours. */
const QUARTER_HOUR = 15 * 60_000;

/** Server clock minus UTC, read from the top bar clock (rounded to a quarter hour). */
export async function serverClockOffsetMs(page: Page): Promise<number> {
  const text = await page.getByText(SERVER_TIME).innerText();
  const m = text.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Cannot read the server time from "${text}"`);
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const serverAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((serverAsUtc - Date.now()) / QUARTER_HOUR) * QUARTER_HOUR;
}

/** Server wall clock of `instant`, given the server's offset from UTC. */
export function serverClock(instant: Date, offsetMs: number): ServerClock {
  const t = new Date(instant.getTime() + offsetMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const [year, month, day, hour, minute] = [
    t.getUTCFullYear(),
    t.getUTCMonth() + 1,
    t.getUTCDate(),
    t.getUTCHours(),
    t.getUTCMinutes(),
  ];
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
    year,
    month,
    day,
    hour,
    minute,
  };
}

/** The calendar's accessible name of a day tile, e.g. "November 10, 2026". */
export function calendarDayLabel(clock: Pick<ServerClock, 'year' | 'month' | 'day'>): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(clock.year, clock.month - 1, clock.day)));
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Months since year 0 for a calendar label such as "November 2026". */
function monthNumber(label: string): number {
  const match = /([A-Z][a-z]+)\s+(\d{4})/.exec(label);
  const month = match ? MONTH_NAMES.indexOf(match[1]!) : -1;
  if (!match || month < 0) throw new Error(`Cannot read the calendar month "${label}"`);
  return Number(match[2]) * 12 + month;
}

/**
 * Picks a day in the date picker (react-calendar) opened by `dateInput`, which then shows the date
 * as `2026-11-10`. Used by the order panel and the Edit Order dialog.
 */
export async function pickCalendarDate(
  page: Page,
  dateInput: Locator,
  clock: Pick<ServerClock, 'year' | 'month' | 'day' | 'date'>,
): Promise<void> {
  await dateInput.click();
  // The calendar opens in a layer outside the form.
  const calendar = page.locator('.react-calendar');
  await expect(calendar).toBeVisible();
  await showCalendarMonth(calendar, clock);
  await calendar.getByRole('button', { name: calendarDayLabel(clock), exact: true }).click();
  await expect(dateInput).toHaveText(clock.date);
}

/**
 * Moves an open date picker (react-calendar) to the month of `clock`. It opens on the input's
 * current month, which can lie after the target (an order that already expires later) or before
 * it (tomorrow is in the next month), so it is moved either way.
 */
export async function showCalendarMonth(
  calendar: Locator,
  clock: Pick<ServerClock, 'year' | 'month'>,
): Promise<void> {
  const monthLabel = calendar.locator('.react-calendar__navigation__label');
  const wanted = clock.year * 12 + clock.month - 1;
  const maxSteps = Math.abs(wanted - monthNumber(await monthLabel.innerText())) + 2;
  for (let i = 0; ; i++) {
    const shown = await monthLabel.innerText();
    const steps = wanted - monthNumber(shown);
    if (steps === 0) break;
    if (i >= maxSteps) throw new Error(`The calendar never reached ${clock.year}-${clock.month}`);
    const button = steps > 0 ? 'next' : 'prev';
    await calendar.locator(`.react-calendar__navigation__${button}-button`).click();
    await expect(monthLabel).not.toHaveText(shown);
  }
}

/**
 * Picks hour and minute in the time picker opened by `timeInput` (an "Hour" and a "Minute"
 * dropdown of two-digit values, then OK), which then shows the time as `12:30`.
 */
export async function pickClockTime(
  page: Page,
  timeInput: Locator,
  clock: Pick<ServerClock, 'hour' | 'minute' | 'time'>,
): Promise<void> {
  await timeInput.click();
  const hourLabel = page.getByText('Hour', { exact: true });
  const minuteLabel = page.getByText('Minute', { exact: true });
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  const picker = page
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
  await expect(timeInput).toHaveText(clock.time);
}

/**
 * Opens one of the custom dropdowns (order panel or Edit Order dialog) and clicks `option`, unless
 * it is already selected.
 */
export async function chooseOption(dropdown: Locator, option: string): Promise<void> {
  if ((await dropdown.innerText()).trim() === option) return;
  await dropdown.click();
  // The open list follows the trigger, which also shows the current value.
  await dropdown.getByText(option, { exact: true }).last().click();
  await expect(dropdown).toHaveText(option);
}

/** The expiry inputs of a pending-order form (order panel or Edit Order dialog). */
export interface ExpiryInputs {
  dropdown: Locator;
  date: Locator;
  time: Locator;
}

/**
 * Picks an expiry. For "Specified Date" and "Specified Date and Time", `expiresAt` is entered as
 * the server clock shows it (the pickers work in server time); without it the form keeps its
 * default, which is the current server time.
 */
export async function pickExpiry(
  page: Page,
  inputs: ExpiryInputs,
  expiry: Expiry,
  expiresAt?: Date,
): Promise<void> {
  await chooseOption(inputs.dropdown, expiry);
  if (!expiresAt) return;
  if (expiry !== 'Specified Date' && expiry !== 'Specified Date and Time') {
    throw new Error(`Expiry "${expiry}" does not take a date`);
  }
  const clock = serverClock(expiresAt, await serverClockOffsetMs(page));
  await pickCalendarDate(page, inputs.date, clock);
  if (expiry === 'Specified Date and Time') await pickClockTime(page, inputs.time, clock);
}

/**
 * Order panel ("Trade" tab) on the right of the trade screen.
 *
 * Verified on the live demo with the market closed: every locator below exists. The place button
 * reads "Market Closed" and is disabled while the symbol's market is closed; with the market
 * reported open (mocked) it reads "Place Buy Order" / "Place Sell Order".
 * Order Type and Expiry are custom dropdowns whose options exist only while open. Inputs take
 * `fill()` and normalise on blur: prices are rounded to the symbol's digits, volume is cut to the
 * volume step and capped at the maximum. Changing the order type clears SL/TP; changing the side
 * keeps them. With One-Click Trading on, the panel opens on its "One Click" tab, so every flow
 * here first switches to "Trade". The whole form resets to an empty Market order when the
 * symbol's details load and whenever One-Click Trading is switched in any session of the account,
 * so the fill methods read the form back and fill it again if it was reset.
 * Owner: order-entry work (R1, R3).
 */
export class OrderPanel {
  readonly tradeTab: Locator;
  readonly specificationTab: Locator;
  readonly buySide: Locator;
  readonly sellSide: Locator;
  /** Bid (the SELL price). */
  readonly liveBid: Locator;
  /** Ask (the BUY price). */
  readonly liveAsk: Locator;
  readonly orderType: Locator;
  readonly volume: Locator;
  /** Units for the entered volume, or "Min: 1000" while the volume is empty. */
  readonly units: Locator;
  readonly stopLossPrice: Locator;
  readonly stopLossPoints: Locator;
  readonly takeProfitPrice: Locator;
  readonly takeProfitPoints: Locator;
  /** Order price of Limit / Stop orders; the stop (trigger) price of a Stop Limit order. */
  readonly price: Locator;
  /** "Stop Limit Price" of a Stop Limit order: the limit price the order becomes once triggered. */
  readonly stopLimitPrice: Locator;
  readonly expiry: Locator;
  readonly expiryDate: Locator;
  readonly expiryTime: Locator;
  /** The date picker (react-calendar) opened from {@link expiryDate}. */
  readonly expiryCalendar: Locator;
  readonly fillPolicy: Locator;
  readonly onePointEquals: Locator;
  readonly tradeDetailsHeader: Locator;
  readonly placeButton: Locator;
  /** Inline validation messages currently shown in the panel. */
  readonly validation: Locator;
  readonly confirmation: TradeConfirmation;
  /** Top bar clock, "Server Time : 2026-11-08 02:01:17". */
  readonly serverTime: Locator;

  /**
   * What the confirmation dialog showed for the last order placed through this panel; `null` when
   * One-Click Trading sent it without a dialog.
   */
  lastConfirmation: ConfirmationDetails | null = null;

  private readonly root: Locator;

  constructor(protected readonly page: Page) {
    this.tradeTab = page.getByTestId('tab-trade');
    this.placeButton = page.getByTestId('trade-button-order');
    // Innermost element holding both the panel tabs and the place button. The Edit Position and
    // Edit Order dialogs reuse the panel's input test ids, so inputs are looked up inside it.
    this.root = page
      .locator('div')
      .filter({ has: this.tradeTab })
      .filter({ has: this.placeButton })
      .last();
    const root = this.root;
    this.specificationTab = root.getByTestId('tab-specification');
    this.buySide = root.getByTestId('trade-button-order-buy');
    this.sellSide = root.getByTestId('trade-button-order-sell');
    this.liveBid = root.getByTestId('trade-live-sell-price').first();
    this.liveAsk = root.getByTestId('trade-live-buy-price').first();
    this.orderType = root.getByTestId('trade-dropdown-order-type');
    this.volume = root.getByTestId('trade-input-volume').first();
    this.units = root.getByTestId('trade-volume-info-min-value').first();
    this.stopLossPrice = root.getByTestId('trade-input-stoploss-price');
    this.stopLossPoints = root.getByTestId('trade-input-stoploss-points');
    this.takeProfitPrice = root.getByTestId('trade-input-takeprofit-price');
    this.takeProfitPoints = root.getByTestId('trade-input-takeprofit-points');
    this.price = root.locator('input[name="price"]');
    this.stopLimitPrice = root.locator('input[name="priceTrigger"]');
    this.expiry = root.getByTestId('trade-dropdown-expiry');
    this.expiryDate = root.getByTestId('trade-input-expiry-date');
    this.expiryTime = root.getByTestId('trade-input-expiry-time');
    // The calendar opens in a layer outside the panel.
    this.expiryCalendar = page.locator('.react-calendar');
    this.fillPolicy = root.getByTestId('trade-dropdown-fill-policy');
    this.onePointEquals = root.getByTestId('trade-one-point-equal-label');
    this.tradeDetailsHeader = root.getByTestId('trade-details').getByText(/^Trade Details/);
    this.validation = root.getByText(VALIDATION_TEXT);
    this.confirmation = new TradeConfirmation(page);
    this.serverTime = page.getByText(SERVER_TIME);
  }

  /** Shows the "Trade" form (One-Click Trading opens the panel on its own tab). */
  async openTradeForm(): Promise<void> {
    await this.tradeTab.click();
    await expect(this.orderType).toBeVisible();
  }

  /** Current Bid/Ask shown on the panel. */
  async quote(): Promise<Quote> {
    if (!(await this.liveAsk.isVisible())) await this.openTradeForm();
    const [bid, ask] = await Promise.all([this.liveBid.innerText(), this.liveAsk.innerText()]);
    return { bid: requireUiNumber(bid, 'Bid'), ask: requireUiNumber(ask, 'Ask') };
  }

  async chooseSide(side: Side): Promise<void> {
    await (side === 'BUY' ? this.buySide : this.sellSide).click();
    // The side is only visible as a colour, except on the place button while the market is open.
    if (!(await this.isMarketClosed())) {
      await expect(this.placeButton).toHaveText(new RegExp(side, 'i'));
    }
  }

  async selectOrderType(type: OrderType): Promise<void> {
    await chooseOption(this.orderType, type);
  }

  /** Picks an expiry; see {@link pickExpiry}. */
  async selectExpiry(expiry: Expiry, expiresAt?: Date): Promise<void> {
    const inputs = { dropdown: this.expiry, date: this.expiryDate, time: this.expiryTime };
    await pickExpiry(this.page, inputs, expiry, expiresAt);
  }

  /** True when the place button says the market is closed. */
  async isMarketClosed(): Promise<boolean> {
    return /market closed/i.test(await this.placeButton.innerText());
  }

  /** Validation messages currently shown under the panel's inputs. */
  async validationMessages(): Promise<string[]> {
    return (await this.validation.allInnerTexts()).map((t) => t.trim());
  }

  /**
   * Opens a dropdown (Order Type, Fill Policy or Expiry, in the order panel or the Edit Order
   * dialog), checks that it lists exactly `expected`, in order, and closes it again.
   */
  async expectDropdownOptions(dropdown: Locator, expected: readonly string[]): Promise<void> {
    // While open, the dropdown holds its trigger followed by one entry per option.
    const entries = dropdown.locator('[tabindex="0"]');
    await dropdown.click();
    // Options can arrive late: until the symbol's details have loaded, Expiry lists only its
    // default (seen on CI). So read it until it matches.
    await expect
      .poll(async () => (await entries.allInnerTexts()).slice(1).map((t) => t.trim()), {
        message: 'the dropdown should list exactly the expected options',
      })
      .toEqual(expected);
    await entries.first().click();
    await expect(entries).toHaveCount(1);
  }

  /**
   * Types a number into an input (`undefined` clears it), commits it with blur and reads it back,
   * typing it again if it did not stick: the panel resets its form when a symbol's details arrive,
   * which can be just after the header already shows the new symbol.
   */
  async setNumber(input: Locator, value: number | undefined): Promise<void> {
    await expect(async () => {
      await input.fill(value === undefined ? '' : String(value));
      await input.blur();
      const kept = await input.inputValue();
      expect(value === undefined ? kept : Number(kept), 'the field should keep the value').toBe(
        value ?? '',
      );
    }).toPass({ timeout: 10_000 });
  }

  /**
   * Clears the input and types raw text key by key, as a user would, then commits it with blur.
   * For invalid-input checks: the inputs drop keys they do not accept, while `fill()` with a whole
   * invalid string is ignored and leaves the old value.
   */
  async typeText(input: Locator, text: string): Promise<void> {
    await input.fill('');
    await input.pressSequentially(text);
    await input.blur();
  }

  /** Fills the Market form without placing the order. */
  async fillMarketOrder(order: MarketOrderInput): Promise<void> {
    await this.fillUntilKept('Market', order, async () => {
      await this.setNumber(this.volume, order.volume);
      await this.setNumber(this.stopLossPrice, order.stopLoss);
      await this.setNumber(this.takeProfitPrice, order.takeProfit);
    });
  }

  /** Fills a Limit / Stop / Stop Limit form without placing the order. */
  async fillPendingOrder(order: PendingOrderInput): Promise<void> {
    if ((order.type === 'Stop Limit') !== (order.stopLimitPrice !== undefined)) {
      throw new Error('stopLimitPrice is required for Stop Limit orders and only for them');
    }
    const expiry = order.expiry ?? 'Good Till Canceled';
    await this.fillUntilKept(order.type, order, async () => {
      await this.setNumber(this.volume, order.volume);
      // SL/TP are checked against the order price, so the price goes in first.
      await this.setNumber(this.price, order.price);
      if (order.stopLimitPrice !== undefined) {
        await this.setNumber(this.stopLimitPrice, order.stopLimitPrice);
      }
      await this.setNumber(this.stopLossPrice, order.stopLoss);
      await this.setNumber(this.takeProfitPrice, order.takeProfit);
      await this.selectExpiry(expiry, order.expiresAt);
    });
    await expect(this.expiry).toHaveText(expiry);
  }

  /**
   * Fills the Market form and places the order, confirming the dialog if one is shown (it is not
   * when One-Click Trading is on). Resolves once the server accepted the order.
   */
  async placeMarketOrder(order: MarketOrderInput): Promise<void> {
    await this.fillMarketOrder(order);
    await this.submit('market');
  }

  /** Same as {@link placeMarketOrder} for Limit / Stop / Stop Limit orders. */
  async placePendingOrder(order: PendingOrderInput): Promise<void> {
    await this.fillPendingOrder(order);
    await this.submit('pending');
  }

  /** Reads the "Trade Details" block, opening it if it is collapsed. */
  async tradeDetails(): Promise<TradeDetails> {
    const value = (id: string): Locator => this.root.getByTestId(`trade-details-${id}`);
    if (!(await value('trade-size').isVisible())) await this.tradeDetailsHeader.click();
    await expect(value('trade-size')).toBeVisible();
    const read = async (id: string): Promise<number | null> =>
      parseUiNumber(await value(id).innerText());
    return {
      tradeVolume: await read('trade-size'),
      marginRequired: await read('margin-required'),
      amountPerTick: await read('amount-per-tick'),
      potentialLoss: await read('potential-loss'),
      potentialGain: await read('potential-gain'),
      riskReward: await read('risk-reward'),
    };
  }

  /** Trading hours from the Specification tab (leaves the panel on that tab). */
  async tradingHours(): Promise<TradingHours> {
    await this.specificationTab.click();
    const rows = this.page.getByTestId('specification-trading-hours-session');
    await expect(rows.first()).toBeVisible();
    const days = await rows
      .getByTestId('specification-trading-hours-session-label')
      .allInnerTexts();
    const hours = await rows
      .getByTestId('specification-trading-hours-session-value')
      .allInnerTexts();
    return {
      timeZone: (
        await this.page.getByTestId('specification-trading-hours-time-display-value').innerText()
      ).trim(),
      sessions: days.map((day, i) => ({ day: day.trim(), hours: (hours[i] ?? '').trim() })),
    };
  }

  /** Server clock minus UTC, from the top bar clock (rounded to a quarter hour). */
  async serverTimeOffsetMs(): Promise<number> {
    return serverClockOffsetMs(this.page);
  }

  /**
   * Opens the Trade form, picks the order type and side, runs `fillFields`, then reads the whole
   * form back. Switching One-Click Trading on or off, from any session of the account, resets the
   * form to an empty Market order (seen 2026-11-08), so the form is filled again until it holds.
   */
  private async fillUntilKept(
    type: OrderType,
    order: MarketOrderInput & { price?: number; stopLimitPrice?: number },
    fillFields: () => Promise<void>,
  ): Promise<void> {
    const kept = async (input: Locator): Promise<number | null> => {
      const value = await input.inputValue();
      return value === '' ? null : Number(value);
    };
    await expect(async () => {
      await this.openTradeForm();
      await this.selectOrderType(type);
      await this.chooseSide(order.side);
      await fillFields();
      expect((await this.orderType.innerText()).trim()).toBe(type);
      expect(await kept(this.volume)).toBe(order.volume);
      if (order.price !== undefined) expect(await kept(this.price)).toBe(order.price);
      if (order.stopLimitPrice !== undefined) {
        expect(await kept(this.stopLimitPrice)).toBe(order.stopLimitPrice);
      }
      expect(await kept(this.stopLossPrice)).toBe(order.stopLoss ?? null);
      expect(await kept(this.takeProfitPrice)).toBe(order.takeProfit ?? null);
    }).toPass({ timeout: 60_000 });
  }

  /**
   * Clicks the place button and confirms the dialog when it is shown (One-Click Trading sends the
   * order at once). Resolves once the server accepted the order; throws `OrderRejectedError`
   * otherwise (see {@link submitTradeRequest}).
   */
  private async submit(kind: 'market' | 'pending'): Promise<void> {
    await expect(this.placeButton, 'the place button should be enabled').toBeEnabled();
    this.lastConfirmation = null;
    const path = kind === 'market' ? TRADE_API.marketOrder : TRADE_API.pendingOrder;
    try {
      await submitTradeRequest(this.page, {
        action: `Placing the ${kind} order`,
        trigger: this.placeButton,
        confirm: this.confirmation.confirmButton,
        completeDialog: async () => {
          this.lastConfirmation = await this.confirmation.read();
          await this.confirmation.confirm();
        },
        matches: (r) => r.method() === 'POST' && new URL(r.url()).pathname === path,
        errors: this.validation,
      });
    } catch (error) {
      // Leave the form usable for the next step of the test; the refusal is what gets reported.
      if (await this.confirmation.isOpen()) await this.confirmation.cancel().catch(() => undefined);
      throw error;
    }
    if (this.lastConfirmation) await expect(this.confirmation.confirmButton).toBeHidden();
  }
}
