import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Runs in the browser. Sets an input's value and fires the events typing would fire, using the
 * native setter so React, which tracks input values itself, sees the change.
 */
function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Web trader sign-in page. Opened from the site root (`BASE_URL`), which redirects to `/web/login`.
 *
 * The app tags its controls with `data-testid`, so locators use `getByTestId`.
 * Only the Demo account type is offered, and LOG IN stays disabled until both fields are filled.
 */
export class LoginPage extends BasePage {
  protected readonly path = '/';

  readonly demoTab: Locator;
  readonly accountIdInput: Locator;
  readonly passwordInput: Locator;
  readonly logInButton: Locator;

  private closed = false;

  constructor(page: Page) {
    super(page);
    this.demoTab = page.getByTestId('tab-login-account-type-demo');
    this.accountIdInput = page.getByTestId('login-user-id');
    this.passwordInput = page.getByTestId('login-password');
    this.logInButton = page.getByTestId('login-submit');
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.accountIdInput).toBeVisible();
  }

  /** Fills and submits the form; resolves with the login API response (`/api/auth/.../login`). */
  async submit(accountId: string, password: string): Promise<Response> {
    await this.demoTab.click();
    await this.accountIdInput.fill(accountId);
    await this.enterPassword(password);

    const loginResponse = this.page.waitForResponse(
      (res) => res.request().method() === 'POST' && /\/api\/auth\/.+\/login$/.test(res.url()),
    );
    await this.logInButton.click();
    return loginResponse;
  }

  /** Logs in, failing fast with the server's reason (e.g. "Metatrader Invalid Login") if rejected. */
  async login(accountId: string, password: string): Promise<void> {
    const response = await this.submit(accountId, password);
    // Read the body only on failure: a successful response carries the session token.
    if (!response.ok()) {
      throw new Error(`Login API responded ${response.status()}: ${await response.text()}`);
    }
  }

  /**
   * Puts the password in the field without Playwright recording it. `fill()` and the keyboard
   * APIs write the typed text into the HTML report's step titles and into error logs; a value
   * passed to `evaluate()` appears in neither.
   */
  async enterPassword(password: string): Promise<void> {
    // What fill() waits for before typing: a visible, editable field.
    await expect(this.passwordInput).toBeVisible();
    await expect(this.passwordInput).toBeEditable();
    await this.passwordInput.focus();
    if (this.closed) throw new Error('LoginPage is closed: the test has already ended');
    await this.passwordInput.evaluate(setInputValue, password);
  }

  /**
   * Empties the password field (also while a show-password toggle makes it plain text) and any
   * other password input, so a page snapshot in the failure report cannot show it.
   */
  async clearPassword(): Promise<void> {
    const inputs = [
      ...(await this.passwordInput.all()),
      ...(await this.page.locator('input[type="password"]').all()),
    ];
    for (const input of inputs) {
      await input.evaluate(setInputValue, '');
    }
  }

  /** Called by the fixture when the test ends. Blocks enterPassword() from then on. */
  close(): void {
    this.closed = true;
  }
}
