import { currencyFromLabel } from "../currency.js";
import {
  emptyParse,
  type CardNetwork,
  type CustomerSegment,
  type IssuerMarkup,
  type MarkupContext,
  type ParseResult,
} from "../types.js";
import { cardTypeOf, networkOf } from "./hsbc-cbpr.js";

/**
 * HSBC-group CBPR disclosure PDFs (first direct; M&S Bank used the same template), read as text lines.
 *
 * Layout as observed (first direct, Nov 2026):
 *   "Personal Card" / "Business Card" headings, then "Using an ATM" / "Making a purchase..." tables.
 *   A header line names the networks ("VISA   Mastercard" or just "VISA"); card-type headers wrap
 *   over several lines, so products are inferred from the networks plus the number of columns.
 *   Rows: "Czech Korona (CZK)   3.33%   5.34%   6.58% ..." ; "#N/A" for withdrawn currencies (HRK).
 *   Footer timestamp: "11/21/2026-12:08 AM" (US month/day, 12-hour clock, UK time).
 */
export function parseCbprPdfLines(lines: readonly string[], issuer: string): ParseResult {
  const result = emptyParse();
  let segment: CustomerSegment = "unknown";
  let context: MarkupContext = "unknown";
  let networks: CardNetwork[] = [];
  let publishedAt: string | null = null;
  let tables = 0;
  let lastTableKey = "";
  const pending: IssuerMarkup[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    publishedAt ??= parseUsTimestamp(line);
    if (/^personal card\b/i.test(line)) segment = "personal";
    else if (/^business card\b/i.test(line)) segment = "business";
    if (/^using an atm\b|^using a cash machine\b/i.test(line)) context = "atm";
    else if (/^making a purchase\b/i.test(line)) context = "purchase";

    if (!line.includes("%") && !/#N\/A/i.test(line) && /\b(visa|mastercard)\b/i.test(line)) {
      networks = networkOrder(line);
      continue;
    }

    const row = line.match(ROW);
    if (!row) continue;
    const [, label = "", valuesText = ""] = row;
    const values = valuesText.split(" ");
    const currency = currencyFromLabel(label);
    if (!currency) {
      result.warnings.push(`unrecognised currency label: ${label}`);
      continue;
    }
    const products = productsFor(networks, values.length);
    const tableKey = `${segment}|${context}|${networks.join("+")}|${values.length}`;
    if (tableKey !== lastTableKey) {
      tables++;
      lastTableKey = tableKey;
      if (!products) result.warnings.push(`can't map ${values.length} columns for networks [${networks.join(", ")}] in ${segment}/${context}`);
      if (segment === "unknown" || context === "unknown") result.warnings.push(`table without a section heading near ${label}`);
    }
    if (!products) continue;
    values.forEach((v, i) => {
      if (/#N\/A/i.test(v)) return;
      const markupPct = Number(v.replace("%", "").replace("−", "-"));
      const product = products[i]!;
      if (!Number.isFinite(markupPct)) return;
      pending.push({ issuer, product, network: networkOf(product), cardType: cardTypeOf(product), segment, context, currency, markupPct, publishedAt: null });
    });
  }

  if (!publishedAt) result.warnings.push("no timestamp found in PDF");
  for (const m of pending) result.markups.push({ ...m, publishedAt });
  if (tables === 0) result.warnings.push("no markup tables found; PDF layout may have changed");
  return result;
}

const VALUE = String.raw`(?:-?\d+(?:\.\d+)?%|#N/A)`;
const ROW = new RegExp(String.raw`^(.+?) (${VALUE}(?: ${VALUE})*)$`, "i");

function networkOrder(line: string): CardNetwork[] {
  const found: [number, CardNetwork][] = [];
  const v = line.search(/\bvisa\b/i);
  const m = line.search(/\bmastercard\b/i);
  if (v >= 0) found.push([v, "visa"]);
  if (m >= 0) found.push([m, "mastercard"]);
  return found.sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

const NAME: Record<string, string> = { visa: "VISA", mastercard: "Mastercard" };

/** Product labels from the networks in the header and the number of value columns. */
export function productsFor(networks: readonly CardNetwork[], columns: number): string[] | null {
  if (networks.length === 0 || columns % networks.length !== 0) return null;
  const perNetwork = columns / networks.length;
  const kinds =
    perNetwork === 3 ? ["debit card for Premier/Advance", "debit card for Bank Account", "credit card"]
    : perNetwork === 2 ? ["debit card", "credit card"]
    : null;
  if (!kinds) return null;
  return networks.flatMap((n) => kinds.map((k) => `${NAME[n] ?? n} ${k}`));
}

/** "11/21/2026-12:08 AM" -> "2026-11-21T00:08" */
export function parseUsTimestamp(text: string): string | null {
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (!m) return null;
  const [, mo = "", d = "", y = "", hRaw = "", min = "", ap = ""] = m;
  let h = Number(hRaw) % 12;
  if (ap.toUpperCase() === "PM") h += 12;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${min}`;
}
