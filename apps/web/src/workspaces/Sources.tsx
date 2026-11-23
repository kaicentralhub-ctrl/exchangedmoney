import { ago, when } from "../lib/format.js";
import { manifest, manifestError } from "../state/data.js";
import { Loading, Notice } from "../ui/bits.js";

export function Sources() {
  const m = manifest.value;
  if (!m) return manifestError.value ? <Notice kind="error">{manifestError.value}</Notice> : <Loading what="sources" />;
  const now = Date.now();
  const files = Object.entries(m.files);
  const history = files.filter(([n]) => n.startsWith("history/"));
  const other = files.filter(([n]) => !n.startsWith("history/"));
  const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
  return (
    <section class="ws">
      <header class="ws-head">
        <div>
          <h1>Sources</h1>
          <p class="sub">
            Every number in exchangedmoney comes from one of these public sources. We fetch each once per run, archive the page or file exactly as received, then read the
            numbers from the archived copy.
          </p>
        </div>
      </header>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Source</th>
              <th>Last collected</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {m.sources.map((s) => {
              const age = s.lastSuccess ? (now - Date.parse(s.lastSuccess)) / 3_600_000 : Infinity;
              const stale = age > s.maxAgeHours;
              return (
                <tr key={s.id}>
                  <td>
                    <span class="strong">{s.label}</span>
                    <br />
                    <a class="muted" href={s.url} target="_blank" rel="noopener noreferrer">
                      {new URL(s.url).hostname} ↗
                    </a>
                  </td>
                  <td>
                    {when(s.lastSuccess)} <span class="muted">({ago(s.lastSuccess, now)})</span>
                  </td>
                  <td>{stale ? <span class="pill warn">Overdue</span> : <span class="pill ok">Current</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2 class="h2">Published data</h2>
      <p class="sub">
        The app loads these files and does every calculation on your device. Data last published {when(m.generatedAt)}.
      </p>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>File</th>
              <th class="num">Size</th>
              <th>Fingerprint</th>
            </tr>
          </thead>
          <tbody>
            {other.map(([name, f]) => (
              <tr key={name}>
                <td class="strong">{name}</td>
                <td class="num">{kb(f.bytes)}</td>
                <td>
                  <code>{f.sha256.slice(0, 16)}</code>
                </td>
              </tr>
            ))}
            {history.length > 0 && (
              <tr>
                <td class="strong">history (ECB, {history.length} currencies)</td>
                <td class="num">{kb(history.reduce((a, [, f]) => a + f.bytes, 0))}</td>
                <td class="muted">one file per currency</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
