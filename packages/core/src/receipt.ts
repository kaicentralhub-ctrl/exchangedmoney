/**
 * Receipt check: what rate did you actually get, and what did the gap to the reference rate cost?
 * All rates are units of what you got per 1 unit of what you gave.
 */
import { lossInBase, shortfallPct } from "./math.js";

export interface ReceiptInput {
  /** What you handed over, sent, or were charged, in `giveCurrency` (excluding separate fees). */
  give: number;
  giveCurrency: string;
  /** What you received, or the local amount of the purchase, in `getCurrency`. */
  get: number;
  getCurrency: string;
  /** Fees charged separately, in `giveCurrency` (e.g. a non-sterling fee shown as its own line). */
  separateFees?: number;
}

export interface ReceiptAnalysis {
  /** What you got per unit given, counting separate fees. */
  achievedRate: number;
  referenceRate: number;
  /** % less than the reference would have given. Negative means you beat the reference. */
  shortfallPct: number;
  /** Cost of the gap, in what you gave. */
  costInGive: number;
  /** What `get` would have cost at the reference rate, in what you gave. */
  fairGive: number;
  totalGive: number;
}

export function analyseReceipt(r: ReceiptInput, referenceRate: number): ReceiptAnalysis | null {
  const fees = Math.max(0, r.separateFees ?? 0);
  const totalGive = r.give + fees;
  if (!(r.give > 0) || !(r.get > 0) || !(referenceRate > 0) || !Number.isFinite(totalGive)) return null;
  const achievedRate = r.get / totalGive;
  return {
    achievedRate,
    referenceRate,
    shortfallPct: shortfallPct(achievedRate, referenceRate),
    costInGive: lossInBase(totalGive, r.get, referenceRate),
    fairGive: r.get / referenceRate,
    totalGive,
  };
}
