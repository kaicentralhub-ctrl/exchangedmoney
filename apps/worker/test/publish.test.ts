import { describe, expect, it } from "vitest";
import { MANIFEST_PATH, decodeMarkups, decodeSeries, type HistoryBundle, type Manifest, type MarkupsBundle, type RatesBundle, type SeriesPoint, type StoredMarkup } from "@exm/core";
import { publishBundles, type BundleQueries, type PublishStore, type RunInfo, type StoredRate } from "../src/publish.js";

class MemoryPublishStore implements PublishStore {
  objects = new Map<string, string>();
  puts: string[] = [];
  async has(key: string) { return this.objects.has(key); }
  async put(key: string, body: string) { this.objects.set(key, body); this.puts.push(key); }
  async getText(key: string) { return this.objects.get(key) ?? null; }
  json<T>(key: string): T { return JSON.parse(this.objects.get(key)!) as T; }
}

const markup = (issuer: string, currency: string, pct: number, runId: number, publishedAt: string | null = null): StoredMarkup => ({
  issuer, product: "VISA debit card", network: "visa", cardType: "debit", segment: "personal", context: "purchase",
  currency, markupPct: pct, publishedAt, collectedDate: "2026-11-23", runId,
});

function queries(over: Partial<BundleQueries> = {}): BundleQueries {
  const runs: RunInfo[] = [
    { id: 7, source: "issuer-hsbc-uk", finishedAt: "2026-11-23T06:00:02Z", rawKey: "raw/issuer-hsbc-uk/a.html", sha256: "aa" },
    { id: 8, source: "issuer-first-direct", finishedAt: "2026-11-23T06:00:05Z", rawKey: "raw/issuer-first-direct/b.pdf", sha256: "bb" },
    { id: 9, source: "ecb-daily", finishedAt: "2026-11-20T16:30:02Z", rawKey: "raw/ecb-daily/c.xml", sha256: "cc" },
  ];
  const history: Record<string, SeriesPoint[]> = {
    GBP: [{ date: "2026-11-19", rate: 0.871 }, { date: "2026-11-20", rate: 0.873 }],
    USD: [{ date: "2026-11-20", rate: 1.052 }],
  };
  return {
    latestMarkups: async () => [markup("HSBC", "EUR", 2.75, 7, "2026-11-22T09:00"), markup("first direct", "EUR", 2.99, 8, "2026-11-21T00:08")],
    latestRates: async (): Promise<StoredRate[]> => [{ source: "ecb-daily", kind: "reference", base: "EUR", quote: "GBP", rate: 0.873, rateDate: "2026-11-20", runId: 9 }],
    runs: async (ids) => runs.filter((r) => ids.includes(r.id)),
    referenceQuotes: async () => Object.keys(history),
    referenceHistory: async (q) => history[q] ?? [],
    lastSuccess: async (id) => (id === "ecb-daily" ? "2026-11-20T16:30:02Z" : null),
    ...over,
  };
}

describe("publishBundles", () => {
  it("publishes hashed bundles with provenance and a manifest", async () => {
    const store = new MemoryPublishStore();
    const { manifest } = await publishBundles(store, queries(), new Date("2026-11-23T06:01:00Z"), { history: true });

    expect(Object.keys(manifest.files)).toEqual(["history/EUR-GBP", "history/EUR-USD", "markups", "rates", "tariffs"]);
    expect(store.json<Manifest>(MANIFEST_PATH).generatedAt).toBe("2026-11-23T06:01:00.000Z");

    const mk = store.json<MarkupsBundle>(manifest.files.markups!.path);
    expect(mk.provenance["first direct"]).toMatchObject({
      sourceId: "issuer-first-direct", rawKey: "raw/issuer-first-direct/b.pdf", collectedAt: "2026-11-23T06:00:05Z", publishedAt: "2026-11-21T00:08",
    });
    expect(decodeMarkups(mk).map((m) => m.issuer)).toEqual(["HSBC", "first direct"]);

    const rates = store.json<RatesBundle>(manifest.files.rates!.path);
    expect(rates.provenance["ecb-daily"]?.note).toMatch(/information purposes only/);

    const gbp = store.json<HistoryBundle>(manifest.files["history/EUR-GBP"]!.path);
    expect(decodeSeries(gbp).map((p) => p.rate)).toEqual([0.871, 0.873]);
    expect(manifest.sources.find((s) => s.id === "ecb-daily")?.lastSuccess).toBe("2026-11-20T16:30:02Z");
  });

  it("doesn't re-upload unchanged files and carries history over when not rebuilding it", async () => {
    const store = new MemoryPublishStore();
    const first = await publishBundles(store, queries(), new Date("2026-11-23T06:01:00Z"), { history: true });
    store.puts = [];
    const second = await publishBundles(store, queries(), new Date("2026-11-24T06:01:00Z"), { history: false });
    expect(store.puts).toEqual([MANIFEST_PATH]);
    expect(second.manifest.files["history/EUR-USD"]).toEqual(first.manifest.files["history/EUR-USD"]);
  });

  it("publishes new markups under a new hash and keeps the old file", async () => {
    const store = new MemoryPublishStore();
    const first = await publishBundles(store, queries(), new Date("2026-11-23T06:01:00Z"), { history: false });
    const second = await publishBundles(store, queries({ latestMarkups: async () => [markup("HSBC", "EUR", 2.8, 7)] }), new Date("2026-11-24T06:01:00Z"), { history: false });
    expect(second.manifest.files.markups!.path).not.toBe(first.manifest.files.markups!.path);
    expect(store.objects.has(first.manifest.files.markups!.path)).toBe(true);
  });

  it("copes with an empty warehouse", async () => {
    const store = new MemoryPublishStore();
    const empty = queries({ latestMarkups: async () => [], latestRates: async () => [], referenceQuotes: async () => [] });
    const { manifest } = await publishBundles(store, empty, new Date("2026-11-23T06:01:00Z"), { history: true });
    expect(store.json<MarkupsBundle>(manifest.files.markups!.path).rows).toEqual([]);
  });
});
