import type { IssuerMarkup, RateObservation, SeriesPoint, SnapshotMeta, StoredMarkup } from "@exm/core";
import type { BundleQueries, RunInfo, StoredRate } from "./publish.js";

export type RunStatus = "ok" | "parse_warning" | "parse_empty" | "http_error" | "fetch_error";

export interface RunRecord {
  source: string;
  startedAt: string;
  finishedAt: string;
  status: RunStatus;
  httpStatus: number | null;
  rawKey: string | null;
  sha256: string | null;
  bytes: number | null;
  changed: boolean | null;
  observations: number;
  markups: number;
  warnings: string[];
  error: string | null;
}

/** Where raw snapshots go. Implementations must never overwrite an existing key. */
export interface RawStore {
  put(key: string, body: ArrayBuffer, meta: SnapshotMeta): Promise<void>;
}

/** Where derived rows go. */
export interface Warehouse {
  lastSha(source: string): Promise<string | null>;
  recordRun(run: RunRecord): Promise<number>;
  insertObservations(rows: RateObservation[], runId: number, collectedAt: string): Promise<void>;
  insertMarkups(rows: IssuerMarkup[], runId: number, collectedAt: string): Promise<void>;
  lastSuccess(source: string): Promise<string | null>;
}

/* ---------------- Cloudflare implementations ---------------- */

export class R2RawStore implements RawStore {
  constructor(private bucket: R2Bucket) {}

  async put(key: string, body: ArrayBuffer, meta: SnapshotMeta): Promise<void> {
    // Keys carry a millisecond timestamp, so a clash means a bug; refuse rather than overwrite.
    if (await this.bucket.head(key)) throw new Error(`refusing to overwrite existing snapshot ${key}`);
    await this.bucket.put(key, body, {
      httpMetadata: meta.contentType ? { contentType: meta.contentType } : undefined,
      customMetadata: { source: meta.source, sha256: meta.sha256, fetchedAt: meta.fetchedAt },
    });
    await this.bucket.put(`${key}.meta.json`, JSON.stringify(meta, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
  }
}

/** D1 allows at most 100 bound parameters per statement. */
const MAX_PARAMS = 100;

export class D1Warehouse implements Warehouse, BundleQueries {
  constructor(private db: D1Database) {}

  async lastSha(source: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT sha256 FROM collector_runs WHERE source = ? AND sha256 IS NOT NULL ORDER BY id DESC LIMIT 1")
      .bind(source)
      .first<{ sha256: string }>();
    return row?.sha256 ?? null;
  }

  async lastSuccess(source: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT finished_at FROM collector_runs WHERE source = ? AND status IN ('ok','parse_warning') ORDER BY id DESC LIMIT 1")
      .bind(source)
      .first<{ finished_at: string }>();
    return row?.finished_at ?? null;
  }

  async recordRun(r: RunRecord): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO collector_runs
           (source, started_at, finished_at, status, http_status, raw_key, sha256, bytes, changed, observations, markups, warnings, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        r.source, r.startedAt, r.finishedAt, r.status, r.httpStatus, r.rawKey, r.sha256, r.bytes,
        r.changed === null ? null : r.changed ? 1 : 0, r.observations, r.markups,
        r.warnings.length ? JSON.stringify(r.warnings) : null, r.error,
      )
      .first<{ id: number }>();
    if (!row) throw new Error("failed to record collector run");
    return row.id;
  }

  async insertObservations(rows: RateObservation[], runId: number, collectedAt: string): Promise<void> {
    await this.insertMany(
      "rate_observations",
      ["source", "kind", "base", "quote", "rate", "rate_date", "run_id", "collected_at"],
      rows.map((o) => [o.source, o.kind, o.base, o.quote, o.rate, o.rateDate, runId, collectedAt]),
      // First observation of a (source, pair, date) wins; later identical fetches are no-ops.
      "ON CONFLICT (source, kind, base, quote, rate_date) DO NOTHING",
    );
  }

  async insertMarkups(rows: IssuerMarkup[], runId: number, collectedAt: string): Promise<void> {
    const collectedDate = collectedAt.slice(0, 10);
    await this.insertMany(
      "issuer_markups",
      ["issuer", "product", "segment", "context", "currency", "network", "card_type", "markup_pct", "published_at", "collected_date", "run_id"],
      rows.map((m) => [m.issuer, m.product, m.segment, m.context, m.currency, m.network, m.cardType, m.markupPct, m.publishedAt, collectedDate, runId]),
      "ON CONFLICT (issuer, product, segment, context, currency, collected_date) DO NOTHING",
    );
  }

  /* ---------------- read side for the publisher ---------------- */

  async latestMarkups(): Promise<StoredMarkup[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.issuer, m.product, m.network, m.card_type, m.segment, m.context, m.currency, m.markup_pct,
                m.published_at, m.collected_date, m.run_id
           FROM issuer_markups m
           JOIN (SELECT issuer, MAX(collected_date) AS d FROM issuer_markups GROUP BY issuer) l
             ON m.issuer = l.issuer AND m.collected_date = l.d`,
      )
      .all<Record<string, string | number | null>>();
    return results.map((r) => ({
      issuer: String(r.issuer), product: String(r.product), network: r.network as StoredMarkup["network"],
      cardType: r.card_type as StoredMarkup["cardType"], segment: r.segment as StoredMarkup["segment"],
      context: r.context as StoredMarkup["context"], currency: String(r.currency), markupPct: Number(r.markup_pct),
      publishedAt: (r.published_at as string | null) ?? null, collectedDate: String(r.collected_date), runId: Number(r.run_id),
    }));
  }

  async latestRates(): Promise<StoredRate[]> {
    const { results } = await this.db
      .prepare(
        `SELECT o.source, o.kind, o.base, o.quote, o.rate, o.rate_date, o.run_id
           FROM rate_observations o
           JOIN (SELECT source, base, quote, MAX(rate_date) AS d FROM rate_observations
                  WHERE source <> 'ecb-history' GROUP BY source, base, quote) l
             ON o.source = l.source AND o.base = l.base AND o.quote = l.quote AND o.rate_date = l.d`,
      )
      .all<Record<string, string | number | null>>();
    return results.map((r) => ({
      source: String(r.source), kind: r.kind as StoredRate["kind"], base: String(r.base), quote: String(r.quote),
      rate: Number(r.rate), rateDate: String(r.rate_date), runId: r.run_id === null ? null : Number(r.run_id),
    }));
  }

  async runs(ids: number[]): Promise<RunInfo[]> {
    const out: RunInfo[] = [];
    for (let i = 0; i < ids.length; i += MAX_PARAMS) {
      const chunk = ids.slice(i, i + MAX_PARAMS);
      const { results } = await this.db
        .prepare(`SELECT id, source, finished_at, raw_key, sha256 FROM collector_runs WHERE id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .all<{ id: number; source: string; finished_at: string; raw_key: string | null; sha256: string | null }>();
      out.push(...results.map((r) => ({ id: r.id, source: r.source, finishedAt: r.finished_at, rawKey: r.raw_key, sha256: r.sha256 })));
    }
    return out;
  }

  async referenceQuotes(): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT DISTINCT quote FROM rate_observations WHERE source IN ('ecb-daily','ecb-history') AND base = 'EUR' ORDER BY quote")
      .all<{ quote: string }>();
    return results.map((r) => r.quote);
  }

  /** Daily rows first, so where both files have a date the daily one wins in encodeSeries. */
  async referenceHistory(quote: string): Promise<SeriesPoint[]> {
    const { results } = await this.db
      .prepare(
        `SELECT rate_date, rate FROM rate_observations
          WHERE source IN ('ecb-daily','ecb-history') AND base = 'EUR' AND quote = ?
          ORDER BY rate_date, CASE source WHEN 'ecb-daily' THEN 0 ELSE 1 END`,
      )
      .bind(quote)
      .all<{ rate_date: string; rate: number }>();
    return results.map((r) => ({ date: r.rate_date, rate: r.rate }));
  }

  private async insertMany(table: string, cols: string[], rows: unknown[][], conflict: string): Promise<void> {
    if (rows.length === 0) return;
    const perStatement = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
    const placeholder = `(${cols.map(() => "?").join(", ")})`;
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < rows.length; i += perStatement) {
      const chunk = rows.slice(i, i + perStatement);
      const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${chunk.map(() => placeholder).join(", ")} ${conflict}`;
      statements.push(this.db.prepare(sql).bind(...chunk.flat()));
    }
    await this.db.batch(statements);
  }
}
