import type { IssuerMarkup } from "@exm/core/types";

/** Rank with ties: equal markups share a rank ("=2"). */
export function ranks(sorted: readonly IssuerMarkup[]): string[] {
  return sorted.map((r) => {
    const rank = 1 + sorted.filter((x) => x.markupPct < r.markupPct).length;
    const tied = sorted.filter((x) => x.markupPct === r.markupPct).length > 1;
    return `${tied ? "=" : ""}${rank}`;
  });
}

export function filterMarkups(all: readonly IssuerMarkup[], f: { cur: string; seg: string; ctx: string; type: string; net: string }): IssuerMarkup[] {
  return all
    .filter((m) => m.currency === f.cur && m.segment === f.seg && m.context === f.ctx)
    .filter((m) => f.type === "all" || m.cardType === f.type)
    .filter((m) => f.net === "all" || m.network === f.net)
    .sort((a, b) => a.markupPct - b.markupPct || a.issuer.localeCompare(b.issuer) || a.product.localeCompare(b.product));
}
