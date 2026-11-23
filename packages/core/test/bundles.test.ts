import { describe, expect, it } from "vitest";
import {
  buildHistoryBundle, buildManifest, buildMarkupsBundle, buildRatesBundle, decodeMarkups, decodeSeries, encodeSeries, toBundleFile,
  type IssuerMarkup, type Provenance,
} from "../src/index.js";

const prov = (sourceId: string): Provenance => ({
  sourceId, label: sourceId, url: `https://example.test/${sourceId}`, collectedAt: "2026-11-23T06:00:01Z",
  publishedAt: "2026-11-21T00:08", rawKey: `raw/${sourceId}/x.pdf`, sha256: "ab".repeat(32),
});

const m = (issuer: string, currency: string, markupPct: number, context: "atm" | "purchase" = "purchase"): IssuerMarkup => ({
  issuer, product: "VISA debit card", network: "visa", cardType: "debit", segment: "personal", context, currency, markupPct, publishedAt: null,
});

describe("markups bundle", () => {
  it("sorts deterministically and round-trips", () => {
    const rows = [m("first direct", "USD", 2.99), m("HSBC", "EUR", 2.75, "atm"), m("first direct", "EUR", 2.85)];
    const b = buildMarkupsBundle(rows, { HSBC: prov("issuer-hsbc-uk"), "first direct": prov("issuer-first-direct") });
    expect(b.rows.map((r) => `${r[0]}/${r[6]}`)).toEqual(["HSBC/EUR", "first direct/EUR", "first direct/USD"]);
    const back = decodeMarkups(b);
    expect(back).toHaveLength(3);
    expect(back[1]).toMatchObject({ issuer: "first direct", currency: "EUR", markupPct: 2.85, publishedAt: "2026-11-21T00:08" });
  });

  it("hashes the same for the same data in any order", async () => {
    const p = { HSBC: prov("issuer-hsbc-uk") };
    const a = await toBundleFile("markups", buildMarkupsBundle([m("HSBC", "EUR", 1), m("HSBC", "USD", 2)], p));
    const b = await toBundleFile("markups", buildMarkupsBundle([m("HSBC", "USD", 2), m("HSBC", "EUR", 1)], p));
    expect(a.sha256).toBe(b.sha256);
    expect(a.path).toMatch(/^data\/markups\.[0-9a-f]{12}\.json$/);
    expect(a.bytes).toBe(new TextEncoder().encode(a.body).byteLength);
  });
});

describe("series encoding", () => {
  it("delta-encodes dates, sorts and drops repeated dates", () => {
    const pts = [
      { date: "2026-11-20", rate: 1.05 },
      { date: "2026-11-17", rate: 1.06 },
      { date: "2026-11-20", rate: 9.99 },
      { date: "2026-11-18", rate: 1.07 },
    ];
    const enc = encodeSeries(pts);
    expect(enc).toEqual({ start: "2026-11-17", gaps: [0, 1, 2], rates: [1.06, 1.07, 1.05] });
    expect(decodeSeries(enc)).toEqual([
      { date: "2026-11-17", rate: 1.06 },
      { date: "2026-11-18", rate: 1.07 },
      { date: "2026-11-20", rate: 1.05 },
    ]);
  });

  it("survives month and leap-year boundaries", () => {
    const pts = [{ date: "2024-02-28", rate: 1 }, { date: "2024-03-01", rate: 2 }, { date: "2025-01-01", rate: 3 }];
    expect(decodeSeries(encodeSeries(pts))).toEqual(pts);
  });

  it("handles an empty series", () => {
    expect(decodeSeries(encodeSeries([]))).toEqual([]);
    expect(buildHistoryBundle("EUR", "GBP", [], prov("ecb-daily")).gaps).toEqual([]);
  });
});

describe("manifest", () => {
  it("indexes files by name and sorts sources", async () => {
    const rates = await toBundleFile("rates", buildRatesBundle([{ source: "ecb-daily", kind: "reference", base: "EUR", quote: "GBP", rate: 0.87, rateDate: "2026-11-20" }], {}));
    const hist = await toBundleFile("history/EUR-GBP", buildHistoryBundle("EUR", "GBP", [{ date: "2026-11-20", rate: 0.87 }], prov("ecb-daily")));
    const man = buildManifest([rates, hist], [{ id: "z", label: "Z", url: "u", lastSuccess: null, maxAgeHours: 30 }, { id: "a", label: "A", url: "u", lastSuccess: null, maxAgeHours: 30 }], "2026-11-23T07:00:00Z");
    expect(Object.keys(man.files)).toEqual(["history/EUR-GBP", "rates"]);
    expect(man.files.rates).toEqual({ path: rates.path, sha256: rates.sha256, bytes: rates.bytes });
    expect(man.sources.map((s) => s.id)).toEqual(["a", "z"]);
  });

  it("refuses unsafe names", async () => {
    await expect(toBundleFile("../etc", {})).rejects.toThrow();
  });
});
