import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ago } from "./lib/format.js";
import { loadManifest, manifest, manifestError } from "./state/data.js";
import { path } from "./state/router.js";
import { commandBarOpen, sourcePanel } from "./state/ui.js";
import { CommandBar } from "./ui/CommandBar.js";
import { WORKSPACES } from "./ui/commands.js";
import { installKeys } from "./ui/keys.js";
import { Link } from "./ui/Link.js";
import { Shortcuts } from "./ui/Shortcuts.js";
import { SourcePanel } from "./ui/SourcePanel.js";
import { Cards } from "./workspaces/Cards.js";
import { Home } from "./workspaces/Home.js";
import { Markets } from "./workspaces/Markets.js";
import { Planned } from "./workspaces/Planned.js";
import { Sources } from "./workspaces/Sources.js";

const online = signal(navigator.onLine);
addEventListener("online", () => ((online.value = true), void loadManifest()));
addEventListener("offline", () => (online.value = false));

function View() {
  const p = path.value;
  if (p === "/") return <Home />;
  if (p === "/cards") return <Cards />;
  if (p === "/markets") return <Markets />;
  if (p === "/sources") return <Sources />;
  if (p === "/trip" || p === "/receipt") return <Planned path={p} />;
  return (
    <section class="ws">
      <h1>Not found</h1>
      <p class="sub">
        Nothing lives at this address. <Link to="/">Go to the start</Link>.
      </p>
    </section>
  );
}

function Freshness() {
  const m = manifest.value;
  if (!online.value) return <span class="fresh off">Offline · showing saved data</span>;
  if (manifestError.value && !m) return <span class="fresh off">Data unavailable</span>;
  if (!m) return <span class="fresh">Loading data…</span>;
  return (
    <Link to="/sources" class="fresh" title="See every source">
      Data published {ago(m.generatedAt)}
    </Link>
  );
}

export function App() {
  useEffect(() => installKeys(), []);
  useEffect(() => {
    void loadManifest();
    const t = setInterval(() => void loadManifest(), 10 * 60_000);
    const onVis = () => document.visibilityState === "visible" && void loadManifest();
    document.addEventListener("visibilitychange", onVis);
    return () => (clearInterval(t), document.removeEventListener("visibilitychange", onVis));
  }, []);
  useEffect(() => {
    const w = WORKSPACES.find((x) => x.path === path.value);
    document.title = w ? `${w.label} · exchangedmoney` : "exchangedmoney: what currency exchange really costs";
    sourcePanel.value = null;
  }, [path.value]);

  return (
    <div class={`shell ${sourcePanel.value ? "with-panel" : ""}`}>
      <nav class="rail" aria-label="Workspaces">
        <Link to="/" class="wordmark">
          exchanged<span>money</span>
        </Link>
        <ul>
          {WORKSPACES.map((w) => (
            <li key={w.path}>
              <Link to={w.path} class={w.ready ? "" : "planned"} title={`${w.blurb} (g ${w.key})`}>
                <span>{w.label}</span>
                <kbd>{w.key}</kbd>
              </Link>
            </li>
          ))}
        </ul>
        <p class="pledge">Independent. We never sell currency, and rankings follow cost to you, not commission.</p>
      </nav>
      <div class="main">
        <header class="topbar">
          <button class="cmd" onClick={() => (commandBarOpen.value = true)} aria-label="Open command bar">
            <span>Search or run a command</span>
            <kbd>⌘K</kbd>
          </button>
          <Freshness />
        </header>
        <main id="content">
          <View />
        </main>
      </div>
      <SourcePanel />
      <CommandBar />
      <Shortcuts />
    </div>
  );
}
