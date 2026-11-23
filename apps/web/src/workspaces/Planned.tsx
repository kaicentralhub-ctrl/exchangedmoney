const PLANS: Record<string, { title: string; what: string; needs: string[] }> = {
  "/trip": {
    title: "Trip",
    what: "Add the cards you carry and a list of what you expect to spend and withdraw. See what each card would cost and which card is cheapest for each kind of transaction, including what happens if you accept paying in pounds abroad.",
    needs: ["Card markups (collecting now)", "Fixed and percentage fees per card (fee model, next)", "Card network daily rates"],
  },
  "/receipt": {
    title: "Receipt",
    what: "Enter what you paid and what you got. See how far the rate was from mid-market, where that sits in history, and what it cost you.",
    needs: ["Reference rate history (collecting now)", "Card markups (collecting now)"],
  },
};

export function Planned({ path }: { path: string }) {
  const p = PLANS[path];
  if (!p) return null;
  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>{p.title}</h1>
          <p class="sub">Planned. {p.what}</p>
        </div>
      </header>
      <h2 class="h2">What it needs</h2>
      <ul class="plain">
        {p.needs.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
