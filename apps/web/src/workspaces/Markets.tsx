import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HistoryBundle, RatesBundle } from "@exm/core/bundles";
import { download, toCsv } from "../lib/csv.js";
import { currencyName, local, num } from "../lib/format.js";
import { crossSeries, euroRates, seriesOf, windowStats } from "../lib/rates.js";
import { loadBundle, manifest, useBundles } from "../state/data.js";
import { param, setParam } from "../state/router.js";
import { contextCommands, sourcePanel } from "../state/ui.js";
import { Loading, Notice, SourceButton } from "../ui/bits.js";
import { workspaceKeys } from "../ui/keys.js";
import { Sparkline } from "../ui/Sparkline.js";

const BASES = ["GBP", "EUR", "USD"];

export function Markets() {
  const loaded = useBundles<[RatesBundle]>(["rates"]);
  if (loaded.state === "loading") return <Loading what="rates" />;
  if (loaded.state === "error") return <Notice kind="error">Couldn't load rates: {loaded.error}</Notice>;
  return <MarketsView bundle={loaded.data[0]} />;
}

function MarketsView({ bundle }: { bundle: RatesBundle }) {
  const eur = useMemo(() => euroRates(bundle), [bundle]);
  const base = param("base", "GBP");
  const filter = param("q", "");
  const pick = param("pair", "");
  const baseRate = eur.get(base)?.rate;
  const [sel, setSel] = useState(0);

  const rows = useMemo(() => {
    if (!baseRate) return [];
    const q = filter.trim().toLowerCase();
    return [...eur.values()]
      .filter((r) => r.quote !== base && r.source !== "identity")
      .map((r) => ({ ...r, cross: r.rate / baseRate, name: currencyName(r.quote) }))
      .filter((r) => !q || r.quote.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => (a.source === b.source ? a.quote.localeCompare(b.quote) : a.source === "ecb-daily" ? -1 : 1));
  }, [eur, base, baseRate, filter]);

  const exportCsv = () =>
    download(`exchangedmoney-rates-${base}.csv`, toCsv(["base", "quote", "rate", "inverse", "rate_date", "source"], rows.map((r) => [base, r.quote, r.cross, 1 / r.cross, r.date, r.source])));

  useEffect(() => setSel(0), [base, filter]);
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
      if (k === "Enter" && r) return setParam("pair", pick === r.quote ? "" : r.quote, ""), true;
      if (k === "i" && r) {
        const p = bundle.provenance[r.source];
        if (p) sourcePanel.value = { title: `${base} → ${r.quote}`, provenance: p };
        return true;
      }
      if (k === "e") return exportCsv(), true;
      return false;
    };
    return () => {
      workspaceKeys.current = null;
    };
  }, [rows, sel, pick]);
  useEffect(() => {
    contextCommands.value = [
      ...BASES.map((b) => ({ id: `base-${b}`, group: "Markets", label: `Rates from ${b}`, run: () => setParam("base", b, "GBP") })),
      ...[...eur.keys()].filter((c) => c !== base).map((c) => ({ id: `pair-${c}`, group: "Markets", label: `${base} to ${c}: ${currencyName(c)}`, keywords: c, run: () => setParam("pair", c, "") })),
      { id: "rates-csv", group: "Markets", label: "Export these rates as CSV", shortcut: "e", run: exportCsv },
    ];
    return () => {
      contextCommands.value = [];
    };
  }, [eur, base, rows]);

  const ecbDate = bundle.provenance["ecb-daily"]?.publishedAt;
  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>Markets</h1>
          <p class="sub">
            Reference rates from {currencyName(base)}: the ECB's daily euro rates{ecbDate ? ` for ${local(ecbDate)}` : ""}, with Frankfurter for currencies the ECB doesn't cover.
            Select a currency to see how today compares with history.
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
          <span>From</span>
          <select value={base} onChange={(e) => setParam("base", (e.target as HTMLSelectElement).value, "GBP")}>
            {[...eur.keys()].sort().map((c) => (
              <option key={c} value={c}>
                {c} · {currencyName(c)}
              </option>
            ))}
          </select>
        </label>
        <label class="field grow">
          <span>Find</span>
          <input type="search" value={filter} placeholder="Currency code or name" onInput={(e) => setParam("q", (e.target as HTMLInputElement).value, "")} />
        </label>
      </div>

      {pick && eur.has(pick) && pick !== base && <PairDetail base={base} quote={pick} rate={(eur.get(pick)!.rate / (baseRate ?? 1))} />}

      {!baseRate ? (
        <Notice>No rate for {base} yet.</Notice>
      ) : (
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Currency</th>
                <th class="num">1 {base} =</th>
                <th class="num">1 unit = {base}</th>
                <th>Rate date</th>
                <th>Source</th>
                <th>
                  <span class="sr">Source details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.quote} data-row={i} class={`${i === sel ? "sel" : ""} ${pick === r.quote ? "open" : ""}`} onClick={() => (setSel(i), setParam("pair", pick === r.quote ? "" : r.quote, ""))}>
                  <td>
                    <span class="strong">{r.quote}</span> <span class="muted">{r.name}</span>
                  </td>
                  <td class="num">{num(r.cross)}</td>
                  <td class="num">{num(1 / r.cross)}</td>
                  <td>{local(r.date)}</td>
                  <td class="muted">{r.source === "ecb-daily" ? "ECB" : "Frankfurter"}</td>
                  <td class="tight">
                    <SourceButton title={`${base} → ${r.quote}`} provenance={bundle.provenance[r.source]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="fine">
        Reference rates are mid-market benchmarks for comparison; nobody exchanges money at exactly these rates. ECB rates are published for information purposes only.
        Statistics, not forecasts or financial advice.
      </p>
    </section>
  );
}

const WINDOWS = [
  { label: "Past year", years: 1 },
  { label: "Past 5 years", years: 5 },
  { label: "All history", years: null },
];

function PairDetail({ base, quote, rate }: { base: string; quote: string; rate: number }) {
  const m = manifest.value;
  const has = (c: string) => c === "EUR" || !!m?.files[`history/EUR-${c}`];
  const [state, setState] = useState<{ series: { date: string; rate: number }[]; error?: string } | null>(null);

  useEffect(() => {
    if (!has(base) || !has(quote)) return setState({ series: [], error: "The ECB doesn't publish history for this pair, so there's nothing to compare with yet." });
    let live = true;
    setState(null);
    const get = (c: string) => (c === "EUR" ? Promise.resolve(null) : loadBundle<HistoryBundle>(`history/EUR-${c}`));
    Promise.all([get(base), get(quote)])
      .then(([b, q]) => {
        const bs = seriesOf(b);
        const series = quote === "EUR" ? (invert(bs) ?? []) : crossSeries(bs, seriesOf(q));
        if (live) setState({ series });
      })
      .catch((e: unknown) => live && setState({ series: [], error: String(e) }));
    return () => {
      live = false;
    };
  }, [base, quote, m]);

  const stats = state ? windowStats(state.series, WINDOWS) : [];
  const lastYear = state?.series.slice(-260) ?? [];
  return (
    <div class="pair">
      <header>
        <h2>
          {base} → {quote}
        </h2>
        <span class="v">{num(rate)}</span>
        <button class="icon" onClick={() => setParam("pair", "", "")} aria-label="Close">
          ×
        </button>
      </header>
      {!state ? (
        <Loading what="history" />
      ) : state.error ? (
        <p class="muted">{state.error}</p>
      ) : (
        <>
          {stats.length === 0 && (
            <p class="muted">
              Only {state.series.length} {state.series.length === 1 ? "day" : "days"} of history so far. Comparisons appear once at least 20 days are in, or straight away
              once the ECB's full history (back to 1999) is loaded.
            </p>
          )}
          {lastYear.length > 1 && <Sparkline points={lastYear} label={`${base} to ${quote}, past year`} />}
          {stats.length > 0 && <div class="stats">
            {stats.map((s) => (
              <div key={s.label}>
                <span class="k">{s.label}</span>
                <span class="v">{Math.round(s.betterThan)}%</span>
                <span class="s">
                  of {s.days.toLocaleString("en-GB")} days had a worse rate · range {num(s.low)}–{num(s.high)}
                </span>
              </div>
            ))}
          </div>}
          {stats.length > 0 && <p class="fine">
            On the latest ECB date, converting {base} into {quote} got more {quote} than on the share of days shown. A higher share is better for someone selling {base}.
            This describes the past; it doesn't predict the future.
          </p>}
        </>
      )}
    </div>
  );
}

function invert(s: { date: string; rate: number }[] | null) {
  return s ? s.map((p) => ({ date: p.date, rate: 1 / p.rate })) : null;
}
