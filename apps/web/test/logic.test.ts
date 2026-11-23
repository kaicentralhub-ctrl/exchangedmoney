import { describe, expect, it } from "vitest";
import type { IssuerMarkup } from "@exm/core/types";
import { toCsv } from "../src/lib/csv.js";
import { filterMarkups, ranks } from "../src/lib/markups.js";
import { crossSeries, euroRates, windowStats } from "../src/lib/rates.js";
import { score } from "../src/lib/score.js";
import { BUNDLE_SCHEMA, type RatesBundle } from "@exm/core/bundles";

const mk = (issuer: string, product: string, pct: number, over: Partial<IssuerMarkup> = {}): IssuerMarkup => ({
  issuer, product, network: "visa", cardType: "debit", segment: "personal", context: "purchase", currency: "EUR", markupPct: pct, publishedAt: null, ...over,
});

describe("card league", () => {
  const all = [
    mk("B", "VISA debit card", 2.99),
    mk("A", "VISA debit card", 2.75),
    mk("A", "VISA credit card", 2.99, { cardType: "credit" }),
    mk("C", "Mastercard debit card", 3.5, { network: "mastercard" }),
    mk("A", "VISA debit card", 1.0, { currency: "USD" }),
    mk("A", "VISA debit card", 4.0, { context: "atm" }),
  ];
  const base = { cur: "EUR", seg: "personal", ctx: "purchase", type: "all", net: "all" };

  it("filters to one currency, segment and context, cheapest first", () => {
    expect(filterMarkups(all, base).map((m) => `${m.issuer}:${m.markupPct}`)).toEqual(["A:2.75", "A:2.99", "B:2.99", "C:3.5"]);
  });
  it("filters by card type and network", () => {
    expect(filterMarkups(all, { ...base, type: "credit" })).toHaveLength(1);
    expect(filterMarkups(all, { ...base, net: "mastercard" }).map((m) => m.issuer)).toEqual(["C"]);
  });
  it("ranks ties together", () => {
    expect(ranks(filterMarkups(all, base))).toEqual(["1", "=2", "=2", "4"]);
  });
});

describe("rates", () => {
  const bundle: RatesBundle = {
    schema: BUNDLE_SCHEMA, kind: "rates", provenance: {}, columns: ["source", "base", "quote", "rate", "rateDate"],
    rows: [
      ["frankfurter", "EUR", "GBP", 0.9, "2026-11-20"],
      ["ecb-daily", "EUR", "GBP", 0.873, "2026-11-20"],
      ["frankfurter", "EUR", "AED", 3.86, "2026-11-20"],
      ["ecb-daily", "USD", "JPY", 150, "2026-11-20"],
    ],
  };
  it("prefers the ECB and fills gaps from Frankfurter", () => {
    const eur = euroRates(bundle);
    expect(eur.get("GBP")).toMatchObject({ rate: 0.873, source: "ecb-daily" });
    expect(eur.get("AED")?.source).toBe("frankfurter");
    expect(eur.has("JPY")).toBe(false);
    expect(eur.get("EUR")?.rate).toBe(1);
  });

  it("crosses two euro series on shared dates only", () => {
    const gbp = [{ date: "2026-11-19", rate: 0.8 }, { date: "2026-11-20", rate: 0.875 }];
    const usd = [{ date: "2026-11-18", rate: 1.0 }, { date: "2026-11-20", rate: 1.05 }];
    expect(crossSeries(gbp, usd)).toEqual([{ date: "2026-11-20", rate: 1.2 }]);
    expect(crossSeries(null, usd)).toBe(usd);
  });

  it("says how the latest rate compares with each window", () => {
    const series = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), rate: i < 99 ? 1 + (i % 10) / 100 : 1.055 }));
    const [all] = windowStats(series, [{ label: "All", years: null }]);
    expect(all!.days).toBe(100);
    expect(all!.betterThan).toBe(60); // beats the 1.00–1.05 values: 6 of every 10 days
    expect(all!.low).toBe(1);
    expect(windowStats(series.slice(0, 5), [{ label: "All", years: null }])).toEqual([]);
  });
});

describe("csv", () => {
  it("quotes, escapes and defuses formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["=SUM(A1)", null], [-1.5, "-ok"]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),\r\n-1.5,\'-ok\r\n');
  });
});

describe("command matching", () => {
  it("prefers contiguous matches and rejects missing letters", () => {
    expect(score("cards", "Go to Cards")).toBeGreaterThan(score("cards", "Cash machine rates"));
    expect(score("eur", "Markups in EUR: Euro")).toBeGreaterThan(0);
    expect(score("xyz", "Markets")).toBe(0);
    expect(score("", "anything")).toBe(1);
  });
});
