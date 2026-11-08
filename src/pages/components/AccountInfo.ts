import { expect, type Locator, type Page } from '@playwright/test';
import { parseUiNumber } from '../../helpers/numbers';

/** Shown in place of a figure until the account's figures have loaded (seen on CI). */
const NOT_LOADED = /^\*+$/;

/** Every figure of the account dropdown ("Account Information"), as numbers. */
export interface AccountSummary {
  balance: number;
  equity: number;
  freeMargin: number;
  /** "Margin Used". */
  margin: number;
  profitLoss: number;
  /** Percent; the demo shows `0.00%` (not "--") while no margin is used. */
  marginLevel: number | null;
  /** Percent, e.g. 70. */
  stopOutLevel: number | null;
  marginCallLevel: number | null;
}

/**
 * Account summary in the header: DEMO badge (`account-type-tag`), equity, profit/loss and margin
 * level, plus the account dropdown (`account-info` toggles `account-info-dropdown`, Escape does
 * not close it) with Equity, Profit/Loss, Free Margin, Margin Level, Account Balance, Margin
 * Used, Stop Out Level and Margin Call Level. Amounts read like `$1,000,000.00`.
 * Owner: records work (R6, R7).
 */
export class AccountInfo {
  readonly typeTag: Locator;
  readonly header: Locator;
  readonly equity: Locator;
  readonly profitLoss: Locator;
  readonly marginLevel: Locator;
  readonly dropdown: Locator;

  constructor(protected readonly page: Page) {
    this.typeTag = page.getByTestId('account-type-tag');
    this.header = page.getByTestId('account-info');
    // Scoped to the header: the dropdown repeats these test ids.
    this.equity = this.header.getByTestId('account-info-equity-value');
    this.profitLoss = this.header.getByTestId('account-info-profit-loss-value');
    this.marginLevel = this.header.getByTestId('account-info-margin-level-value');
    this.dropdown = page.getByTestId('account-info-dropdown');
  }

  /** Equity, profit/loss and margin level as shown in the header. */
  async headerFigures(): Promise<{
    equity: number;
    profitLoss: number;
    marginLevel: number | null;
  }> {
    return {
      equity: await readAmount(this.equity, 'header equity'),
      profitLoss: await readAmount(this.profitLoss, 'header profit/loss'),
      marginLevel: await readOptionalAmount(this.marginLevel, 'header margin level'),
    };
  }

  /** Balance, equity, free margin and the other dropdown figures, as numbers. */
  async summary(): Promise<AccountSummary> {
    await this.openDropdown();
    try {
      const field = (id: string) => this.dropdown.getByTestId(`account-info-${id}-value`);
      return {
        balance: await readAmount(field('balance'), 'balance'),
        equity: await readAmount(field('equity'), 'equity'),
        freeMargin: await readAmount(field('free-margin'), 'free margin'),
        margin: await readAmount(field('margin'), 'margin used'),
        profitLoss: await readAmount(field('profit-loss'), 'profit/loss'),
        marginLevel: await readOptionalAmount(field('margin-level'), 'margin level'),
        stopOutLevel: await readOptionalAmount(field('stop-out-level'), 'stop out level'),
        marginCallLevel: await readOptionalAmount(field('margin-call-level'), 'margin call level'),
      };
    } finally {
      await this.closeDropdown();
    }
  }

  async openDropdown(): Promise<void> {
    if (!(await this.dropdown.isVisible())) await this.header.click();
    await expect(this.dropdown).toBeVisible();
  }

  async closeDropdown(): Promise<void> {
    if (await this.dropdown.isVisible()) await this.header.click();
    await expect(this.dropdown).toBeHidden();
  }
}

/** Parses `$1,000,000.00`, `-$5.20`, `$-5.20` or `0.00%`; the currency sign is dropped first. */
function parseAmount(text: string): number | null {
  return parseUiNumber(text.replace(/[$€£¥]/g, ''));
}

function requireAmount(text: string, what: string): number {
  const value = parseAmount(text);
  if (value === null) throw new Error(`Expected an amount for ${what}, got "${text}"`);
  return value;
}

/** Reads an amount once the UI shows one. */
async function readAmount(field: Locator, what: string): Promise<number> {
  await expect(field, `${what} should show an amount`).toHaveText(/\d/);
  return requireAmount(await field.innerText(), what);
}

/** Reads a figure that may be empty or `--` (then null), once it has loaded. */
async function readOptionalAmount(field: Locator, what: string): Promise<number | null> {
  await expect(field, `${what} should have loaded`).not.toHaveText(NOT_LOADED);
  return parseAmount(await field.innerText());
}
