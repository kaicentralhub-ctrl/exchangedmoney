import { describe, expect, it } from "vitest";
import { breakEvenPct, dccCost } from "../src/lib/dcc.js";
import { addDays, decodeTrip, defaultState, encodeTrip, planSpends, type TripState } from "../src/lib/trip.js";

describe("quick plan", () => {
  it("makes one card-payment line per day and spreads cash evenly", () => {
    const s = planSpends({ currency: "EUR", start: "2026-12-05", days: 7, daily: 60, cashCount: 2, cashAmount: 150 });
    const pay = s.filter((x) => x.context === "purchase");
    const cash = s.filter((x) => x.context === "atm");
    expect(pay.map((x) => x.date)).toEqual(["2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11"]);
    expect(cash.map((x) => x.date)).toEqual(["2026-12-05", "2026-12-08"]);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    expect(s.map((x) => x.date)).toEqual([...s.map((x) => x.date)].sort());
  });

  it("clamps silly inputs", () => {
    expect(planSpends({ currency: "EUR", start: "2026-12-05", days: 999, daily: 1, cashCount: -3, cashAmount: 10 })).toHaveLength(60);
    expect(planSpends({ currency: "EUR", start: "2026-12-05", days: 3, daily: 0, cashCount: 0, cashAmount: 0 })).toEqual([]);
  });

  it("adds days across months", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("sharing", () => {
  const trip: TripState = { ...defaultState("2026-11-23"), wallet: [{ productId: "first-direct/debit", network: "mastercard" }], dccPct: 5.5 };

  it("round-trips through a URL-safe string", () => {
    const enc = encodeTrip(trip);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeTrip(enc)!;
    expect(back.plan).toEqual(trip.plan);
    expect(back.wallet).toEqual(trip.wallet);
    expect(back.dccPct).toBe(5.5);
    expect(back.spends.map(({ id: _id, ...s }) => s)).toEqual(trip.spends.map(({ id: _id, ...s }) => s));
  });

  it("rejects malformed or tampered input instead of breaking", () => {
    expect(decodeTrip("not-base64!")).toBeNull();
    const bad = (o: unknown) => decodeTrip(btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    const plan = { currency: "EUR", start: "2026-12-05", days: 1, daily: 1, cashCount: 0, cashAmount: 0 };
    expect(bad({ v: 2, p: plan, s: [], w: null, d: null })).toBeNull();
    expect(bad({ v: 1, p: plan, s: [["2026-12-05", "x", "EUR", 5]], w: null, d: null })).toBeNull();
    expect(bad({ v: 1, p: plan, s: [["2026-12-05", "p", "eur", 5]], w: null, d: null })).toBeNull();
    expect(bad({ v: 1, p: plan, s: [["2026-12-05", "p", "EUR", -5]], w: null, d: null })).toBeNull();
    expect(bad({ v: 1, p: { ...plan, currency: "<script>" }, s: [], w: null, d: null })).toBeNull();
    expect(bad({ v: 1, p: plan, s: [], w: [["x/y", "amex"]], d: 999 })).toMatchObject({ wallet: [], dccPct: 50 });
  });
});

describe("paying in pounds", () => {
  it("costs the offered markup, and breaks even at the card's own effective rate", () => {
    expect(dccCost(500, 4)).toBe(20);
    expect(breakEvenPct(13.75, 500)).toBeCloseTo(2.75);
    expect(breakEvenPct(1, 0)).toBe(0);
  });
});
