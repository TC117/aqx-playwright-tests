/**
 * Price math for order entry: valid (or deliberately invalid) SL/TP and pending-order prices
 * derived from a quote, following the trading rules in docs/testcase-final.md §2. Pure functions,
 * no page access. Distances are in points (the symbol's smallest price step).
 */
import type { SymbolDetail } from '../api/AqxApi';
import type { PendingOrderType, Quote, Side } from '../models/trading';
import { offsetByPoints } from './numbers';

/** The parts of the symbol spec the price math needs. */
export type PriceSpec = Pick<SymbolDetail, 'digits' | 'pointStep'>;

/** Stop Loss / Take Profit pair as absolute prices. */
export interface Levels {
  stopLoss: number;
  takeProfit: number;
}

/** Order price of a pending order; `stopLimitPrice` only for Stop Limit. */
export interface PendingPrices {
  price: number;
  stopLimitPrice?: number;
}

/** +1 for a Buy, -1 for a Sell: the direction in which a position profits. */
export function direction(side: Side): 1 | -1 {
  return side === 'BUY' ? 1 : -1;
}

/** The other side. */
export function opposite(side: Side): Side {
  return side === 'BUY' ? 'SELL' : 'BUY';
}

/** Price a market order opens at: Ask for a Buy, Bid for a Sell. */
export function openPrice(side: Side, quote: Quote): number {
  return side === 'BUY' ? quote.ask : quote.bid;
}

/** Price a position closes at, which SL/TP of a market order are checked against. */
export function closePrice(side: Side, quote: Quote): number {
  return side === 'BUY' ? quote.bid : quote.ask;
}

/** `price` moved `points` in the profitable direction of `side` (negative points: against it). */
export function towardsProfit(side: Side, price: number, points: number, spec: PriceSpec): number {
  return offsetByPoints(price, direction(side) * points, spec.pointStep, spec.digits);
}

/** SL `slPoints` below and TP `tpPoints` above `reference` for a Buy; mirrored for a Sell. */
export function levelsAround(
  side: Side,
  reference: number,
  spec: PriceSpec,
  slPoints: number,
  tpPoints: number = slPoints,
): Levels {
  return {
    stopLoss: towardsProfit(side, reference, -slPoints, spec),
    takeProfit: towardsProfit(side, reference, tpPoints, spec),
  };
}

/** Valid SL/TP for a market order: placed around the closing price (Bid for a Buy). */
export function marketLevels(
  side: Side,
  quote: Quote,
  spec: PriceSpec,
  slPoints: number,
  tpPoints: number = slPoints,
): Levels {
  return levelsAround(side, closePrice(side, quote), spec, slPoints, tpPoints);
}

/** SL/TP on the wrong side of the closing price (SL above the Bid for a Buy, and so on). */
export function wrongSideMarketLevels(
  side: Side,
  quote: Quote,
  spec: PriceSpec,
  points: number,
): Levels {
  return levelsAround(side, closePrice(side, quote), spec, -points, -points);
}

/**
 * A valid pending order `points` away from the market: Limit below the Ask (Buy) or above the Bid
 * (Sell), Stop on the other side. For Stop Limit, `price` is the stop and `stopLimitPrice` the
 * limit, `limitGapPoints` back from the stop towards the market.
 */
export function pendingPrices(
  type: PendingOrderType,
  side: Side,
  quote: Quote,
  spec: PriceSpec,
  points: number,
  limitGapPoints = 0,
): PendingPrices {
  const away = type === 'Limit' ? -points : points;
  const price = towardsProfit(side, openPrice(side, quote), away, spec);
  if (type !== 'Stop Limit') return { price };
  return { price, stopLimitPrice: towardsProfit(side, price, -limitGapPoints, spec) };
}

/** Pending price on the wrong side of the market for its type (e.g. a Buy Limit above the Ask). */
export function wrongSidePendingPrice(
  type: Exclude<PendingOrderType, 'Stop Limit'>,
  side: Side,
  quote: Quote,
  spec: PriceSpec,
  points: number,
): number {
  return pendingPrices(type, side, quote, spec, -points).price;
}

/** Price a pending order fills at, which its SL/TP are checked against. */
export function executionPrice(prices: PendingPrices): number {
  return prices.stopLimitPrice ?? prices.price;
}

/** Signed P/L of `units` opened at `open` and closed at `close`, in quote currency. */
export function profit(side: Side, open: number, close: number, units: number): number {
  return direction(side) * (close - open) * units;
}

/** Type column text of a pending order, e.g. `BUY STOP LIMIT`. */
export function pendingTypeText(side: Side, type: PendingOrderType): string {
  return `${side} ${type.toUpperCase()}`;
}
