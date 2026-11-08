/** Shared trading types used by page objects, the API client and the tests. */

export type Side = 'BUY' | 'SELL';

/** Order types offered by the order panel's "Order Type" dropdown. */
export type OrderType = 'Market' | 'Limit' | 'Stop' | 'Stop Limit';

export type PendingOrderType = Exclude<OrderType, 'Market'>;

/** Expiry options of a pending order, as labelled in the "Expiry" dropdown. */
export type Expiry =
  'Good Till Canceled' | 'Good Till Day' | 'Specified Date' | 'Specified Date and Time';

export interface MarketOrderInput {
  side: Side;
  /** Volume in lots. */
  volume: number;
  /** Absolute Stop Loss price. Omit for no Stop Loss. */
  stopLoss?: number;
  /** Absolute Take Profit price. Omit for no Take Profit. */
  takeProfit?: number;
}

export interface PendingOrderInput extends MarketOrderInput {
  type: PendingOrderType;
  /** Order (trigger) price. */
  price: number;
  /** Limit price of a Stop Limit order. */
  stopLimitPrice?: number;
  expiry?: Expiry;
  /** Expiry moment for "Specified Date" / "Specified Date and Time", in server time. */
  expiresAt?: Date;
}

/** A row of the Open Positions table, parsed into numbers. */
export interface PositionRow {
  orderId: string;
  symbol: string;
  side: Side;
  volume: number;
  entryPrice: number;
  currentPrice: number | null;
  /** `null` when the cell shows `--`. */
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number | null;
}

/** A row of the Pending Orders table. */
export interface PendingOrderRow {
  orderId: string;
  symbol: string;
  /** As shown in the Type column, e.g. `BUY LIMIT`, `SELL STOP`. */
  type: string;
  /** Volume column, e.g. `0.01 / 0` (requested / filled). */
  volumeText: string;
  expiry: string;
  expiryDate: string;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

/** A row of History > Positions History. */
export interface PositionHistoryRow {
  orderId: string;
  symbol: string;
  type: string;
  volumeText: string;
  entryPrice: number | null;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number | null;
  openDate: string;
  closeDate: string;
}

/** A row of History > Orders & Deals. */
export interface OrderDealRow {
  orderId: string;
  symbol: string;
  type: string;
  /** e.g. `FILLED`, `CANCELED`, `EXPIRED` (compare case-insensitively). */
  state: string;
  volumeText: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number | null;
}

export interface NotificationItem {
  title: string;
  text: string;
  /** Order No. mentioned in the item, if any. */
  orderId: string | null;
}

/** Bid/Ask as shown on the order panel. */
export interface Quote {
  bid: number;
  ask: number;
}
