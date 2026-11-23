/**
 * Turn the ECB's full reference-rate history into SQL files for D1.
 *
 *   1. Download https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip and unzip it.
 *   2. pnpm backfill:ecb path/to/eurofxref-hist.csv
 *   3. For each file printed: pnpm --filter @exm/worker exec wrangler d1 execute exm --remote --file ../../data/backfill/NNN.sql
 *
 * Rows go in as source "ecb-history", kind "reference", with ON CONFLICT DO NOTHING, so the
 * script is safe to re-run. D1's free plan allows 100,000 rows written per day; each file is
 * kept under that, so run one file per day on the free plan or all at once on Workers Paid.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEcbHistoryCsv } from "../packages/core/src/index.js";

const ROWS_PER_INSERT = 400; // keeps each statement well under D1's 100 KB statement limit
const ROWS_PER_FILE = 90_000; // under the free plan's 100k rows-written-per-day limit

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: pnpm backfill:ecb path/to/eurofxref-hist.csv");
    process.exit(1);
  }
  const outDir = resolve("data/backfill");
  mkdirSync(outDir, { recursive: true });

  const { observations, warnings } = parseEcbHistoryCsv(readFileSync(input, "utf8"), "ecb-history");
  if (warnings.length) console.warn(`${warnings.length} warnings, first: ${warnings[0]}`);
  if (observations.length === 0) {
    console.error("no observations parsed; is this the ECB history CSV?");
    process.exit(1);
  }

  const collectedAt = new Date().toISOString();
  const value = (o: (typeof observations)[number]) =>
    `('${o.source}','reference','EUR','${o.quote}',${o.rate},'${o.rateDate}',NULL,'${collectedAt}')`;

  const files: string[] = [];
  for (let f = 0; f * ROWS_PER_FILE < observations.length; f++) {
    const slice = observations.slice(f * ROWS_PER_FILE, (f + 1) * ROWS_PER_FILE);
    const statements: string[] = [];
    for (let i = 0; i < slice.length; i += ROWS_PER_INSERT) {
      const rows = slice.slice(i, i + ROWS_PER_INSERT).map(value).join(",\n");
      statements.push(
        `INSERT INTO rate_observations (source, kind, base, quote, rate, rate_date, run_id, collected_at) VALUES\n${rows}\nON CONFLICT (source, kind, base, quote, rate_date) DO NOTHING;`,
      );
    }
    const file = join(outDir, `${String(f + 1).padStart(3, "0")}.sql`);
    writeFileSync(file, statements.join("\n\n") + "\n");
    files.push(file);
  }

  const dates = observations.map((o) => o.rateDate).sort();
  console.log(`${observations.length} rates, ${dates[0]} to ${dates.at(-1)}, in ${files.length} file(s):`);
  for (const f of files) console.log(`  ${f}`);
}

main();
