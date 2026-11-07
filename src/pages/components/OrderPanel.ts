import type { Locator, Page } from '@playwright/test';
import type {
  Expiry,
  MarketOrderInput,
  OrderType,
  PendingOrderInput,
  Quote,
  Side,
} from '../../models/trading';
import { notImplemented } from './notImplemented';

/**
 * Order panel ("Trade" tab) on the right of the trade screen.
 *
 * Verified on the live demo with the market closed: every locator below exists. The place button
 * reads "Market Closed" and is disabled while the symbol's market is closed.
 * Owner: order-entry work (R1, R3).
 */
export class OrderPanel {
  readonly tradeTab: Locator;
  readonly buySide: Locator;
  readonly sellSide: Locator;
  /** Bid (the SELL price). */
  readonly liveBid: Locator;
  /** Ask (the BUY price). */
  readonly liveAsk: Locator;
  readonly orderType: Locator;
  readonly volume: Locator;
  readonly stopLossPrice: Locator;
  readonly stopLossPoints: Locator;
  readonly takeProfitPrice: Locator;
  readonly takeProfitPoints: Locator;
  /** Order price of Limit / Stop orders (no test id on this input). */
  readonly price: Locator;
  readonly expiry: Locator;
  readonly fillPolicy: Locator;
  readonly onePointEquals: Locator;
  readonly placeButton: Locator;

  constructor(protected readonly page: Page) {
    this.tradeTab = page.getByTestId('tab-trade');
    this.buySide = page.getByTestId('trade-button-order-buy');
    this.sellSide = page.getByTestId('trade-button-order-sell');
    this.liveBid = page.getByTestId('trade-live-sell-price').first();
    this.liveAsk = page.getByTestId('trade-live-buy-price').first();
    this.orderType = page.getByTestId('trade-dropdown-order-type');
    this.volume = page.getByTestId('trade-input-volume').first();
    this.stopLossPrice = page.getByTestId('trade-input-stoploss-price');
    this.stopLossPoints = page.getByTestId('trade-input-stoploss-points');
    this.takeProfitPrice = page.getByTestId('trade-input-takeprofit-price');
    this.takeProfitPoints = page.getByTestId('trade-input-takeprofit-points');
    this.price = page.locator('input[name="price"]');
    this.expiry = page.getByTestId('trade-dropdown-expiry');
    this.fillPolicy = page.getByTestId('trade-dropdown-fill-policy');
    this.onePointEquals = page.getByTestId('trade-one-point-equal-label');
    this.placeButton = page.getByTestId('trade-button-order');
  }

  /** Current Bid/Ask shown on the panel. */
  async quote(): Promise<Quote> {
    return notImplemented('OrderPanel.quote');
  }

  async chooseSide(_side: Side): Promise<void> {
    return notImplemented('OrderPanel.chooseSide');
  }

  async selectOrderType(_type: OrderType): Promise<void> {
    return notImplemented('OrderPanel.selectOrderType');
  }

  async selectExpiry(_expiry: Expiry, _expiresAt?: Date): Promise<void> {
    return notImplemented('OrderPanel.selectExpiry');
  }

  /** True when the place button says the market is closed. */
  async isMarketClosed(): Promise<boolean> {
    return notImplemented('OrderPanel.isMarketClosed');
  }

  /** Validation messages currently shown under the panel's inputs. */
  async validationMessages(): Promise<string[]> {
    return notImplemented('OrderPanel.validationMessages');
  }

  /**
   * Fills the Market form and places the order, confirming the dialog if one is shown (it is not
   * when One-Click Trading is on). Resolves once the server accepted the order.
   */
  async placeMarketOrder(_order: MarketOrderInput): Promise<void> {
    return notImplemented('OrderPanel.placeMarketOrder');
  }

  /** Same as {@link placeMarketOrder} for Limit / Stop / Stop Limit orders. */
  async placePendingOrder(_order: PendingOrderInput): Promise<void> {
    return notImplemented('OrderPanel.placePendingOrder');
  }
}
