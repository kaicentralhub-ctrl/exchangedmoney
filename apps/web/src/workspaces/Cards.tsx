import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { decodeMarkups, type MarkupsBundle, type Provenance, type RatesBundle, type TariffsBundle } from "@exm/core/bundles";
import type { CardProduct } from "@exm/core/fees";
import type { IssuerMarkup } from "@exm/core/types";
import { rankCardCosts, type CardCostRow } from "../lib/costs.js";
import { download, toCsv } from "../lib/csv.js";
import { currencyName, gbp, local, pct } from "../lib/format.js";
import { filterMarkups, ranks } from "../lib/markups.js";
import { euroRates } from "../lib/rates.js";
import { useBundles } from "../state/data.js";
import { param, setParam } from "../state/router.js";
import { contextCommands, sourcePanel } from "../state/ui.js";
import { Loading, Notice, Segmented, SourceButton } from "../ui/bits.js";
import { workspaceKeys } from "../ui/keys.js";

const VIEWS = [
  { value: "cost", label: "Full cost" },
  { value: "markups", label: "Published markups" },
] as const;
const SEGMENTS = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
] as const;
const CONTEXTS = [
  { value: "purchase", label: "Card payments" },
  { value: "atm", label: "Cash machines" },
] as const;
const TYPES = [
  { value: "all", label: "All" },
  { value: "debit", label: "Debit" },
  { value: "credit", label: "Credit" },
] as const;
const NETWORKS = [
  { value: "all", label: "All" },
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
] as const;

const DEFAULTS = { view: "cost", cur: "EUR", seg: "personal", ctx: "purchase", type: "all", net: "all", amt: "1000" };
type Key = keyof typeof DEFAULTS;
const ctxWord = (ctx: string) => (ctx === "atm" ? "cash machine withdrawals" : "card payments");
const set = (k: Key) => (v: string) => setParam(k, v, DEFAULTS[k]);

export function Cards() {
  const loaded = useBundles<[MarkupsBundle, TariffsBundle, RatesBundle]>(["markups", "tariffs", "rates"]);
  if (loaded.state === "loading") return <Loading what="card data" />;
  if (loaded.state === "error") return <Notice kind="error">Couldn't load card data: {loaded.error}</Notice>;
  const [markups, tariffs, rates] = loaded.data;
  return <CardsView markupsBundle={markups} tariffs={tariffs} rates={rates} />;
}

/** Keyboard selection shared by both tables. */
function useRowKeys(count: number, onEnter: (i: number) => void, onInfo: (i: number) => void, onExport: () => void, deps: unknown[]) {
  const [sel, setSel] = useState(0);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) document.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
    moved.current = false;
  }, [sel]);
  useEffect(() => {
    workspaceKeys.current = (k) => {
      if (k === "j" || k === "ArrowDown") return (moved.current = true), setSel((s) => Math.min(count - 1, s + 1)), true;
      if (k === "k" || k === "ArrowUp") return (moved.current = true), setSel((s) => Math.max(0, s - 1)), true;
      if (k === "Enter" && sel < count) return onEnter(sel), true;
      if (k === "i" && sel < count) return onInfo(sel), true;
      if (k === "e") return onExport(), true;
      return false;
    };
    return () => {
      workspaceKeys.current = null;
    };
  }, [count, sel, ...deps]);
  return [sel, setSel] as const;
}

function CardsView({ markupsBundle, tariffs, rates }: { markupsBundle: MarkupsBundle; tariffs: TariffsBundle; rates: RatesBundle }) {
  const all = useMemo(() => decodeMarkups(markupsBundle), [markupsBundle]);
  const eur = useMemo(() => euroRates(rates), [rates]);
  const f = Object.fromEntries((Object.keys(DEFAULTS) as Key[]).map((k) => [k, param(k, DEFAULTS[k])])) as Record<Key, string>;
  const amt = Math.max(1, Number(f.amt) || 1000);
  const view = f.view === "markups" ? "markups" : "cost";

  const toGBP = useMemo(() => {
    const g = eur.get("GBP")?.rate;
    return (cur: string, amount: number) => {
      const r = eur.get(cur)?.rate;
      return g && r ? (amount / r) * g : null;
    };
  }, [eur]);

  const disclosed = useMemo(() => [...new Set(all.map((m) => m.currency))], [all]);
  const currencies = useMemo(() => {
    const pool = view === "cost" ? [...eur.keys()].filter((c) => c !== "GBP") : disclosed;
    const first = ["EUR", "USD"];
    return [...new Set(pool)].sort((a, b) => (first.indexOf(a) + 1 || 99) - (first.indexOf(b) + 1 || 99) || a.localeCompare(b));
  }, [view, eur, disclosed]);

  useEffect(() => {
    contextCommands.value = [
      ...VIEWS.map((v) => ({ id: `view-${v.value}`, group: "Cards", label: `${v.label} view`, run: () => set("view")(v.value) })),
      ...currencies.map((c) => ({ id: `cur-${c}`, group: "Cards", label: `Cards in ${c}: ${currencyName(c)}`, keywords: c, run: () => set("cur")(c) })),
      ...CONTEXTS.map((o) => ({ id: `ctx-${o.value}`, group: "Cards", label: `Show ${o.label.toLowerCase()}`, run: () => set("ctx")(o.value) })),
      ...SEGMENTS.map((o) => ({ id: `seg-${o.value}`, group: "Cards", label: `${o.label} accounts`, run: () => set("seg")(o.value) })),
    ];
    return () => {
      contextCommands.value = [];
    };
  }, [currencies]);

  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>Cards abroad</h1>
          <p class="sub">
            {view === "cost"
              ? `What each card would cost for ${gbp(amt, 0)} of ${ctxWord(f.ctx)} in ${currencyName(f.cur)}: every fee in its schedule, plus the card network's margin where we can estimate it. Ranked by cost to you.`
              : `What each issuer publishes as its markup over the ECB reference rate for ${ctxWord(f.ctx)} in ${currencyName(f.cur)}. Ranked by cost to you.`}
          </p>
        </div>
      </header>

      <div class="toolbar">
        <Segmented label="View" value={view} options={VIEWS} onChange={set("view")} />
        <label class="field">
          <span>Currency</span>
          <select value={f.cur} onChange={(e) => set("cur")((e.target as HTMLSelectElement).value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c} · {currencyName(c)}
              </option>
            ))}
          </select>
        </label>
        <Segmented label="Using" value={f.ctx} options={CONTEXTS} onChange={set("ctx")} />
        <Segmented label="Account" value={f.seg} options={SEGMENTS} onChange={set("seg")} />
        <Segmented label="Card" value={f.type} options={TYPES} onChange={set("type")} />
        {view === "markups" && <Segmented label="Network" value={f.net} options={NETWORKS} onChange={set("net")} />}
        <label class="field narrow">
          <span>Spend (£)</span>
          <input type="number" min={1} step={50} value={amt} onChange={(e) => set("amt")(String(Math.max(1, Number((e.target as HTMLInputElement).value) || 1000)))} />
        </label>
      </div>

      {view === "cost" ? (
        <FullCost products={tariffs.products} markups={all} toGBP={toGBP} f={f} amt={amt} />
      ) : (
        <Markups all={all} provenance={markupsBundle.provenance} f={f} amt={amt} />
      )}
    </section>
  );
}

/* ---------------- full cost ---------------- */

function productProvenance(p: CardProduct): Provenance {
  const s = p.sources[0]!;
  return { sourceId: p.id, label: s.label, url: s.url, collectedAt: null, publishedAt: null, rawKey: null, sha256: null, checkedAt: p.sources.map((x) => x.checkedAt).sort()[0] };
}

function FullCost({ products, markups, toGBP, f, amt }: { products: CardProduct[]; markups: IssuerMarkup[]; toGBP: (c: string, a: number) => number | null; f: Record<Key, string>; amt: number }) {
  const ctx = f.ctx === "atm" ? "atm" : "purchase";
  const rows = useMemo(() => rankCardCosts(products, markups, toGBP, { currency: f.cur, context: ctx, gbp: amt, segment: f.seg, type: f.type }), [products, markups, toGBP, f.cur, ctx, amt, f.seg, f.type]);
  const [open, setOpen] = useState<string | null>(null);
  const showSource = (r: CardCostRow) =>
    (sourcePanel.value = { title: `${r.product.issuer}: ${r.product.name}`, provenance: productProvenance(r.product), detail: "Fee schedule, read from the issuer's own pages.", extra: <SourceList product={r.product} /> });
  const exportCsv = () =>
    download(
      `exchangedmoney-card-costs-${f.cur}-${ctx}-${amt}.csv`,
      toCsv(
        ["rank", "issuer", "card", "network_priced", "context", "currency", "spend_gbp", "fees_gbp", "network_margin_estimate_gbp", "total_gbp", "effective_pct", "disclosure_check", "fee_schedule_checked", "source_url"],
        rows.map((r, i) => [i + 1, r.product.issuer, r.product.name, r.network, ctx, f.cur, amt, r.feesGBP, r.estimateGBP, r.cost.totalGBP, Number(r.cost.effectivePct.toFixed(3)), r.cost.check.status, r.product.sources[0]?.checkedAt ?? null, r.product.sources[0]?.url ?? null]),
      ),
    );
  const [sel, setSel] = useRowKeys(rows.length, (i) => setOpen((o) => (o === rows[i]!.product.id ? null : rows[i]!.product.id)), (i) => showSource(rows[i]!), exportCsv, [rows]);
  useEffect(() => (setSel(0), setOpen(null)), [f.cur, ctx, f.seg, f.type]);

  if (f.seg === "business") return <Notice>We haven't added business card fee schedules yet. The Published markups view has business cards' disclosed markups.</Notice>;
  if (!toGBP(f.cur, 1)) return <Notice>No reference rate for {f.cur} yet, so cards can't be priced in it.</Notice>;
  if (rows.length === 0) return <Notice>No cards match these filters.</Notice>;
  const max = Math.max(0.01, ...rows.map((r) => r.cost.totalGBP));
  const conflicts = rows.filter((r) => r.cost.check.status === "conflict").length;
  const checked = rows.filter((r) => r.cost.check.status !== "none").length;

  return (
    <>
      <div class="stats">
        <div>
          <span class="k">Cheapest</span>
          <span class="v">{gbp(rows[0]!.cost.totalGBP)}</span>
          <span class="s">
            {rows[0]!.product.issuer}, {rows[0]!.product.name}
          </span>
        </div>
        <div>
          <span class="k">Most expensive</span>
          <span class="v">{gbp(rows.at(-1)!.cost.totalGBP)}</span>
          <span class="s">
            {rows.at(-1)!.product.issuer}, {rows.at(-1)!.product.name}
          </span>
        </div>
        <div>
          <span class="k">Gap on {gbp(amt, 0)}</span>
          <span class="v">{gbp(rows.at(-1)!.cost.totalGBP - rows[0]!.cost.totalGBP)}</span>
          <span class="s">between cheapest and most expensive</span>
        </div>
        <div>
          <span class="k">Disclosure checks</span>
          <span class="v">{checked === 0 ? "None published" : conflicts === 0 ? "All agree" : `${conflicts} of ${checked} disagree`}</span>
          <span class="s">{checked === 0 ? `issuers don't publish markups for ${f.cur}, so network margins can't be estimated yet` : "issuers' published markups vs their fee schedules"}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Issuer</th>
              <th>Card</th>
              <th class="num hide-sm">Fees</th>
              <th class="num hide-sm">Network margin</th>
              <th class="num">Total on {gbp(amt, 0)}</th>
              <th class="num hide-sm">Effective</th>
              <th>
                <span class="sr">Source</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const k = r.product.id;
              const flag = r.cost.check.status === "conflict";
              return (
                <Fragment key={k}>
                  <tr data-row={i} class={`${i === sel ? "sel" : ""} ${open === k ? "open" : ""}`} aria-expanded={open === k} onClick={() => (setSel(i), setOpen((o) => (o === k ? null : k)))}>
                    <td class="num rank">{i + 1}</td>
                    <td class="strong">{r.product.issuer}</td>
                    <td>
                      {r.product.name} <span class="muted cap">· {r.product.cardType}</span>
                      {flag && (
                        <span class="pill warn" title="The issuer's published markup disagrees with its fee schedule">
                          check
                        </span>
                      )}
                    </td>
                    <td class="num hide-sm">{gbp(r.feesGBP)}</td>
                    <td class="num hide-sm muted">{r.estimateGBP > 0 ? `~${gbp(r.estimateGBP)}` : "–"}</td>
                    <td class="num">
                      <span class="bar" aria-hidden="true">
                        <span style={{ width: `${(r.cost.totalGBP / max) * 100}%` }} />
                      </span>
                      <span class="strong">{gbp(r.cost.totalGBP)}</span>
                    </td>
                    <td class="num hide-sm">{pct(r.cost.effectivePct)}</td>
                    <td class="tight">
                      <SourceButton title={`${r.product.issuer}: ${r.product.name}`} provenance={productProvenance(r.product)} />
                    </td>
                  </tr>
                  {open === k && (
                    <tr class="detail">
                      <td colSpan={8}>
                        <CostBreakdown row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="ws-actions under">
        <button onClick={exportCsv} title="Export as CSV (e)">
          Export CSV
        </button>
      </div>
      <p class="fine">
        Fees come from each issuer's own fee pages, checked on the date shown in each card's source. “Network margin” is our estimate of the gap between the card network's
        exchange rate and the ECB rate, taken from the issuer's published markup where it agrees with the fee schedule. Cash machine operators may add their own charge, shown
        on screen. Statistics, not financial advice.
      </p>
    </>
  );
}

function CostBreakdown({ row }: { row: CardCostRow }) {
  const c = row.cost;
  return (
    <div class="breakdown">
      <h3>
        {row.product.issuer}, {row.product.name}: {gbp(c.baseGBP ?? 0)} of {ctxWord(c.spend.context)} in {c.spend.currency} ({c.spend.amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })}{" "}
        {c.spend.currency}), priced on {row.network === "visa" ? "Visa" : "Mastercard"}
      </h3>
      {c.lines.length === 0 ? (
        <p>No fees in this card's schedule for this.</p>
      ) : (
        <table class="mini">
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.label}>
                <td>
                  {l.label}
                  {l.basis === "estimate" && <span class="muted"> (estimate)</span>}
                </td>
                <td class="muted">{l.detail}</td>
                <td class="num">{gbp(l.gbp)}</td>
              </tr>
            ))}
            <tr class="cur">
              <td>Total</td>
              <td class="muted">{pct(c.effectivePct)} of the spend</td>
              <td class="num">{gbp(c.totalGBP)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {[...c.notes, ...row.product.caveats].length > 0 && (
        <ul class="notes">
          {[...c.notes, ...row.product.caveats].map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <SourceList product={row.product} />
    </div>
  );
}

function SourceList({ product }: { product: CardProduct }) {
  return (
    <p class="fine">
      Fee schedule from{" "}
      {product.sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && " and "}
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.label} ↗
          </a>{" "}
          (checked {local(s.checkedAt)})
        </span>
      ))}
      .
    </p>
  );
}

/* ---------------- published markups ---------------- */

const keyOf = (m: IssuerMarkup) => `${m.issuer}|${m.product}`;

function Markups({ all, provenance, f, amt }: { all: IssuerMarkup[]; provenance: Record<string, Provenance>; f: Record<Key, string>; amt: number }) {
  const rows = useMemo(() => filterMarkups(all, f), [all, f.cur, f.seg, f.ctx, f.type, f.net]);
  const rankLabels = useMemo(() => ranks(rows), [rows]);
  const max = Math.max(0.01, ...rows.map((r) => r.markupPct));
  const [open, setOpen] = useState<string | null>(null);
  const showSource = (r: IssuerMarkup) => {
    const p = provenance[r.issuer];
    if (p) sourcePanel.value = { title: `${r.issuer}: ${r.product}`, provenance: p, detail: `${pct(r.markupPct)} over the ECB rate for ${ctxWord(r.context)} in ${r.currency} (${r.segment}).` };
  };
  const exportCsv = () =>
    download(
      `exchangedmoney-card-markups-${f.cur}-${f.seg}-${f.ctx}.csv`,
      toCsv(
        ["rank", "issuer", "card", "network", "card_type", "segment", "context", "currency", "markup_pct_over_ecb", `markup_gbp_on_${amt}`, "issuer_published_at", "source_url"],
        rows.map((r, i) => [rankLabels[i]!, r.issuer, r.product, r.network, r.cardType, r.segment, r.context, r.currency, r.markupPct, Number(((amt * r.markupPct) / 100).toFixed(2)), r.publishedAt, provenance[r.issuer]?.url ?? null]),
      ),
    );
  const [sel, setSel] = useRowKeys(rows.length, (i) => setOpen((o) => (o === keyOf(rows[i]!) ? null : keyOf(rows[i]!))), (i) => showSource(rows[i]!), exportCsv, [rows]);
  useEffect(() => (setSel(0), setOpen(null)), [f.cur, f.seg, f.ctx, f.type, f.net]);

  if (rows.length === 0) return <Notice>No published markups match these filters. Try “All” for card type or network, or a currency in the EEA.</Notice>;
  return (
    <>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Issuer</th>
              <th>Card (as published)</th>
              <th class="hide-sm">Network</th>
              <th class="num">Markup over ECB</th>
              <th class="num">On {gbp(amt, 0)}</th>
              <th>
                <span class="sr">Source</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const k = keyOf(r);
              return (
                <Fragment key={k}>
                  <tr data-row={i} class={`${i === sel ? "sel" : ""} ${open === k ? "open" : ""}`} aria-expanded={open === k} onClick={() => (setSel(i), setOpen((o) => (o === k ? null : k)))}>
                    <td class="num rank">{rankLabels[i]}</td>
                    <td class="strong">{r.issuer}</td>
                    <td>{r.product}</td>
                    <td class="cap hide-sm">{r.network}</td>
                    <td class="num">
                      <span class="bar" aria-hidden="true">
                        <span style={{ width: `${(Math.max(0, r.markupPct) / max) * 100}%` }} />
                      </span>
                      <span class={r.markupPct < 0 ? "gain" : ""}>{pct(r.markupPct)}</span>
                    </td>
                    <td class="num">{gbp((amt * r.markupPct) / 100)}</td>
                    <td class="tight">
                      <SourceButton title={`${r.issuer}: ${r.product}`} provenance={provenance[r.issuer]} />
                    </td>
                  </tr>
                  {open === k && (
                    <tr class="detail">
                      <td colSpan={7}>
                        <MarkupBreakdown all={all} row={r} amt={amt} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div class="ws-actions under">
        <button onClick={exportCsv} title="Export as CSV (e)">
          Export CSV
        </button>
      </div>
      <p class="fine">
        Each issuer's published percentage over the ECB euro reference rate: the disclosure required by the EU Cross-Border Payments Regulation, still published by these UK
        issuers for EEA currencies. It covers percentage conversion charges only, not fixed fees, and issuers describe it as indicative. The Full cost view prices every fee.
      </p>
    </>
  );
}

function MarkupBreakdown({ all, row, amt }: { all: IssuerMarkup[]; row: IssuerMarkup; amt: number }) {
  const same = all.filter((m) => m.issuer === row.issuer && m.product === row.product && m.segment === row.segment && m.context === row.context);
  const lowest = (cur: string) => Math.min(...all.filter((m) => m.currency === cur && m.segment === row.segment && m.context === row.context).map((m) => m.markupPct));
  const max = Math.max(0.01, ...same.map((m) => m.markupPct));
  return (
    <div class="breakdown">
      <h3>
        {row.issuer}, {row.product}: {ctxWord(row.context)} in every currency it publishes
      </h3>
      <table class="mini">
        <thead>
          <tr>
            <th>Currency</th>
            <th class="num">Markup</th>
            <th class="num">Lowest published</th>
            <th class="num">Above lowest on {gbp(amt, 0)}</th>
          </tr>
        </thead>
        <tbody>
          {same
            .sort((a, b) => a.currency.localeCompare(b.currency))
            .map((m) => {
              const low = lowest(m.currency);
              return (
                <tr key={m.currency} class={m.currency === row.currency ? "cur" : ""}>
                  <td>
                    <button class="linkish" onClick={() => set("cur")(m.currency)} title={`Rank all cards in ${m.currency}`}>
                      {m.currency}
                    </button>{" "}
                    <span class="muted">{currencyName(m.currency)}</span>
                  </td>
                  <td class="num">
                    <span class="bar" aria-hidden="true">
                      <span style={{ width: `${(Math.max(0, m.markupPct) / max) * 100}%` }} />
                    </span>
                    {pct(m.markupPct)}
                  </td>
                  <td class="num">{pct(low)}</td>
                  <td class="num">{m.markupPct - low < 0.005 ? <span class="gain">lowest</span> : gbp((amt * (m.markupPct - low)) / 100)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
