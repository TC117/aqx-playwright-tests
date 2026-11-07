/** Helpers for reading numbers shown by the web trader and for price arithmetic. */

/**
 * Parses a number as displayed by the UI: `1,114.10`, `+1,000,000.00`, `-10.30`, `1 : 1.03` (last
 * number wins). Returns `null` for empty cells and the `--` placeholder.
 */
export function parseUiNumber(text: string | null | undefined): number | null {
  const cleaned = (text ?? '').replace(/,/g, '').trim();
  if (!cleaned || /^-+$/.test(cleaned)) return null;
  const matches = cleaned.match(/[-+]?\d+(?:\.\d+)?/g);
  if (!matches) return null;
  return Number(matches[matches.length - 1]);
}

/** Like {@link parseUiNumber} but throws when the text holds no number. */
export function requireUiNumber(text: string | null | undefined, what = 'value'): number {
  const value = parseUiNumber(text);
  if (value === null) throw new Error(`Expected a number for ${what}, got "${text ?? ''}"`);
  return value;
}

/** Rounds to the symbol's number of digits, avoiding binary float noise. */
export function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** Formats a price with exactly `digits` decimals, as the inputs expect. */
export function formatPrice(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** Moves `price` by a number of points (`point` = smallest price step, e.g. 0.0001). */
export function offsetByPoints(
  price: number,
  points: number,
  point: number,
  digits: number,
): number {
  return roundTo(price + points * point, digits);
}

/** True when two prices are within `tolerance` of each other. */
export function closeTo(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance + Number.EPSILON;
}
