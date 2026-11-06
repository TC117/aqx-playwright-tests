import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Web trader sign-in page.
 *
 * Locators are accessibility-first and intentionally generic for now; they will be
 * tightened once the demo web trader UI has been explored.
 */
export class LoginPage extends BasePage {
  protected readonly path = '/';

  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByRole('textbox', { name: /user|email|login|account/i });
    this.passwordInput = page.locator('input[type="password"]');
    this.signInButton = page.getByRole('button', { name: /sign in|log in|login/i });
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.passwordInput).toBeVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}
