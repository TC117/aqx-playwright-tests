import { expect, type Locator, type Page } from '@playwright/test';
import { exactly } from '../../helpers/text';

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
    // Type key by key: the dropdown filters on input events. The box sometimes drops a keystroke
    // while it re-renders, so retype until it holds exactly the symbol.
    await expect(async () => {
      await this.input.fill('');
      await this.input.pressSequentially(symbol, { delay: 30 });
      await expect(this.input).toHaveValue(symbol, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await this.results
      .filter({ hasText: exactly(symbol) })
      .first()
      .click();
  }
}
