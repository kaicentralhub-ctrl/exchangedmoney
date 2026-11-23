/**
 * After each collection run: build the data bundles from the warehouse and publish them.
 * Hashed files are written once and never changed; only the manifest is replaced.
 */
import {
  MANIFEST_PATH, SOURCES, buildHistoryBundle, buildManifest, buildMarkupsBundle, buildRatesBundle, sourceById, toBundleFile,
  type BundleFile, type Manifest, type ManifestEntry, type Provenance, type RateObservation, type SeriesPoint, type StoredMarkup,
} from "@exm/core";

export interface RunInfo {
  id: number;
  source: string;
  finishedAt: string;
  rawKey: string | null;
  sha256: string | null;
}

export interface StoredRate extends RateObservation {
  runId: number | null;
}

/** Read side of the warehouse, as the publisher needs it. */
export interface BundleQueries {
  latestMarkups(): Promise<StoredMarkup[]>;
  latestRates(): Promise<StoredRate[]>;
  runs(ids: number[]): Promise<RunInfo[]>;
  referenceQuotes(): Promise<string[]>;
  referenceHistory(quote: string): Promise<SeriesPoint[]>;
  lastSuccess(source: string): Promise<string | null>;
}

/** Where published files go. */
export interface PublishStore {
  has(key: string): Promise<boolean>;
  put(key: string, body: string, contentType: string): Promise<void>;
  getText(key: string): Promise<string | null>;
}

export interface PublishResult {
  manifest: Manifest;
  written: string[];
}

const ECB_NOTE = "ECB reference rates are published for information purposes only.";

function provenanceFor(run: RunInfo | undefined, sourceId: string, publishedAt: string | null): Provenance {
  const def = sourceById(sourceId);
  return {
    sourceId,
    label: def?.label ?? sourceId,
    url: def?.url ?? "",
    collectedAt: run?.finishedAt ?? null,
    publishedAt,
    rawKey: run?.rawKey ?? null,
    sha256: run?.sha256 ?? null,
    ...(sourceId.startsWith("ecb") ? { note: ECB_NOTE } : {}),
  };
}

export async function publishBundles(store: PublishStore, q: BundleQueries, now: Date, opts: { history: boolean }): Promise<PublishResult> {
  const files: BundleFile[] = [];

  // Card markups: latest day per issuer, provenance from the run that wrote them.
  const markups = await q.latestMarkups();
  const rates = await q.latestRates();
  const runIds = [...new Set([...markups.map((m) => m.runId), ...rates.flatMap((r) => (r.runId === null ? [] : [r.runId]))])];
  const runs = new Map((await q.runs(runIds)).map((r) => [r.id, r]));

  const byIssuer = new Map<string, StoredMarkup[]>();
  for (const m of markups) byIssuer.set(m.issuer, [...(byIssuer.get(m.issuer) ?? []), m]);
  const markupProv: Record<string, Provenance> = {};
  for (const [issuer, rows] of byIssuer) {
    const run = runs.get(Math.max(...rows.map((r) => r.runId)));
    const published = rows.map((r) => r.publishedAt).filter((p): p is string => !!p).sort().at(-1) ?? null;
    markupProv[issuer] = provenanceFor(run, run?.source ?? "unknown", published);
  }
  files.push(await toBundleFile("markups", buildMarkupsBundle(markups, markupProv)));

  // Latest rates per source.
  const rateProv: Record<string, Provenance> = {};
  for (const source of new Set(rates.map((r) => r.source))) {
    const rows = rates.filter((r) => r.source === source);
    const run = runs.get(Math.max(...rows.map((r) => r.runId ?? -1)));
    rateProv[source] = provenanceFor(run, source, rows.map((r) => r.rateDate).sort().at(-1) ?? null);
  }
  files.push(await toBundleFile("rates", buildRatesBundle(rates, rateProv)));

  // Reference history (ECB, euro base): rebuilt on the ECB job, otherwise carried over.
  let carried: Record<string, ManifestEntry> = {};
  if (opts.history) {
    for (const quote of await q.referenceQuotes()) {
      const points = await q.referenceHistory(quote);
      const prov: Provenance = {
        ...provenanceFor(undefined, "ecb-daily", points.at(-1)?.date ?? null),
        label: "ECB euro reference rates (daily file plus full history file)",
      };
      files.push(await toBundleFile(`history/EUR-${quote}`, buildHistoryBundle("EUR", quote, points, prov)));
    }
  } else {
    const previous = await readManifest(store);
    carried = Object.fromEntries(Object.entries(previous?.files ?? {}).filter(([name]) => name.startsWith("history/")));
  }

  const written: string[] = [];
  for (const f of files) {
    if (await store.has(f.path)) continue; // same content already published
    await store.put(f.path, f.body, "application/json; charset=utf-8");
    written.push(f.path);
  }

  const sources = await Promise.all(
    SOURCES.map(async (s) => ({ id: s.id, label: s.label, url: s.url, maxAgeHours: s.maxAgeHours, lastSuccess: await q.lastSuccess(s.id) })),
  );
  const entries: Record<string, ManifestEntry> = { ...carried };
  for (const f of files) entries[f.name] = { path: f.path, sha256: f.sha256, bytes: f.bytes };
  const manifest = buildManifest(entries, sources, now.toISOString());
  await store.put(MANIFEST_PATH, JSON.stringify(manifest), "application/json; charset=utf-8");
  written.push(MANIFEST_PATH);
  return { manifest, written };
}

async function readManifest(store: PublishStore): Promise<Manifest | null> {
  const text = await store.getText(MANIFEST_PATH);
  if (!text) return null;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return null;
  }
}

/* ---------------- serving ---------------- */

const SAFE_KEY = /^data\/[A-Za-z0-9][A-Za-z0-9/._-]*\.json$/;

/** GET /data/* from the published bucket. Hashed files are immutable; the manifest revalidates. */
export async function serveData(request: Request, bucket: R2Bucket): Promise<Response> {
  const key = new URL(request.url).pathname.slice(1);
  if (!SAFE_KEY.test(key) || key.includes("..")) return new Response("not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const object = await bucket.get(key, { onlyIf: request.headers });
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", key === MANIFEST_PATH ? "public, max-age=60, must-revalidate" : "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  // onlyIf matched the client's validators: nothing to send.
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : (object as R2ObjectBody).body, { headers });
}

export class R2PublishStore implements PublishStore {
  constructor(private bucket: R2Bucket) {}
  async has(key: string) {
    return (await this.bucket.head(key)) !== null;
  }
  async put(key: string, body: string, contentType: string) {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }
  async getText(key: string) {
    const o = await this.bucket.get(key);
    return o ? o.text() : null;
  }
}
