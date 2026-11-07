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

  async waitUntilLoaded(): Promise<void> {
    await expect(this.selectedSymbol).not.toBeEmpty();
  }

  /** Makes `symbol` the active instrument (no-op when it already is). */
  async selectSymbol(symbol: string): Promise<void> {
    if ((await this.selectedSymbol.textContent())?.trim() === symbol) return;
    await this.symbolSearch.select(symbol);
    await expect(this.selectedSymbol).toHaveText(symbol);
  }
}
