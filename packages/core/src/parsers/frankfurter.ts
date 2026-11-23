import { emptyParse, type ParseResult, type RateObservation } from "../types.js";
import { isCurrencyCode } from "../currency.js";

/**
 * Frankfurter rates (api.frankfurter.dev). The v2 response format is not documented on the
 * public page, so this parser accepts the shapes Frankfurter has used:
 *   - v1 object:  { base, date, rates: { USD: 1.08, ... } }
 *   - row arrays: [ { date, base, quote, rate }, ... ]  (or wrapped in { data | rates: [...] })
 * Anything it cannot read becomes a warning; the raw snapshot is archived regardless.
 */
export function parseFrankfurter(body: string, source = "frankfurter"): ParseResult {
  const result = emptyParse();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    result.warnings.push("response is not JSON");
    return result;
  }

  const push = (o: Omit<RateObservation, "source" | "kind">) => {
    // Frankfurter v2 also blends crypto tokens (USDT, AAVE...). They aren't ISO 4217 currencies;
    // skip them quietly here. They remain in the archived raw snapshot if ever needed.
    if (/^[A-Z0-9]{4,}$/.test(o.quote)) return;
    if (!isCurrencyCode(o.base) || !isCurrencyCode(o.quote) || !(o.rate > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(o.rateDate)) {
      result.warnings.push(`skipped invalid row ${JSON.stringify(o)}`);
      return;
    }
    result.observations.push({ source, kind: "reference", ...o });
  };

  const fromRow = (row: Record<string, unknown>, fallbackBase?: string, fallbackDate?: string) => {
    const base = String(row.base ?? fallbackBase ?? "").toUpperCase();
    const quote = String(row.quote ?? row.currency ?? row.code ?? "").toUpperCase();
    const rate = Number(row.rate ?? row.value);
    const rateDate = String(row.date ?? fallbackDate ?? "");
    push({ base, quote, rate, rateDate });
  };

  if (Array.isArray(json)) {
    for (const row of json) if (row && typeof row === "object") fromRow(row as Record<string, unknown>);
  } else if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const base = typeof obj.base === "string" ? obj.base.toUpperCase() : undefined;
    const date = typeof obj.date === "string" ? obj.date : undefined;
    const rows = obj.rates ?? obj.data;
    if (Array.isArray(rows)) {
      for (const row of rows) if (row && typeof row === "object") fromRow(row as Record<string, unknown>, base, date);
    } else if (rows && typeof rows === "object" && base && date) {
      for (const [quote, rate] of Object.entries(rows as Record<string, unknown>)) {
        push({ base, quote: quote.toUpperCase(), rate: Number(rate), rateDate: date });
      }
    } else {
      result.warnings.push("unrecognised Frankfurter response shape");
    }
  }
  if (result.observations.length === 0) result.warnings.push("no rates parsed from Frankfurter response");
  return result;
}
