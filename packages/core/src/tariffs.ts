/**
 * Curated fee schedules, read from each issuer's own pages.
 *
 * Rules: every product cites the page(s) its fees come from and the date we last checked them.
 * When the issuer's pages disagree with each other, follow the fee page and record a caveat.
 * Re-check each product at least every 90 days (the health check reminds us).
 */
import type { CardProduct } from "./fees.js";

const HSBC_DEBIT_PAGE = { label: "HSBC UK: using your card (fees outside the UK)", url: "https://www.hsbc.co.uk/help/card-support/using-your-card/", checkedAt: "2026-11-23" };
const HSBC_CHARGES_PAGE = { label: "HSBC UK: current account interest rates and charges", url: "https://www.hsbc.co.uk/current-accounts/interest-rates-and-charges/", checkedAt: "2026-11-23" };
const FD_PAGE = { label: "first direct: using your cards outside the UK", url: "https://www.firstdirect.com/travel-and-international/travel-help-and-advice/using-your-cards-outside-the-uk/", checkedAt: "2026-11-23" };

const NSTF = (pct: number, appliesTo: ("purchase" | "atm")[] = ["purchase", "atm"]) =>
  ({ kind: "percent", name: "Non-sterling transaction fee", pct, appliesTo, inDisclosedMarkup: true }) as const;

const CREDIT_INTEREST = "Interest is charged on cash withdrawals from the day you take the cash until you repay it, with no interest-free period. Not included here.";

export const CARD_PRODUCTS: readonly CardProduct[] = [
  {
    id: "hsbc-uk/debit-premier",
    issuer: "HSBC UK",
    name: "Debit card (Premier, Jade or Private Banking account)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa", "mastercard"],
    markupMatch: { purchase: "debit card", atm: "premier|advance" },
    fees: [NSTF(2.75)],
    caveats: [],
    sources: [HSBC_DEBIT_PAGE, HSBC_CHARGES_PAGE],
  },
  {
    id: "hsbc-uk/debit-advance",
    issuer: "HSBC UK",
    name: "Debit card (Advance account)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa", "mastercard"],
    markupMatch: { purchase: "debit card", atm: "premier|advance" },
    fees: [NSTF(2.75), { kind: "percent", name: "Cash fee", pct: 2, minGBP: 1.75, maxGBP: 5, appliesTo: ["atm"], inDisclosedMarkup: true }],
    caveats: [
      "HSBC's fee pages list Advance under “all other accounts”, which pay the cash fee, but its markup table groups Advance with Premier, which doesn't. We follow the fee pages.",
    ],
    sources: [HSBC_CHARGES_PAGE, HSBC_DEBIT_PAGE],
  },
  {
    id: "hsbc-uk/debit-other",
    issuer: "HSBC UK",
    name: "Debit card (Bank Account, Student and other accounts)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa", "mastercard"],
    markupMatch: { purchase: "debit card", atm: "bank account" },
    fees: [NSTF(2.75), { kind: "percent", name: "Cash fee", pct: 2, minGBP: 1.75, maxGBP: 5, appliesTo: ["atm"], inDisclosedMarkup: true }],
    caveats: [],
    sources: [HSBC_DEBIT_PAGE, HSBC_CHARGES_PAGE],
  },
  {
    id: "hsbc-uk/credit",
    issuer: "HSBC UK",
    name: "Credit card (HSBC, Premier, Premier World Elite and Student)",
    cardType: "credit",
    segment: "personal",
    networks: ["visa", "mastercard"],
    markupMatch: { purchase: "credit card", atm: "credit card" },
    fees: [NSTF(2.99), { kind: "percent", name: "Cash fee", pct: 2.99, minGBP: 3, appliesTo: ["atm"], inDisclosedMarkup: true }],
    caveats: [CREDIT_INTEREST],
    sources: [HSBC_DEBIT_PAGE],
  },
  {
    id: "first-direct/debit",
    issuer: "first direct",
    name: "1st Account debit card",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit card", atm: "bank account" },
    fees: [],
    caveats: [
      "first direct says it charges no fees on its debit card abroad and converts at the Mastercard rate. Its published markup table still shows markups for this card well above the network's own rate; we follow the fee page.",
      "Cash withdrawals are limited to £500 a day.",
    ],
    sources: [FD_PAGE],
  },
  {
    id: "first-direct/credit",
    issuer: "first direct",
    name: "Credit card and Gold card",
    cardType: "credit",
    segment: "personal",
    networks: ["visa", "mastercard"],
    markupMatch: { purchase: "credit card", atm: "credit card" },
    fees: [NSTF(2.99), { kind: "percent", name: "Cash advance fee", pct: 2.99, minGBP: 3, appliesTo: ["atm"], inDisclosedMarkup: true }],
    caveats: [CREDIT_INTEREST, "Cash withdrawals are limited to £500 a day in local currency."],
    sources: [FD_PAGE],
  },
];

export const productById = (id: string): CardProduct | undefined => CARD_PRODUCTS.find((p) => p.id === id);
