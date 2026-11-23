/**
 * Data bundles: what the Worker publishes after each collection run and the app loads.
 *
 * - A small manifest (re-fetched often) points at content-hashed files (cached forever).
 * - Bodies hold no generation time, so unchanged data hashes the same and is not re-uploaded.
 * - Tables travel as column names plus row tuples; series travel delta-encoded.
 * Pure: no Cloudflare or DOM APIs, so it runs in the Worker, the browser and Node tests.
 */
import type { CardNetwork, CardType, CustomerSegment, IssuerMarkup, MarkupContext, RateObservation } from "./types.js";
import { sha256Hex } from "./snapshot.js";
import type { CardProduct } from "./fees.js";

export const BUNDLE_SCHEMA = 1;
export const MANIFEST_PATH = "data/manifest.json";

/** Where a number came from. Shown in the app's source panel. */
export interface Provenance {
  sourceId: string;
  label: string;
  url: string;
  /** When our collector fetched it (UTC ISO). */
  collectedAt: string | null;
  /** The publisher's own timestamp, if it gives one. */
  publishedAt: string | null;
  /** Key of the archived original in the snapshot store. */
  rawKey: string | null;
  sha256: string | null;
  note?: string;
  /** For curated data (fee schedules): the date we last checked the page by hand. */
  checkedAt?: string;
}

/* ---------------- markups ---------------- */

export const MARKUP_COLUMNS = ["issuer", "product", "network", "cardType", "segment", "context", "currency", "markupPct"] as const;
export type MarkupRow = [string, string, CardNetwork, CardType, CustomerSegment, MarkupContext, string, number];

export interface StoredMarkup extends IssuerMarkup {
  collectedDate: string;
  runId: number;
}

export interface MarkupsBundle {
  schema: number;
  kind: "markups";
  /** Keyed by issuer. */
  provenance: Record<string, Provenance>;
  columns: typeof MARKUP_COLUMNS;
  rows: MarkupRow[];
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

export function buildMarkupsBundle(rows: readonly IssuerMarkup[], provenance: Record<string, Provenance>): MarkupsBundle {
  const out: MarkupRow[] = rows.map((m) => [m.issuer, m.product, m.network, m.cardType, m.segment, m.context, m.currency, m.markupPct]);
  out.sort((a, b) => cmp(a[0], b[0]) || cmp(a[4], b[4]) || cmp(a[5], b[5]) || cmp(a[1], b[1]) || cmp(a[6], b[6]));
  return { schema: BUNDLE_SCHEMA, kind: "markups", provenance: sortKeys(provenance), columns: MARKUP_COLUMNS, rows: out };
}

export function decodeMarkups(bundle: MarkupsBundle): IssuerMarkup[] {
  return bundle.rows.map(([issuer, product, network, cardType, segment, context, currency, markupPct]) => ({
    issuer, product, network, cardType, segment, context, currency, markupPct,
    publishedAt: bundle.provenance[issuer]?.publishedAt ?? null,
  }));
}

/* ---------------- latest rates ---------------- */

export const RATE_COLUMNS = ["source", "base", "quote", "rate", "rateDate"] as const;
export type RateRow = [string, string, string, number, string];

export interface RatesBundle {
  schema: number;
  kind: "rates";
  /** Keyed by source id. */
  provenance: Record<string, Provenance>;
  columns: typeof RATE_COLUMNS;
  rows: RateRow[];
}

export function buildRatesBundle(rows: readonly RateObservation[], provenance: Record<string, Provenance>): RatesBundle {
  const out: RateRow[] = rows.map((o) => [o.source, o.base, o.quote, o.rate, o.rateDate]);
  out.sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || cmp(a[2], b[2]));
  return { schema: BUNDLE_SCHEMA, kind: "rates", provenance: sortKeys(provenance), columns: RATE_COLUMNS, rows: out };
}

/* ---------------- history series ---------------- */

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  rate: number;
}

export interface HistoryBundle {
  schema: number;
  kind: "history";
  base: string;
  quote: string;
  provenance: Provenance;
  /** First date. */
  start: string;
  /** Days since the previous point (first is 0). Small integers compress well. */
  gaps: number[];
  rates: number[];
}

const DAY = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** Sorts by date and keeps the first point for any repeated date. */
export function encodeSeries(points: readonly SeriesPoint[]): { start: string; gaps: number[]; rates: number[] } {
  const sorted = [...points].sort((a, b) => cmp(a.date, b.date));
  const gaps: number[] = [];
  const rates: number[] = [];
  let prev: number | null = null;
  let start = "";
  for (const p of sorted) {
    const d = dayNumber(p.date);
    if (Number.isNaN(d) || d === prev) continue;
    if (prev === null) start = p.date;
    gaps.push(prev === null ? 0 : d - prev);
    rates.push(p.rate);
    prev = d;
  }
  return { start, gaps, rates };
}

export function decodeSeries(s: { start: string; gaps: readonly number[]; rates: readonly number[] }): SeriesPoint[] {
  if (!s.start) return [];
  let d = dayNumber(s.start);
  return s.gaps.map((g, i) => {
    d += g;
    return { date: dateOf(d), rate: s.rates[i]! };
  });
}

export function buildHistoryBundle(base: string, quote: string, points: readonly SeriesPoint[], provenance: Provenance): HistoryBundle {
  return { schema: BUNDLE_SCHEMA, kind: "history", base, quote, provenance, ...encodeSeries(points) };
}

/* ---------------- fee schedules ---------------- */

export interface TariffsBundle {
  schema: number;
  kind: "tariffs";
  products: CardProduct[];
}

export function buildTariffsBundle(products: readonly CardProduct[]): TariffsBundle {
  return { schema: BUNDLE_SCHEMA, kind: "tariffs", products: [...products].sort((a, b) => cmp(a.id, b.id)) };
}

/* ---------------- manifest ---------------- */

export interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface SourceStatus {
  id: string;
  label: string;
  url: string;
  lastSuccess: string | null;
  /** Older than this and the source counts as stale. */
  maxAgeHours: number;
}

export interface Manifest {
  schema: number;
  generatedAt: string;
  /** Logical name ("markups", "rates", "history/EUR-USD") -> file. */
  files: Record<string, ManifestEntry>;
  sources: SourceStatus[];
}

export interface BundleFile extends ManifestEntry {
  name: string;
  body: string;
}

/** Serialises a bundle and names it by its content hash. */
export async function toBundleFile(name: string, bundle: unknown): Promise<BundleFile> {
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(name) || name.includes("..")) throw new Error(`invalid bundle name: ${name}`);
  const body = JSON.stringify(bundle);
  const bytes = new TextEncoder().encode(body);
  const sha256 = await sha256Hex(bytes);
  return { name, path: `data/${name}.${sha256.slice(0, 12)}.json`, sha256, bytes: bytes.byteLength, body };
}

export function buildManifest(files: readonly ManifestEntry[] | Record<string, ManifestEntry>, sources: SourceStatus[], generatedAt: string): Manifest {
  const entries: Record<string, ManifestEntry> = Array.isArray(files)
    ? Object.fromEntries((files as BundleFile[]).map((f) => [f.name, { path: f.path, sha256: f.sha256, bytes: f.bytes }]))
    : (files as Record<string, ManifestEntry>);
  return { schema: BUNDLE_SCHEMA, generatedAt, files: sortKeys(entries), sources: [...sources].sort((a, b) => cmp(a.id, b.id)) };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b)));
}
