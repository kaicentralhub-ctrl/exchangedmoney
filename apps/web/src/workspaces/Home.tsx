import { ago } from "../lib/format.js";
import { manifest } from "../state/data.js";
import { WORKSPACES } from "../ui/commands.js";
import { Link } from "../ui/Link.js";

export function Home() {
  const m = manifest.value;
  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>What changing money really costs</h1>
          <p class="sub">
            Independent and sourced. We never sell currency or transfers, and every ranking is ordered by cost to you. {m ? `Data published ${ago(m.generatedAt)}.` : ""}
          </p>
        </div>
      </header>
      <div class="tiles">
        {WORKSPACES.map((w) => (
          <Link key={w.path} to={w.path} class={`tile ${w.ready ? "" : "planned"}`}>
            <span class="t">{w.label}</span>
            <span class="d">{w.blurb}</span>
            <span class="k">
              {w.ready ? "" : "Planned · "}
              <kbd>g {w.key}</kbd>
            </span>
          </Link>
        ))}
      </div>
      <p class="fine">Press ⌘K (or /) anywhere to search and run commands, and ? for all keyboard shortcuts.</p>
    </section>
  );
}
