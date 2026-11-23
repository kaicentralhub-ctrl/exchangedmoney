import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseEcbHistoryCsv,
  parseEcbXml,
  parseFrankfurter,
  parseHsbcCbpr,
  parseLastUpdated,
  parsePercent,
  type IssuerMarkup,
} from "../src/index.js";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

describe("ECB daily XML", () => {
  it("reads every currency with the publication date", () => {
    const r = parseEcbXml(fixture("ecb-daily.synthetic.xml"));
    expect(r.warnings).toEqual([]);
    expect(r.observations).toHaveLength(4);
    expect(r.observations[0]).toEqual({ source: "ecb-daily", kind: "reference", base: "EUR", quote: "USD", rate: 1.0812, rateDate: "2026-11-20" });
  });

  it("handles several dates (90-day history file)", () => {
    const xml = `<Cube><Cube time='2026-11-20'><Cube currency='USD' rate='1.08'/></Cube><Cube time='2026-11-19'><Cube currency='USD' rate='1.07'/></Cube></Cube>`;
    const r = parseEcbXml(xml);
    expect(r.observations.map((o) => o.rateDate)).toEqual(["2026-11-20", "2026-11-19"]);
  });

  it("warns instead of throwing on junk", () => {
    const r = parseEcbXml("<html>maintenance</html>");
    expect(r.observations).toEqual([]);
    expect(r.warnings).toContain("no rates found in ECB XML");
  });
});

describe("ECB history CSV", () => {
  it("skips N/A cells and trailing commas", () => {
    const csv = "Date,USD,JPY,CYP,\n2026-11-20,1.0812,162.34,N/A,\n2026-11-19,1.0790,161.90,,\n";
    const r = parseEcbHistoryCsv(csv);
    expect(r.observations).toHaveLength(4);
    expect(r.observations.find((o) => o.quote === "CYP")).toBeUndefined();
  });
});

describe("Frankfurter", () => {
  it("reads the v1 object shape", () => {
    const r = parseFrankfurter(JSON.stringify({ amount: 1, base: "EUR", date: "2026-11-20", rates: { USD: 1.0812, GBP: 0.8431 } }));
    expect(r.observations).toHaveLength(2);
    expect(r.observations[1]).toMatchObject({ base: "EUR", quote: "GBP", rate: 0.8431, rateDate: "2026-11-20" });
  });

  it("reads row arrays", () => {
    const r = parseFrankfurter(JSON.stringify([{ date: "2026-11-20", base: "EUR", quote: "USD", rate: 1.08 }]));
    expect(r.observations).toHaveLength(1);
  });

  it("reads the live v2 shape: rows with per-currency dates, crypto tokens skipped quietly", () => {
    const r = parseFrankfurter(
      JSON.stringify([
        { date: "2026-11-23", base: "EUR", quote: "USD", rate: 1.0986 },
        { date: "2026-11-20", base: "EUR", quote: "ANG", rate: 1.97 },
        { date: "2026-11-22", base: "EUR", quote: "USDT", rate: 1.1006 },
        { date: "2026-11-22", base: "EUR", quote: "ADA", rate: 2.1 },
      ]),
    );
    expect(r.warnings).toEqual([]);
    expect(r.observations.map((o) => o.quote)).toEqual(["USD", "ANG", "ADA"]);
  });

  it("reports unrecognised shapes", () => {
    const r = parseFrankfurter(JSON.stringify({ hello: "world" }));
    expect(r.observations).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("HSBC CBPR markups", () => {
  const r = parseHsbcCbpr(fixture("hsbc-cbpr.synthetic.html"));
  const find = (q: Partial<IssuerMarkup>) =>
    r.markups.filter((m) => Object.entries(q).every(([k, v]) => m[k as keyof IssuerMarkup] === v));

  it("reads the page timestamp", () => {
    expect(r.markups[0]?.publishedAt).toBe("2026-11-23T06:04");
  });

  it("reads only the wide tables (not the per-currency repeats)", () => {
    // personal atm 3x6 + personal purchase (2x4 minus one n/a) + business atm 1x2 + business purchase 1x2
    expect(r.markups).toHaveLength(18 + 7 + 2 + 2);
  });

  it("assigns segment and context from the headings, not the nav", () => {
    expect(find({ segment: "personal", context: "atm" })).toHaveLength(18);
    expect(find({ segment: "personal", context: "purchase" })).toHaveLength(7);
    expect(find({ segment: "business", context: "atm" })).toHaveLength(2);
    expect(find({ segment: "business", context: "purchase" })).toHaveLength(2);
  });

  it("maps labels to network, card type and ISO currency", () => {
    const [m] = find({ segment: "personal", context: "atm", currency: "CZK", product: "Mastercard credit card" });
    expect(m).toMatchObject({ network: "mastercard", cardType: "credit", markupPct: 6.34, issuer: "HSBC UK" });
    expect(find({ currency: "EUR" }).length).toBeGreaterThan(0);
  });

  it("keeps negative markups, including the Unicode minus", () => {
    const chf = find({ segment: "personal", context: "atm", currency: "CHF" });
    expect(chf.find((m) => m.product === "VISA debit card for Premier or Advance")?.markupPct).toBe(-0.05);
    expect(chf.find((m) => m.product === "Mastercard debit card for Premier or Advance")?.markupPct).toBe(-0.04);
  });

  it("warns about unknown currency labels rather than guessing", () => {
    expect(r.warnings).toContain("unrecognised currency label: Mystery Money");
  });

  it("reads section labels from <caption> (live page structure) without falling back to table order", () => {
    const live = parseHsbcCbpr(fixture("hsbc-cbpr.captions.synthetic.html"));
    expect(live.warnings).toEqual([]);
    const pick = (segment: string, context: string) => live.markups.filter((m) => m.segment === segment && m.context === context);
    expect(pick("personal", "atm")).toHaveLength(4);
    expect(pick("personal", "purchase")).toHaveLength(2);
    expect(pick("business", "purchase")).toHaveLength(2);
    expect(pick("business", "atm")).toHaveLength(0);
    expect(live.markups.every((m) => m.publishedAt === "2026-11-23T06:04")).toBe(true);
  });

  it("reports a changed layout", () => {
    const broken = parseHsbcCbpr("<html><body><p>We've moved</p></body></html>");
    expect(broken.markups).toEqual([]);
    expect(broken.warnings).toContain("no markup tables found; page layout may have changed");
  });
});

describe("helpers", () => {
  it("parsePercent", () => {
    expect(parsePercent("2.95%")).toBe(2.95);
    expect(parsePercent(" 3 ")).toBe(3);
    expect(parsePercent("−0.10%")).toBe(-0.1);
    expect(parsePercent("n/a")).toBeNull();
    expect(parsePercent(undefined)).toBeNull();
  });

  it("parseLastUpdated", () => {
    expect(parseLastUpdated("Last updated on: 24/12/2025, 10:05")).toBe("2025-12-24T10:05");
    expect(parseLastUpdated("nothing here")).toBeNull();
  });
});
