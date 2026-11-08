import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { parseUiNumber } from '../../helpers/numbers';
import { exactly } from '../../helpers/text';
import type { OrderDealRow, PositionHistoryRow } from '../../models/trading';

/** Presets of the history date-range picker (`orders-date-picker-dropdown`). */
export type DateRangePreset =
  'All' | 'Last 7 days' | 'Last 30 days' | 'Last 90 days' | 'This year' | 'Last year';

/** A Positions History row with the money columns the shared model does not carry yet. */
export interface PositionHistoryRecord extends PositionHistoryRow {
  units: string;
  swap: number | null;
  commission: number | null;
  remarks: string;
  comment: string;
}

/** An Orders & Deals row: an order, or one of its deals once the order row is expanded. */
export interface OrderDealRecord extends OrderDealRow {
  kind: 'order' | 'deal';
  openDate: string;
  closeDate: string;
  units: string;
  fillPolicy: string;
  swap: number | null;
  commission: number | null;
  remarks: string;
}

type Cells = Record<string, string>;

type HistoryTab = 'positions' | 'ordersAndDeals';

/** A history tab, the list request it sends when opened, and what only its table shows. */
interface TabParts {
  tab: Locator;
  ownHeader: string;
  api: string;
  emptyState: Locator;
}

const HISTORIES_API = '/api/order/v3/histories';
const DEALS_API = '/api/trade/order/v1/deal/histories';

/**
 * Assets module > "Positions History" and "Orders & Deals" tabs.
 *
 * Verified: Positions History columns are Open Date, Symbol, Close Date, Order No., Type,
 * Profit/Loss, Volume, Units, Entry Price, Close Price, Take Profit, Stop Loss, Swap, Commission,
 * Remarks, Comment, Share (cells `asset-history-column-*`, rows `asset-history-position-list-item`).
 * A new demo account shows one BALANCE row for the initial deposit. Orders & Deals columns are
 * Open Date, Symbol, Close Date, Order No., Type, State, Volume, Units, Fill Policy, Entry Price,
 * Take Profit, Stop Loss, Profit/Loss, Swap, Commission, Remarks, Comment; empty state "You have
 * no orders & deals history." Empty Positions History: "You have no order histories."
 *
 * Both tables use the same row and cell test ids and only the open tab's table is rendered.
 * Orders & Deals lists orders; an order with deals has an expand button that adds its deals as
 * child rows (`data-row-id` "0.0" under "0"). Dates are shown in server time; the date range is
 * picked in device time.
 * Owner: records work (R6, R7).
 */
export class TradeHistory {
  readonly positionsHistoryTab: Locator;
  readonly ordersAndDealsTab: Locator;
  /** Rows of the open history table (Positions History or Orders & Deals). */
  readonly positionRows: Locator;
  readonly positionsEmptyState: Locator;
  readonly ordersAndDealsEmptyState: Locator;
  readonly columnHeaders: Locator;
  /** Button showing the selected range, e.g. `10/10/2026 - 08/11/2026`. */
  readonly dateRangeButton: Locator;
  readonly dateRangeMenu: Locator;

  private readonly tabs: Record<HistoryTab, TabParts>;

  constructor(protected readonly page: Page) {
    this.positionsHistoryTab = page.getByTestId('tab-asset-order-type-history-positions-history');
    this.ordersAndDealsTab = page.getByTestId('tab-asset-order-type-history-orders-and-deals');
    this.positionRows = page.getByTestId('asset-history-position-list-item');
    this.positionsEmptyState = page.getByText('You have no order histories.');
    this.ordersAndDealsEmptyState = page.getByText('You have no orders & deals history.');
    this.columnHeaders = page.getByRole('columnheader');
    this.dateRangeButton = page
      .getByRole('button')
      .filter({ has: page.getByTestId('orders-date-picker-icon-calendar') });
    this.dateRangeMenu = page.getByTestId('orders-date-picker-dropdown');
    this.tabs = {
      positions: {
        tab: this.positionsHistoryTab,
        ownHeader: 'Close Price',
        api: HISTORIES_API,
        emptyState: this.positionsEmptyState,
      },
      ordersAndDeals: {
        tab: this.ordersAndDealsTab,
        ownHeader: 'State',
        api: DEALS_API,
        emptyState: this.ordersAndDealsEmptyState,
      },
    };
  }

  /** Opens Positions History and waits until the server's answer is rendered. */
  async openPositionsHistory(): Promise<void> {
    await this.openTab('positions');
  }

  /** Opens Orders & Deals and waits until the server's answer is rendered. */
  async openOrdersAndDeals(): Promise<void> {
    await this.openTab('ordersAndDeals');
  }

  /** Header texts of the open history table, without the unnamed expand/share columns. */
  async headers(): Promise<string[]> {
    const texts = await this.columnHeaders.allInnerTexts();
    return texts.map((t) => t.trim()).filter(Boolean);
  }

  /**
   * Picks a preset in the date-range picker of the open tab and waits for the new list.
   * Resolves with the history request the UI sent, so callers can check the requested period.
   */
  async selectDateRange(preset: DateRangePreset): Promise<{ from: number; to: number }> {
    const request = this.page.waitForResponse(
      (r) => isHistoryRequest(r, HISTORIES_API) || isHistoryRequest(r, DEALS_API),
    );
    await this.dateRangeButton.click();
    await expect(this.dateRangeMenu).toBeVisible();
    await this.dateRangeMenu.getByText(preset, { exact: true }).click();
    await this.page.getByTestId('orders-date-picker-button-apply').click();
    const params = new URL((await request).url()).searchParams;
    await expect(this.dateRangeMenu).toBeHidden();
    return { from: Number(params.get('from')), to: Number(params.get('to')) };
  }

  /** Rows (of the open table) whose Order No. is `orderId`. */
  row(orderId: string): Locator {
    return this.positionRows.filter({
      has: this.page
        .getByTestId('asset-history-column-order-id')
        .filter({ hasText: exactly(orderId) }),
    });
  }

  /**
   * Positions History row of a closed (or partly closed) position. A position closed in several
   * steps has one row per close; this returns the latest one (see {@link readPositionRows}).
   */
  async readPosition(orderId: string): Promise<PositionHistoryRecord> {
    const rows = await this.readPositionRows(orderId);
    return [...rows].sort((a, b) => b.closeDate.localeCompare(a.closeDate))[0]!;
  }

  /** Every Positions History row of one position (one per partial or full close). */
  async readPositionRows(orderId: string): Promise<PositionHistoryRecord[]> {
    const rows = this.row(orderId);
    await this.openUntilListed(
      'positions',
      rows.first(),
      `Positions History should list Order No. ${orderId}`,
    );
    const cells = await Promise.all((await rows.all()).map((r) => readCells(r)));
    return cells.map(toPositionRecord);
  }

  /** Order No. of every order row in Orders & Deals, to diff against after an action. */
  async orderDealIds(): Promise<string[]> {
    await this.openOrdersAndDeals();
    const rows = await this.positionRows.all();
    const ids: string[] = [];
    for (const row of rows) {
      const cells = await readCells(row);
      if (cells.kind === 'order') ids.push(cells['order-id'] ?? '');
    }
    return ids.filter(Boolean);
  }

  /**
   * The Orders & Deals order row with Order No. `orderId`, followed by its deals (the row is
   * expanded when it has any). For a position this is its opening order; each closing order has
   * its own Order No. (find it with {@link orderDealIds} before and after the close).
   */
  async readOrdersAndDeals(orderId: string): Promise<OrderDealRecord[]> {
    const orderRow = this.row(orderId).and(
      this.page.locator('[data-row-id]:not([data-row-id*="."])'),
    );
    await this.openUntilListed(
      'ordersAndDeals',
      orderRow,
      `Orders & Deals should list Order No. ${orderId}`,
    );
    const rowId = (await orderRow.getAttribute('data-row-id')) ?? '';
    const expand = orderRow.getByTestId('asset-history-position-list-item-expand');
    const dealRows = this.positionRows.and(this.page.locator(`[data-row-id^="${rowId}."]`));
    if (await expand.count()) {
      if ((await expand.getAttribute('aria-label')) === 'Expand row') await expand.click();
      await expect(expand).toHaveAttribute('aria-label', 'Collapse row');
      await expect(dealRows.first()).toBeVisible();
    }
    const order = toOrderDealRecord(await readCells(orderRow));
    const deals = await Promise.all((await dealRows.all()).map((r) => readCells(r)));
    return [order, ...deals.map(toOrderDealRecord)];
  }

  /**
   * Clicks a history tab unless it is already open, waiting for its list request, a column only
   * that tab has, and the rows or the empty state. The UI fetches a list only when its tab is
   * opened, so with `refetch` an open tab is left for the other one and opened again.
   */
  private async openTab(name: HistoryTab, refetch = false): Promise<void> {
    const { tab, ownHeader, api, emptyState } = this.tabs[name];
    const header = this.columnHeaders.filter({ hasText: new RegExp(`^${ownHeader}$`) });
    if (refetch && (await header.isVisible())) {
      await this.openTab(name === 'positions' ? 'ordersAndDeals' : 'positions');
    }
    if (!(await header.isVisible())) {
      const response = this.page.waitForResponse((r) => isHistoryRequest(r, api));
      await tab.click();
      await response;
    }
    await expect(header).toBeVisible();
    await expect(this.positionRows.first().or(emptyState)).toBeVisible();
  }

  /**
   * Opens a history tab until `row` is shown. The list the tab loaded can predate the action the
   * test just took (an order filled, closed or deleted a moment ago), so it is fetched again.
   */
  private async openUntilListed(name: HistoryTab, row: Locator, message: string): Promise<void> {
    let attempt = 0;
    await expect(async () => {
      await this.openTab(name, attempt++ > 0);
      await expect(row, message).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }
}

/**
 * Resolves with the server's UTC offset in hours (`serverTimezone` of the company profile the
 * app loads at start-up; 2 on the demo). Call it before the page is opened.
 */
export async function waitForServerUtcOffset(page: Page): Promise<number> {
  const response = await page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/config/v1/company/user' && r.ok(),
  );
  const body = (await response.json()) as { result: { serverTimezone: number } };
  return body.result.serverTimezone;
}

/** Formats an epoch time the way the history tables show it: server time, `YYYY-MM-DD HH:mm:ss`. */
export function toServerTime(epochMs: number, serverUtcOffsetHours: number): string {
  return new Date(epochMs + serverUtcOffsetHours * 3_600_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

function isHistoryRequest(response: Response, api: string): boolean {
  return response.request().method() === 'GET' && new URL(response.url()).pathname === api;
}

/** Reads every `asset-history-column-*` cell of a row in one go, keyed by the column name. */
async function readCells(row: Locator): Promise<Cells> {
  // The Profit/Loss cell is rendered a few hundred ms after the rest of the row.
  await expect(row.getByTestId('asset-history-column-profit')).toBeVisible();
  return row.evaluate((el) => {
    const cells: Record<string, string> = {};
    for (const cell of el.querySelectorAll<HTMLElement>('[data-testid^="asset-history-column-"]')) {
      const key = cell.dataset.testid!.replace('asset-history-column-', '');
      cells[key] = cell.innerText.trim();
    }
    cells.kind = (el.getAttribute('data-row-id') ?? '').includes('.') ? 'deal' : 'order';
    return cells;
  });
}

function toPositionRecord(c: Cells): PositionHistoryRecord {
  return {
    orderId: c['order-id'] ?? '',
    symbol: c.symbol ?? '',
    type: c['order-type'] ?? '',
    volumeText: c.volume ?? '',
    entryPrice: parseUiNumber(c['entry-price']),
    closePrice: parseUiNumber(c['close-price']),
    stopLoss: parseUiNumber(c['stop-loss']),
    takeProfit: parseUiNumber(c['take-profit']),
    profit: parseUiNumber(c.profit),
    openDate: c['open-date'] ?? '',
    closeDate: c['close-date'] ?? '',
    units: c.units ?? '',
    swap: parseUiNumber(c.swap),
    commission: parseUiNumber(c.commission),
    remarks: c.remarks ?? '',
    comment: c.comment ?? '',
  };
}

function toOrderDealRecord(c: Cells): OrderDealRecord {
  return {
    kind: c.kind === 'deal' ? 'deal' : 'order',
    orderId: c['order-id'] ?? '',
    symbol: c.symbol ?? '',
    type: c['order-type'] ?? '',
    // Deal rows have no State cell.
    state: c.state ?? '',
    volumeText: c.volume ?? '',
    entryPrice: parseUiNumber(c['entry-price']),
    stopLoss: parseUiNumber(c['stop-loss']),
    takeProfit: parseUiNumber(c['take-profit']),
    profit: parseUiNumber(c.profit),
    openDate: c['open-date'] ?? '',
    closeDate: c['close-date'] ?? '',
    units: c.units ?? '',
    fillPolicy: c['fill-policy'] ?? '',
    swap: parseUiNumber(c.swap),
    commission: parseUiNumber(c.commission),
    remarks: c.remarks ?? '',
  };
}
