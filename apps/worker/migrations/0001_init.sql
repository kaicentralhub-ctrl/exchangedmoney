-- exchangedmoney warehouse (Cloudflare D1 / SQLite).
-- Raw snapshots in R2 are the source of truth; everything here can be rebuilt from them.

CREATE TABLE collector_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT    NOT NULL,
  started_at    TEXT    NOT NULL,
  finished_at   TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('ok', 'parse_warning', 'parse_empty', 'http_error', 'fetch_error')),
  http_status   INTEGER,
  raw_key       TEXT,
  sha256        TEXT,
  bytes         INTEGER,
  changed       INTEGER,            -- 1 if content differs from the previous snapshot of this source
  observations  INTEGER NOT NULL DEFAULT 0,
  markups       INTEGER NOT NULL DEFAULT 0,
  warnings      TEXT,               -- JSON array
  error         TEXT
);
CREATE INDEX idx_runs_source_id ON collector_runs (source, id DESC);

-- One exchange rate at one date from one source. rate = units of quote per 1 base.
CREATE TABLE rate_observations (
  source        TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('reference', 'card-network', 'provider', 'street', 'achieved')),
  base          TEXT NOT NULL,
  quote         TEXT NOT NULL,
  rate          REAL NOT NULL CHECK (rate > 0),
  rate_date     TEXT NOT NULL,      -- publisher's date, YYYY-MM-DD
  run_id        INTEGER,            -- NULL for backfilled history
  collected_at  TEXT NOT NULL,
  PRIMARY KEY (source, kind, base, quote, rate_date)
);
CREATE INDEX idx_obs_pair_date ON rate_observations (base, quote, rate_date);

-- Card issuers' published markups over the ECB reference rate (CBPR disclosures), one row per day.
CREATE TABLE issuer_markups (
  issuer          TEXT NOT NULL,
  product         TEXT NOT NULL,    -- label exactly as published
  segment         TEXT NOT NULL,    -- personal | business | unknown
  context         TEXT NOT NULL,    -- purchase | atm | unknown
  currency        TEXT NOT NULL,
  network         TEXT NOT NULL,    -- visa | mastercard | unknown
  card_type       TEXT NOT NULL,    -- debit | credit | unknown
  markup_pct      REAL NOT NULL,
  published_at    TEXT,             -- issuer's own "last updated", UK local time
  collected_date  TEXT NOT NULL,    -- YYYY-MM-DD (UTC)
  run_id          INTEGER NOT NULL,
  PRIMARY KEY (issuer, product, segment, context, currency, collected_date)
);
CREATE INDEX idx_markups_currency_date ON issuer_markups (currency, collected_date);

-- Alert sign-ups from the holding page. Double opt-in: nothing is sent until status = 'confirmed'.
CREATE TABLE subscribers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  interests        TEXT,            -- JSON array, e.g. ["card-league","rate-alerts"]
  consent_version  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  confirmed_at     TEXT,
  unsubscribed_at  TEXT,
  token            TEXT NOT NULL UNIQUE   -- for confirm / unsubscribe links
);
