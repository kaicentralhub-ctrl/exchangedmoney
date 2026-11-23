import { useEffect, useMemo, useState } from "preact/hooks";
import { decodeMarkups, decodeSeries, type HistoryBundle, type MarkupsBundle, type Provenance, type RatesBundle, type SeriesPoint, type TariffsBundle } from "@exm/core/bundles";
import { analyseReceipt } from "@exm/core/receipt";
import { rankCardCosts } from "../lib/costs.js";
import { download, toCsv } from "../lib/csv.js";
import { gbp, local, num as fmtNum, pct } from "../lib/format.js";
import { euroRates } from "../lib/rates.js";
import {
  dayPercentile, FORM_DEFAULTS, formFromParams, KINDS, LABELS, loadReceipts, num, pairSeries, paramKey, referenceOn, storeReceipts, toSaved, totals,
  type ReceiptForm, type ReceiptKind, type SavedReceipt,
} from "../lib/receipt.js";
import { loadBundle, manifest, useBundles } from "../state/data.js";
import { params, setParams } from "../state/router.js";
import { contextCommands } from "../state/ui.js";
import { Loading, Notice, Segmented, SourceButton } from "../ui/bits.js";

const money = (v: number, cur: string) =>
  `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-GB", { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Receipt() {
  const loaded = useBundles<[RatesBundle, MarkupsBundle, TariffsBundle]>(["rates", "markups", "tariffs"]);
  if (loaded.state === "loading") return <Loading what="rates" />;
  if (loaded.state === "error") return <Notice kind="error">Couldn't load data: {loaded.error}</Notice>;
  const [rates, markups, tariffs] = loaded.data;
  return <ReceiptView rates={rates} markups={markups} tariffs={tariffs} />;
}

interface Reference {
  rate: number;
  date: string;
  provenance: Provenance | undefined;
  /** Whether this came from history on the date, or the latest rate as a fallback. */
  basis: "history" | "latest";
  series: SeriesPoint[] | null;
}

function ReceiptView({ rates, markups, tariffs }: { rates: RatesBundle; markups: MarkupsBundle; tariffs: TariffsBundle }) {
  const eur = useMemo(() => euroRates(rates), [rates]);
  const latestDate = rates.provenance["ecb-daily"]?.publishedAt ?? new Date().toISOString().slice(0, 10);
  const defaults = FORM_DEFAULTS(latestDate);
  const f = formFromParams(params.value, defaults);
  const set = (k: keyof ReceiptForm, v: string) => setParams({ [paramKey(k)]: { value: v, fallback: defaults[k] } });
  const currencies = useMemo(() => [...eur.keys()].sort((a, b) => (a === "GBP" ? -1 : b === "GBP" ? 1 : a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b))), [eur]);
  const [saved, setSaved] = useState<SavedReceipt[]>(loadReceipts);
  useEffect(() => storeReceipts(saved), [saved]);

  // Reference rate: ECB history on (or just before) the date, else the latest published rate.
  const [ref, setRef] = useState<Reference | null | "loading">("loading");
  const m = manifest.value;
  useEffect(() => {
    let live = true;
    setRef("loading");
    const hist = (c: string) => (c === "EUR" ? Promise.resolve(null) : m?.files[`history/EUR-${c}`] ? loadBundle<HistoryBundle>(`history/EUR-${c}`) : Promise.reject(new Error("no history")));
    const latest = (): Reference | null => {
      const g = eur.get(f.giveCurrency);
      const q = eur.get(f.getCurrency);
      if (!g || !q) return null;
      const date = [g.date, q.date].filter(Boolean).sort()[0] ?? latestDate;
      if (f.date < date) return null; // asking about a day before the latest rate, with no history for it
      const src = q.source !== "identity" ? q.source : g.source;
      return { rate: q.rate / g.rate, date, provenance: rates.provenance[src], basis: "latest", series: null };
    };
    Promise.all([hist(f.giveCurrency), hist(f.getCurrency)])
      .then(([g, q]) => {
        if (!live) return;
        const series = pairSeries(g ? decodeSeries(g) : null, q ? decodeSeries(q) : null);
        const on = referenceOn(series, f.date);
        const prov = (g ?? q)?.provenance;
        setRef(on ? { rate: on.rate, date: on.date, provenance: prov, basis: "history", series } : latest());
      })
      .catch(() => live && setRef(latest()));
    return () => {
      live = false;
    };
  }, [f.giveCurrency, f.getCurrency, f.date, m, eur]);

  const input = { give: num(f.give), giveCurrency: f.giveCurrency, get: num(f.get), getCurrency: f.getCurrency, separateFees: num(f.fees) };
  const analysis = ref && ref !== "loading" ? analyseReceipt(input, ref.rate) : null;
  const ready = input.give > 0 && input.get > 0;

  const save = () => {
    if (!analysis || !ref || ref === "loading") return;
    setSaved((s) => [toSaved(f, analysis, ref.date, new Date()), ...s]);
  };
  useEffect(() => {
    contextCommands.value = [
      ...KINDS.map((k) => ({ id: `kind-${k.value}`, group: "Receipt", label: `Check a ${k.label.toLowerCase()}`, run: () => set("kind", k.value) })),
      { id: "receipt-save", group: "Receipt", label: "Save this receipt", run: save },
    ];
    return () => {
      contextCommands.value = [];
    };
  }, [f.kind, analysis]);

  const L = LABELS[f.kind];
  const amountField = (side: "give" | "get") => (
    <div class="amount" key={side}>
      <span class="amount-label">{side === "give" ? L.give : L.get}</span>
      <div class="amount-row">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`${side === "give" ? L.give : L.get} amount`}
          value={side === "give" ? f.give : f.get}
          onInput={(e) => set(side, (e.target as HTMLInputElement).value)}
        />
        <select aria-label={`${side === "give" ? L.give : L.get} currency`} value={side === "give" ? f.giveCurrency : f.getCurrency} onChange={(e) => set(side === "give" ? "giveCurrency" : "getCurrency", (e.target as HTMLSelectElement).value)}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>Receipt</h1>
          <p class="sub">Enter what you paid and what you got. See the rate you really got, how far it was from the reference rate that day, and what the gap cost you.</p>
        </div>
      </header>

      <div class="receipt-form">
        <Segmented label="What was it?" value={f.kind} options={KINDS} onChange={(v) => set("kind", v as ReceiptKind)} />
        <div class="amounts">
          {L.getFirst ? [amountField("get"), amountField("give")] : [amountField("give"), amountField("get")]}
          <label class="field narrow">
            <span>Fees on a separate line ({f.giveCurrency})</span>
            <input type="text" inputMode="decimal" placeholder="0.00" value={f.fees} onInput={(e) => set("fees", (e.target as HTMLInputElement).value)} />
          </label>
          <label class="field narrow">
            <span>Date</span>
            <input type="date" value={f.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("date", (e.target as HTMLInputElement).value)} />
          </label>
        </div>
      </div>

      {f.giveCurrency === f.getCurrency ? (
        <Notice>Pick two different currencies.</Notice>
      ) : !ready ? (
        <Notice>Fill in both amounts to check the rate. {L.getFirst ? "The receipt shows the local amount; your statement or app shows what it cost you." : ""}</Notice>
      ) : ref === "loading" ? (
        <Loading what="the reference rate" />
      ) : !ref || !analysis ? (
        <Notice>We don't have a reference rate for {f.giveCurrency} to {f.getCurrency} on {local(f.date)} yet.</Notice>
      ) : (
        <Verdict f={f} analysis={analysis} reference={ref} markups={markups} tariffs={tariffs} onSave={save} />
      )}

      <SavedList saved={saved} setSaved={setSaved} />
    </section>
  );
}

function Verdict({
  f,
  analysis: a,
  reference: ref,
  markups,
  tariffs,
  onSave,
}: {
  f: ReceiptForm;
  analysis: NonNullable<ReturnType<typeof analyseReceipt>>;
  reference: Reference;
  markups: MarkupsBundle;
  tariffs: TariffsBundle;
  onSave: () => void;
}) {
  const [savedFlash, setSavedFlash] = useState(false);
  const g = f.giveCurrency;
  const q = f.getCurrency;
  const close = Math.abs(a.shortfallPct) < 0.05;
  const day = ref.series ? dayPercentile(ref.series, f.date) : null;

  // For card payments and cash machines charged in pounds, compare with the cards we cover.
  const cards = useMemo(() => {
    if (g !== "GBP" || (f.kind !== "card" && f.kind !== "atm")) return null;
    const all = decodeMarkups(markups);
    const toGBP = (cur: string, amount: number) => (cur === q ? amount / a.referenceRate : cur === "GBP" ? amount : null);
    return rankCardCosts(tariffs.products, all, toGBP, { currency: q, context: f.kind === "atm" ? "atm" : "purchase", gbp: a.fairGive, segment: "personal", type: "all" });
  }, [g, q, f.kind, a.fairGive, a.referenceRate, markups, tariffs]);
  const dearestCardPct = cards?.length ? Math.max(...cards.map((c) => c.cost.effectivePct)) : null;

  return (
    <>
      <div class={`verdict ${close ? "" : a.shortfallPct > 0 ? "worse" : "better"}`}>
        <p class="headline">
          {close
            ? "You got the reference rate, or within a whisker of it."
            : a.shortfallPct > 0
              ? `You got ${pct(a.shortfallPct)} less than the reference rate. That cost you ${money(a.costInGive, g)}.`
              : `You got ${pct(-a.shortfallPct)} more than the reference rate, ${money(-a.costInGive, g)} better off.`}
        </p>
        <p class="sub">
          The reference rate is the ECB's daily rate for {local(ref.date)}
          {ref.basis === "latest" ? ", the latest we have" : ref.date < f.date ? ", the last one before your date" : ""}. At that rate, {money(num(f.get), q)} would have cost{" "}
          {money(a.fairGive, g)}; you paid {money(a.totalGive, g)}
          {num(f.fees) > 0 ? ` including ${money(num(f.fees), g)} in separate fees` : ""}.
        </p>
      </div>

      <div class="stats">
        <div>
          <span class="k">Your rate</span>
          <span class="v">{fmtNum(a.achievedRate)}</span>
          <span class="s">
            {q} per {g} (1 {q} = {fmtNum(1 / a.achievedRate)} {g})
          </span>
        </div>
        <div>
          <span class="k">
            Reference rate <SourceButton title={`${g} → ${q} reference rate`} provenance={ref.provenance} detail={`ECB-based rate for ${local(ref.date)}: 1 ${g} = ${fmtNum(ref.rate)} ${q}.`} />
          </span>
          <span class="v">{fmtNum(a.referenceRate)}</span>
          <span class="s">
            {q} per {g}, {local(ref.date)}
          </span>
        </div>
        <div>
          <span class="k">Gap</span>
          <span class="v">{pct(a.shortfallPct)}</span>
          <span class="s">{money(a.costInGive, g)} on this one</span>
        </div>
        {day && (
          <div>
            <span class="k">That day's rate</span>
            <span class="v">{Math.round(day.betterThan)}%</span>
            <span class="s">of the year before had a worse reference rate for {g} to {q}</span>
          </div>
        )}
      </div>

      {dearestCardPct !== null && f.kind === "card" && a.shortfallPct > dearestCardPct + 1 && (
        <Notice>
          That's more than any card we cover would charge for this ({pct(dearestCardPct)} at most). If the receipt showed the amount in pounds, the shop's payment provider
          set the rate (dynamic currency conversion), and its markup is usually the reason.
        </Notice>
      )}

      {cards && cards.length > 0 && (
        <div class="plan-box">
          <h3>What the cards we cover would have charged for this</h3>
          <table class="mini">
            <thead>
              <tr>
                <th>Card</th>
                <th class="num">Would have cost</th>
                <th class="num">Compared with yours</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => {
                const diff = c.cost.totalGBP - a.costInGive;
                return (
                  <tr key={c.product.id}>
                    <td>
                      {c.product.issuer}, {c.product.name}
                    </td>
                    <td class="num">{gbp(c.cost.totalGBP)}</td>
                    <td class={`num ${diff < -0.005 ? "gain" : ""}`}>{Math.abs(diff) < 0.005 ? "the same" : diff < 0 ? `${gbp(-diff)} less` : `${gbp(diff)} more`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="fine">Using each card's fee schedule and the same reference rate. Open Cards for the fee-by-fee breakdown.</p>
        </div>
      )}
      {(f.kind === "bureau" || f.kind === "transfer") && <p class="fine">Comparisons with bureaux and transfer providers are coming as we add their rates.</p>}

      <div class="ws-actions under start">
        <button
          class="primary"
          onClick={() => {
            onSave();
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 2000);
          }}
        >
          {savedFlash ? "Saved" : "Save to my receipts"}
        </button>
        <button onClick={() => navigator.clipboard?.writeText(location.href)} title="Copy a link to this check">
          Copy link
        </button>
      </div>
      {(f.kind === "card" || f.kind === "atm") && <p class="fine">
        Card networks convert at their own rate on the day the payment is processed, which can differ from the ECB rate on the day you paid. A small gap can come from that
        alone. Statistics, not financial advice.
      </p>}
      {f.kind !== "card" && f.kind !== "atm" && <p class="fine">Statistics, not financial advice.</p>}
    </>
  );
}

function SavedList({ saved, setSaved }: { saved: SavedReceipt[]; setSaved: (f: (s: SavedReceipt[]) => SavedReceipt[]) => void }) {
  if (saved.length === 0) return null;
  const t = totals(saved);
  const exportCsv = () =>
    download(
      "exchangedmoney-receipts.csv",
      toCsv(
        ["date", "kind", "gave", "gave_currency", "separate_fees", "got", "got_currency", "your_rate", "reference_rate", "reference_date", "gap_pct", "cost_vs_reference"],
        saved.map((r) => [r.form.date, r.form.kind, num(r.form.give), r.form.giveCurrency, num(r.form.fees), num(r.form.get), r.form.getCurrency, r.achievedRate, r.referenceRate, r.referenceDate, Number(r.shortfallPct.toFixed(3)), Number(r.costInGive.toFixed(2))]),
      ),
    );
  return (
    <>
      <h2 class="h2">My receipts</h2>
      <p class="sub">
        Kept on this device only.{" "}
        {t.map((x) => `${x.count} paid in ${x.currency}: ${money(x.cost, x.currency)} more than the reference rate, on ${money(x.given, x.currency)}.`).join(" ")}
      </p>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th class="num hide-sm">Your rate</th>
              <th class="num hide-sm">Reference</th>
              <th class="num">Gap</th>
              <th class="num">Cost</th>
              <th>
                <span class="sr">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {saved.map((r) => (
              <tr key={r.id} class="static">
                <td>{local(r.form.date)}</td>
                <td>
                  {KINDS.find((k) => k.value === r.form.kind)?.label}: {money(num(r.form.get), r.form.getCurrency)} for {money(num(r.form.give) + num(r.form.fees), r.form.giveCurrency)}
                </td>
                <td class="num hide-sm">{fmtNum(r.achievedRate)}</td>
                <td class="num hide-sm">{fmtNum(r.referenceRate)}</td>
                <td class="num">{pct(r.shortfallPct)}</td>
                <td class="num">{money(r.costInGive, r.form.giveCurrency)}</td>
                <td class="tight">
                  <button class="icon" aria-label="Remove this receipt" title="Remove" onClick={() => setSaved((s) => s.filter((x) => x.id !== r.id))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="ws-actions under">
        <button onClick={exportCsv}>Export CSV</button>
      </div>
    </>
  );
}

