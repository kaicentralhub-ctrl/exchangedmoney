import { describe, expect, it } from "vitest";
import { crossRate, currencyFromLabel, extensionFor, lossInBase, percentileRank, sha256Hex, shortfallPct, snapshotKey } from "../src/index.js";

describe("rate maths", () => {
  it("shortfallPct", () => {
    expect(shortfallPct(1.17, 1.2)).toBeCloseTo(2.5, 10);
    expect(shortfallPct(1.2, 1.2)).toBe(0);
    expect(() => shortfallPct(0, 1.2)).toThrow(RangeError);
  });

  it("lossInBase: sent £800, got €920, fair rate 1.17 -> lost ~£13.68", () => {
    expect(lossInBase(800, 920, 1.17)).toBeCloseTo(800 - 920 / 1.17, 10);
  });

  it("crossRate from EUR-based rates: GBP->USD", () => {
    // EUR/GBP 0.8431, EUR/USD 1.0812 -> GBP/USD = 1.0812 / 0.8431
    expect(crossRate(0.8431, 1.0812)).toBeCloseTo(1.28241, 4);
  });

  it("percentileRank", () => {
    const history = [1.1, 1.12, 1.15, 1.18, 1.2];
    expect(percentileRank(history, 1.19)).toBe(80);
    expect(percentileRank(history, 1.19, false)).toBe(20);
    expect(() => percentileRank([], 1)).toThrow(RangeError);
  });
});

describe("currency labels", () => {
  it.each([
    ["Czech Korona (CZK)", "CZK"],
    ["EURO", "EUR"],
    ["Euro", "EUR"],
    ["USD", "USD"],
    ["Icelandic Króna (ISK)", "ISK"],
    ["Mystery Money", null],
  ])("%s -> %s", (label, code) => {
    expect(currencyFromLabel(label)).toBe(code);
  });
});

describe("snapshots", () => {
  it("builds sortable, dated keys", () => {
    const key = snapshotKey("ecb-daily", new Date("2026-11-23T16:30:05.123Z"), "xml");
    expect(key).toBe("raw/ecb-daily/2026/11/23/2026-11-23T16-30-05-123Z.xml");
  });

  it("rejects unsafe source ids", () => {
    expect(() => snapshotKey("../evil", new Date(), "xml")).toThrow();
  });

  it("chooses extensions from content type", () => {
    expect(extensionFor("text/xml; charset=utf-8")).toBe("xml");
    expect(extensionFor("application/json")).toBe("json");
    expect(extensionFor("text/html")).toBe("html");
    expect(extensionFor(null)).toBe("bin");
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
