import { expect } from '@playwright/test';
import type { TradePage } from '../pages/TradePage';

/**
 * Remembers the positions and pending orders a test creates, and removes only those at the end.
 *
 * The demo account is shared, so a test never assumes it is the only one with orders: it takes a
 * snapshot of the Order No. list before acting and treats exactly one new number as its own.
 * Clean-up closes or deletes items one by one, never with bulk actions, so a bulk-action bug
 * cannot break every other test.
 */
export class OrderTracker {
  private readonly positions = new Set<string>();
  private readonly pending = new Set<string>();

  constructor(private readonly tradePage: TradePage) {}

  /** Order No. of every open position, to diff against after placing an order. */
  async positionIds(): Promise<Set<string>> {
    await this.tradePage.openPositions.open();
    return new Set(await this.tradePage.openPositions.orderIds());
  }

  async pendingIds(): Promise<Set<string>> {
    await this.tradePage.pendingOrders.open();
    return new Set(await this.tradePage.pendingOrders.orderIds());
  }

  /** Waits until exactly one position not in `before` is listed, and takes ownership of it. */
  async newPosition(before: Set<string>): Promise<string> {
    const id = await this.waitForOneNew(before, () => this.positionIds(), 'open position');
    this.positions.add(id);
    return id;
  }

  /** Waits until exactly one pending order not in `before` is listed, and takes ownership of it. */
  async newPendingOrder(before: Set<string>): Promise<string> {
    const id = await this.waitForOneNew(before, () => this.pendingIds(), 'pending order');
    this.pending.add(id);
    return id;
  }

  /** Takes ownership of a position the test learned about another way (e.g. a filled order). */
  ownPosition(orderId: string): void {
    this.positions.add(orderId);
  }

  /** Call when the test itself closed or deleted the item, so clean-up skips it. */
  release(orderId: string): void {
    this.positions.delete(orderId);
    this.pending.delete(orderId);
  }

  /** Closes owned positions and deletes owned pending orders that are still listed. */
  async cleanUp(): Promise<void> {
    const errors: string[] = [];
    if (this.positions.size) {
      const open = await this.positionIds();
      for (const id of this.positions) {
        if (!open.has(id)) continue;
        await this.tradePage.openPositions
          .close(id)
          .catch((e: Error) => errors.push(`close ${id}: ${e.message}`));
      }
    }
    if (this.pending.size) {
      const listed = await this.pendingIds();
      for (const id of this.pending) {
        if (!listed.has(id)) continue;
        await this.tradePage.pendingOrders
          .delete(id)
          .catch((e: Error) => errors.push(`delete ${id}: ${e.message}`));
      }
    }
    if (errors.length) throw new Error(`Clean-up left orders behind:\n${errors.join('\n')}`);
  }

  private async waitForOneNew(
    before: Set<string>,
    list: () => Promise<Set<string>>,
    what: string,
  ): Promise<string> {
    let added: string[] = [];
    await expect
      .poll(
        async () => {
          added = [...(await list())].filter((id) => !before.has(id));
          return added.length;
        },
        { message: `exactly one new ${what} should appear`, timeout: 20_000 },
      )
      .toBe(1);
    return added[0]!;
  }
}
