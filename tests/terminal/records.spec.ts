import type { Page, Response } from '@playwright/test';
import type { HistoryEntry } from '../../src/api/AqxApi';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { test, expect } from '../../src/fixtures/test';
import { closeTo } from '../../src/helpers/numbers';
import { TradePage } from '../../src/pages/TradePage';
import {
  toServerTime,
  waitForServerUtcOffset,
  type DateRangePreset,
} from '../../src/pages/components/TradeHistory';

/**
 * Records that already exist on the demo account (the initial deposit, the account figures and
 * the system notifications), checked against the server. None of these tests needs the market.
 */

/** `orderType` of balance and credit operations in `/api/order/v3/histories`. */
const BALANCE = 6;
const CREDIT = 7;
const ALL_TIME: [number, number] = [0, Date.now() + 86_400_000];

interface ServerNotification {
  title: string;
  message: string;
  orderId: string | null;
  publishDate: number;
  created: number;
}

/** Opens the trade screen and returns it with the server's UTC offset the UI formats dates in. */
async function openTradeScreen(page: Page): Promise<{ tradePage: TradePage; offset: number }> {
  const offset = waitForServerUtcOffset(page);
  const tradePage = new TradePage(page);
  await tradePage.open();
  return { tradePage, offset: await offset };
}

function notificationsResponse(page: Page, type: string): Promise<Response> {
  return page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      url.pathname === '/api/notification/v2' && url.searchParams.get('notificationType') === type
    );
  });
}

/**
 * Margin level = Equity / Margin used x 100. Finding: with no margin used the demo shows 0.00%
 * (the test cases expected "--").
 */
function expectedMarginLevel(equity: number, margin: number): number {
  return margin > 0 ? (equity / margin) * 100 : 0;
}

async function resultOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { result: T }).result;
}

/** Period the app should request for a preset, computed in the browser's own time zone. */
function expectedPeriod(page: Page, preset: DateRangePreset) {
  return page.evaluate((p) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    const to = new Date(today);
    to.setHours(23, 59, 59, 0);
    const days = { 'Last 7 days': 7, 'Last 30 days': 30, 'Last 90 days': 90 }[p as string];
    if (days) {
      from.setDate(from.getDate() - (days - 1));
    } else if (p === 'This year' || p === 'Last year') {
      const year = today.getFullYear() - (p === 'Last year' ? 1 : 0);
      from.setFullYear(year, 0, 1);
      to.setFullYear(year, 11, 31);
    }
    const label = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    return { from: from.getTime(), to: to.getTime(), label: `${label(from)} - ${label(to)}` };
  }, preset);
}

test.describe('Trading records already on the account', () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test(
    'TC-HIS-08 Initial deposit is listed in Positions History as a BALANCE record matching the server',
    { tag: ['@R6', '@R7'] },
    async ({ page, api }) => {
      const history = await api.positionHistory(...ALL_TIME);
      const deposit = history
        .filter((e) => e.orderType === BALANCE && e.deposit > 0)
        .sort((a, b) => a.openTime - b.openTime)[0];
      expect(deposit, 'the demo account should have an initial deposit').toBeDefined();
      const { tradePage, offset } = await openTradeScreen(page);
      const { history: records } = tradePage;

      await test.step('show every period so the deposit is in range whatever its age', async () => {
        await records.openPositionsHistory();
        await records.selectDateRange('All');
      });

      const row = await records.readPosition(deposit!.positionId);

      // The UI shows the deal's position id as Order No. (the entry's orderId is "0").
      expect(row).toEqual({
        orderId: deposit!.positionId,
        symbol: '--',
        type: 'BALANCE',
        volumeText: '--',
        units: '--',
        entryPrice: null,
        closePrice: null,
        takeProfit: null,
        stopLoss: null,
        swap: null,
        commission: null,
        profit: deposit!.deposit,
        remarks: '--',
        comment: expect.any(String),
        openDate: toServerTime(deposit!.openTime, offset),
        closeDate: toServerTime(deposit!.closeTime, offset),
      });
      await expect(
        records.row(deposit!.positionId).getByTestId('asset-history-column-profit'),
      ).toHaveText(`+${deposit!.deposit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    },
  );

  test(
    'TC-HIS-08 Account balance equals the sum of every booked history record',
    { tag: ['@R6', '@R7'] },
    async ({ tradePage, api }) => {
      const counts = await api.orderCounts();
      // Commission of an open position is charged on entry but only listed once it is closed.
      test.skip(
        counts.marketOrderCounts > 0,
        `${counts.marketOrderCounts} position(s) open; the balance includes their entry commission`,
      );
      const history = await api.positionHistory(...ALL_TIME);
      const account = await api.account();

      // Credit is not part of the balance; every other record is booked as P/L + commission + swap.
      const booked = history
        .filter((e: HistoryEntry) => e.orderType !== CREDIT)
        .reduce((sum, e) => sum + e.profit + e.commission + e.swap, 0);
      expect(
        closeTo(booked, account.balance, 0.01),
        `booked ${booked} vs balance ${account.balance}`,
      ).toBe(true);

      const ui = await tradePage.account.summary();
      expect(ui.balance).toBe(account.balance);
    },
  );

  test(
    'TC-DTL-04 Balance, equity and free margin agree between header, account dropdown and server',
    { tag: ['@R7'] },
    async ({ tradePage, api }) => {
      const server = await api.account();
      const header = await tradePage.account.headerFigures();
      const dropdown = await tradePage.account.summary();

      expect(dropdown).toMatchObject({
        balance: server.balance,
        equity: server.equity,
        freeMargin: server.freeMargin,
        margin: server.margin,
      });
      expect(header.equity).toBe(dropdown.equity);
      expect(header.profitLoss).toBe(dropdown.profitLoss);
      expect(header.marginLevel).toBe(dropdown.marginLevel);
      expect(dropdown.stopOutLevel, 'stop out level (%)').toBeGreaterThan(0);
      expect(dropdown.marginCallLevel, 'margin call level (%)').toBeGreaterThan(
        dropdown.stopOutLevel!,
      );

      // Equity = Balance + floating P/L; Free margin = Equity - Margin used.
      expect(closeTo(dropdown.equity, dropdown.balance + dropdown.profitLoss, 0.01)).toBe(true);
      expect(closeTo(dropdown.freeMargin, dropdown.equity - dropdown.margin, 0.01)).toBe(true);
      const level = expectedMarginLevel(dropdown.equity, dropdown.margin);
      expect(closeTo(dropdown.marginLevel ?? NaN, level, 0.01)).toBe(true);
    },
  );

  test(
    'TC-HIS-06 History tabs show the expected columns',
    { tag: ['@R6'] },
    async ({ tradePage }) => {
      const { history } = tradePage;

      await history.openPositionsHistory();
      expect(await history.headers()).toEqual([
        'Open Date',
        'Symbol',
        'Close Date',
        'Order No.',
        'Type',
        'Profit/Loss',
        'Volume',
        'Units',
        'Entry Price',
        'Close Price',
        'Take Profit',
        'Stop Loss',
        'Swap',
        'Commission',
        'Remarks',
        'Comment',
        'Share',
      ]);

      await history.openOrdersAndDeals();
      expect(await history.headers()).toEqual([
        'Open Date',
        'Symbol',
        'Close Date',
        'Order No.',
        'Type',
        'State',
        'Volume',
        'Units',
        'Fill Policy',
        'Entry Price',
        'Take Profit',
        'Stop Loss',
        'Profit/Loss',
        'Swap',
        'Commission',
        'Remarks',
        'Comment',
      ]);
    },
  );

  test(
    'TC-HIS-06 Orders & Deals lists one row per order the server returns, or its empty state',
    { tag: ['@R6', '@R7'] },
    async ({ tradePage, page }) => {
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/trade/order/v1/deal/histories',
      );
      await tradePage.history.openOrdersAndDeals();
      const orders = await resultOf<{ orderId: string }[]>(await response);

      await expect(tradePage.history.ordersAndDealsEmptyState).toBeVisible({
        visible: orders.length === 0,
      });
      expect((await tradePage.history.orderDealIds()).sort()).toEqual(
        orders.map((o) => String(o.orderId)).sort(),
      );
    },
  );

  test(
    'TC-HIS-10 A period without trades shows the empty state on both history tabs',
    { tag: ['@R6'] },
    async ({ tradePage, page, api }) => {
      const history = await api.positionHistory(...ALL_TIME);
      const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
      test.skip(
        history.some((e) => e.openTime < startOfYear),
        'the account has records from last year, so "Last year" is not an empty period',
      );
      const { history: records } = tradePage;
      const expected = await expectedPeriod(page, 'Last year');

      await test.step('Positions History', async () => {
        await records.openPositionsHistory();
        expect(await records.selectDateRange('Last year')).toEqual({
          from: expected.from,
          to: expected.to,
        });
        await expect(records.positionsEmptyState).toBeVisible();
        await expect(records.positionRows).toHaveCount(0);
      });

      await test.step('Orders & Deals', async () => {
        await records.openOrdersAndDeals();
        expect(await records.selectDateRange('Last year')).toEqual({
          from: expected.from,
          to: expected.to,
        });
        await expect(records.ordersAndDealsEmptyState).toBeVisible();
        await expect(records.positionRows).toHaveCount(0);
      });
    },
  );

  test(
    'TC-HIS-09 Date-range presets request the matching period and keep the records inside it',
    { tag: ['@R6'] },
    async ({ tradePage, page, api }) => {
      const history = await api.positionHistory(...ALL_TIME);
      const { history: records } = tradePage;
      await records.openPositionsHistory();

      for (const preset of ['Last 7 days', 'Last 30 days', 'Last 90 days', 'This year'] as const) {
        await test.step(preset, async () => {
          const expected = await expectedPeriod(page, preset);
          const requested = await records.selectDateRange(preset);

          expect(requested).toEqual({ from: expected.from, to: expected.to });
          await expect(records.dateRangeButton).toHaveText(
            new RegExp(`^\\s*${expected.label.replace(' - ', '\\s+-\\s+')}\\s*$`),
          );
          const inRange = history.filter(
            (e) => e.closeTime >= expected.from && e.closeTime <= expected.to,
          );
          for (const entry of inRange) {
            await expect(records.row(entry.positionId).first()).toBeVisible();
          }
          await expect(records.positionsEmptyState).toBeVisible({ visible: inRange.length === 0 });
        });
      }
    },
  );
});

test.describe('Notification panel', () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test(
    'TC-HIS-05 Panel has Positions, System and Information tabs with their retention notes',
    { tag: ['@R6'] },
    async ({ tradePage }) => {
      const { notifications } = tradePage;
      await notifications.open();

      await expect(notifications.tab('order')).toHaveText('Positions');
      await expect(notifications.tab('system')).toHaveText(/^System\s*\d*$/);
      await expect(notifications.tab('information')).toHaveText('Information');

      for (const [tab, days] of [
        ['order', 30],
        ['system', 30],
        ['information', 10],
      ] as const) {
        await notifications.openTab(tab);
        await expect(notifications.retentionNote).toHaveText(
          `Notifications display for up to ${days} days.`,
        );
      }
      await notifications.close();
    },
  );

  test(
    'TC-HIS-05 System tab lists the server notifications newest first, including New Login Detected',
    { tag: ['@R6'] },
    async ({ page }) => {
      const { tradePage, offset } = await openTradeScreen(page);
      const { notifications } = tradePage;
      const response = notificationsResponse(page, 'SYSTEM');
      await notifications.openTab('system');
      const server = await resultOf<ServerNotification[]>(await response);

      expect(
        server.map((n) => n.title),
        'the demo logs every sign-in',
      ).toContain('New Login Detected');
      expect([...server].sort((a, b) => b.publishDate - a.publishDate)).toEqual(server);

      // The list is virtualised: compare the rendered items with the start of the server's list.
      const items = await notifications.items();
      expect(items.length).toBeGreaterThan(0);
      expect(items.map((i) => i.title)).toEqual(server.slice(0, items.length).map((n) => n.title));
      items.forEach((item, i) => {
        // Compared without printing the text: login messages contain the client's IP address.
        expect(item.text === server[i]!.message, `message of item ${i} matches the server`).toBe(
          true,
        );
        expect(item.orderId).toBeNull();
      });
      // Recent items say e.g. "5 minutes ago"; older ones show the publish time in server time.
      const dated = items
        .map((item, i) => ({ shown: item.time, published: server[i]!.publishDate }))
        .filter((d) => /^\d{4}-\d{2}-\d{2} /.test(d.shown));
      for (const d of dated) expect(d.shown).toBe(toServerTime(d.published, offset));
      const login = items.find((i) => i.title === 'New Login Detected')!;
      expect(login.text.startsWith('New login detected from ')).toBe(true);
      expect(
        login.text.endsWith('Please review the linked devices if you did not initiate this.'),
      ).toBe(true);
    },
  );

  test(
    'TC-HIS-01 Positions tab shows the server order notifications, or its empty state',
    { tag: ['@R6', '@R7'] },
    async ({ tradePage, page }) => {
      const { notifications } = tradePage;
      const response = notificationsResponse(page, 'ORDER');
      await notifications.openTab('order');
      const server = await resultOf<ServerNotification[]>(await response);

      await expect(notifications.emptyState).toBeVisible({ visible: server.length === 0 });
      const items = await notifications.items();
      expect(items.length > 0, 'items are listed exactly when the server has some').toBe(
        server.length > 0,
      );
      expect(items.map((i) => i.orderId)).toEqual(
        server.slice(0, items.length).map((n) => String(n.orderId)),
      );
      for (const item of items) expect(item.title).toMatch(/^Position (Created|Closed)$/);
    },
  );
});
