import { describe, expect, it } from "vitest";
import { CARD_PRODUCTS } from "@exm/core/tariffs";
import type { IssuerMarkup } from "@exm/core/types";
import { rankCardCosts } from "../src/lib/costs.js";

const mk = (issuer: string, product: string, network: "visa" | "mastercard", cardType: "debit" | "credit", pct: number): IssuerMarkup => ({
  issuer, product, network, cardType, segment: "personal", context: "purchase", currency: "EUR", markupPct: pct, publishedAt: null,
});
const markups = [
  mk("HSBC UK", "VISA debit card", "visa", "debit", 2.99),
  mk("HSBC UK", "Mastercard debit card", "mastercard", "debit", 2.95),
  mk("first direct", "Mastercard debit card", "mastercard", "debit", 2.85),
  mk("HSBC UK", "VISA credit card", "visa", "credit", 3.23),
];
const toGBP = (cur: string, amt: number) => (cur === "EUR" ? amt * 0.873 : cur === "USD" ? amt * 0.76 : null);

describe("full-cost league", () => {
  it("ranks products by total cost of the spend and keeps the network whose disclosure agrees", () => {
    const rows = rankCardCosts(CARD_PRODUCTS, markups, toGBP, { currency: "EUR", context: "purchase", gbp: 1000, segment: "personal", type: "all" });
    const fd = rows.find((r) => r.product.id === "first-direct/debit")!;
    expect(fd.cost.check.status).toBe("conflict");
    expect(fd.feesGBP).toBe(0);
    expect(fd.estimateGBP).toBeCloseTo(2.0, 1); // Mastercard EUR margin from HSBC's agreeing disclosure (2.95-2.75)
    // Every no-fee Mastercard debit card ties with it at the cheapest total.
    const cheapest = rows[0]!.cost.totalGBP;
    expect(fd.cost.totalGBP).toBe(cheapest);
    expect(rows.filter((r) => r.cost.totalGBP === cheapest).map((r) => r.product.id)).toEqual(expect.arrayContaining(["chase-uk/debit", "first-direct/debit", "starling/debit", "monzo/standard"]));
    const hsbcOther = rows.find((r) => r.product.id === "hsbc-uk/debit-other")!;
    expect(hsbcOther.feesGBP).toBe(27.5);
    expect(hsbcOther.network).toBe("visa"); // first network with an agreeing disclosure
    expect(hsbcOther.estimateGBP).toBeCloseTo(2.4, 1); // 0.24% on £1,000
    expect(rows.at(-1)!.feesGBP).toBe(29.9); // a 2.99% card is the most expensive here
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.cost.totalGBP).toBeGreaterThanOrEqual(rows[i - 1]!.cost.totalGBP);
  });

  it("prices currencies issuers don't disclose, from the fee schedule alone", () => {
    const rows = rankCardCosts(CARD_PRODUCTS, markups, toGBP, { currency: "USD", context: "atm", gbp: 100, segment: "personal", type: "debit" });
    const other = rows.find((r) => r.product.id === "hsbc-uk/debit-other")!;
    expect(other.cost.lines.map((l) => [l.label, l.gbp])).toEqual([["Non-sterling transaction fee", 2.75], ["Cash fee", 2]]);
    expect(other.cost.check.status).toBe("none");
    expect(rows.every((r) => r.product.cardType === "debit")).toBe(true);
  });

  it("returns nothing without a rate", () => {
    expect(rankCardCosts(CARD_PRODUCTS, markups, toGBP, { currency: "XYZ", context: "purchase", gbp: 100, segment: "personal", type: "all" })).toEqual([]);
  });
});
