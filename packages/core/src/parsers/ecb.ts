import { emptyParse, type ParseResult } from "../types.js";
import { isCurrencyCode } from "../currency.js";

/**
 * ECB euro foreign exchange reference rates, XML (eurofxref-daily.xml or eurofxref-hist-90d.xml).
 * Shape: <Cube time='YYYY-MM-DD'><Cube currency='USD' rate='1.0812'/>...</Cube>
 * The ECB publishes these "for information purposes only"; we label them as reference rates.
 */
export function parseEcbXml(xml: string, source = "ecb-daily"): ParseResult {
  const result = emptyParse();
  const token = /<Cube\s+(?:time=['"](\d{4}-\d{2}-\d{2})['"]|currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"])/g;
  let currentDate: string | null = null;
  for (const match of xml.matchAll(token)) {
    const [, time, currency, rate] = match;
    if (time) {
      currentDate = time;
      continue;
    }
    if (!currency || !rate) continue;
    if (!currentDate) {
      result.warnings.push(`rate for ${currency} appeared before any date`);
      continue;
    }
    const value = Number(rate);
    if (!isCurrencyCode(currency) || !Number.isFinite(value) || value <= 0) {
      result.warnings.push(`skipped invalid rate ${currency}=${rate}`);
      continue;
    }
    result.observations.push({ source, kind: "reference", base: "EUR", quote: currency, rate: value, rateDate: currentDate });
  }
  if (result.observations.length === 0) result.warnings.push("no rates found in ECB XML");
  return result;
}

/**
 * ECB full history CSV (eurofxref-hist.csv inside eurofxref-hist.zip).
 * Header: Date,USD,JPY,...,  Rows: 2026-11-20,1.0812,...  Missing values are "N/A" or empty.
 */
export function parseEcbHistoryCsv(csv: string, source = "ecb-history"): ParseResult {
  const result = emptyParse();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) {
    result.warnings.push("empty CSV");
    return result;
  }
  const columns = header.split(",").map((c) => c.trim());
  if (columns[0]?.toLowerCase() !== "date") result.warnings.push(`unexpected first column: ${columns[0]}`);
  for (const line of lines) {
    const cells = line.split(",");
    const date = cells[0]?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result.warnings.push(`skipped row with bad date: ${line.slice(0, 40)}`);
      continue;
    }
    for (let i = 1; i < columns.length; i++) {
      const code = columns[i];
      const raw = cells[i]?.trim();
      if (!code || !isCurrencyCode(code) || !raw || raw === "N/A") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      result.observations.push({ source, kind: "reference", base: "EUR", quote: code, rate: value, rateDate: date });
    }
  }
  return result;
}
