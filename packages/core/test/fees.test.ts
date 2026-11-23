import { describe, expect, it } from "vitest";
import {
  CARD_PRODUCTS, checkDisclosure, disclosedMarkup, estimateNetworkMargins, priceSpend, priceTrip, productById, schedulePct, staleProducts,
  type CardProduct, type IssuerMarkup, type PricingContext,
} from "../src/index.js";

// Synthetic markups in the shape the HSBC and first direct parsers produce.
const mk = (issuer: string, product: string, context: "purchase" | "atm", currency: string, pct: number, cardType: "debit" | "credit" = "debit", network: "visa" | "mastercard" = "visa"): IssuerMarkup => ({
  issuer, product, network, cardType, segment: "personal", context, currency, markupPct: pct, publishedAt: null,
});
const MARKUPS = [
  mk("HSBC UK", "VISA debit card", "purchase", "EUR", 2.99),
  mk("HSBC UK", "VISA debit card for Premier or Advance", "atm", "EUR", 3.0),
  mk("HSBC UK", "VISA debit card for Bank Account", "atm", "EUR", 5.0),
  mk("HSBC UK", "VISA credit card", "atm", "EUR", 6.23, "credit"),
  mk("first direct", "Mastercard debit card", "purchase", "EUR", 2.85, "debit", "mastercard"),
];
// 1 EUR = 0.873 GBP; USD unknown.
const ctx = (network: "visa" | "mastercard" = "visa"): PricingContext => ({
  toGBP: (cur, amt) => (cur === "EUR" ? amt * 0.873 : cur === "GBP" ? amt : null),
  markups: MARKUPS,
  network,
});
const card = (id: string) => productById(id)!;

describe("pricing a spend", () => {
  it("applies the cash fee minimum and estimates the network margin from the disclosure", () => {
    const c = priceSpend({ context: "atm", currency: "EUR", amount: 100 }, card("hsbc-uk/debit-other"), ctx());
    expect(c.baseGBP).toBe(87.3);
    expect(c.check).toEqual({ status: "consistent", disclosedPct: 5, schedulePct: 4.75 });
    expect(c.lines.map((l) => [l.label, l.gbp, l.basis])).toEqual([
      ["Non-sterling transaction fee", 2.4, "fee-schedule"],
      ["Cash fee", 1.75, "fee-schedule"],
      ["Card network's rate vs ECB", 0.22, "estimate"],
    ]);
    expect(c.lines[1]!.detail).toMatch(/minimum £1\.75/);
    expect(c.totalGBP).toBe(4.37);
  });

  it("caps the cash fee at its maximum", () => {
    const c = priceSpend({ context: "atm", currency: "EUR", amount: 1000 }, card("hsbc-uk/debit-other"), ctx());
    expect(c.lines.find((l) => l.label === "Cash fee")).toMatchObject({ gbp: 5 });
    expect(c.lines.find((l) => l.label === "Cash fee")!.detail).toMatch(/maximum £5\.00/);
  });

  it("flags a disclosure that disagrees with the fee schedule and prices from the schedule", () => {
    const fd = priceSpend({ context: "purchase", currency: "EUR", amount: 100 }, card("first-direct/debit"), ctx("mastercard"));
    expect(fd.check).toEqual({ status: "conflict", disclosedPct: 2.85, schedulePct: 0 });
    expect(fd.totalGBP).toBe(0);
    expect(fd.notes.join(" ")).toMatch(/published markup for this card is 2\.85%.*fee schedule adds up to 0%/);

    const adv = priceSpend({ context: "atm", currency: "EUR", amount: 100 }, card("hsbc-uk/debit-advance"), ctx());
    expect(adv.check.status).toBe("conflict"); // disclosure groups Advance with Premier
    const prem = priceSpend({ context: "atm", currency: "EUR", amount: 100 }, card("hsbc-uk/debit-premier"), ctx());
    expect(prem.check.status).toBe("consistent");
    expect(prem.lines.map((l) => l.label)).toEqual(["Non-sterling transaction fee", "Card network's rate vs ECB"]);
  });

  it("notes the unknown network margin when there is no disclosure (e.g. outside the EEA)", () => {
    const c = priceSpend({ context: "purchase", currency: "GBP", amount: 50 }, card("hsbc-uk/credit"), ctx());
    expect(c.check.status).toBe("none");
    expect(c.lines).toHaveLength(1);
    expect(c.notes[0]).toMatch(/network's own margin/);
  });

  it("can't price a currency with no reference rate", () => {
    const c = priceSpend({ context: "purchase", currency: "USD", amount: 50 }, card("hsbc-uk/credit"), ctx());
    expect(c.baseGBP).toBeNull();
    expect(c.totalGBP).toBe(0);
    expect(c.notes[0]).toMatch(/No reference rate for USD/);
  });
});

describe("allowances across a trip", () => {
  const allowanceCard: CardProduct = {
    id: "test/allowance", issuer: "Test", name: "Card with £200 a month fee-free cash", cardType: "debit", segment: "personal", networks: ["mastercard"],
    markupMatch: { purchase: "x", atm: "x" },
    fees: [
      { kind: "percent", name: "Cash fee", pct: 3, appliesTo: ["atm"], inDisclosedMarkup: false, allowance: { gbp: 200, period: "month" } },
      { kind: "fixed", name: "Withdrawal fee", gbp: 1, appliesTo: ["atm"], inDisclosedMarkup: false, allowance: { count: 2, period: "day" } },
    ],
    caveats: [], sources: [{ label: "test", url: "https://example.test", checkedAt: "2026-11-23" }],
  };
  const gbp: PricingContext = { toGBP: (_c, a) => a, markups: [], network: "mastercard" };

  it("charges only the amount above the monthly allowance, in date order", () => {
    const t = priceTrip(
      [
        { context: "atm", currency: "GBP", amount: 150, date: "2026-12-02" },
        { context: "atm", currency: "GBP", amount: 150, date: "2026-12-01" },
        { context: "atm", currency: "GBP", amount: 100, date: "2027-01-01" },
      ],
      allowanceCard, gbp,
    );
    expect(t.spends.map((s) => s.lines.find((l) => l.label === "Cash fee")?.gbp ?? 0)).toEqual([0, 3, 0]); // 100 over on 2 Dec; new month resets
    expect(t.baseGBP).toBe(400);
  });

  it("counts transactions against a daily count allowance", () => {
    const day = (n: number) => ({ context: "atm" as const, currency: "GBP", amount: 10, date: "2026-12-01", n });
    const t = priceTrip([day(1), day(2), day(3)], allowanceCard, gbp);
    expect(t.spends.map((s) => s.lines.find((l) => l.label === "Withdrawal fee")?.gbp ?? 0)).toEqual([0, 0, 1]);
  });
});

describe("helpers", () => {
  it("finds the disclosed markup by issuer, context, currency, card type, network and label", () => {
    expect(disclosedMarkup(card("hsbc-uk/debit-other"), MARKUPS, "atm", "EUR", "visa")).toBe(5);
    expect(disclosedMarkup(card("hsbc-uk/debit-other"), MARKUPS, "atm", "EUR", "mastercard")).toBeNull();
    expect(schedulePct(card("hsbc-uk/credit"), "atm")).toBeCloseTo(5.98);
    expect(checkDisclosure(3.2, 2.75).status).toBe("consistent");
    expect(checkDisclosure(2.0, 2.75).status).toBe("conflict");
  });

  it("finds fee schedules due a re-check", () => {
    expect(staleProducts(CARD_PRODUCTS, new Date("2026-12-01T00:00:00Z"))).toEqual([]);
    expect(staleProducts(CARD_PRODUCTS, new Date("2027-03-01T00:00:00Z")).length).toBe(CARD_PRODUCTS.length);
  });
});

describe("curated fee schedules", () => {
  it("are well formed and sourced", () => {
    expect(new Set(CARD_PRODUCTS.map((p) => p.id)).size).toBe(CARD_PRODUCTS.length);
    for (const p of CARD_PRODUCTS) {
      expect(p.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      for (const pattern of Object.values(p.markupMatch)) expect(() => new RegExp(pattern, "i")).not.toThrow();
      for (const f of p.fees) {
        expect(f.appliesTo.length).toBeGreaterThan(0);
        if (f.kind === "percent") expect(f.pct).toBeGreaterThan(0);
      }
    }
  });
});

describe("typical network margins", () => {
  it("are the median gap between agreeing disclosures and schedules, per network and currency", () => {
    const m = estimateNetworkMargins(CARD_PRODUCTS, MARKUPS);
    // Visa EUR: HSBC debit purchase 2.99-2.75 (x3 products), premier ATM 3.0-2.75, other ATM 5.0-4.75, credit ATM 6.23-5.98
    expect(m.get("visa|EUR")).toEqual({ pct: 0.25, samples: 6 });
    expect(m.has("mastercard|EUR")).toBe(false); // first direct disagrees, so no Mastercard sample
  });

  it("fill in the margin for a card whose own disclosure can't give it", () => {
    const margins = estimateNetworkMargins(CARD_PRODUCTS, MARKUPS);
    const adv = priceSpend({ context: "atm", currency: "EUR", amount: 100 }, card("hsbc-uk/debit-advance"), { ...ctx(), networkMargins: margins });
    const other = priceSpend({ context: "atm", currency: "EUR", amount: 100 }, card("hsbc-uk/debit-other"), { ...ctx(), networkMargins: margins });
    expect(adv.check.status).toBe("conflict");
    expect(adv.lines.at(-1)!.detail).toMatch(/typical for Visa in EUR, from 6 issuer disclosures/);
    expect(adv.totalGBP).toBeCloseTo(other.totalGBP, 1); // same schedule, near-same cost
  });
});

