/**
 * The fee model: what a card charges for spending and withdrawing in a foreign currency,
 * and an engine that prices any spend or withdrawal against it.
 *
 * Every fee schedule records where it came from and when we last checked it. Pure: runs in
 * the Worker, the browser and Node tests.
 *
 * How the two kinds of evidence fit together
 * - The fee schedule (the issuer's tariff page) is contractual. We price from it.
 * - The issuer's published markup over the ECB rate (CBPR disclosure) covers its percentage
 *   conversion charges plus the card network's own margin. Where it agrees with the schedule,
 *   the difference is our estimate of that network margin. Where it doesn't, we say so.
 */
import type { CardNetwork, CustomerSegment, IssuerMarkup, MarkupContext } from "./types.js";

export type SpendContext = Exclude<MarkupContext, "unknown">;

export interface Allowance {
  /** Fee-free amount per period, in GBP. */
  gbp?: number;
  /** Fee-free number of transactions per period. */
  count?: number;
  /**
   * day / month: calendar periods. 30-days-from-first: a window that opens with the first
   * transaction it covers and lasts 30 days (Monzo's rule), then reopens with the next one.
   */
  period: "day" | "month" | "30-days-from-first";
}

/** Currencies of the European Economic Area (Bulgaria kept for issuers that still list the lev). */
export const EEA_CURRENCIES = ["EUR", "BGN", "CZK", "DKK", "HUF", "ISK", "NOK", "PLN", "RON", "SEK"] as const;

interface FeeBase {
  /** As the issuer names it, e.g. "Non-sterling transaction fee". */
  name: string;
  appliesTo: SpendContext[];
  /** Whether the issuer's published markup over ECB includes this fee's percentage. */
  inDisclosedMarkup: boolean;
  allowance?: Allowance;
  /** Limit the rule to some currencies (e.g. outside the EEA only). Absent = every currency. */
  currencies?: { only?: readonly string[]; except?: readonly string[] };
}

const appliesToCurrency = (rule: FeeRule, currency: string) =>
  (!rule.currencies?.only || rule.currencies.only.includes(currency)) && !rule.currencies?.except?.includes(currency);

export type FeeRule =
  | (FeeBase & { kind: "percent"; pct: number; minGBP?: number; maxGBP?: number })
  | (FeeBase & { kind: "fixed"; gbp: number });

export interface FeeSource {
  label: string;
  url: string;
  /** Date we last read the page and confirmed these fees (YYYY-MM-DD). */
  checkedAt: string;
}

export interface CardProduct {
  /** Stable id, "issuer-slug/product-slug". */
  id: string;
  /** Exactly as in the issuer's markup disclosure, so the two can be joined. */
  issuer: string;
  name: string;
  cardType: "debit" | "credit";
  segment: Exclude<CustomerSegment, "unknown">;
  networks: CardNetwork[];
  /**
   * Which rows of the issuer's markup disclosure describe this card, per context:
   * a case-insensitive pattern matched against the published product label.
   */
  markupMatch: Record<SpendContext, string>;
  fees: FeeRule[];
  /** Things the user should know that the numbers don't capture. */
  caveats: string[];
  sources: FeeSource[];
}

export interface Spend {
  context: SpendContext;
  currency: string;
  /** In the foreign currency. */
  amount: number;
  /** YYYY-MM-DD; used for daily and monthly allowances. Undated spends share one period. */
  date?: string;
}

export interface CostLine {
  label: string;
  gbp: number;
  basis: "fee-schedule" | "estimate";
  detail: string;
}

export type DisclosureCheck =
  | { status: "consistent"; disclosedPct: number; schedulePct: number }
  | { status: "conflict"; disclosedPct: number; schedulePct: number }
  | { status: "none" };

export interface SpendCost {
  spend: Spend;
  /** Value of the spend at the reference (ECB) rate, in GBP. Null if we have no rate. */
  baseGBP: number | null;
  lines: CostLine[];
  totalGBP: number;
  /** Total cost as a share of the base value. */
  effectivePct: number;
  check: DisclosureCheck;
  notes: string[];
}

export interface PricingContext {
  /** Value of `amount` of `currency` in GBP at the reference rate, or null if unknown. */
  toGBP: (currency: string, amount: number) => number | null;
  /** The issuer's published markup rows (all issuers is fine; they're filtered). */
  markups: readonly IssuerMarkup[];
  network: CardNetwork;
  /** Typical network margin over ECB by "network|currency", from estimateNetworkMargins. */
  networkMargins?: ReadonlyMap<string, NetworkMargin>;
}

export interface NetworkMargin {
  pct: number;
  /** How many card/context disclosures it was derived from. */
  samples: number;
}

/** Disclosed and schedule figures within this band (percentage points) count as agreeing. */
export const AGREEMENT_BAND = { below: 0.5, above: 1.0 } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtGBP = (n: number) => `£${n.toFixed(2)}`;

/** The issuer's disclosed markup for this card, context and currency, if it publishes one. */
export function disclosedMarkup(card: CardProduct, markups: readonly IssuerMarkup[], context: SpendContext, currency: string, network: CardNetwork): number | null {
  const re = new RegExp(card.markupMatch[context], "i");
  const rows = markups.filter(
    (m) => m.issuer === card.issuer && m.segment === card.segment && m.context === context && m.currency === currency && m.cardType === card.cardType && m.network === network && re.test(m.product),
  );
  if (rows.length === 0) return null;
  // Several labels can match (e.g. when a disclosure splits a product we treat as one); take the lowest.
  return Math.min(...rows.map((r) => r.markupPct));
}

/** The percentage the schedule says should appear in the disclosure for this context. */
export function schedulePct(card: CardProduct, context: SpendContext, currency?: string): number {
  return card.fees.filter((f) => f.kind === "percent" && f.inDisclosedMarkup && f.appliesTo.includes(context) && (!currency || appliesToCurrency(f, currency))).reduce((a, f) => a + (f as { pct: number }).pct, 0);
}

export function checkDisclosure(disclosed: number | null, scheduled: number): DisclosureCheck {
  if (disclosed === null) return { status: "none" };
  const diff = disclosed - scheduled;
  const ok = diff >= -AGREEMENT_BAND.below && diff <= AGREEMENT_BAND.above;
  return { status: ok ? "consistent" : "conflict", disclosedPct: disclosed, schedulePct: round2(scheduled) };
}

type UsageState = Map<string, { gbp: number; count: number; start?: string }>;

const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** How much of this spend (in GBP) is above the rule's allowance, updating usage. */
function chargeable(rule: FeeRule, ruleIndex: number, gbp: number, date: string | undefined, usage: UsageState): number {
  const a = rule.allowance;
  if (!a) return gbp;
  const d = date ?? "undated";
  let key: string;
  let used: { gbp: number; count: number; start?: string };
  if (a.period === "30-days-from-first") {
    key = `${ruleIndex}:window`;
    const w = usage.get(key);
    const expired = w?.start && date && w.start !== "undated" && date >= plusDays(w.start, 30);
    used = !w || expired ? { gbp: 0, count: 0, start: d } : w;
  } else {
    key = `${ruleIndex}:${a.period === "day" ? d.slice(0, 10) : d.slice(0, 7)}`;
    used = usage.get(key) ?? { gbp: 0, count: 0 };
  }
  let free = gbp;
  if (a.count !== undefined && used.count >= a.count) free = 0;
  if (a.gbp !== undefined) free = Math.min(free, Math.max(0, a.gbp - used.gbp));
  usage.set(key, { ...used, gbp: used.gbp + gbp, count: used.count + 1 });
  return gbp - free;
}

/** Price one spend. Pass the same `usage` map across a trip so allowances carry over. */
export function priceSpend(spend: Spend, card: CardProduct, ctx: PricingContext, usage: UsageState = new Map()): SpendCost {
  const notes: string[] = [];
  const baseGBP = ctx.toGBP(spend.currency, spend.amount);
  const disclosed = disclosedMarkup(card, ctx.markups, spend.context, spend.currency, ctx.network);
  const scheduled = schedulePct(card, spend.context, spend.currency);
  const check = checkDisclosure(disclosed, scheduled);
  if (baseGBP === null) {
    return { spend, baseGBP, lines: [], totalGBP: 0, effectivePct: 0, check, notes: [`No reference rate for ${spend.currency} yet, so this can't be priced.`] };
  }

  const lines: CostLine[] = [];
  card.fees.forEach((rule, i) => {
    if (!rule.appliesTo.includes(spend.context) || !appliesToCurrency(rule, spend.currency)) return;
    const over = chargeable(rule, i, baseGBP, spend.date, usage);
    if (rule.kind === "percent") {
      if (over <= 0) return void notes.push(`${rule.name}: within the fee-free allowance.`);
      const raw = (over * rule.pct) / 100;
      let gbp = raw;
      if (rule.minGBP !== undefined) gbp = Math.max(gbp, rule.minGBP);
      if (rule.maxGBP !== undefined) gbp = Math.min(gbp, rule.maxGBP);
      const clamp = gbp !== raw ? (gbp === rule.minGBP ? ` (minimum ${fmtGBP(rule.minGBP)})` : ` (maximum ${fmtGBP(rule.maxGBP!)})`) : "";
      lines.push({ label: rule.name, gbp: round2(gbp), basis: "fee-schedule", detail: `${rule.pct}% of ${fmtGBP(over)}${clamp}` });
    } else {
      if (over <= 0) return void notes.push(`${rule.name}: within the fee-free allowance.`);
      lines.push({ label: rule.name, gbp: rule.gbp, basis: "fee-schedule", detail: `${fmtGBP(rule.gbp)} per transaction` });
    }
  });

  if (check.status === "consistent") {
    const margin = Math.max(0, check.disclosedPct - check.schedulePct);
    if (margin > 0) {
      lines.push({
        label: "Card network's rate vs ECB",
        gbp: round2((baseGBP * margin) / 100),
        basis: "estimate",
        detail: `${margin.toFixed(2)}%: the issuer's disclosed ${check.disclosedPct}% less the ${check.schedulePct}% in its fee schedule`,
      });
    }
  } else {
    const typical = ctx.networkMargins?.get(`${ctx.network}|${spend.currency}`);
    const net = ctx.network === "visa" ? "Visa" : ctx.network === "mastercard" ? "Mastercard" : "the network";
    if (typical && typical.pct > 0) {
      lines.push({
        label: "Card network's rate vs ECB",
        gbp: round2((baseGBP * typical.pct) / 100),
        basis: "estimate",
        detail: `${typical.pct.toFixed(2)}%: typical for ${net} in ${spend.currency}, from ${typical.samples} issuer disclosures that agree with their fee schedules`,
      });
    } else {
      notes.push("Plus the card network's own margin over the ECB rate, usually a fraction of a percent. We'll measure it directly once we collect Visa and Mastercard rates.");
    }
    if (check.status === "conflict") {
      notes.push(
        `${card.issuer}'s published markup for this card is ${check.disclosedPct}% over ECB, but its fee schedule adds up to ${check.schedulePct}%. We price from the fee schedule and show both.`,
      );
    }
  }

  const totalGBP = round2(lines.reduce((a, l) => a + l.gbp, 0));
  return { spend, baseGBP: round2(baseGBP), lines, totalGBP, effectivePct: baseGBP > 0 ? (totalGBP / baseGBP) * 100 : 0, check, notes };
}

/**
 * The network's margin over ECB is a property of the network, currency and day, not the card.
 * Estimate it per network and currency as the median of (disclosed markup − schedule percentage)
 * across every product and context where the two agree.
 */
export function estimateNetworkMargins(products: readonly CardProduct[], markups: readonly IssuerMarkup[]): Map<string, NetworkMargin> {
  const samples = new Map<string, number[]>();
  const currencies = [...new Set(markups.map((m) => m.currency))];
  for (const p of products)
    for (const network of p.networks)
      for (const context of ["purchase", "atm"] as const)
        for (const currency of currencies) {
          const check = checkDisclosure(disclosedMarkup(p, markups, context, currency, network), schedulePct(p, context, currency));
          if (check.status !== "consistent") continue;
          const key = `${network}|${currency}`;
          samples.set(key, [...(samples.get(key) ?? []), Math.max(0, check.disclosedPct - check.schedulePct)]);
        }
  const out = new Map<string, NetworkMargin>();
  for (const [key, vals] of samples) {
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    out.set(key, { pct: round2(median), samples: sorted.length });
  }
  return out;
}

export interface TripCost {
  card: CardProduct;
  network: CardNetwork;
  spends: SpendCost[];
  totalGBP: number;
  baseGBP: number;
  /** Spends we couldn't price (no rate). */
  unpriced: number;
}

/** Price a list of spends in order on one card, carrying allowances across them. */
export function priceTrip(spends: readonly Spend[], card: CardProduct, ctx: PricingContext): TripCost {
  const usage: UsageState = new Map();
  const ordered = [...spends].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const priced = ordered.map((s) => priceSpend(s, card, ctx, usage));
  return {
    card,
    network: ctx.network,
    spends: priced,
    totalGBP: round2(priced.reduce((a, s) => a + s.totalGBP, 0)),
    baseGBP: round2(priced.reduce((a, s) => a + (s.baseGBP ?? 0), 0)),
    unpriced: priced.filter((s) => s.baseGBP === null).length,
  };
}

export interface CardChoice {
  card: CardProduct;
  network: CardNetwork;
}

export interface Assignment {
  /** The spend priced on the chosen card. */
  cost: SpendCost;
  choice: CardChoice;
  /** What each card would have cost for this spend, given its allowances used so far. */
  options: { choice: CardChoice; totalGBP: number }[];
}

/**
 * The cheapest card for each spend, in date order. Each card keeps its own allowance usage,
 * so a card's fee-free allowance is used up only by the spends assigned to it. Greedy: the
 * cheapest card now, which is optimal unless allowances would be better saved for later.
 */
export function bestCardPerSpend(spends: readonly Spend[], choices: readonly CardChoice[], base: Omit<PricingContext, "network">): { assignments: Assignment[]; totalGBP: number } {
  if (choices.length === 0) return { assignments: [], totalGBP: 0 };
  const usages: UsageState[] = choices.map(() => new Map());
  const ordered = [...spends].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const assignments = ordered.map((spend) => {
    const trial = choices.map((choice, i) => priceSpend(spend, choice.card, { ...base, network: choice.network }, new Map(usages[i])));
    let best = 0;
    trial.forEach((t, i) => {
      if (t.totalGBP < trial[best]!.totalGBP) best = i;
    });
    // Commit: price again against the real usage so the chosen card's allowances advance.
    const cost = priceSpend(spend, choices[best]!.card, { ...base, network: choices[best]!.network }, usages[best]);
    return { cost, choice: choices[best]!, options: choices.map((choice, i) => ({ choice, totalGBP: trial[i]!.totalGBP })) };
  });
  return { assignments, totalGBP: round2(assignments.reduce((a, x) => a + x.cost.totalGBP, 0)) };
}

/** Fee schedules last checked more than `days` ago. */
export function staleProducts(products: readonly CardProduct[], now: Date, days = 90): { product: CardProduct; checkedAt: string }[] {
  const limit = now.getTime() - days * 86_400_000;
  return products.flatMap((p) => {
    const oldest = p.sources.map((s) => s.checkedAt).sort()[0];
    return oldest && Date.parse(`${oldest}T00:00:00Z`) < limit ? [{ product: p, checkedAt: oldest }] : [];
  });
}
