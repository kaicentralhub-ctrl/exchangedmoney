/**
 * Trip state: what you'll spend, and which cards you carry. Pure, so it's tested in Node.
 * Saved on the device and shareable as a link; nothing is sent to us.
 */
import type { CardProduct, Spend } from "@exm/core/fees";
import type { CardNetwork } from "@exm/core/types";

export interface TripSpend extends Spend {
  id: string;
  date: string;
}

export interface WalletEntry {
  productId: string;
  network: CardNetwork;
}

export interface QuickPlan {
  currency: string;
  start: string;
  days: number;
  /** Card payments per day, in the trip currency. */
  daily: number;
  cashCount: number;
  /** Per withdrawal, in the trip currency. */
  cashAmount: number;
}

export interface TripState {
  plan: QuickPlan;
  spends: TripSpend[];
  /** null = compare every card we cover. */
  wallet: WalletEntry[] | null;
  /** Markup a terminal offered for paying in pounds, in %, if the user entered one. */
  dccPct: number | null;
}

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

const DAY = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Turn a quick plan into dated spends: one card payment total per day, cash spread evenly. */
export function planSpends(p: QuickPlan): TripSpend[] {
  const days = Math.round(clamp(p.days, 1, 60));
  const cashCount = Math.round(clamp(p.cashCount, 0, 30));
  const out: TripSpend[] = [];
  if (p.daily > 0) for (let d = 0; d < days; d++) out.push({ id: newId(), date: addDays(p.start, d), context: "purchase", currency: p.currency, amount: p.daily });
  if (p.cashAmount > 0)
    for (let i = 0; i < cashCount; i++) out.push({ id: newId(), date: addDays(p.start, Math.floor((i * days) / cashCount)), context: "atm", currency: p.currency, amount: p.cashAmount });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.context.localeCompare(b.context));
}

export function defaultPlan(today: string): QuickPlan {
  return { currency: "EUR", start: addDays(today, 14), days: 7, daily: 60, cashCount: 2, cashAmount: 150 };
}

export function defaultState(today: string): TripState {
  const plan = defaultPlan(today);
  return { plan, spends: planSpends(plan), wallet: null, dccPct: null };
}

/** The network a product is priced on unless the user picks another. */
export const defaultNetwork = (p: CardProduct): CardNetwork => p.networks[0] ?? "unknown";

/* ---------------- sharing and saving ---------------- */

type Packed = { v: 1; p: QuickPlan; s: [string, "p" | "a", string, number][]; w: [string, string][] | null; d: number | null };

const toB64Url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export function encodeTrip(t: TripState): string {
  const packed: Packed = {
    v: 1,
    p: t.plan,
    s: t.spends.map((x) => [x.date, x.context === "atm" ? "a" : "p", x.currency, x.amount]),
    w: t.wallet ? t.wallet.map((w) => [w.productId, w.network]) : null,
    d: t.dccPct,
  };
  return toB64Url(JSON.stringify(packed));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CUR = /^[A-Z]{3}$/;
const NETS = ["visa", "mastercard", "unknown"];

/** Parse a shared or saved trip; anything malformed gives null rather than a broken state. */
export function decodeTrip(encoded: string): TripState | null {
  try {
    const raw = JSON.parse(fromB64Url(encoded)) as Partial<Packed>;
    if (raw.v !== 1 || !Array.isArray(raw.s) || raw.s.length > 500 || !raw.p) return null;
    const p = raw.p;
    if (!CUR.test(p.currency) || !DATE.test(p.start)) return null;
    const plan: QuickPlan = { currency: p.currency, start: p.start, days: clamp(+p.days, 1, 60), daily: clamp(+p.daily, 0, 1e7), cashCount: clamp(+p.cashCount, 0, 30), cashAmount: clamp(+p.cashAmount, 0, 1e7) };
    const spends: TripSpend[] = [];
    for (const row of raw.s) {
      if (!Array.isArray(row) || row.length !== 4) return null;
      const [date, kind, currency, amount] = row;
      if (!DATE.test(String(date)) || (kind !== "p" && kind !== "a") || !CUR.test(String(currency)) || !(Number(amount) > 0)) return null;
      spends.push({ id: newId(), date: String(date), context: kind === "a" ? "atm" : "purchase", currency: String(currency), amount: Number(amount) });
    }
    let wallet: WalletEntry[] | null = null;
    if (Array.isArray(raw.w)) {
      wallet = raw.w
        .filter((w): w is [string, string] => Array.isArray(w) && typeof w[0] === "string" && NETS.includes(String(w[1])))
        .map(([productId, network]) => ({ productId, network: network as CardNetwork }));
    }
    const d = raw.d === null || raw.d === undefined ? null : clamp(Number(raw.d), 0, 50);
    return { plan, spends, wallet, dccPct: d };
  } catch {
    return null;
  }
}

const STORE_KEY = "exm.trip.v1";

export function saveTrip(t: TripState): void {
  try {
    localStorage.setItem(STORE_KEY, encodeTrip(t));
  } catch {
    /* storage can be unavailable (private mode, quota); the trip still works for this visit */
  }
}

export function loadTrip(): TripState | null {
  try {
    const s = localStorage.getItem(STORE_KEY);
    return s ? decodeTrip(s) : null;
  } catch {
    return null;
  }
}
