export interface Env {
  SNAPSHOTS: R2Bucket;
  /** Published data bundles served at /data/*. Hashed files are immutable; manifest.json is replaced. */
  PUBLISHED: R2Bucket;
  DB: D1Database;
  ASSETS: Fetcher;
  COLLECTOR_VERSION: string;
  NTFY_URL?: string;
}

/** Cron expression -> job. Must match wrangler.toml [triggers]. */
export const CRON_JOBS: Record<string, "daily-morning" | "daily-ecb" | "health"> = {
  "0 6 * * *": "daily-morning",
  "30 16 * * 1-5": "daily-ecb",
  "0 9 * * *": "health",
};
