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
    return this.waitForOneNew(
      before,
      () => this.positionIds(),
      (id) => this.positions.add(id),
      'open position',
    );
  }

  /** Waits until exactly one pending order not in `before` is listed, and takes ownership of it. */
  async newPendingOrder(before: Set<string>): Promise<string> {
    return this.waitForOneNew(
      before,
      () => this.pendingIds(),
      (id) => this.pending.add(id),
      'pending order',
    );
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

  /**
   * Closes owned positions and deletes owned pending orders that are still listed. Keeps going
   * after a failure, so one stuck item does not leave the others behind.
   */
  async cleanUp(): Promise<void> {
    if (!this.positions.size && !this.pending.size) return;
    const errors: string[] = [];
    // A failed test may have left a dialog open over the tables: start from a fresh screen.
    await this.tradePage.open().catch((e: Error) => errors.push(`reload: ${e.message}`));
    await this.removeListed(
      'position',
      this.positions,
      () => this.positionIds(),
      (id) => this.tradePage.openPositions.close(id),
      errors,
    );
    await this.removeListed(
      'pending order',
      this.pending,
      () => this.pendingIds(),
      (id) => this.tradePage.pendingOrders.delete(id),
      errors,
    );
    if (errors.length) throw new Error(`Clean-up left orders behind:\n${errors.join('\n')}`);
  }

  private async removeListed(
    what: string,
    owned: Set<string>,
    list: () => Promise<Set<string>>,
    remove: (orderId: string) => Promise<void>,
    errors: string[],
  ): Promise<void> {
    if (!owned.size) return;
    let listed: Set<string>;
    try {
      listed = await list();
    } catch (e) {
      errors.push(`listing ${what}s: ${(e as Error).message}`);
      return;
    }
    for (const id of owned) {
      if (!listed.has(id)) continue;
      try {
        await remove(id);
      } catch (e) {
        errors.push(`${what} ${id}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Polls until exactly one id not in `before` is listed. Every new id seen is owned at once, so
   * if the UI created more than one (e.g. a double submit), clean-up still removes all of them.
   */
  private async waitForOneNew(
    before: Set<string>,
    list: () => Promise<Set<string>>,
    own: (orderId: string) => void,
    what: string,
  ): Promise<string> {
    let added: string[] = [];
    await expect
      .poll(
        async () => {
          added = [...(await list())].filter((id) => !before.has(id));
          added.forEach(own);
          return added.length;
        },
        { message: `exactly one new ${what} should appear`, timeout: 20_000 },
      )
      .toBe(1);
    return added[0]!;
  }
}
