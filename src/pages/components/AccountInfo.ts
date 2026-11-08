import { expect, type Locator, type Page } from '@playwright/test';
import { parseUiNumber } from '../../helpers/numbers';

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
      equity: requireAmount(await this.equity.innerText(), 'header equity'),
      profitLoss: requireAmount(await this.profitLoss.innerText(), 'header profit/loss'),
      marginLevel: parseAmount(await this.marginLevel.innerText()),
    };
  }

  /** Balance, equity, free margin and the other dropdown figures, as numbers. */
  async summary(): Promise<AccountSummary> {
    await this.openDropdown();
    try {
      const value = async (id: string) =>
        (await this.dropdown.getByTestId(`account-info-${id}-value`).innerText()).trim();
      return {
        balance: requireAmount(await value('balance'), 'balance'),
        equity: requireAmount(await value('equity'), 'equity'),
        freeMargin: requireAmount(await value('free-margin'), 'free margin'),
        margin: requireAmount(await value('margin'), 'margin used'),
        profitLoss: requireAmount(await value('profit-loss'), 'profit/loss'),
        marginLevel: parseAmount(await value('margin-level')),
        stopOutLevel: parseAmount(await value('stop-out-level')),
        marginCallLevel: parseAmount(await value('margin-call-level')),
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
