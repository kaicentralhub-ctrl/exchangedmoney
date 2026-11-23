import type { CurrencyCode } from "./types.js";

const ISO = /^[A-Z]{3}$/;

export const isCurrencyCode = (value: string): boolean => ISO.test(value);

/** Names that issuers print without an ISO code in brackets. */
const NAME_TO_CODE: Record<string, CurrencyCode> = {
  euro: "EUR",
  euros: "EUR",
  "us dollar": "USD",
  "us dollars": "USD",
  "pound sterling": "GBP",
  sterling: "GBP",
};

/**
 * Pull an ISO code out of an issuer label such as "Czech Korona (CZK)" or "EURO".
 * Returns null when nothing recognisable is found.
 */
export function currencyFromLabel(label: string): CurrencyCode | null {
  const text = label.replace(/\s+/g, " ").trim();
  const bracketed = text.match(/\(([A-Z]{3})\)/);
  if (bracketed?.[1]) return bracketed[1];
  if (isCurrencyCode(text)) return text;
  const named = NAME_TO_CODE[text.toLowerCase()];
  if (named) return named;
  const trailing = text.match(/\b([A-Z]{3})$/);
  if (trailing?.[1]) return trailing[1];
  return null;
}
