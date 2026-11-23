/**
 * Curated fee schedules, read from each issuer's own pages.
 *
 * Rules: every product cites the page(s) its fees come from and the date we last checked them.
 * When the issuer's pages disagree with each other, follow the fee page and record a caveat.
 * Re-check each product at least every 90 days (the health check reminds us).
 */
import { EEA_CURRENCIES, type CardProduct, type FeeRule } from "./fees.js";

const HSBC_DEBIT_PAGE = { label: "HSBC UK: using your card (fees outside the UK)", url: "https://www.hsbc.co.uk/help/card-support/using-your-card/", checkedAt: "2026-11-23" };
const HSBC_CHARGES_PAGE = { label: "HSBC UK: current account interest rates and charges", url: "https://www.hsbc.co.uk/current-accounts/interest-rates-and-charges/", checkedAt: "2026-11-23" };
const FD_PAGE = { label: "first direct: using your cards outside the UK", url: "https://www.firstdirect.com/travel-and-international/travel-help-and-advice/using-your-cards-outside-the-uk/", checkedAt: "2026-11-23" };

const day = "2026-11-23";
const STARLING = { label: "Starling Bank: travel", url: "https://www.starlingbank.com/travel/", checkedAt: day };
const STARLING_LIMITS = { label: "Starling Bank: travelling with your card", url: "https://www.starlingbank.com/campaign/starling-current-account/travel/", checkedAt: day };
const MONZO = { label: "Monzo: understanding fees for using your card abroad", url: "https://monzo.com/help/travelling/fees", checkedAt: day };
const CHASE = { label: "Chase UK: travelling with Chase", url: "https://www.chase.co.uk/gb/en/product/travel-with-chase", checkedAt: day };
const BARCLAYS = { label: "Barclays: using your debit card abroad", url: "https://www.barclays.co.uk/help/cards/using-cards/connect-abroad/", checkedAt: day };
const NATWEST = { label: "NatWest: spend abroad with no non-sterling transaction fees", url: "https://www.natwest.com/current-accounts/existing-customers/no-non-sterling-transaction-fee.html", checkedAt: day };
const SANTANDER = { label: "Santander UK: travelling abroad", url: "https://www.santander.co.uk/personal/support/credit-cards/travelling", checkedAt: day };
const NATIONWIDE = { label: "Nationwide: fees for using your card in a foreign currency", url: "https://www.nationwide.co.uk/help/travel/charges-using-your-card-abroad", checkedAt: day };

const MONZO_CAVEATS = [
  "Monzo's fee-free cash allowance runs for 30 days from your first withdrawal, then starts again. We count euro and other EEA currencies as the EEA; euros withdrawn outside the EEA would count as outside.",
  "Paid plans have a monthly fee, not included here. Cash withdrawals are limited to £400 a day.",
];
const monzoCash = (eeaAllowance: number | null, outsideAllowance: number): FeeRule[] => {
  const rule = (name: string, gbp: number, currencies: FeeRule["currencies"]): FeeRule => ({
    kind: "percent", name, pct: 3, appliesTo: ["atm"], inDisclosedMarkup: false, currencies, allowance: { gbp, period: "30-days-from-first" },
  });
  return [
    ...(eeaAllowance === null ? [] : [rule("Cash withdrawal fee (EEA, over allowance)", eeaAllowance, { only: EEA_CURRENCIES })]),
    rule("Cash withdrawal fee (outside the EEA, over allowance)", outsideAllowance, { except: EEA_CURRENCIES }),
  ];
};

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
  /* ---------------- Starling ---------------- */
  {
    id: "starling/debit",
    issuer: "Starling Bank",
    name: "Personal account debit card",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [],
    caveats: ["Cash withdrawals are limited to £300 a day, and six withdrawals a day."],
    sources: [STARLING, STARLING_LIMITS],
  },

  /* ---------------- Monzo ---------------- */
  {
    id: "monzo/standard",
    issuer: "Monzo",
    name: "Debit card (Monzo isn't your main bank)",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: monzoCash(400, 200),
    caveats: MONZO_CAVEATS,
    sources: [MONZO],
  },
  {
    id: "monzo/main-bank",
    issuer: "Monzo",
    name: "Debit card (Monzo is your main bank)",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: monzoCash(null, 200),
    caveats: MONZO_CAVEATS,
    sources: [MONZO],
  },
  {
    id: "monzo/plus",
    issuer: "Monzo",
    name: "Debit card (Monzo Plus)",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: monzoCash(null, 400),
    caveats: MONZO_CAVEATS,
    sources: [MONZO],
  },
  {
    id: "monzo/premium",
    issuer: "Monzo",
    name: "Debit card (Monzo Premium, Perks or Max)",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: monzoCash(null, 600),
    caveats: MONZO_CAVEATS,
    sources: [MONZO],
  },

  /* ---------------- Chase ---------------- */
  {
    id: "chase-uk/debit",
    issuer: "Chase UK",
    name: "Current account debit card",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [],
    caveats: ["Cash withdrawals are limited to £500 a day, and £1,500 a calendar month while abroad."],
    sources: [CHASE],
  },

  /* ---------------- Barclays ---------------- */
  {
    id: "barclays/debit",
    issuer: "Barclays",
    name: "Debit card",
    cardType: "debit",
    segment: "personal",
    networks: ["visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [NSTF(2.99)],
    caveats: [],
    sources: [BARCLAYS],
  },

  /* ---------------- NatWest ---------------- */
  {
    id: "natwest/debit",
    issuer: "NatWest",
    name: "Debit card (Select and other accounts)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [NSTF(2.75)],
    caveats: [],
    sources: [NATWEST],
  },
  {
    id: "natwest/debit-reward",
    issuer: "NatWest",
    name: "Debit card (Reward, Premier Reward, Premier Select and Black accounts)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [NSTF(2.75, ["atm"])],
    caveats: ["No fee on card payments abroad, but cash withdrawals still pay 2.75%. These accounts have a monthly fee, not included here."],
    sources: [NATWEST],
  },

  /* ---------------- Santander ---------------- */
  {
    id: "santander-uk/debit",
    issuer: "Santander UK",
    name: "Debit card (most accounts)",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard", "visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [{ kind: "percent", name: "Foreign currency conversion fee", pct: 2.95, appliesTo: ["purchase", "atm"], inDisclosedMarkup: true }],
    caveats: ["Withdrawals from Santander's own cash machines abroad are free in the local currency; this assumes another bank's machine."],
    sources: [SANTANDER],
  },
  {
    id: "santander-uk/debit-edge",
    issuer: "Santander UK",
    name: "Debit card (Edge, Edge Up, Edge Explorer and Private accounts)",
    cardType: "debit",
    segment: "personal",
    networks: ["mastercard", "visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [],
    caveats: ["These accounts have a monthly fee, not included here."],
    sources: [SANTANDER],
  },

  /* ---------------- Nationwide ---------------- */
  {
    id: "nationwide/debit",
    issuer: "Nationwide",
    name: "Debit card (FlexAccount, FlexDirect and FlexBasic)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [{ kind: "percent", name: "Foreign currency transaction fee", pct: 2.99, appliesTo: ["purchase", "atm"], inDisclosedMarkup: true }],
    caveats: [],
    sources: [NATIONWIDE],
  },
  {
    id: "nationwide/debit-plus",
    issuer: "Nationwide",
    name: "Debit card (FlexPlus, FlexStudent, FlexGraduate and FlexOne)",
    cardType: "debit",
    segment: "personal",
    networks: ["visa"],
    markupMatch: { purchase: "debit", atm: "debit" },
    fees: [],
    caveats: ["FlexPlus has a monthly fee, not included here."],
    sources: [NATIONWIDE],
  },
  {
    id: "nationwide/credit",
    issuer: "Nationwide",
    name: "Credit card (Member, Select, Classic and Gold)",
    cardType: "credit",
    segment: "personal",
    networks: ["visa"],
    markupMatch: { purchase: "credit", atm: "credit" },
    fees: [{ kind: "percent", name: "Cash fee", pct: 2.5, minGBP: 3, appliesTo: ["atm"], inDisclosedMarkup: true }],
    caveats: [CREDIT_INTEREST],
    sources: [NATIONWIDE],
  },
];

export const productById = (id: string): CardProduct | undefined => CARD_PRODUCTS.find((p) => p.id === id);
