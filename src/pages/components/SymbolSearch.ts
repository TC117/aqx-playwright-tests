import type { Locator, Page } from '@playwright/test';

/** Symbol search box in the header. Results appear in a dropdown while typing. */
export class SymbolSearch {
  readonly input: Locator;
  readonly results: Locator;

  constructor(page: Page) {
    this.input = page.getByTestId('symbol-input-search');
    this.results = page.getByTestId('symbol-input-search-items-symbol');
  }

  /** Searches for `symbol` and picks the result whose name matches it exactly. */
  async select(symbol: string): Promise<void> {
    await this.input.click();
    await this.input.fill('');
    // Type key by key: the dropdown filters on input events.
    await this.input.pressSequentially(symbol, { delay: 30 });
    await this.results
      .filter({ hasText: new RegExp(`^${symbol}$`) })
      .first()
      .click();
  }
}
