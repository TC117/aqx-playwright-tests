import type { Page } from '@playwright/test';

/** Shared behaviour for all page objects. */
export abstract class BasePage {
  /** URL path of the page, relative to `baseURL`. */
  protected abstract readonly path: string;

  protected constructor(protected readonly page: Page) {}

  /** Navigates to the page and waits until it is ready to use. */
  async open(): Promise<void> {
    await this.page.goto(this.path);
    await this.waitUntilLoaded();
  }

  /** Waits for the element that proves the page has rendered and is usable. */
  abstract waitUntilLoaded(): Promise<void>;
}
