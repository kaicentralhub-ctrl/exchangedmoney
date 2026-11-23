/** Paying in pounds abroad (dynamic currency conversion) versus letting the card convert. */

/** Cost of paying `gbp` worth in pounds when the terminal adds `dccPct` over the reference rate. */
export const dccCost = (gbp: number, dccPct: number) => (gbp * dccPct) / 100;

/**
 * A terminal's markup below this (in %) would be cheaper than the card converting, for spends
 * like these. It's the card's own effective rate on them.
 */
export const breakEvenPct = (cardCostGBP: number, baseGBP: number) => (baseGBP > 0 ? (cardCostGBP / baseGBP) * 100 : 0);
