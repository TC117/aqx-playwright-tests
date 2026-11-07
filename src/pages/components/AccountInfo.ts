import type { Locator, Page } from '@playwright/test';
import { notImplemented } from './notImplemented';

/**
 * Account summary in the header: DEMO badge (`account-type-tag`), equity, profit/loss and margin
 * level, plus the account dropdown (`account-info`) with balance and free margin.
 * Owner: records work (R6, R7).
 */
export class AccountInfo {
  readonly typeTag: Locator;
  readonly equity: Locator;
  readonly profitLoss: Locator;
  readonly marginLevel: Locator;

  constructor(protected readonly page: Page) {
    this.typeTag = page.getByTestId('account-type-tag');
    this.equity = page.getByTestId('account-info-equity-value');
    this.profitLoss = page.getByTestId('account-info-profit-loss-value');
    this.marginLevel = page.getByTestId('account-info-margin-level-value');
  }

  /** Balance, equity and free margin as numbers. */
  async summary(): Promise<{ balance: number; equity: number; freeMargin: number }> {
    return notImplemented('AccountInfo.summary');
  }
}
