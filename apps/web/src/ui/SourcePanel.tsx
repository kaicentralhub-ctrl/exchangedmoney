import { useEffect, useRef } from "preact/hooks";
import { local, when } from "../lib/format.js";
import { sourcePanel } from "../state/ui.js";

/** Where a number came from: source, times, and the archived original. */
export function SourcePanel() {
  const s = sourcePanel.value;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (s) ref.current?.focus();
  }, [s]);
  if (!s) return null;
  const p = s.provenance;
  return (
    <aside class="panel" ref={ref} tabIndex={-1} aria-label="Source of this number" onKeyDown={(e) => e.key === "Escape" && (sourcePanel.value = null)}>
      <header>
        <span class="eyebrow">Source</span>
        <button class="icon" onClick={() => (sourcePanel.value = null)} aria-label="Close source panel" title="Close (Esc)">
          ×
        </button>
      </header>
      <h2>{s.title}</h2>
      {s.detail && <p class="lead">{s.detail}</p>}
      <dl class="facts">
        <dt>Published by</dt>
        <dd>
          {p.label}
          {p.url && (
            <>
              {" "}
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                open original ↗
              </a>
            </>
          )}
        </dd>
        <dt>Publisher's timestamp</dt>
        <dd>{local(p.publishedAt)}</dd>
        <dt>Collected by us</dt>
        <dd>{when(p.collectedAt)}</dd>
        <dt>Archived copy</dt>
        <dd>{p.rawKey ? <code>{p.rawKey}</code> : "not recorded (historical file)"}</dd>
        {p.sha256 && (
          <>
            <dt>SHA-256</dt>
            <dd>
              <code class="hash" title={p.sha256}>
                {p.sha256.slice(0, 16)}…
              </code>
            </dd>
          </>
        )}
      </dl>
      {p.note && <p class="note">{p.note}</p>}
      <p class="fine">
        We archive every page and file exactly as fetched before reading any numbers from it, and never edit the copy. Figures are statistics, not
        financial advice.
      </p>
    </aside>
  );
}
