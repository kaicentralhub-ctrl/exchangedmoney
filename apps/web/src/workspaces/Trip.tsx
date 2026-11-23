import { Fragment } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { decodeMarkups, type MarkupsBundle, type RatesBundle, type TariffsBundle } from "@exm/core/bundles";
import { bestCardPerSpend, estimateNetworkMargins, priceTrip, type CardChoice, type CardProduct, type TripCost } from "@exm/core/fees";
import type { IssuerMarkup } from "@exm/core/types";
import { download, toCsv } from "../lib/csv.js";
import { breakEvenPct, dccCost } from "../lib/dcc.js";
import { currencyName, gbp, local, num, pct } from "../lib/format.js";
import { euroRates, gbpConverter } from "../lib/rates.js";
import { decodeTrip, defaultNetwork, defaultState, encodeTrip, loadTrip, newId, planSpends, saveTrip, type TripSpend, type TripState } from "../lib/trip.js";
import { useBundles } from "../state/data.js";
import { contextCommands } from "../state/ui.js";
import { Loading, Notice, Segmented } from "../ui/bits.js";

const today = () => new Date().toISOString().slice(0, 10);
const kindWord = (c: string) => (c === "atm" ? "Cash withdrawal" : "Card payments");

/** A shared trip arrives in the URL hash; otherwise the last trip saved on this device. */
function initialTrip(): { state: TripState; shared: boolean } {
  const m = /[#&]trip=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m) {
    const t = decodeTrip(m[1]!);
    history.replaceState(null, "", location.pathname + location.search);
    if (t) return { state: t, shared: true };
  }
  return { state: loadTrip() ?? defaultState(today()), shared: false };
}

export function Trip() {
  const loaded = useBundles<[MarkupsBundle, TariffsBundle, RatesBundle]>(["markups", "tariffs", "rates"]);
  if (loaded.state === "loading") return <Loading what="card and rate data" />;
  if (loaded.state === "error") return <Notice kind="error">Couldn't load data: {loaded.error}</Notice>;
  const [markups, tariffs, rates] = loaded.data;
  return <TripView markups={markups} products={tariffs.products} rates={rates} />;
}

function TripView({ markups, products, rates }: { markups: MarkupsBundle; products: CardProduct[]; rates: RatesBundle }) {
  const [{ state: initial, shared }] = useState(initialTrip);
  const [trip, setTrip] = useState<TripState>(initial);
  const [copied, setCopied] = useState(false);
  useEffect(() => saveTrip(trip), [trip]);

  const all = useMemo(() => decodeMarkups(markups), [markups]);
  const eur = useMemo(() => euroRates(rates), [rates]);
  const toGBP = useMemo(() => gbpConverter(eur), [eur]);
  const margins = useMemo(() => estimateNetworkMargins(products, all), [products, all]);
  const currencies = useMemo(() => [...eur.keys()].filter((c) => c !== "GBP").sort((a, b) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b))), [eur]);

  const choices: CardChoice[] = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    if (!trip.wallet) return products.filter((p) => p.segment === "personal").map((card) => ({ card, network: defaultNetwork(card) }));
    return trip.wallet.flatMap((w) => {
      const card = byId.get(w.productId);
      return card ? [{ card, network: card.networks.includes(w.network) ? w.network : defaultNetwork(card) }] : [];
    });
  }, [products, trip.wallet]);

  const share = async () => {
    const url = `${location.origin}${location.pathname}#trip=${encodeTrip(trip)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt("Copy this link to share the trip:", url);
    }
  };

  useEffect(() => {
    contextCommands.value = [
      { id: "trip-share", group: "Trip", label: "Copy a link to this trip", run: share },
      { id: "trip-reset", group: "Trip", label: "Start a new trip", run: () => setTrip(defaultState(today())) },
      { id: "trip-all", group: "Trip", label: "Compare every card", run: () => setTrip((t) => ({ ...t, wallet: null })) },
    ];
    return () => {
      contextCommands.value = [];
    };
  }, [trip]);

  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>Trip</h1>
          <p class="sub">
            Plan what you'll spend, pick the cards you carry, and see what the trip would cost on each, fee by fee, and which card is cheapest for every payment and
            withdrawal. Your trip stays on this device.
          </p>
        </div>
        <div class="ws-actions">
          <button onClick={share}>{copied ? "Link copied" : "Share trip"}</button>
          <button onClick={() => setTrip(defaultState(today()))}>New trip</button>
        </div>
      </header>
      {shared && <Notice>You're looking at a trip someone shared with you. Changes you make are saved on this device only.</Notice>}

      <h2 class="h2 step">1. Your trip</h2>
      <QuickPlanForm trip={trip} setTrip={setTrip} currencies={currencies} />
      <SpendsTable trip={trip} setTrip={setTrip} currencies={currencies} toGBP={toGBP} />

      <h2 class="h2 step">2. Your cards</h2>
      <WalletPicker trip={trip} setTrip={setTrip} products={products} />

      <h2 class="h2 step">3. What it costs</h2>
      <Results trip={trip} setTrip={setTrip} choices={choices} markups={all} toGBP={toGBP} margins={margins} />
    </section>
  );
}

/* ---------------- 1. plan ---------------- */

type SetTrip = (f: TripState | ((t: TripState) => TripState)) => void;

function QuickPlanForm({ trip, setTrip, currencies }: { trip: TripState; setTrip: SetTrip; currencies: string[] }) {
  const p = trip.plan;
  const upd = (k: keyof typeof p, v: string) => setTrip((t) => ({ ...t, plan: { ...t.plan, [k]: k === "currency" || k === "start" ? v : Number(v) || 0 } }));
  return (
    <div class="toolbar plan">
      <label class="field">
        <span>Currency</span>
        <select value={p.currency} onChange={(e) => upd("currency", (e.target as HTMLSelectElement).value)}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c} · {currencyName(c)}
            </option>
          ))}
        </select>
      </label>
      <label class="field narrow">
        <span>From</span>
        <input type="date" value={p.start} onChange={(e) => upd("start", (e.target as HTMLInputElement).value)} />
      </label>
      <label class="field tiny">
        <span>Days</span>
        <input type="number" min={1} max={60} value={p.days} onChange={(e) => upd("days", (e.target as HTMLInputElement).value)} />
      </label>
      <label class="field narrow">
        <span>Card payments a day ({p.currency})</span>
        <input type="number" min={0} step={10} value={p.daily} onChange={(e) => upd("daily", (e.target as HTMLInputElement).value)} />
      </label>
      <label class="field tiny">
        <span>Cash withdrawals</span>
        <input type="number" min={0} max={30} value={p.cashCount} onChange={(e) => upd("cashCount", (e.target as HTMLInputElement).value)} />
      </label>
      <label class="field narrow">
        <span>Each withdrawal ({p.currency})</span>
        <input type="number" min={0} step={10} value={p.cashAmount} onChange={(e) => upd("cashAmount", (e.target as HTMLInputElement).value)} />
      </label>
      <button class="primary" onClick={() => setTrip((t) => ({ ...t, spends: planSpends(t.plan) }))} title="Replace the list below with this plan">
        Build trip
      </button>
    </div>
  );
}

function SpendsTable({ trip, setTrip, currencies, toGBP }: { trip: TripState; setTrip: SetTrip; currencies: string[]; toGBP: (c: string, a: number) => number | null }) {
  const [open, setOpen] = useState(trip.spends.length <= 12);
  const rows = [...trip.spends].sort((a, b) => a.date.localeCompare(b.date));
  const upd = (id: string, patch: Partial<TripSpend>) => setTrip((t) => ({ ...t, spends: t.spends.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const remove = (id: string) => setTrip((t) => ({ ...t, spends: t.spends.filter((s) => s.id !== id) }));
  const add = () =>
    setTrip((t) => {
      const last = [...t.spends].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      return { ...t, spends: [...t.spends, { id: newId(), date: last?.date ?? t.plan.start, context: "purchase", currency: last?.currency ?? t.plan.currency, amount: last?.amount ?? 50 }] };
    });
  const totals = rows.reduce(
    (a, s) => {
      const g = toGBP(s.currency, s.amount);
      return g === null ? { ...a, missing: a.missing + 1 } : { ...a, [s.context]: a[s.context as "purchase" | "atm"] + g };
    },
    { purchase: 0, atm: 0, missing: 0 },
  );
  return (
    <div class="spends">
      <div class="spends-head">
        <span>
          <span class="strong">{rows.length} transactions</span> worth {gbp(totals.purchase + totals.atm, 0)} at the reference rate ({gbp(totals.purchase, 0)} card payments,{" "}
          {gbp(totals.atm, 0)} cash){totals.missing ? `; ${totals.missing} in a currency we have no rate for` : ""}.
        </span>
        <button class="linkish" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the list" : "Edit the list"}
        </button>
      </div>
      {open && (
        <div class="table-wrap">
          <table class="grid edit">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Currency</th>
                <th class="num">Amount</th>
                <th class="num">In pounds</th>
                <th>
                  <span class="sr">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const g = toGBP(s.currency, s.amount);
                return (
                  <tr key={s.id}>
                    <td>
                      <input type="date" value={s.date} aria-label="Date" onChange={(e) => upd(s.id, { date: (e.target as HTMLInputElement).value })} />
                    </td>
                    <td>
                      <select value={s.context} aria-label="Type" onChange={(e) => upd(s.id, { context: (e.target as HTMLSelectElement).value as TripSpend["context"] })}>
                        <option value="purchase">Card payment</option>
                        <option value="atm">Cash withdrawal</option>
                      </select>
                    </td>
                    <td>
                      <select value={s.currency} aria-label="Currency" onChange={(e) => upd(s.id, { currency: (e.target as HTMLSelectElement).value })}>
                        {currencies.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td class="num">
                      <input type="number" min={0} step={5} value={s.amount} aria-label="Amount" onChange={(e) => upd(s.id, { amount: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} />
                    </td>
                    <td class="num muted">{g === null ? "no rate" : gbp(g)}</td>
                    <td class="tight">
                      <button class="icon" onClick={() => remove(s.id)} aria-label="Remove this transaction" title="Remove">
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div class="ws-actions under start">
          <button onClick={add}>Add a transaction</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- 2. cards ---------------- */

function WalletPicker({ trip, setTrip, products }: { trip: TripState; setTrip: SetTrip; products: CardProduct[] }) {
  const personal = products.filter((p) => p.segment === "personal");
  const mode = trip.wallet ? "mine" : "all";
  const has = (id: string) => trip.wallet?.some((w) => w.productId === id) ?? false;
  const toggle = (p: CardProduct) =>
    setTrip((t) => {
      const w = t.wallet ?? [];
      return { ...t, wallet: w.some((x) => x.productId === p.id) ? w.filter((x) => x.productId !== p.id) : [...w, { productId: p.id, network: defaultNetwork(p) }] };
    });
  const setNet = (id: string, network: string) => setTrip((t) => ({ ...t, wallet: (t.wallet ?? []).map((w) => (w.productId === id ? { ...w, network: network as CardProduct["networks"][number] } : w)) }));
  const issuers = [...new Set(personal.map((p) => p.issuer))];
  return (
    <div class="wallet">
      <Segmented
        label="Compare"
        value={mode}
        options={[
          { value: "all", label: "Every card we cover" },
          { value: "mine", label: "Only the cards I have" },
        ]}
        onChange={(v) => setTrip((t) => ({ ...t, wallet: v === "all" ? null : (t.wallet ?? []) }))}
      />
      {mode === "mine" && (
        <div class="wallet-list">
          {issuers.map((issuer) => (
            <fieldset key={issuer}>
              <legend>{issuer}</legend>
              {personal
                .filter((p) => p.issuer === issuer)
                .map((p) => (
                  <div key={p.id} class="wallet-item">
                    <label>
                      <input type="checkbox" checked={has(p.id)} onChange={() => toggle(p)} /> {p.name} <span class="muted cap">· {p.cardType}</span>
                    </label>
                    {has(p.id) && p.networks.length > 1 && (
                      <select aria-label={`Network for ${p.name}`} value={trip.wallet!.find((w) => w.productId === p.id)!.network} onChange={(e) => setNet(p.id, (e.target as HTMLSelectElement).value)}>
                        {p.networks.map((n) => (
                          <option key={n} value={n}>
                            {n === "visa" ? "Visa" : "Mastercard"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
            </fieldset>
          ))}
          <p class="fine">More banks and cards are being added. Business cards aren't covered yet.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- 3. results ---------------- */

function Results({
  trip,
  setTrip,
  choices,
  markups,
  toGBP,
  margins,
}: {
  trip: TripState;
  setTrip: SetTrip;
  choices: CardChoice[];
  markups: IssuerMarkup[];
  toGBP: (c: string, a: number) => number | null;
  margins: ReturnType<typeof estimateNetworkMargins>;
}) {
  const base = { toGBP, markups, networkMargins: margins };
  const costs = useMemo(
    () => choices.map((c) => priceTrip(trip.spends, c.card, { ...base, network: c.network })).sort((a, b) => a.totalGBP - b.totalGBP || a.card.name.localeCompare(b.card.name)),
    [choices, trip.spends, markups, toGBP, margins],
  );
  const best = useMemo(() => bestCardPerSpend(trip.spends, choices, base), [choices, trip.spends, markups, toGBP, margins]);
  const [open, setOpen] = useState<string | null>(null);

  if (trip.spends.length === 0) return <Notice>Add some spending above to see what the trip would cost.</Notice>;
  if (choices.length === 0) return <Notice>Pick at least one card above.</Notice>;

  const cheapest = costs[0]!;
  const dearest = costs.at(-1)!;
  const tripValue = cheapest.baseGBP;
  const exportCsv = () =>
    download(
      "exchangedmoney-trip.csv",
      toCsv(
        ["card", "network", "date", "type", "currency", "amount", "value_gbp", "fees_gbp", "network_margin_estimate_gbp", "total_gbp"],
        costs.flatMap((c) =>
          c.spends.map((s) => {
            const est = s.lines.filter((l) => l.basis === "estimate").reduce((a, l) => a + l.gbp, 0);
            return [`${c.card.issuer}, ${c.card.name}`, c.network, s.spend.date ?? null, s.spend.context, s.spend.currency, s.spend.amount, s.baseGBP, Number((s.totalGBP - est).toFixed(2)), Number(est.toFixed(2)), s.totalGBP];
          }),
        ),
      ),
    );

  return (
    <>
      <div class="stats">
        <div>
          <span class="k">Trip value</span>
          <span class="v">{gbp(tripValue, 0)}</span>
          <span class="s">at the reference rate</span>
        </div>
        <div>
          <span class="k">Cheapest single card</span>
          <span class="v">{gbp(cheapest.totalGBP)}</span>
          <span class="s">
            {cheapest.card.issuer}, {cheapest.card.name}
          </span>
        </div>
        {choices.length > 1 && (
          <div>
            <span class="k">Cheapest card each time</span>
            <span class="v">{gbp(best.totalGBP)}</span>
            <span class="s">{best.totalGBP < cheapest.totalGBP - 0.004 ? `saves ${gbp(cheapest.totalGBP - best.totalGBP)} on the cheapest single card` : "same as the cheapest single card"}</span>
          </div>
        )}
        <div>
          <span class="k">{choices.length > 1 ? "Most expensive card" : "Effective cost"}</span>
          <span class="v">{choices.length > 1 ? gbp(dearest.totalGBP) : pct(tripValue > 0 ? (cheapest.totalGBP / tripValue) * 100 : 0)}</span>
          <span class="s">{choices.length > 1 ? `${dearest.card.issuer}, ${dearest.card.name}` : "of the trip's value"}</span>
        </div>
      </div>

      {cheapest.unpriced > 0 && <Notice>{cheapest.unpriced} transactions are in a currency we have no rate for, so they're left out of these totals.</Notice>}

      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Card</th>
              <th class="num hide-sm">Card payments</th>
              <th class="num hide-sm">Cash</th>
              <th class="num">Trip total</th>
              <th class="num hide-sm">Effective</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((c, i) => {
              const k = c.card.id;
              const byCtx = (ctx: string) => c.spends.filter((s) => s.spend.context === ctx).reduce((a, s) => a + s.totalGBP, 0);
              const conflict = c.spends.some((s) => s.check.status === "conflict");
              return (
                <Fragment key={k}>
                  <tr class={open === k ? "open" : ""} aria-expanded={open === k} onClick={() => setOpen((o) => (o === k ? null : k))}>
                    <td class="num rank">{i + 1}</td>
                    <td>
                      <span class="strong">{c.card.issuer}</span>, {c.card.name} <span class="muted">· {c.network === "visa" ? "Visa" : "Mastercard"}</span>
                      {conflict && (
                        <span class="pill warn" title="The issuer's published markup disagrees with its fee schedule">
                          check
                        </span>
                      )}
                    </td>
                    <td class="num hide-sm">{gbp(byCtx("purchase"))}</td>
                    <td class="num hide-sm">{gbp(byCtx("atm"))}</td>
                    <td class="num strong">{gbp(c.totalGBP)}</td>
                    <td class="num hide-sm">{pct(c.baseGBP > 0 ? (c.totalGBP / c.baseGBP) * 100 : 0)}</td>
                  </tr>
                  {open === k && (
                    <tr class="detail">
                      <td colSpan={6}>
                        <TripBreakdown cost={c} />
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
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      {choices.length > 1 && <BestPlan best={best} />}
      <PayInPounds trip={trip} setTrip={setTrip} costs={costs} />

      <p class="fine">
        Fees come from each issuer's fee pages (open a card to see its sources and the date we checked them). Network margins are estimates. Cash machine operators may add
        their own charge, and credit cards charge interest on cash from the day you take it, which isn't included. Statistics, not financial advice.
      </p>
    </>
  );
}

function TripBreakdown({ cost }: { cost: TripCost }) {
  const notes = [...new Set(cost.spends.flatMap((s) => s.notes).filter((n) => !n.includes("within the fee-free allowance")))];
  const lines = new Map<string, { gbp: number; estimate: boolean }>();
  for (const s of cost.spends) for (const l of s.lines) lines.set(l.label, { gbp: (lines.get(l.label)?.gbp ?? 0) + l.gbp, estimate: l.basis === "estimate" });
  return (
    <div class="breakdown">
      <h3>
        {cost.card.issuer}, {cost.card.name}: where the {gbp(cost.totalGBP)} comes from
      </h3>
      {lines.size === 0 ? (
        <p>No fees on this trip.</p>
      ) : (
        <table class="mini">
          <tbody>
            {[...lines].map(([label, v]) => (
              <tr key={label}>
                <td>
                  {label}
                  {v.estimate && <span class="muted"> (estimate)</span>}
                </td>
                <td class="num">{gbp(v.gbp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {[...notes, ...cost.card.caveats].length > 0 && (
        <ul class="notes">
          {[...notes, ...cost.card.caveats].map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p class="fine">
        Fee schedule from{" "}
        {cost.card.sources.map((s, i) => (
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
    </div>
  );
}

function BestPlan({ best }: { best: ReturnType<typeof bestCardPerSpend> }) {
  // Group consecutive choices by type and card, so allowance switches show up.
  const groups = new Map<string, { context: string; card: CardProduct; count: number; gbp: number; value: number }>();
  for (const a of best.assignments) {
    const k = `${a.cost.spend.context}|${a.choice.card.id}`;
    const g = groups.get(k) ?? { context: a.cost.spend.context, card: a.choice.card, count: 0, gbp: 0, value: 0 };
    groups.set(k, { ...g, count: g.count + 1, gbp: g.gbp + a.cost.totalGBP, value: g.value + (a.cost.baseGBP ?? 0) });
  }
  return (
    <div class="plan-box">
      <h3>Cheapest card for each transaction</h3>
      <table class="mini">
        <thead>
          <tr>
            <th>For</th>
            <th>Use</th>
            <th class="num">Transactions</th>
            <th class="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.values()]
            .sort((a, b) => a.context.localeCompare(b.context) * -1 || b.count - a.count)
            .map((g) => (
              <tr key={`${g.context}${g.card.id}`}>
                <td>{kindWord(g.context)}</td>
                <td>
                  {g.card.issuer}, {g.card.name}
                </td>
                <td class="num">
                  {g.count} ({gbp(g.value, 0)})
                </td>
                <td class="num">{gbp(g.gbp)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p class="fine">Worked out transaction by transaction in date order, with each card using up its own fee-free allowances.</p>
    </div>
  );
}

function PayInPounds({ trip, setTrip, costs }: { trip: TripState; setTrip: SetTrip; costs: TripCost[] }) {
  const payments = (c: TripCost) => c.spends.filter((s) => s.spend.context === "purchase");
  const value = payments(costs[0]!).reduce((a, s) => a + (s.baseGBP ?? 0), 0);
  if (value <= 0) return null;
  const d = trip.dccPct;
  return (
    <div class="plan-box">
      <h3>If a card machine offers to charge you in pounds</h3>
      <p class="sub">
        Paying in pounds (dynamic currency conversion) means the shop's provider sets the rate. Below the markup in this column, paying in pounds would cost less than letting
        that card convert, for card payments like these.
      </p>
      <div class="toolbar slim">
        <label class="field narrow">
          <span>Markup you were offered (%)</span>
          <input
            type="number"
            min={0}
            max={50}
            step={0.1}
            placeholder="from the screen"
            value={d ?? ""}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setTrip((t) => ({ ...t, dccPct: v === "" ? null : Math.max(0, Math.min(50, Number(v))) }));
            }}
          />
        </label>
      </div>
      <table class="mini">
        <thead>
          <tr>
            <th>Card</th>
            <th class="num">Card converts</th>
            <th class="num">Break-even markup</th>
            {d !== null && <th class="num">Paying in pounds at {num(d, 3)}%</th>}
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => {
            const card = payments(c).reduce((a, s) => a + s.totalGBP, 0);
            const be = breakEvenPct(card, value);
            const dcc = d !== null ? dccCost(value, d) : null;
            return (
              <tr key={c.card.id}>
                <td>
                  {c.card.issuer}, {c.card.name}
                </td>
                <td class="num">{gbp(card)}</td>
                <td class="num">{pct(be)}</td>
                {dcc !== null && <td class={`num ${dcc < card ? "gain" : ""}`}>{gbp(dcc)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="fine">
        On {gbp(value, 0)} of card payments. Most UK cards don't charge their non-sterling fee when you pay in pounds; the cost is the provider's markup. The markup shown on
        the screen should be against the ECB rate, as EU rules require there.
      </p>
    </div>
  );
}
