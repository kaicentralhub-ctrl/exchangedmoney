import { parse, type HTMLElement, type Node } from "node-html-parser";
import { currencyFromLabel } from "../currency.js";
import {
  emptyParse,
  type CardNetwork,
  type CardType,
  type CustomerSegment,
  type IssuerMarkup,
  type MarkupContext,
  type ParseResult,
} from "../types.js";

/**
 * HSBC UK Cross-Border Payments Regulation page (https://www.hsbc.co.uk/cbpr/).
 *
 * Layout as observed (Nov 2026): personal and business sections, each with a "Using a cash
 * machine" and a "Making a purchase" part. Each part has a WIDE table (one row per currency,
 * one column per card type) followed by small per-currency tables repeating the same numbers.
 * We read only the wide tables. A single line "Last updated on: DD/MM/YYYY, HH:MM" (UK time)
 * sits above the rates.
 *
 * The same parser works for HSBC-family pages with the same template (first direct, M&S Bank
 * use different templates and need their own parsers).
 */
export function parseHsbcCbpr(html: string, issuer = "HSBC UK"): ParseResult {
  const result = emptyParse();
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const publishedAt = parseLastUpdated(root.textContent);
  if (!publishedAt) result.warnings.push("no 'Last updated on' timestamp found");

  const wideTables: { table: HTMLElement; segment: CustomerSegment; context: MarkupContext }[] = [];
  let segment: CustomerSegment = "unknown";
  let context: MarkupContext = "unknown";

  walk(root, (el) => {
    const tag = el.rawTagName?.toLowerCase();
    if (tag === "table") {
      if (isWideTable(el)) {
        // The live page labels each table with a <caption> ("Using a cash machine" / "Making a purchase").
        const fromCaption = contextOf(clean(el.querySelector("caption")?.textContent ?? ""));
        wideTables.push({ table: el, segment, context: fromCaption ?? context });
        context = "unknown"; // each part announces its own context
      }
      return false; // don't descend into tables for context text
    }
    if (tag && /^(h[1-6]|p|strong|b|caption|legend|span|button|summary|div)$/.test(tag)) {
      const own = ownText(el);
      if (own.length > 0 && own.length < 160) {
        const lower = own.toLowerCase();
        if (/\bbusiness\b/.test(lower)) segment = "business";
        else if (/\bpersonal\b/.test(lower)) segment = "personal";
        context = contextOf(lower) ?? context;
      }
    }
    return true;
  });

  // Fallback for when headings could not be read: the page's fixed order.
  const order: [CustomerSegment, MarkupContext][] = [
    ["personal", "atm"],
    ["personal", "purchase"],
    ["business", "atm"],
    ["business", "purchase"],
  ];
  const needsFallback = wideTables.some((t) => t.segment === "unknown" || t.context === "unknown");
  if (needsFallback && wideTables.length === order.length) {
    result.warnings.push("section headings not detected; assigned sections by table order");
    wideTables.forEach((t, i) => {
      const [s, c] = order[i]!;
      if (t.segment === "unknown") t.segment = s;
      if (t.context === "unknown") t.context = c;
    });
  }

  for (const { table, segment: seg, context: ctx } of wideTables) {
    const rows = table.querySelectorAll("tr").map((tr) => tr.querySelectorAll("th,td").map((c) => clean(c.textContent)));
    const [header, ...body] = rows;
    if (!header) continue;
    const products = header.slice(1);
    for (const row of body) {
      const currency = currencyFromLabel(row[0] ?? "");
      if (!currency) {
        if ((row[0] ?? "").length > 0) result.warnings.push(`unrecognised currency label: ${row[0]}`);
        continue;
      }
      products.forEach((product, i) => {
        const pct = parsePercent(row[i + 1]);
        if (pct === null) return;
        result.markups.push(markup(issuer, product, seg, ctx, currency, pct, publishedAt));
      });
    }
  }

  if (wideTables.length === 0) result.warnings.push("no markup tables found; page layout may have changed");
  return result;
}

function markup(
  issuer: string,
  product: string,
  segment: CustomerSegment,
  context: MarkupContext,
  currency: string,
  markupPct: number,
  publishedAt: string | null,
): IssuerMarkup {
  return { issuer, product, network: networkOf(product), cardType: cardTypeOf(product), segment, context, currency, markupPct, publishedAt };
}

export function networkOf(label: string): CardNetwork {
  const l = label.toLowerCase();
  if (l.includes("visa")) return "visa";
  if (l.includes("mastercard")) return "mastercard";
  return "unknown";
}

export function cardTypeOf(label: string): CardType {
  const l = label.toLowerCase();
  if (l.includes("debit")) return "debit";
  if (l.includes("credit")) return "credit";
  return "unknown";
}

/** "2.95%", "2.95", "-0.10 %", "−0.10%" -> number; anything else -> null. */
export function parsePercent(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = cell.replace(/−/g, "-").match(/^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/);
  return m?.[1] ? Number(m[1]) : null;
}

/** "Last updated on: 23/11/2026, 06:04" -> "2026-11-23T06:04" (UK local time, no offset). */
export function parseLastUpdated(text: string): string | null {
  const m = text.match(/Last updated on:\s*(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/i);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function contextOf(text: string): MarkupContext | null {
  const lower = text.toLowerCase();
  if (/cash machine|\batm\b|withdraw/.test(lower)) return "atm";
  if (/making a purchase|\bpurchases?\b|restaurant/.test(lower)) return "purchase";
  return null;
}

function isWideTable(table: HTMLElement): boolean {
  const first = table.querySelector("tr");
  if (!first) return false;
  const cells = first.querySelectorAll("th,td").map((c) => clean(c.textContent));
  return cells.length >= 3 && /^currency$/i.test(cells[0] ?? "");
}

function walk(node: Node, visit: (el: HTMLElement) => boolean): void {
  for (const child of node.childNodes) {
    const el = child as HTMLElement;
    if (el.nodeType !== 1) continue;
    if (visit(el)) walk(el, visit);
  }
}

/** Text belonging to this element itself, not to nested block elements. */
function ownText(el: HTMLElement): string {
  return clean(
    el.childNodes
      .filter((n) => n.nodeType === 3 || ["strong", "b", "em", "span", "a"].includes((n as HTMLElement).rawTagName?.toLowerCase() ?? ""))
      .map((n) => n.textContent)
      .join(" "),
  );
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
