/** Simple subsequence scoring: every typed character must appear in order. */
export function score(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let gaps = 0;
  for (const ch of q.replace(/\s+/g, "")) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    gaps += found - ti;
    ti = found + 1;
  }
  return Math.max(1, 50 - gaps);
}
