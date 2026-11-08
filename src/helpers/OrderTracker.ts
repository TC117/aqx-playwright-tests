import { expect } from '@playwright/test';
import type { AqxApi } from '../api/AqxApi';
import type { MarketOrderInput, Side } from '../models/trading';
import type { TradePage } from '../pages/TradePage';
import { closeTo, parseUiNumber } from './numbers';

/** What a test placed, so the tracker can tell its order from other activity on the account. */
export type OrderMatch = Pick<MarketOrderInput, 'side' | 'volume'>;

/** Order Nos. of every position and pending order on the account at one moment. */
export interface OrderSnapshot {
  positions: Set<string>;
  pending: Set<string>;
}

/** The fields of a server position or pending order the tracker reads. */
interface ServerItem {
  orderId: string | number;
  symbol: string;
  orderType: number;
  lotSize: number;
}

/** A table the tracker removes items from (Open Positions or Pending Orders). */
interface Table {
  open(): Promise<void>;
  orderIds(): Promise<string[]>;
}

/** One kind of owned item and how to remove it. */
interface Removal {
  what: string;
  owned: Set<string>;
  /** Order Nos. of this kind the server holds. */
  serverIds: () => Promise<Set<string>>;
  table: Table;
  remove: (orderId: string) => Promise<void>;
}

/**
 * Even order types are Buys, odd ones Sells: 0 BUY / 1 SELL for positions; 2 / 3 Limit,
 * 4 / 5 Stop and 8 / 9 Stop Limit for pending orders.
 */
function sideOf(orderType: number): Side {
  return orderType % 2 === 0 ? 'BUY' : 'SELL';
}

const idOf = (item: ServerItem): string => String(item.orderId);

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Remembers the positions and pending orders a test creates, and removes only those at the end.
 *
 * The demo account is shared, so a test never assumes it is the only one with orders: it takes a
 * snapshot of the Order Nos. before acting and treats exactly one new number for its symbol, side
 * and volume as its own. The snapshots come from the server's lists, which hold every item: the
 * tables render at most 30 rows. Placing and removing still go through the UI, which is what the
 * tests are about. Clean-up closes or deletes items one by one, never with bulk actions, so a
 * bulk-action bug cannot break every other test.
 */
export class OrderTracker {
  private readonly positions = new Set<string>();
  private readonly pending = new Set<string>();

  constructor(
    private readonly tradePage: TradePage,
    private readonly api: AqxApi,
    /** Instrument the test trades; orders on other symbols are never taken for the test's own. */
    private readonly symbol: string,
  ) {}

  /** Order No. of every open position on the account, to diff against after placing an order. */
  async positionIds(): Promise<Set<string>> {
    return new Set((await this.api.openPositions()).map(idOf));
  }

  /** Order No. of every pending order on the account. */
  async pendingIds(): Promise<Set<string>> {
    return new Set((await this.api.pendingOrders()).map(idOf));
  }

  /** Both lists at once, to take before placing a pending order (it may fill at once). */
  async snapshot(): Promise<OrderSnapshot> {
    const [positions, pending] = await Promise.all([this.positionIds(), this.pendingIds()]);
    return { positions, pending };
  }

  /**
   * Waits until exactly one position not in `before` matches `order` (symbol, side, volume), takes
   * ownership of it, and waits until Open Positions lists it.
   */
  async newPosition(before: Set<string>, order: OrderMatch): Promise<string> {
    const ownNew = (): Promise<string[]> => this.ownNewPositions(before, order);
    const id = await this.waitForOneNew(
      'open position',
      ownNew,
      () => this.api.openPositions(),
      before,
    );
    await this.tradePage.openPositions.open();
    await expect(
      this.tradePage.openPositions.row(id),
      `position ${id} should be listed`,
    ).toHaveCount(1, { timeout: 20_000 });
    await this.expectNoLateDuplicate('open position', id, ownNew);
    return id;
  }

  /**
   * Same as {@link newPosition} for a pending order; waits until Pending Orders lists it. An order
   * that fills before it is ever listed as pending shows up as a position instead: that position
   * is owned (so clean-up closes it) and the call fails, since the test expected a pending order.
   */
  async newPendingOrder(before: OrderSnapshot, order: OrderMatch): Promise<string> {
    let filled: string[] = [];
    const ownNew = async (): Promise<string[]> => {
      const pending = await this.ownNewPendingOrders(before.pending, order);
      filled = pending.length ? [] : await this.ownNewPositions(before.positions, order);
      return pending;
    };
    const id = await this.waitForOneNew(
      'pending order',
      ownNew,
      () => this.api.pendingOrders(),
      before.pending,
      () => filled.length > 0,
    );
    if (filled.length) {
      throw new Error(
        `Pending order filled at once as position ${filled.join(', ')}; it is owned, so clean-up closes it`,
      );
    }
    await this.tradePage.pendingOrders.open();
    await expect(
      this.tradePage.pendingOrders.row(id),
      `pending order ${id} should be listed`,
    ).toHaveCount(1, { timeout: 20_000 });
    await this.expectNoLateDuplicate('pending order', id, ownNew);
    return id;
  }

  /** Takes ownership of every position not in `before` that matches `order`; returns their ids. */
  async ownNewPositions(before: Set<string>, order: OrderMatch): Promise<string[]> {
    const ids = this.matchingNew(await this.api.openPositions(), before, order);
    ids.forEach((id) => this.positions.add(id));
    return ids;
  }

  /** Takes ownership of every pending order not in `before` that matches `order`. */
  async ownNewPendingOrders(before: Set<string>, order: OrderMatch): Promise<string[]> {
    const ids = this.matchingNew(await this.api.pendingOrders(), before, order);
    ids.forEach((id) => this.pending.add(id));
    return ids;
  }

  /** Call when the test itself closed or deleted the item, so clean-up skips it. */
  release(orderId: string): void {
    this.positions.delete(orderId);
    this.pending.delete(orderId);
  }

  /**
   * Closes `volume` lots of an owned position through the Close dialog (the Open Positions tab
   * must be open). When the platform lists the rest under a new Order No., that position is owned
   * too, so clean-up still closes it; this is checked even when the close itself failed.
   */
  async closePart(orderId: string, volume: number): Promise<void> {
    const { side, volume: held } = await this.tradePage.openPositions.read(orderId);
    const rest = { side, volume: held - volume };
    if (rest.volume <= 0) {
      throw new Error(`Closing ${volume} of ${held} lots leaves nothing; close the position`);
    }
    const before = await this.positionIds();
    let failure: unknown;
    try {
      await this.tradePage.openPositions.close(orderId, { volume });
    } catch (e) {
      failure = e;
    }
    try {
      await this.ownRest(orderId, before, rest);
    } catch (e) {
      failure ??= e;
    }
    if (failure) throw failure;
  }

  /**
   * Deletes owned pending orders and closes owned positions that are still on the account. Keeps
   * going after a failure, so one stuck item does not leave the others behind.
   */
  async cleanUp(): Promise<void> {
    if (!this.positions.size && !this.pending.size) return;
    const errors: string[] = [];
    // A failed test may have left a dialog open over the tables: start from a fresh screen.
    await this.tradePage.open().catch((e: Error) => errors.push(`reload: ${e.message}`));
    // Pending orders first, so none can fill after the positions were closed.
    await this.removeOwned(
      {
        what: 'pending order',
        owned: this.pending,
        serverIds: () => this.pendingIds(),
        table: this.tradePage.pendingOrders,
        remove: (id) => this.tradePage.pendingOrders.delete(id),
      },
      errors,
    );
    await this.ownFilledPendingOrders().catch((e: unknown) =>
      errors.push(`looking for filled pending orders: ${messageOf(e)}`),
    );
    await this.removeOwned(
      {
        what: 'position',
        owned: this.positions,
        serverIds: () => this.positionIds(),
        table: this.tradePage.openPositions,
        remove: (id) => this.tradePage.openPositions.close(id),
      },
      errors,
    );
    if (errors.length) throw new Error(`Clean-up left orders behind:\n${errors.join('\n')}`);
  }

  /**
   * Waits until the rest of a partly closed position is listed: under the same Order No. with the
   * remaining volume (on the server, or in the table, in case the server keeps the opened volume
   * in `lotSize`), or under a new Order No. on the server, which is then owned.
   */
  private async ownRest(orderId: string, before: Set<string>, rest: OrderMatch): Promise<void> {
    const keptInTable = async (): Promise<boolean> => {
      const cell = this.tradePage.openPositions
        .row(orderId)
        .getByTestId('asset-open-column-volume');
      if (!(await cell.count())) return false;
      const shown = parseUiNumber(await cell.innerText());
      return shown !== null && closeTo(shown, rest.volume, 1e-9);
    };
    await expect
      .poll(
        async () => {
          const items = await this.api.openPositions();
          const original = items.find((p) => idOf(p) === orderId);
          if (original) {
            const kept = closeTo(original.lotSize, rest.volume, 1e-9) || (await keptInTable());
            return kept ? 'kept' : 'waiting';
          }
          const moved = this.matchingNew(items, before, rest);
          moved.forEach((id) => this.positions.add(id));
          return moved.length ? 'moved' : 'waiting';
        },
        { message: `the rest of position ${orderId} should be listed`, timeout: 20_000 },
      )
      .not.toBe('waiting');
  }

  /**
   * An owned pending order that filled during the test became a position. The position carries
   * the order's number (as its Order No. or position id), so it is owned under that.
   */
  private async ownFilledPendingOrders(): Promise<void> {
    if (!this.pending.size) return;
    const [pending, positions] = await Promise.all([this.pendingIds(), this.api.openPositions()]);
    const filled = [...this.pending].filter((id) => !pending.has(id));
    for (const p of positions) {
      if (p.symbol !== this.symbol) continue;
      if (filled.includes(idOf(p)) || filled.includes(String(p.positionId))) {
        this.positions.add(idOf(p));
      }
    }
  }

  private async removeOwned(r: Removal, errors: string[]): Promise<void> {
    if (!r.owned.size) return;
    let left: string[];
    try {
      left = await this.stillListed(r);
    } catch (e) {
      errors.push(`listing ${r.what}s: ${messageOf(e)}`);
      return;
    }
    if (!left.length) return;
    try {
      await r.table.open();
    } catch (e) {
      errors.push(`opening the ${r.what}s tab: ${messageOf(e)}`);
      return;
    }
    for (const id of left) {
      try {
        await r.remove(id);
      } catch (e) {
        errors.push(`${r.what} ${id}: ${messageOf(e)}`);
      }
    }
  }

  /**
   * Owned ids still on the account, from the server. If the API fails (e.g. the token expired),
   * from the table instead, which only needs the browser session but lists at most 30 rows.
   */
  private async stillListed(r: Removal): Promise<string[]> {
    const owned = [...r.owned];
    try {
      const listed = await r.serverIds();
      return owned.filter((id) => listed.has(id));
    } catch (apiError) {
      try {
        await r.table.open();
        const listed = new Set(await r.table.orderIds());
        return owned.filter((id) => listed.has(id));
      } catch (tableError) {
        throw new Error(`API: ${messageOf(apiError)}; table: ${messageOf(tableError)}`, {
          cause: tableError,
        });
      }
    }
  }

  /** Ids in `items` that are not in `before` and match the test's symbol and `order`. */
  private matchingNew(items: ServerItem[], before: Set<string>, order: OrderMatch): string[] {
    return items
      .filter((item) => !before.has(idOf(item)))
      .filter((item) => item.symbol === this.symbol)
      .filter((item) => sideOf(item.orderType) === order.side)
      .filter((item) => closeTo(item.lotSize, order.volume, 1e-9))
      .map(idOf);
  }

  /**
   * Polls `ownNew` until it reports exactly one id, or until `stop` says to give up waiting (the
   * caller then handles why). Every matching id is owned at once, so if the UI created more than
   * one (e.g. a double submit), clean-up still removes all of them. New items that do not match
   * (another session trading on the shared account) are left alone.
   */
  private async waitForOneNew(
    what: string,
    ownNew: () => Promise<string[]>,
    list: () => Promise<ServerItem[]>,
    before: Set<string>,
    stop: () => boolean = () => false,
  ): Promise<string> {
    let mine: string[] = [];
    try {
      await expect
        .poll(
          async () => {
            mine = await ownNew();
            return mine.length === 1 || stop();
          },
          { timeout: 20_000 },
        )
        .toBe(true);
    } catch (pollError) {
      let others = '';
      try {
        const ids = (await list()).map(idOf).filter((id) => !before.has(id) && !mine.includes(id));
        if (ids.length)
          others = `, plus ${ids.length} other new item(s) left alone: ${ids.join(', ')}`;
      } catch (e) {
        others = `; listing the account failed: ${messageOf(e)}`;
      }
      throw new Error(
        `Expected exactly one new ${what} for ${this.symbol}; found ${mine.length} (${mine.join(', ') || 'none'})${others}`,
        { cause: pollError },
      );
    }
    return mine[0]!;
  }

  /** A double submit can list its second item only after the first: own it and fail. */
  private async expectNoLateDuplicate(
    what: string,
    id: string,
    ownNew: () => Promise<string[]>,
  ): Promise<void> {
    const all = await ownNew();
    if (all.length > 1) {
      throw new Error(
        `A second new ${what} appeared after ${id}: ${all.join(', ')}; all are owned, so clean-up removes them`,
      );
    }
  }
}
