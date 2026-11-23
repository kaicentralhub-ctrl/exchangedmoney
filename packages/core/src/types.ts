/**
 * Shared data model.
 *
 * Principle: raw snapshots are the source of truth and are never edited.
 * Everything below is derived from them and can be recomputed.
 */

/** ISO 4217 code, upper case, e.g. "GBP". */
export type CurrencyCode = string;

/** What kind of rate an observation is. */
export type RateKind =
  | "reference" // central-bank or blended mid-market reference rate
  | "card-network" // Visa / Mastercard daily conversion rate
  | "provider" // a transfer provider's quoted rate
  | "street" // parallel / P2P market rate
  | "achieved"; // what a user actually received (receipts)

/**
 * One exchange rate at one moment.
 * `rate` is units of `quote` per 1 unit of `base` (EUR/USD 1.08 = base EUR, quote USD).
 */
export interface RateObservation {
  source: string;
  kind: RateKind;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: number;
  /** The date the rate applies to, YYYY-MM-DD (the publisher's date, not ours). */
  rateDate: string;
}

export type CardNetwork = "visa" | "mastercard" | "unknown";
export type CardType = "debit" | "credit" | "unknown";
export type MarkupContext = "purchase" | "atm" | "unknown";
export type CustomerSegment = "personal" | "business" | "unknown";

/**
 * A card issuer's published currency conversion markup over the ECB reference rate,
 * as required by the Cross-Border Payments Regulation disclosures.
 */
export interface IssuerMarkup {
  issuer: string;
  /** The product label exactly as the issuer publishes it. */
  product: string;
  network: CardNetwork;
  cardType: CardType;
  segment: CustomerSegment;
  context: MarkupContext;
  currency: CurrencyCode;
  /** Percentage, e.g. 2.95 means 2.95% over the ECB reference rate. Can be negative. */
  markupPct: number;
  /** The issuer's own "last updated" timestamp, ISO 8601, if the page shows one. */
  publishedAt: string | null;
}

/** Result of parsing one raw snapshot. Parsing never throws; problems are reported. */
export interface ParseResult {
  observations: RateObservation[];
  markups: IssuerMarkup[];
  warnings: string[];
}

export const emptyParse = (): ParseResult => ({ observations: [], markups: [], warnings: [] });
