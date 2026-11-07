import type { Locator, Page } from '@playwright/test';
import type { NotificationItem } from '../../models/trading';
import { notImplemented } from './notImplemented';

export type NotificationTab = 'order' | 'system' | 'information';

/**
 * Notification bell (`notification-selector`) with Order / System / Information tabs
 * (`tab-notification-type-*`) and a virtualised list (`notification-list-result`). Also the toast
 * shown after an action.
 * Owner: records work (R6, R7).
 */
export class Notifications {
  readonly bell: Locator;
  readonly list: Locator;

  constructor(protected readonly page: Page) {
    this.bell = page.getByTestId('notification-selector');
    this.list = page.getByTestId('notification-list-result');
  }

  async open(): Promise<void> {
    return notImplemented('Notifications.open');
  }

  async openTab(_tab: NotificationTab): Promise<void> {
    return notImplemented('Notifications.openTab');
  }

  async items(): Promise<NotificationItem[]> {
    return notImplemented('Notifications.items');
  }

  /** Text of the toast shown after the last action. */
  async lastToast(): Promise<string> {
    return notImplemented('Notifications.lastToast');
  }
}
