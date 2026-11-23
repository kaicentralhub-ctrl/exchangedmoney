import { CARD_PRODUCTS, SOURCES, staleProducts, type CardProduct, type SourceDefinition } from "@exm/core";
import type { Warehouse } from "./storage.js";

export interface SourceHealth {
  source: string;
  lastSuccess: string | null;
  ageHours: number | null;
  stale: boolean;
}

/** A source is stale if it has never succeeded or its last success is older than its maxAgeHours. */
export async function checkHealth(warehouse: Warehouse, now: Date, sources: readonly SourceDefinition[] = SOURCES): Promise<SourceHealth[]> {
  const out: SourceHealth[] = [];
  for (const s of sources) {
    const lastSuccess = await warehouse.lastSuccess(s.id);
    const ageHours = lastSuccess ? (now.getTime() - Date.parse(lastSuccess)) / 3_600_000 : null;
    out.push({ source: s.id, lastSuccess, ageHours, stale: ageHours === null || ageHours > s.maxAgeHours });
  }
  return out;
}

export function healthMessage(report: SourceHealth[]): string | null {
  const stale = report.filter((r) => r.stale);
  if (stale.length === 0) return null;
  const lines = stale.map((r) =>
    r.lastSuccess ? `${r.source}: last success ${Math.round(r.ageHours ?? 0)}h ago` : `${r.source}: no successful run yet`,
  );
  return `A missed day of collection is permanent.\n${lines.join("\n")}`;
}

/** Weekly (Mondays) reminder listing fee schedules not re-checked for 90 days. */
export function tariffReminder(now: Date, products: readonly CardProduct[] = CARD_PRODUCTS): string | null {
  if (now.getUTCDay() !== 1) return null;
  const due = staleProducts(products, now);
  if (due.length === 0) return null;
  const lines = due.map(({ product, checkedAt }) => `${product.issuer}: ${product.name} (last checked ${checkedAt})`);
  return `Re-check these fee schedules against the issuers' pages, then update checkedAt in packages/core/src/tariffs.ts:\n${lines.join("\n")}`;
}
