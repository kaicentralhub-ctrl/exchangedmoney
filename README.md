# exchangedmoney

What your money really changes hands for. Every exchange rate a person can actually get (card networks, card issuers, transfer apps, street markets), measured against the reference rate, every day, with history nobody else kept.

This repo is **Phase 0: the foundations.** It collects data from day one, because a missed day of collection is permanent and the archive is the moat.

## What's here

| Path | What it is |
| --- | --- |
| `packages/core` | Data model, rate maths (shortfall, loss, cross rates, percentiles), snapshot naming, and one parser per source, each tested against fixtures |
| `apps/worker` | One Cloudflare Worker: scheduled collectors, the data publisher (`/data/*`), `/api/subscribe`, `/api/health`, and the static holding page in `public/` |
| `apps/web` | The app at `/app/` (Vite + Preact). Loads the published data bundles and does every calculation in the browser; works offline |
| `apps/worker/migrations` | D1 schema: collector runs, rate observations, issuer markups, subscribers |
| `scripts/backfill-ecb.ts` | Loads the ECB's full reference-rate history (1999 onwards) into D1 |

## How collection works

```
cron ──▶ fetch source ──▶ R2: raw/{source}/{YYYY}/{MM}/{DD}/{timestamp}.{ext} (+ .meta.json)
                     └──▶ parse ──▶ D1: rate_observations / issuer_markups
                     └──▶ D1: collector_runs (status, sha256, changed?, warnings)
daily 09:00 ──▶ health check ──▶ ntfy alert if any source is stale
```

Rules the code enforces:

- **Raw first.** The response body is archived before parsing. A parser bug never loses data; rows can be rebuilt from R2.
- **Never overwrite.** Snapshot keys carry a millisecond timestamp and writes refuse to replace an existing key.
- **Never throw.** Every outcome (network failure, HTTP error, layout change) becomes a `collector_runs` row the health check can see.
- **Be polite.** One request per source per run, a User-Agent that links to `/collector.html`, public pages only.

### Sources

| Id | What | Schedule (UTC) | Status |
| --- | --- | --- | --- |
| `ecb-daily` | ECB euro reference rates (XML) | 16:30 weekdays | Verified live 2026-11-23 (29 currencies) |
| `frankfurter` | Frankfurter blended mid-market rates | 16:30 weekdays | Verified live 2026-11-23 (189 currencies; crypto tokens skipped) |
| `issuer-hsbc-uk` | HSBC UK card markups over ECB (CBPR disclosure) | 06:00 daily | Verified live 2026-11-23 (140 markups: 10 currencies × personal/business × cash machine/purchase) |
| `issuer-first-direct` | first direct card markups over ECB (CBPR disclosure PDF) | 06:00 daily | Verified live 2026-11-23 (154 markups; withdrawn currencies shown as #N/A are skipped) |

Adding a source: add an entry to `packages/core/src/sources.ts`, write a parser with a fixture test, done. Next up: M&S Bank (its PDF has moved), Barclays, NatWest, Santander, Monzo, Starling, then Visa and Mastercard once permission is confirmed. Parked: Nationwide (figures sit behind a private API loaded by JavaScript). Excluded: Lloyds, Halifax and Bank of Scotland, whose pages sit behind bot challenges; we don't get around bot detection.

## Setup (once)

You need a Cloudflare account (the one holding `exchangedmoney.com`) and Node 22 with pnpm.

```sh
pnpm install
cd apps/worker
npx wrangler login
npx wrangler r2 bucket create exm-snapshots
npx wrangler r2 bucket create exm-published
npx wrangler d1 create exm                 # paste the database_id into wrangler.toml
pnpm db:migrate:remote
npx wrangler secret put NTFY_URL           # e.g. https://ntfy.sh/<private-topic> or your own ntfy
pnpm deploy
```

Then in the Cloudflare dashboard, add `exchangedmoney.com` as a custom domain on the `exchangedmoney` Worker, and set up Email Routing for `privacy@`, `collector@` (both referenced on the site).

### Backfill 27 years of ECB history

```sh
# download and unzip https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip
pnpm backfill:ecb ~/Downloads/eurofxref-hist.csv
cd apps/worker && npx wrangler d1 execute exm --remote --file ../../data/backfill/001.sql   # repeat per file
```

D1's free plan allows 100,000 rows written per day; each file stays under that. On Workers Paid, run them all at once.

## Local development

```sh
pnpm test          # unit tests (core + worker)
pnpm typecheck
cd apps/worker
pnpm db:migrate:local
pnpm dev           # http://localhost:8787
# trigger a collection run against the live sources:
curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"      # issuer markups
curl "http://localhost:8787/__scheduled?cron=30+16+*+*+1-5"  # ECB + Frankfurter
curl http://localhost:8787/api/health
curl http://localhost:8787/data/manifest.json                # what the app loads
# the app, built into the Worker's assets:
open http://localhost:8787/app/
# or with hot reload (proxies /data to the Worker on :8787), from the repo root:
pnpm dev:web       # http://localhost:5173/app/
```

### Fee schedules

`packages/core/src/tariffs.ts` holds each card's fee schedule, read by hand from the issuer's own pages, with the page URLs and the date last checked. `packages/core/src/fees.ts` prices any spend or withdrawal against them:

- Fees come from the schedule (it's contractual): percentages with minimums and maximums, fixed fees, and daily or monthly fee-free allowances.
- The issuer's published markup over ECB is a cross-check. Where it agrees with the schedule, the difference estimates the card network's margin; where it doesn't, the app says so and prices from the schedule.
- The network margin belongs to the network and currency, so cards without a usable disclosure get the median from cards that have one.

The health check sends a reminder each Monday listing any schedule not re-checked for 90 days. To update one: re-read the pages, change the figures and `checkedAt`, and run the tests.

### How the app gets its data

After every collection run the Worker publishes **data bundles** to the `exm-published` bucket: a small `data/manifest.json` plus content-hashed files (`markups`, `rates`, `tariffs`, `history/EUR-XXX`). Hashed files are cached forever and never rewritten; only the manifest changes. Each bundle carries provenance (source, collected-at, publisher's timestamp, archived snapshot key and hash), which the app shows in its source panel. ECB history bundles are rebuilt on the 16:30 ECB job.

## Not done yet (on purpose)

- **Sign-up emails.** Subscribers are stored as `pending`; nothing is sent until a provider is wired up for double opt-in.
- **Rate limiting on `/api/subscribe`.** There's a honeypot; add a Cloudflare rate-limiting rule before promoting the page.
- **More of the app.** Markets, Cards, Trip and Receipt are built. Next: search-engine pages, more issuers, card network rates, and transfer providers. Business card fee schedules aren't added yet. Search-engine pages per currency pair, issuer and card come with Phase 1.
- **Workers plan.** Parsing PDFs and rebuilding history bundles needs more CPU time than the Workers free plan allows per invocation; budget for Workers Paid before going live.

The build and business plan lives in the claude.ai project ("exchangedmoney.com — Build & Business Plan").
