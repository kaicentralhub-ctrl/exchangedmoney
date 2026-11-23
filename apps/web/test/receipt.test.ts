import { describe, expect, it } from "vitest";
import { dayPercentile, FORM_DEFAULTS, formFromParams, num, pairSeries, referenceOn, totals, type SavedReceipt } from "../src/lib/receipt.js";

const eurGBP = [
  { date: "2026-11-18", rate: 0.87 },
  { date: "2026-11-19", rate: 0.875 },
  { date: "2026-11-20", rate: 0.873 },
];
const eurUSD = [
  { date: "2026-11-19", rate: 1.05 },
  { date: "2026-11-20", rate: 1.052 },
];

describe("reference rate on a date", () => {
  it("builds give → get series in every direction", () => {
    expect(pairSeries(eurGBP, null)[2]!.rate).toBeCloseTo(1 / 0.873); // GBP -> EUR
    expect(pairSeries(null, eurUSD)).toBe(eurUSD); // EUR -> USD
    expect(pairSeries(eurGBP, eurUSD)).toEqual([
      { date: "2026-11-19", rate: 1.05 / 0.875 },
      { date: "2026-11-20", rate: 1.052 / 0.873 },
    ]);
  });

  it("uses the nearest earlier publication within a week (weekends, holidays)", () => {
    expect(referenceOn(eurGBP, "2026-11-20")?.date).toBe("2026-11-20");
    expect(referenceOn(eurGBP, "2026-11-22")?.date).toBe("2026-11-20"); // Sunday -> Friday
    expect(referenceOn(eurGBP, "2026-12-05")).toBeNull(); // too far after
    expect(referenceOn(eurGBP, "2026-11-01")).toBeNull(); // before the series
  });

  it("ranks the day against the year before, needing enough history", () => {
    expect(dayPercentile(eurGBP, "2026-11-20")).toBeNull();
    const year = Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), rate: 1 + (i % 4) / 100 }));
    const r = dayPercentile(year, year.at(-1)!.date)!;
    expect(r.days).toBe(299);
    expect(r.betterThan).toBeGreaterThan(70);
  });
});

describe("form state from the URL", () => {
  it("reads values and ignores bad ones", () => {
    const f = formFromParams(new URLSearchParams("kind=atm&give=120.5&gc=GBP&get=140&qc=usd&date=bad&fee=1.5"), FORM_DEFAULTS("2026-11-20"));
    expect(f).toEqual({ kind: "atm", give: "120.5", giveCurrency: "GBP", get: "140", getCurrency: "EUR", fees: "1.5", date: "2026-11-20" });
    expect(formFromParams(new URLSearchParams("kind=nope"), FORM_DEFAULTS("2026-11-20")).kind).toBe("card");
    expect(num("1,250.50")).toBe(1250.5);
    expect(num("abc")).toBe(0);
  });
});

describe("saved receipt totals", () => {
  it("adds up cost per currency given", () => {
    const r = (give: string, gc: string, cost: number): SavedReceipt => ({
      id: give, savedAt: "", form: { ...FORM_DEFAULTS("2026-11-20"), give, giveCurrency: gc, fees: "1" }, referenceDate: "", referenceRate: 1, achievedRate: 1, shortfallPct: 1, costInGive: cost,
    });
    expect(totals([r("100", "GBP", 2), r("50", "GBP", 1), r("10", "EUR", 0.5)])).toEqual([
      { currency: "GBP", cost: 3, given: 152, count: 2 },
      { currency: "EUR", cost: 0.5, given: 11, count: 1 },
    ]);
  });
});
