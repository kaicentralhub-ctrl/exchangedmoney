#!/usr/bin/env bash
# exchangedmoney: go live on Cloudflare in one command. Safe to re-run; each step checks first.
#
#   ./scripts/go-live.sh             set up, deploy, start collecting, load ECB history
#   ./scripts/go-live.sh --history   load the next unloaded part of the ECB history (free D1 plan)
#
# Needs: Node 22+, pnpm, a Cloudflare account with exchangedmoney.com, and `wrangler login` done.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/apps/worker"
CONF="$WORKER/wrangler.toml"
SECRETS_DIR="$HOME/.config/exchangedmoney"
TOKEN_FILE="$SECRETS_DIR/admin-token"
URL_FILE="$SECRETS_DIR/worker-url"
BACKFILL_DIR="$ROOT/data/backfill"
APPLIED="$BACKFILL_DIR/.applied"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1 [y/N] " a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }
w() { (cd "$WORKER" && pnpm exec wrangler "$@"); }

admin() { # admin <job>
  local token url
  token="$(cat "$TOKEN_FILE")"
  url="$(cat "$URL_FILE")"
  curl -fsS -X POST -H "Authorization: Bearer $token" "$url/api/admin/run?job=$1" >/dev/null && ok "started $1"
}

load_history() {
  mkdir -p "$BACKFILL_DIR" "$ROOT/data/ecb"
  touch "$APPLIED"
  if ! ls "$BACKFILL_DIR"/*.sql >/dev/null 2>&1; then
    bold "Fetching the ECB's full history of reference rates"
    curl -fsSL https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip -o "$ROOT/data/ecb/eurofxref-hist.zip"
    (cd "$ROOT/data/ecb" && unzip -o -q eurofxref-hist.zip)
    (cd "$ROOT" && pnpm backfill:ecb data/ecb/eurofxref-hist.csv)
  fi
  local files=() f
  for f in "$BACKFILL_DIR"/*.sql; do grep -qx "$(basename "$f")" "$APPLIED" || files+=("$f"); done
  if [ ${#files[@]} -eq 0 ]; then ok "ECB history already loaded"; return 0; fi
  local all="$1"
  for f in "${files[@]}"; do
    bold "Loading $(basename "$f") into D1"
    w d1 execute exm --remote --file "$f" --yes
    basename "$f" >>"$APPLIED"
    ok "loaded $(basename "$f")"
    if [ "$all" != "all" ] && [ ${#files[@]} -gt 1 ]; then
      warn "D1's free plan allows about 100,000 rows written a day. Run ./scripts/go-live.sh --history tomorrow for the next part."
      break
    fi
  done
  admin publish
}

if [ "${1:-}" = "--history" ]; then
  [ -f "$TOKEN_FILE" ] || die "Run ./scripts/go-live.sh first."
  load_history one
  exit 0
fi

bold "1/9  Checking tools and sign-in"
command -v node >/dev/null || die "Node.js 22 or newer is needed."
command -v pnpm >/dev/null || die "pnpm is needed: npm install -g pnpm"
command -v curl >/dev/null || die "curl is needed."
command -v unzip >/dev/null || die "unzip is needed."
(cd "$ROOT" && pnpm install --frozen-lockfile >/dev/null)
if ! w whoami 2>/dev/null | grep -q "You are logged in"; then
  warn "Wrangler isn't signed in to Cloudflare. A browser window will open; choose Allow."
  w login
fi
ok "signed in to Cloudflare"

bold "2/9  Checking the code (tests, types, build)"
(cd "$ROOT" && pnpm test >/dev/null && pnpm typecheck >/dev/null) || die "Tests or typecheck failed; fix before deploying."
ok "tests and typecheck pass"

bold "3/9  Workers plan"
echo "  Reading bank pages and PDFs needs more than the free plan's 10 ms of CPU per scheduled run."
echo "  Workers Paid (\$5 a month) allows up to 15 minutes. Upgrade: https://dash.cloudflare.com/?to=/:account/workers/plans"
PAID=no
if ask "Is this account on Workers Paid?"; then PAID=yes; ok "Workers Paid"; else warn "Continuing on Free: ECB and Frankfurter should work; bank collectors will likely exceed the CPU limit until you upgrade."; fi

bold "4/9  Database (D1)"
DB_ID="$(w d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);const d=l.find(x=>x.name==="exm");process.stdout.write(d?d.uuid:"")}catch{}})')"
if [ -z "$DB_ID" ]; then
  w d1 create exm >/dev/null
  DB_ID="$(w d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="exm");process.stdout.write(d?d.uuid:"")})')"
  [ -n "$DB_ID" ] || die "Couldn't create the D1 database."
  ok "created database exm"
else
  ok "database exm exists"
fi
node -e '
  const fs=require("fs"); const [file,id]=process.argv.slice(1);
  const s=fs.readFileSync(file,"utf8");
  const next=s.replace(/database_id = "[^"]*"/, `database_id = "${id}"`);
  if (next!==s) fs.writeFileSync(file,next);
' "$CONF" "$DB_ID"
ok "wrangler.toml points at $DB_ID"
w d1 migrations apply exm --remote
ok "schema up to date"

bold "5/9  Storage (R2)"
BUCKETS="$(w r2 bucket list 2>/dev/null || true)"
for b in exm-snapshots exm-published; do
  if printf '%s\n' "$BUCKETS" | grep -Eq "(^|[[:space:]\"])$b(\"|[[:space:]]|\$)"; then
    ok "bucket $b exists"
  else
    w r2 bucket create "$b" >/dev/null || die "Couldn't create $b. If R2 isn't enabled yet, enable it in the dashboard (it may ask for a payment method), then re-run."
    ok "created bucket $b"
  fi
done

bold "6/9  Deploying"
LOG="$(mktemp)"
(cd "$ROOT" && pnpm --filter @exm/worker run deploy) 2>&1 | tee "$LOG"
URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$LOG" | head -1 || true)"
rm -f "$LOG"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
if [ -n "$URL" ]; then printf '%s' "$URL" >"$URL_FILE"; fi
[ -f "$URL_FILE" ] || die "Couldn't find the workers.dev address in the deploy output."
ok "live at $(cat "$URL_FILE")"

bold "7/9  Secrets"
if [ ! -f "$TOKEN_FILE" ]; then
  node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' >"$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
w secret put ADMIN_TOKEN <"$TOKEN_FILE" >/dev/null
ok "admin token set (kept in $TOKEN_FILE, never printed)"
read -r -p "  ntfy URL for alerts (e.g. https://ntfy.sh/your-private-topic), or Enter to skip: " NTFY
if [ -n "$NTFY" ]; then printf '%s' "$NTFY" | w secret put NTFY_URL >/dev/null; ok "alerts go to ntfy"; else warn "no alerts set; add later with: cd apps/worker && pnpm exec wrangler secret put NTFY_URL"; fi

bold "8/9  First collection"
sleep 5
admin daily-ecb
admin daily-morning
echo "  Waiting 45 seconds for the first runs to finish…"
sleep 45
curl -fsS "$(cat "$URL_FILE")/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);for(const r of h.sources)console.log(`  ${r.stale?"!":"✓"} ${r.source}: ${r.lastSuccess??"not yet"}`)})'

bold "9/9  ECB history (1999 onwards)"
if ask "Load it now?"; then
  if [ "$PAID" = yes ]; then load_history all; else load_history one; fi
else
  warn "Skipped. Load it any time with: ./scripts/go-live.sh --history"
fi

bold "Custom domain"
if grep -q '^# routes = \[' "$CONF"; then
  if ask "Serve the site at exchangedmoney.com and www now? (Cloudflare will refuse if other DNS records already use those names)"; then
    node -e '
      const fs=require("fs"); const f=process.argv[1];
      let s=fs.readFileSync(f,"utf8");
      s=s.replace(/# routes = \[\n#   (.*)\n#   (.*)\n# \]/, "routes = [\n  $1\n  $2\n]");
      fs.writeFileSync(f,s);
    ' "$CONF"
    (cd "$ROOT" && pnpm --filter @exm/worker run deploy) && ok "exchangedmoney.com points at the Worker"
  fi
else
  ok "custom domain already configured"
fi

bold "Done"
echo "  App:      $(cat "$URL_FILE")/app/"
echo "  Health:   $(cat "$URL_FILE")/api/health"
echo "  Commit wrangler.toml (database id, routes); it holds no secrets."
