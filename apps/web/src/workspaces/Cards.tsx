import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { decodeMarkups, type MarkupsBundle } from "@exm/core/bundles";
import type { IssuerMarkup } from "@exm/core/types";
import { download, toCsv } from "../lib/csv.js";
import { filterMarkups, ranks } from "../lib/markups.js";
import { currencyName, gbp, pct } from "../lib/format.js";
import { useBundles } from "../state/data.js";
import { param, setParam } from "../state/router.js";
import { contextCommands, sourcePanel } from "../state/ui.js";
import { Loading, Notice, Segmented, SourceButton } from "../ui/bits.js";
import { workspaceKeys } from "../ui/keys.js";

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

const DEFAULTS = { cur: "EUR", seg: "personal", ctx: "purchase", type: "all", net: "all", amt: "1000" };
const keyOf = (m: IssuerMarkup) => `${m.issuer}|${m.product}`;
const ctxWord = (ctx: string) => (ctx === "atm" ? "cash machine withdrawals" : "card payments");

export function Cards() {
  const loaded = useBundles<[MarkupsBundle]>(["markups"]);
  if (loaded.state === "loading") return <Loading what="card markups" />;
  if (loaded.state === "error") return <Notice kind="error">Couldn't load card markups: {loaded.error}</Notice>;
  return <CardsView bundle={loaded.data[0]} />;
}

function CardsView({ bundle }: { bundle: MarkupsBundle }) {
  const all = useMemo(() => decodeMarkups(bundle), [bundle]);
  const currencies = useMemo(() => [...new Set(all.map((m) => m.currency))].sort((a, b) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b))), [all]);
  const f = {
    cur: param("cur", DEFAULTS.cur),
    seg: param("seg", DEFAULTS.seg),
    ctx: param("ctx", DEFAULTS.ctx),
    type: param("type", DEFAULTS.type),
    net: param("net", DEFAULTS.net),
  };
  const amt = Math.max(1, Number(param("amt", DEFAULTS.amt)) || 1000);
  const rows = useMemo(() => filterMarkups(all, f), [all, f.cur, f.seg, f.ctx, f.type, f.net]);
  const rankLabels = useMemo(() => ranks(rows), [rows]);
  const max = Math.max(0.01, ...rows.map((r) => r.markupPct));
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const set = (k: keyof typeof DEFAULTS) => (v: string) => setParam(k, v, DEFAULTS[k]);

  const showSource = (r: IssuerMarkup) => {
    const p = bundle.provenance[r.issuer];
    if (p) sourcePanel.value = { title: `${r.issuer}: ${r.product}`, provenance: p, detail: `${pct(r.markupPct)} over the ECB rate for ${ctxWord(r.context)} in ${r.currency} (${r.segment}).` };
  };
  const exportCsv = () =>
    download(
      `exchangedmoney-card-markups-${f.cur}-${f.seg}-${f.ctx}.csv`,
      toCsv(
        ["rank", "issuer", "card", "network", "card_type", "segment", "context", "currency", "markup_pct_over_ecb", `extra_gbp_on_${amt}`, "issuer_published_at", "source_url"],
        rows.map((r, i) => [rankLabels[i]!, r.issuer, r.product, r.network, r.cardType, r.segment, r.context, r.currency, r.markupPct, Number(((amt * r.markupPct) / 100).toFixed(2)), r.publishedAt, bundle.provenance[r.issuer]?.url ?? null]),
      ),
    );

  useEffect(() => {
    setSel(0);
    setOpen(null);
  }, [f.cur, f.seg, f.ctx, f.type, f.net]);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) document.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
    moved.current = false;
  }, [sel]);

  useEffect(() => {
    workspaceKeys.current = (k) => {
      const r = rows[sel];
      if (k === "j" || k === "ArrowDown") return (moved.current = true), setSel((s) => Math.min(rows.length - 1, s + 1)), true;
      if (k === "k" || k === "ArrowUp") return (moved.current = true), setSel((s) => Math.max(0, s - 1)), true;
      if (k === "Enter" && r) return setOpen((o) => (o === keyOf(r) ? null : keyOf(r))), true;
      if (k === "i" && r) return showSource(r), true;
      if (k === "e") return exportCsv(), true;
      return false;
    };
    return () => {
      workspaceKeys.current = null;
    };
  }, [rows, sel]);

  useEffect(() => {
    contextCommands.value = [
      ...currencies.map((c) => ({ id: `cur-${c}`, group: "Cards", label: `Markups in ${c}: ${currencyName(c)}`, keywords: c, run: () => set("cur")(c) })),
      ...CONTEXTS.map((o) => ({ id: `ctx-${o.value}`, group: "Cards", label: `Show ${o.label.toLowerCase()}`, run: () => set("ctx")(o.value) })),
      ...SEGMENTS.map((o) => ({ id: `seg-${o.value}`, group: "Cards", label: `${o.label} accounts`, run: () => set("seg")(o.value) })),
      { id: "cards-csv", group: "Cards", label: "Export this view as CSV", shortcut: "e", run: exportCsv },
    ];
    return () => {
      contextCommands.value = [];
    };
  }, [currencies, rows, amt]);

  const issuers = new Set(all.map((m) => m.issuer)).size;
  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>Card markups</h1>
          <p class="sub">
            What each card adds on top of the ECB reference rate for {ctxWord(f.ctx)} in {currencyName(f.cur)}. Ranked by cost to you, from {issuers} issuers' own
            published figures.
          </p>
        </div>
        <div class="ws-actions">
          <button onClick={exportCsv} title="Export as CSV (e)">
            Export CSV
          </button>
        </div>
      </header>

      <div class="toolbar">
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
        <Segmented label="Network" value={f.net} options={NETWORKS} onChange={set("net")} />
        <label class="field narrow">
          <span>Spend (£)</span>
          <input type="number" min={1} step={50} value={amt} onChange={(e) => set("amt")(String(Math.max(1, Number((e.target as HTMLInputElement).value) || 1000)))} />
        </label>
      </div>

      <Summary rows={rows} amt={amt} />

      {rows.length === 0 ? (
        <Notice>No published markups match these filters. Try “All” for card type or network.</Notice>
      ) : (
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th class="num">#</th>
                <th>Issuer</th>
                <th>Card</th>
                <th class="hide-sm">Network</th>
                <th class="num">Markup over ECB</th>
                <th class="num">Extra on {gbp(amt, 0)}</th>
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
                    <tr
                      data-row={i}
                      class={`${i === sel ? "sel" : ""} ${open === k ? "open" : ""}`}
                      aria-expanded={open === k}
                      onClick={() => {
                        setSel(i);
                        setOpen((o) => (o === k ? null : k));
                      }}
                    >
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
                        <SourceButton title={`${r.issuer}: ${r.product}`} provenance={bundle.provenance[r.issuer]} />
                      </td>
                    </tr>
                    {open === k && (
                      <tr class="detail">
                        <td colSpan={7}>
                          <Breakdown all={all} row={r} amt={amt} onPick={set("cur")} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p class="fine">
        Markups are each issuer's published percentage over the ECB euro reference rate, the disclosure required by the EU Cross-Border Payments Regulation and still
        published by these UK issuers. “Extra” applies the markup to a spend worth {gbp(amt, 0)} at the ECB rate. Separate fees (such as fixed cash machine charges)
        aren't included yet. Statistics, not financial advice.
      </p>
    </section>
  );
}

function Summary({ rows, amt }: { rows: IssuerMarkup[]; amt: number }) {
  if (rows.length < 2) return null;
  const lo = rows[0]!;
  const hi = rows[rows.length - 1]!;
  const gap = hi.markupPct - lo.markupPct;
  const mid = rows[Math.floor((rows.length - 1) / 2)]!.markupPct;
  return (
    <div class="stats">
      <div>
        <span class="k">Lowest</span>
        <span class="v">{pct(lo.markupPct)}</span>
        <span class="s">
          {lo.issuer}, {lo.product}
        </span>
      </div>
      <div>
        <span class="k">Middle</span>
        <span class="v">{pct(mid)}</span>
        <span class="s">median of {rows.length} cards</span>
      </div>
      <div>
        <span class="k">Highest</span>
        <span class="v">{pct(hi.markupPct)}</span>
        <span class="s">
          {hi.issuer}, {hi.product}
        </span>
      </div>
      <div>
        <span class="k">Gap on {gbp(amt, 0)}</span>
        <span class="v">{gbp((amt * gap) / 100)}</span>
        <span class="s">{gap.toFixed(2)} percentage points</span>
      </div>
    </div>
  );
}

/** One card across every currency it publishes, against the lowest available in each. */
function Breakdown({ all, row, amt, onPick }: { all: IssuerMarkup[]; row: IssuerMarkup; amt: number; onPick: (cur: string) => void }) {
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
            <th class="num">Lowest available</th>
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
                    <button class="linkish" onClick={() => onPick(m.currency)} title={`Rank all cards in ${m.currency}`}>
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
