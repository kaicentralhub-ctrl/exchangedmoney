/** Receipt helpers for the browser: reference rate on a date, URL state, saved receipts. Pure. */
import type { SeriesPoint } from "@exm/core/bundles";
import { percentileRank } from "@exm/core/math";
import type { ReceiptAnalysis } from "@exm/core/receipt";
import { crossSeries } from "./rates.js";

export type ReceiptKind = "card" | "atm" | "bureau" | "transfer";
export const KINDS: { value: ReceiptKind; label: string }[] = [
  { value: "card", label: "Card payment" },
  { value: "atm", label: "Cash machine" },
  { value: "bureau", label: "Bureau or cash exchange" },
  { value: "transfer", label: "Money transfer" },
];

export const LABELS: Record<ReceiptKind, { give: string; get: string; getFirst: boolean }> = {
  card: { get: "Amount on the receipt", give: "Charged on your statement", getFirst: true },
  atm: { get: "Cash you got", give: "Taken from your account", getFirst: true },
  bureau: { give: "You handed over", get: "You received", getFirst: false },
  transfer: { give: "You sent", get: "They received", getFirst: false },
};

/** Series of give → get (units of get per 1 give) from euro-based ECB series; null = that side is EUR. */
export function pairSeries(eurGive: SeriesPoint[] | null, eurGet: SeriesPoint[] | null): SeriesPoint[] {
  if (eurGive && !eurGet) return eurGive.map((p) => ({ date: p.date, rate: 1 / p.rate })); // give X, get EUR
  return crossSeries(eurGive, eurGet);
}

/** The reference on `date`, or the nearest earlier publication within `maxDays` (weekends, holidays). */
export function referenceOn(series: SeriesPoint[], date: string, maxDays = 7): SeriesPoint | null {
  const limit = new Date(Date.parse(`${date}T00:00:00Z`) - maxDays * 86_400_000).toISOString().slice(0, 10);
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i]!;
    if (p.date <= date) return p.date >= limit ? p : null;
  }
  return null;
}

/** Share of the 365 days before `date` whose reference rate was worse (less got per given) than on `date`. */
export function dayPercentile(series: SeriesPoint[], date: string): { betterThan: number; days: number } | null {
  const on = referenceOn(series, date);
  if (!on) return null;
  const from = new Date(Date.parse(`${on.date}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const window = series.filter((p) => p.date >= from && p.date < on.date).map((p) => p.rate);
  if (window.length < 20) return null;
  return { betterThan: percentileRank(window, on.rate, true), days: window.length };
}

/* ---------------- URL state ---------------- */

export interface ReceiptForm {
  kind: ReceiptKind;
  give: string;
  giveCurrency: string;
  get: string;
  getCurrency: string;
  fees: string;
  date: string;
}

export const FORM_DEFAULTS = (date: string): ReceiptForm => ({ kind: "card", give: "", giveCurrency: "GBP", get: "", getCurrency: "EUR", fees: "", date });

const KEYS: Record<keyof ReceiptForm, string> = { kind: "kind", give: "give", giveCurrency: "gc", get: "get", getCurrency: "qc", fees: "fee", date: "date" };

export function formFromParams(p: URLSearchParams, defaults: ReceiptForm): ReceiptForm {
  const f = { ...defaults };
  for (const [k, q] of Object.entries(KEYS) as [keyof ReceiptForm, string][]) {
    const v = p.get(q);
    if (v !== null) (f as Record<string, string>)[k] = v;
  }
  if (!KINDS.some((k) => k.value === f.kind)) f.kind = "card";
  if (!/^[A-Z]{3}$/.test(f.giveCurrency)) f.giveCurrency = defaults.giveCurrency;
  if (!/^[A-Z]{3}$/.test(f.getCurrency)) f.getCurrency = defaults.getCurrency;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) f.date = defaults.date;
  return f;
}

export const paramKey = (k: keyof ReceiptForm) => KEYS[k];
export const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/* ---------------- saved receipts ---------------- */

export interface SavedReceipt {
  id: string;
  savedAt: string;
  form: ReceiptForm;
  referenceDate: string;
  referenceRate: number;
  achievedRate: number;
  shortfallPct: number;
  costInGive: number;
}

const STORE = "exm.receipts.v1";

export function toSaved(form: ReceiptForm, a: ReceiptAnalysis, referenceDate: string, now: Date): SavedReceipt {
  return {
    id: `r${now.getTime().toString(36)}`,
    savedAt: now.toISOString(),
    form,
    referenceDate,
    referenceRate: a.referenceRate,
    achievedRate: a.achievedRate,
    shortfallPct: a.shortfallPct,
    costInGive: a.costInGive,
  };
}

export function loadReceipts(): SavedReceipt[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((r): r is SavedReceipt => !!r && typeof r === "object" && typeof (r as SavedReceipt).id === "string" && typeof (r as SavedReceipt).costInGive === "number") : [];
  } catch {
    return [];
  }
}

export function storeReceipts(list: SavedReceipt[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 500)));
  } catch {
    /* storage unavailable; the list lasts for this visit */
  }
}

/** Total cost against the reference, per currency given. */
export function totals(list: SavedReceipt[]): { currency: string; cost: number; given: number; count: number }[] {
  const by = new Map<string, { cost: number; given: number; count: number }>();
  for (const r of list) {
    const t = by.get(r.form.giveCurrency) ?? { cost: 0, given: 0, count: 0 };
    by.set(r.form.giveCurrency, { cost: t.cost + r.costInGive, given: t.given + num(r.form.give) + num(r.form.fees), count: t.count + 1 });
  }
  return [...by].map(([currency, t]) => ({ currency, ...t }));
}
