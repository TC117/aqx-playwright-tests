import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { BasePage } from './BasePage';

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
    await this.passwordInput.fill(password);

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
}
