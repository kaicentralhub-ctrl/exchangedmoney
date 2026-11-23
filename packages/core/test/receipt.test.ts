import { describe, expect, it } from "vitest";
import { analyseReceipt } from "../src/index.js";

describe("receipt analysis", () => {
  it("measures the gap to the reference rate and what it cost", () => {
    // Card payment: €45.00 charged as £40.12; ECB 1 GBP = 1.1455 EUR.
    const a = analyseReceipt({ give: 40.12, giveCurrency: "GBP", get: 45, getCurrency: "EUR" }, 1.1455)!;
    expect(a.achievedRate).toBeCloseTo(1.12164, 4);
    expect(a.shortfallPct).toBeCloseTo(2.083, 2);
    expect(a.fairGive).toBeCloseTo(39.284, 2);
    expect(a.costInGive).toBeCloseTo(0.836, 2);
  });

  it("counts fees charged on a separate line", () => {
    const a = analyseReceipt({ give: 39.28, giveCurrency: "GBP", get: 45, getCurrency: "EUR", separateFees: 1.08 }, 1.1455)!;
    expect(a.totalGive).toBeCloseTo(40.36);
    expect(a.costInGive).toBeCloseTo(40.36 - 45 / 1.1455, 6);
  });

  it("can show a rate better than the reference", () => {
    const a = analyseReceipt({ give: 100, giveCurrency: "GBP", get: 120, getCurrency: "EUR" }, 1.15)!;
    expect(a.shortfallPct).toBeLessThan(0);
    expect(a.costInGive).toBeLessThan(0);
  });

  it("refuses nonsense", () => {
    expect(analyseReceipt({ give: 0, giveCurrency: "GBP", get: 1, getCurrency: "EUR" }, 1.1)).toBeNull();
    expect(analyseReceipt({ give: 1, giveCurrency: "GBP", get: 1, getCurrency: "EUR" }, 0)).toBeNull();
    expect(analyseReceipt({ give: 1, giveCurrency: "GBP", get: Number.NaN, getCurrency: "EUR" }, 1)).toBeNull();
  });
});
