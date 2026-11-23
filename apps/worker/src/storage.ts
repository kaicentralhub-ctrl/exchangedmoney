import type { IssuerMarkup, RateObservation, SnapshotMeta } from "@exm/core";

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

export class D1Warehouse implements Warehouse {
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
