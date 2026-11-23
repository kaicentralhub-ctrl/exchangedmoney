const MINUS = "−";

export function pct(v: number, dp = 2): string {
  return `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(dp)}%`;
}

export function gbp(v: number, dp = 2): string {
  const s = Math.abs(v).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `${MINUS}${s}` : s;
}

export function num(v: number, sig = 6): string {
  if (!Number.isFinite(v)) return "–";
  const dp = Math.max(0, Math.min(6, sig - Math.max(1, Math.floor(Math.log10(Math.abs(v))) + 1)));
  return v.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const UK_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** A UTC instant, shown in UK time. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : UK.format(d);
}

/** A publisher's local timestamp ("2026-11-21T00:08") or a date, shown as written. */
export function local(stamp: string | null | undefined): string {
  if (!stamp) return "not stated";
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(stamp);
  if (!m) return stamp;
  const date = UK_DATE.format(new Date(`${m[1]}T00:00:00Z`));
  return m[2] ? `${date}, ${m[2]}` : date;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const names = new Intl.DisplayNames(["en-GB"], { type: "currency" });
export function currencyName(code: string): string {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}
