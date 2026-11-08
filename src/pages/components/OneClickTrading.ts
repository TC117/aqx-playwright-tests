import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { requireUiNumber } from '../../helpers/numbers';
import type { Quote, Side } from '../../models/trading';
import { TRADE_API } from './tradeRequests';

/** Endpoint the web trader uses to save a user preference (One-Click Trading among them). */
const PREFERENCE_API = '/api/user/setting/v1/preference';
/**
 * Endpoint every market order is sent to, from the One-Click panel and from the Trade form. Same
 * as `TRADE_API.marketOrder`; kept under this name for the specs that import it.
 */
export const MARKET_ORDER_API = TRADE_API.marketOrder;

const isPreferenceWrite = (r: Response): boolean =>
  r.request().method() === 'PATCH' && new URL(r.url()).pathname === PREFERENCE_API;

const isMarketOrder = (r: Request): boolean =>
  r.method() === 'POST' && new URL(r.url()).pathname === MARKET_ORDER_API;

/**
 * One-Click Trading: the switch in the settings menu (gear icon) and the "One Click" panel tab.
 *
 * Verified on the live demo:
 * - `app-setting-dropdown-trigger` opens the settings menu; the switch is `toggle-oct` while off
 *   and `toggle-oct-checked` while on.
 * - Switching it on opens the "One-Click Trading" dialog (Terms and Conditions) with CANCEL and
 *   AGREE AND CONTINUE. It is shown on every activation, not only the first one. Agreeing closes
 *   the menu, saves `OCT_ENABLE=true` on the server (PATCH /api/user/setting/v1/preference),
 *   shows the toast "One-Click Trading activated." and adds a "One Click" tab
 *   (`tab-one-click-trading`) before Trade / Specification, already selected.
 * - Switching it off needs no dialog and shows no toast; the menu stays open, the tab disappears
 *   and the Trade form comes back.
 * - The One Click panel holds a Volume input (`trade-input-volume`, in lots) and BUY / SELL
 *   buttons labelled with the live Ask / Bid. While the market is closed the two buttons are
 *   replaced by one disabled "Market Closed" button (`trade-button-order`).
 * - The setting is stored on the server for the whole account, so tests must switch it off again.
 * Owner: One-Click work (R2).
 */
export class OneClickTrading {
  readonly settingsTrigger: Locator;
  readonly switchOff: Locator;
  readonly switchOn: Locator;
  readonly termsDialog: Locator;
  readonly agreeButton: Locator;
  readonly cancelButton: Locator;
  readonly panelTab: Locator;
  /** Volume (lots) of the One Click panel. Only one panel is rendered at a time. */
  readonly volume: Locator;
  /** BUY button; its label carries the live Ask. */
  readonly buyButton: Locator;
  /** SELL button; its label carries the live Bid. */
  readonly sellButton: Locator;
  /** Disabled button shown instead of BUY / SELL while the market is closed. */
  readonly marketClosedButton: Locator;

  constructor(protected readonly page: Page) {
    this.settingsTrigger = page.getByTestId('app-setting-dropdown-trigger');
    this.switchOff = page.getByTestId('toggle-oct');
    this.switchOn = page.getByTestId('toggle-oct-checked');
    this.termsDialog = page.getByRole('dialog', { name: 'One-Click Trading' });
    this.agreeButton = this.termsDialog.getByRole('button', { name: /agree and continue/i });
    this.cancelButton = this.termsDialog.getByRole('button', { name: /^cancel$/i });
    this.panelTab = page.getByTestId('tab-one-click-trading');
    this.volume = page.getByTestId('trade-input-volume');
    this.buyButton = page.getByTestId('trade-button-oct-order-buy');
    this.sellButton = page.getByTestId('trade-button-oct-order-sell');
    this.marketClosedButton = page.getByTestId('trade-button-order');
  }

  /** Opens the settings menu (no-op when it is already open). */
  async openSettings(): Promise<void> {
    await this.toggleSettingsUntil('open');
  }

  /** Closes the settings menu (no-op when it is closed). Escape does not close it. */
  async closeSettings(): Promise<void> {
    await this.toggleSettingsUntil('closed');
  }

  /**
   * The gear toggles the menu, and the menu re-renders for a moment after the switch changes, so
   * a single visibility check can be wrong: retry until the menu is in the wanted state.
   */
  private async toggleSettingsUntil(wanted: 'open' | 'closed'): Promise<void> {
    const sw = this.switchOff.or(this.switchOn);
    await expect(async () => {
      if ((await sw.isVisible()) !== (wanted === 'open')) await this.settingsTrigger.click();
      if (wanted === 'open') await expect(sw).toBeVisible({ timeout: 2_000 });
      else await expect(sw).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  }

  /** State of the switch in the settings menu. Leaves the menu closed. */
  async isEnabled(): Promise<boolean> {
    await this.openSettings();
    const on = await this.switchOn.isVisible();
    await this.closeSettings();
    return on;
  }

  /** Asserts what the switch in the settings menu shows. Leaves the menu closed. */
  async expectSwitch(state: 'on' | 'off'): Promise<void> {
    await this.openSettings();
    await expect(state === 'on' ? this.switchOn : this.switchOff).toBeVisible();
    await this.closeSettings();
  }

  /** Clicks the switch while off, which opens the terms dialog. */
  async requestEnable(): Promise<void> {
    await this.openSettings();
    await this.switchOff.click();
    await expect(this.termsDialog).toBeVisible();
  }

  /**
   * Turns One-Click Trading on, accepting the terms dialog, and resolves once the server saved it.
   * No-op when already on.
   */
  async enable(): Promise<void> {
    await this.openSettings();
    if (await this.switchOn.isVisible()) return this.closeSettings();
    await this.requestEnable();
    const saved = this.page.waitForResponse(isPreferenceWrite);
    await this.agreeButton.click();
    expect((await saved).ok(), 'the server should save the One-Click setting').toBe(true);
    await expect(this.termsDialog).toBeHidden();
    await expect(this.panelTab).toBeVisible();
    await this.closeSettings();
  }

  /** Turns One-Click Trading off and resolves once the server saved it. No-op when already off. */
  async disable(): Promise<void> {
    await this.openSettings();
    if (await this.switchOn.isVisible()) {
      const saved = this.page.waitForResponse(isPreferenceWrite);
      await this.switchOn.click();
      expect((await saved).ok(), 'the server should save the One-Click setting').toBe(true);
      await expect(this.switchOff).toBeVisible();
    }
    await this.closeSettings();
    await expect(this.panelTab).toBeHidden();
  }

  /** Selects the One Click tab of the order panel. */
  async openPanel(): Promise<void> {
    await this.panelTab.click();
    await expect(this.volume).toBeVisible();
  }

  /** Ask and Bid as labelled on the BUY / SELL buttons (market open only). */
  async quote(): Promise<Quote> {
    await expect(this.buyButton).toBeVisible();
    const [buy, sell] = await Promise.all([
      this.buyButton.innerText(),
      this.sellButton.innerText(),
    ]);
    return {
      ask: requireUiNumber(buy, 'One-Click Ask'),
      bid: requireUiNumber(sell, 'One-Click Bid'),
    };
  }

  /** Places a market order from the One-Click panel (executes immediately, no confirmation). */
  async buy(volume: number): Promise<void> {
    await this.place('BUY', volume);
  }

  async sell(volume: number): Promise<void> {
    await this.place('SELL', volume);
  }

  /**
   * Types the One-Click volume (lots). The panel resets its form once the selected symbol's details
   * arrive, which can wipe a value typed just before, so retype until the value holds.
   */
  async setVolume(volume: number): Promise<void> {
    await this.openPanel();
    await expect(async () => {
      await this.volume.fill(String(volume));
      await this.volume.blur();
      expect(Number(await this.volume.inputValue())).toBe(volume);
    }).toPass({ timeout: 15_000 });
  }

  /**
   * Sets the volume and clicks BUY or SELL. Resolves once the order request has been sent; the
   * outcome (toast, new position, error) is for the caller to check.
   */
  private async place(side: Side, volume: number): Promise<void> {
    await this.setVolume(volume);
    const sent = this.page.waitForRequest(isMarketOrder);
    await (side === 'BUY' ? this.buyButton : this.sellButton).click();
    await sent;
  }
}
