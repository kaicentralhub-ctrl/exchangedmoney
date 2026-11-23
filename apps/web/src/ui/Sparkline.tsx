import { num } from "../lib/format.js";

/** A small line of the series with its first and last values; no axes, for at-a-glance shape. */
export function Sparkline({ points, label }: { points: { date: string; rate: number }[]; label: string }) {
  const vals = points.map((p) => p.rate);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const w = 600;
  const h = 80;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 4 - ((p.rate - lo) / span) * (h - 8)).toFixed(1)}`).join("");
  const first = points[0]!;
  const last = points.at(-1)!;
  return (
    <figure class="spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${label}: from ${num(first.rate)} on ${first.date} to ${num(last.rate)} on ${last.date}`}>
        <path d={d} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span>
          {first.date} · {num(first.rate)}
        </span>
        <span>
          low {num(lo)} · high {num(hi)}
        </span>
        <span>
          {last.date} · {num(last.rate)}
        </span>
      </figcaption>
    </figure>
  );
}
