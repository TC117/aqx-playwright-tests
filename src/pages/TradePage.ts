import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { AccountInfo } from './components/AccountInfo';
import { BulkActions } from './components/BulkActions';
import { Notifications } from './components/Notifications';
import { OneClickTrading } from './components/OneClickTrading';
import { OpenPositions } from './components/OpenPositions';
import { OrderPanel } from './components/OrderPanel';
import { PendingOrders } from './components/PendingOrders';
import { SymbolSearch } from './components/SymbolSearch';
import { TradeHistory } from './components/TradeHistory';

/**
 * The web trader's main screen (`/web/trade`): symbol header, order panel on the right and the
 * assets module (positions, pending orders, history) at the bottom. Each area is a component.
 */
export class TradePage extends BasePage {
  protected readonly path = '/web/trade';

  /** Header showing the selected symbol, e.g. `EURUSD`. */
  readonly selectedSymbol: Locator;
  readonly symbolSearch: SymbolSearch;
  readonly orderPanel: OrderPanel;
  readonly oneClick: OneClickTrading;
  readonly openPositions: OpenPositions;
  readonly pendingOrders: PendingOrders;
  readonly bulk: BulkActions;
  readonly history: TradeHistory;
  readonly notifications: Notifications;
  readonly account: AccountInfo;

  constructor(page: Page) {
    super(page);
    this.selectedSymbol = page.getByTestId('symbol-overview-id').first();
    this.symbolSearch = new SymbolSearch(page);
    this.orderPanel = new OrderPanel(page);
    this.oneClick = new OneClickTrading(page);
    this.openPositions = new OpenPositions(page);
    this.pendingOrders = new PendingOrders(page);
    this.bulk = new BulkActions(page);
    this.history = new TradeHistory(page);
    this.notifications = new Notifications(page);
    this.account = new AccountInfo(page);
  }

  /**
   * Opens the trade screen and waits until the order panel has loaded the symbol's specification.
   * The panel resets its form when that answer arrives, so anything typed earlier would be lost.
   */
  override async open(): Promise<void> {
    const specLoaded = this.page.waitForResponse((r) => isSymbolDetail(r.url()));
    await super.open();
    await specLoaded;
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.selectedSymbol).not.toBeEmpty();
  }

  /** Makes `symbol` the active instrument (no-op when it already is). */
  async selectSymbol(symbol: string): Promise<void> {
    if ((await this.selectedSymbol.textContent())?.trim() === symbol) return;
    // The header can show the new symbol before the panel has reset for it; wait for the reset.
    const specLoaded = this.page.waitForResponse((r) => isSymbolDetail(r.url(), symbol));
    await this.symbolSearch.select(symbol);
    await expect(this.selectedSymbol).toHaveText(symbol);
    await specLoaded;
  }
}

/** True for the order panel's symbol specification request (for `symbol`, when given). */
function isSymbolDetail(url: string, symbol?: string): boolean {
  const { pathname, searchParams } = new URL(url);
  return (
    pathname === '/api/market/v1/symbol/detail' &&
    (symbol === undefined || searchParams.get('symbol') === symbol)
  );
}
