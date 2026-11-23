/** Ranking card products by the full cost of one spend. Pure, so it's tested in Node. */
import { estimateNetworkMargins, priceSpend, type CardProduct, type SpendContext, type SpendCost } from "@exm/core/fees";
import type { IssuerMarkup } from "@exm/core/types";

export interface CardCostRow {
  product: CardProduct;
  network: CardProduct["networks"][number];
  cost: SpendCost;
  feesGBP: number;
  estimateGBP: number;
}

/**
 * Price `gbp` worth of spending in `currency` on every product. A product issued on several
 * networks is priced on each, keeping the one whose disclosure agrees with its fee schedule
 * (so the network margin can be estimated), else the first.
 */
export function rankCardCosts(
  products: readonly CardProduct[],
  markups: readonly IssuerMarkup[],
  toGBP: (currency: string, amount: number) => number | null,
  f: { currency: string; context: SpendContext; gbp: number; segment: string; type: string },
): CardCostRow[] {
  const unit = toGBP(f.currency, 1);
  if (!unit) return [];
  const amount = f.gbp / unit;
  const networkMargins = estimateNetworkMargins(products, markups);
  return products
    .filter((p) => p.segment === f.segment && (f.type === "all" || p.cardType === f.type))
    .map((product) => {
      const options = product.networks.map((network) => ({ network, cost: priceSpend({ context: f.context, currency: f.currency, amount }, product, { toGBP, markups, network, networkMargins }) }));
      const best = options.find((o) => o.cost.check.status === "consistent") ?? options.find((o) => o.cost.check.status === "conflict") ?? options[0]!;
      const sum = (basis: string) => best.cost.lines.filter((l) => l.basis === basis).reduce((a, l) => a + l.gbp, 0);
      return { product, network: best.network, cost: best.cost, feesGBP: sum("fee-schedule"), estimateGBP: sum("estimate") };
    })
    .sort((a, b) => a.cost.totalGBP - b.cost.totalGBP || a.product.issuer.localeCompare(b.product.issuer) || a.product.name.localeCompare(b.product.name));
}
