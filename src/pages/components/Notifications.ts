import { expect, type Locator, type Page } from '@playwright/test';
import type { NotificationItem } from '../../models/trading';

export type NotificationTab = 'order' | 'system' | 'information';

/** A notification as listed, with the parts the order notifications add. */
export interface NotificationRecord extends NotificationItem {
  /** Second line of an order notification, e.g. `EURUSD  |  Order No. 9000001`. */
  meta: string;
  /** e.g. `5 minutes ago` or `2026-11-05 07:00:00` (server time). */
  time: string;
}

/** The "Order Details" dialog opened from an order notification. */
export interface NotificationOrderDetails {
  /** e.g. `Position Closed`. */
  title: string;
  symbol: string;
  /** e.g. `BUY`. */
  side: string;
  /** Value under each label, e.g. `{ 'Order No.': '9000001', Volume: '0.06', ... }`. */
  fields: Record<string, string>;
}

const NOTIFICATIONS_API = '/api/notification/v2';

/** Labels of the Order Details dialog, in display order. */
const DETAIL_LABELS = [
  'Created Time',
  'Closed Time',
  'Order No.',
  'Volume',
  'Units',
  'Profit/Loss',
  'ROI%',
  'Entry Price',
  'Close Price',
  'Stop Loss',
  'Take Profit',
  'Commission',
  'Swap',
  'Remarks',
];

/**
 * Notification bell (`notification-selector`) with three tabs: "Positions" (test id
 * `tab-notification-type-order`), "System" and "Information", and a virtualised list
 * (`notification-list-result`): only the items in view are rendered. Each tab states how long
 * items are kept ("Notifications display for up to 30 days." / "... 10 days." for Information)
 * and shows "No new notifications." when empty. Order items read e.g. "Position Closed | +18.00 |
 * EURUSD  |  Order No. 9000001 | BUY | 0.06 volume(s) | at | 1.1171 | 2026-11-05 07:00:00"; clicking
 * one opens the "Order Details" dialog. Also the toast shown after an action
 * (`notification-box-description`), e.g. "One-Click Trading activated." (live), "Position has been
 * created." and "Order has been created." (with the order requests answered in the browser).
 * Opening a tab marks its items as read on the server.
 * Owner: records work (R6, R7).
 */
export class Notifications {
  readonly bell: Locator;
  readonly panel: Locator;
  readonly list: Locator;
  readonly listItems: Locator;
  readonly emptyState: Locator;
  /** "Notifications display for up to N days." */
  readonly retentionNote: Locator;
  readonly orderDetailsModal: Locator;
  readonly toast: Locator;

  constructor(protected readonly page: Page) {
    this.bell = page.getByTestId('notification-selector');
    this.panel = page.getByTestId('notification-dropdown-result');
    this.list = page.getByTestId('notification-list-result');
    this.listItems = this.list.getByTestId('notification-list-result-item');
    this.emptyState = this.list.getByText('No new notifications.');
    this.retentionNote = this.list.getByText(/^Notifications display for up to \d+ days\.$/);
    this.orderDetailsModal = page.getByTestId('notification-order-details-modal');
    this.toast = page.getByTestId('notification-box-description');
  }

  tab(tab: NotificationTab): Locator {
    return this.page.getByTestId(`tab-notification-type-${tab}`);
  }

  /** Opens the panel (the bell toggles it, so it is only clicked while the panel is closed). */
  async open(): Promise<void> {
    if (!(await this.panel.isVisible())) await this.bell.click();
    await expect(this.panel).toBeVisible();
  }

  async close(): Promise<void> {
    if (await this.panel.isVisible()) await this.bell.click();
    await expect(this.panel).toBeHidden();
  }

  /** Opens one tab and waits until the server's list for it (or its empty state) is shown. */
  async openTab(tab: NotificationTab): Promise<void> {
    await this.open();
    const target = this.tab(tab);
    // The open tab is drawn in medium weight; clicking it again does not reload its list.
    const isOpen = (await target.evaluate((e) => getComputedStyle(e).fontWeight)) === '500';
    if (!isOpen) {
      const loaded = this.page.waitForResponse((r) => {
        const url = new URL(r.url());
        return (
          r.request().method() === 'GET' &&
          url.pathname === NOTIFICATIONS_API &&
          url.searchParams.get('notificationType') === tab.toUpperCase()
        );
      });
      await target.click();
      await loaded;
    }
    await this.waitForList();
  }

  /** Items of the open tab that are rendered (the list is virtualised), newest first. */
  async items(): Promise<NotificationRecord[]> {
    await this.waitForList();
    const items: NotificationRecord[] = [];
    for (const item of await this.listItems.all()) {
      const title = (
        await item.getByTestId('notification-list-result-item-title').innerText()
      ).trim();
      const meta = item.getByTestId('notification-list-result-item-meta');
      const metaText = (await meta.count()) ? (await meta.innerText()).trim() : '';
      const lines = (await item.innerText())
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      // The title comes first and the time last; everything between is the body.
      const body = lines.slice(1, -1).filter((l) => l !== metaText);
      items.push({
        title,
        text: body.join(' '),
        orderId: metaText.match(/Order No\.?\s*(\d+)/)?.[1] ?? null,
        meta: metaText,
        time: lines.at(-1) ?? '',
      });
    }
    return items;
  }

  /** Number in the tab's unread badge (0 when there is none). */
  async unreadCount(tab: NotificationTab): Promise<number> {
    const label = (await this.tab(tab).innerText()).replace(/\s+/g, ' ');
    return Number(label.match(/\d+/)?.[0] ?? 0);
  }

  /** Clicks a rendered order notification and reads the "Order Details" dialog it opens. */
  async openOrderDetails(item: Locator): Promise<NotificationOrderDetails> {
    await item.click();
    await expect(this.orderDetailsModal).toBeVisible();
    // The dialog body is loaded lazily and filled in once the order's details arrive; until
    // then Order No. is missing or "--".
    const lines = async () =>
      (await this.orderDetailsModal.innerText())
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    await expect
      .poll(async () => valueAfter(await lines(), 'Order No.') ?? '', {
        message: 'Order Details should show an Order No.',
      })
      .toMatch(/^\d+$/);
    const all = await lines();
    const fields: Record<string, string> = {};
    for (const label of DETAIL_LABELS) {
      const value = valueAfter(all, label);
      if (value !== undefined) fields[label] = value;
    }
    // Header: "Order Details", then the event title; symbol and side sit just before Order No.
    const orderNoAt = all.indexOf('Order No.');
    return {
      title: all[1] ?? '',
      symbol: all[orderNoAt - 2] ?? '',
      side: all[orderNoAt - 1] ?? '',
      fields,
    };
  }

  async closeOrderDetails(): Promise<void> {
    await this.orderDetailsModal.getByRole('button', { name: /close/i }).click();
    await expect(this.orderDetailsModal).toBeHidden();
  }

  private async waitForList(): Promise<void> {
    await expect(this.page.getByTestId('notification-loading-indicator')).toBeHidden();
    await expect(this.listItems.first().or(this.emptyState)).toBeVisible();
  }

  /** Text of the toast shown after the last action. */
  async lastToast(): Promise<string> {
    const toast = this.toast.last();
    await expect(toast).toBeVisible();
    return (await toast.innerText()).trim();
  }
}

function valueAfter(lines: string[], label: string): string | undefined {
  const i = lines.indexOf(label);
  return i >= 0 ? lines[i + 1] : undefined;
}
