/**
 * Rate maths. All rates are "units of quote per 1 base".
 */

/**
 * How much worse a rate you got is than the reference, as a percentage.
 * Positive = you received less than the reference would have given.
 * Example: reference 1.20, you got 1.17 -> 2.5.
 */
export function shortfallPct(received: number, reference: number): number {
  assertPositive(received, "received");
  assertPositive(reference, "reference");
  return ((reference - received) / reference) * 100;
}

/**
 * Money lost against the reference, in the base currency.
 * You sent `amountBase`, the reference would have delivered amountBase * reference,
 * you received `amountQuoteReceived`.
 */
export function lossInBase(amountBase: number, amountQuoteReceived: number, reference: number): number {
  assertPositive(amountBase, "amountBase");
  assertPositive(reference, "reference");
  const fairQuote = amountBase * reference;
  return (fairQuote - amountQuoteReceived) / reference;
}

/**
 * Cross rate from two rates that share a base (usually EUR, as the ECB publishes).
 * baseToA: units of A per 1 base. baseToB: units of B per 1 base. Returns units of B per 1 A.
 */
export function crossRate(baseToA: number, baseToB: number): number {
  assertPositive(baseToA, "baseToA");
  assertPositive(baseToB, "baseToB");
  return baseToB / baseToA;
}

/**
 * Share of historical values that `value` beats, 0-100.
 * `higherIsBetter` = true when more quote per base is good for the user.
 * "Better than 82% of days" -> percentileRank(history, today, true) === 82.
 */
export function percentileRank(history: readonly number[], value: number, higherIsBetter = true): number {
  if (history.length === 0) throw new RangeError("history is empty");
  let beaten = 0;
  for (const h of history) {
    if (higherIsBetter ? value > h : value < h) beaten++;
  }
  return (beaten / history.length) * 100;
}

function assertPositive(n: number, name: string): void {
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`${name} must be a positive number, got ${n}`);
}
