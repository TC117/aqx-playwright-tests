import type { MarketOrderInput, PendingOrderInput } from '../models/trading';
import type { TradePage } from '../pages/TradePage';
import type { OrderTracker } from './OrderTracker';

/**
 * Order steps the trading specs share: place through the order panel, then let `orders` find and
 * own what the order created, so clean-up removes it whatever the test does next.
 */

/** Places a market order and returns the Order No. of the position it opened. */
export async function openPosition(
  tradePage: TradePage,
  orders: OrderTracker,
  order: MarketOrderInput,
): Promise<string> {
  const before = await orders.positionIds();
  await tradePage.orderPanel.placeMarketOrder(order);
  return orders.newPosition(before, order);
}

/** Places a Limit / Stop / Stop Limit order and returns its Order No. */
export async function placePendingOrder(
  tradePage: TradePage,
  orders: OrderTracker,
  order: PendingOrderInput,
): Promise<string> {
  const before = await orders.snapshot();
  await tradePage.orderPanel.placePendingOrder(order);
  return orders.newPendingOrder(before, order);
}

/**
 * Places an order that the server is expected to refuse. If it is accepted after all, whatever it
 * created is owned, so clean-up removes it, and the promise resolves (or rejects without the
 * platform's code), which fails the caller's `rejects` check.
 */
export async function placeExpectingRejection(
  tradePage: TradePage,
  orders: OrderTracker,
  order: MarketOrderInput | PendingOrderInput,
): Promise<void> {
  await ('type' in order
    ? placePendingOrder(tradePage, orders, order)
    : openPosition(tradePage, orders, order));
}
