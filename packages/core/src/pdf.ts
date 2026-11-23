import { getDocumentProxy } from "unpdf";

interface TextItem {
  str: string;
  transform: number[];
}

/**
 * Extract a PDF's text as visual lines: items sharing a baseline (within `tolerance` points)
 * are joined left to right. Good enough for tabular disclosures; not a general layout engine.
 */
export async function pdfToLines(bytes: Uint8Array, tolerance = 2): Promise<string[]> {
  // pdf.js may take ownership of the buffer, so hand it a copy.
  const pdf = await getDocumentProxy(bytes.slice());
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === "string" && Array.isArray((i as TextItem).transform));
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const item of items) {
      if (!item.str.trim()) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      let row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: item.str });
    }
    rows.sort((a, b) => b.y - a.y); // PDF y grows upwards
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join(" "));
  }
  await (pdf as { destroy?: () => Promise<void> }).destroy?.();
  return lines;
}
