# exchangedmoney — working rules

## Product principles (these decide arguments)
- **Independent referee.** We never sell currency or transfers, and rankings are ordered by cost to the user, never by commission.
- **Every number has a source.** Show where it came from and when. ECB rates are labelled "for information purposes only".
- **Statistics, never forecasts.** "Better than 82% of days" is fine; "change money now" is not. Nothing is financial advice.
- **The archive is the moat.** A missed day of collection can't be recovered, so collectors come before features.

## Data rules
- Raw snapshots in R2 are the source of truth: archive before parsing, never overwrite or delete.
- Parsers never throw; they return rows plus warnings. A layout change must surface as `parse_empty` or a warning, never as wrong numbers.
- Every new source = an entry in `packages/core/src/sources.ts` + a parser + a fixture test. Fixtures are synthetic (made-up numbers in the real structure); don't commit third parties' pages.
- Collect public pages only, one request per source per run, with the collector User-Agent. Respect opt-out requests to collector@.
- Street/parallel rates: aggregates only, neutral wording, never via messaging channels; Venezuela is excluded from live coverage.
- No secrets in the repo. Config goes in `wrangler.toml` vars or `wrangler secret`.

## Code
- TypeScript, strict. pnpm workspace: `packages/core` (pure, tested) and `apps/worker` (Cloudflare Worker).
- Keep core free of Cloudflare APIs so it runs in Node tests; the Worker wires storage through the `RawStore` / `Warehouse` interfaces.
- D1 allows 100 bound parameters per statement; use `insertMany` for bulk writes.
- Before pushing: `pnpm test && pnpm typecheck`, and `pnpm --filter @exm/worker build:check`.

## Copy
- UK English, plain words, short sentences. Brand is lower-case "exchangedmoney".
