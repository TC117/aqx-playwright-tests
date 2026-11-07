import type { Locator, Page } from '@playwright/test';
import { notImplemented } from './notImplemented';

/**
 * One-Click Trading: the switch in the settings menu (gear icon) and the One-Click panel tab.
 *
 * Verified with the market closed: `app-setting-dropdown-trigger` opens the menu; the switch is
 * `toggle-oct` while off and `toggle-oct-checked` while on. Switching it on opens a "Terms and
 * Conditions" dialog with CANCEL and AGREE AND CONTINUE buttons. The setting is stored on the
 * server for the whole account, so tests must restore it.
 * Owner: One-Click work (R2).
 */
export class OneClickTrading {
  readonly settingsTrigger: Locator;
  readonly switchOff: Locator;
  readonly switchOn: Locator;
  readonly termsDialog: Locator;
  readonly panelTab: Locator;
  readonly buyButton: Locator;
  readonly sellButton: Locator;

  constructor(protected readonly page: Page) {
    this.settingsTrigger = page.getByTestId('app-setting-dropdown-trigger');
    this.switchOff = page.getByTestId('toggle-oct');
    this.switchOn = page.getByTestId('toggle-oct-checked');
    this.termsDialog = page.getByRole('dialog').filter({ hasText: 'Terms and Conditions' });
    this.panelTab = page.getByTestId('tab-one-click-trading');
    this.buyButton = page.getByTestId('trade-button-oct-order-buy');
    this.sellButton = page.getByTestId('trade-button-oct-order-sell');
  }

  async isEnabled(): Promise<boolean> {
    return notImplemented('OneClickTrading.isEnabled');
  }

  /** Turns One-Click Trading on, accepting the terms dialog. No-op when already on. */
  async enable(): Promise<void> {
    return notImplemented('OneClickTrading.enable');
  }

  /** Turns One-Click Trading off. No-op when already off. */
  async disable(): Promise<void> {
    return notImplemented('OneClickTrading.disable');
  }

  /** Places a market order from the One-Click panel (executes immediately, no confirmation). */
  async buy(_volume: number): Promise<void> {
    return notImplemented('OneClickTrading.buy');
  }

  async sell(_volume: number): Promise<void> {
    return notImplemented('OneClickTrading.sell');
  }
}
