/** Rate helpers for the browser. All rates are units of quote per 1 base. */
import { decodeSeries, type HistoryBundle, type RatesBundle, type SeriesPoint } from "@exm/core/bundles";
import { percentileRank } from "@exm/core/math";

export interface EuroRate {
  quote: string;
  rate: number;
  date: string;
  source: string;
}

/** Euro-based rates, ECB first and Frankfurter for currencies the ECB doesn't publish. */
export function euroRates(bundle: RatesBundle): Map<string, EuroRate> {
  const out = new Map<string, EuroRate>([["EUR", { quote: "EUR", rate: 1, date: "", source: "identity" }]]);
  const order = ["ecb-daily", "frankfurter"];
  const rows = bundle.rows.filter((r) => r[1] === "EUR" && order.includes(r[0])).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  for (const [source, , quote, rate, date] of rows) if (!out.has(quote)) out.set(quote, { quote, rate, date, source });
  return out;
}

/** History of base -> quote from two euro-based series, on dates both have. */
export function crossSeries(eurBase: SeriesPoint[] | null, eurQuote: SeriesPoint[] | null): SeriesPoint[] {
  if (!eurQuote) return [];
  if (!eurBase) return eurQuote;
  const b = new Map(eurBase.map((p) => [p.date, p.rate]));
  return eurQuote.flatMap((p) => {
    const br = b.get(p.date);
    return br ? [{ date: p.date, rate: p.rate / br }] : [];
  });
}

export const seriesOf = (h: HistoryBundle | null): SeriesPoint[] | null => (h ? decodeSeries(h) : null);

export interface WindowStat {
  label: string;
  days: number;
  /** Share of days in the window with a worse rate than the latest (higher = better for converting base into quote). */
  betterThan: number;
  low: number;
  high: number;
}

/** "Better than N% of days" for the latest point, over trailing windows. Statistics, not forecasts. */
export function windowStats(series: SeriesPoint[], windows: { label: string; years: number | null }[]): WindowStat[] {
  const last = series.at(-1);
  if (!last) return [];
  const end = Date.parse(`${last.date}T00:00:00Z`);
  return windows.flatMap((w) => {
    const from = w.years === null ? -Infinity : end - w.years * 365.25 * 86_400_000;
    const vals = series.filter((p) => Date.parse(`${p.date}T00:00:00Z`) >= from).map((p) => p.rate);
    if (vals.length < 20) return [];
    return [{ label: w.label, days: vals.length, betterThan: percentileRank(vals, last.rate, true), low: Math.min(...vals), high: Math.max(...vals) }];
  });
}

/** GBP value of an amount at the reference rate, from euro-based rates; null if either rate is missing. */
export function gbpConverter(eur: Map<string, EuroRate>): (currency: string, amount: number) => number | null {
  const g = eur.get("GBP")?.rate;
  return (currency, amount) => {
    if (currency === "GBP") return amount;
    const r = eur.get(currency)?.rate;
    return g && r ? (amount / r) * g : null;
  };
}
