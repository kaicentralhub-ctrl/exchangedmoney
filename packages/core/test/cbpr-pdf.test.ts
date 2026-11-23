import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCbprPdfLines, parseUsTimestamp, pdfToLines, productsFor, type IssuerMarkup } from "../src/index.js";

const lines = readFileSync(fileURLToPath(new URL("./fixtures/cbpr-pdf.synthetic.txt", import.meta.url)), "utf8").split("\n");

describe("CBPR PDF lines (first direct template)", () => {
  const r = parseCbprPdfLines(lines, "first direct");
  const pick = (q: Partial<IssuerMarkup>) => r.markups.filter((m) => Object.entries(q).every(([k, v]) => m[k as keyof IssuerMarkup] === v));

  it("reads every section with the right columns", () => {
    expect(pick({ segment: "personal", context: "atm" })).toHaveLength(12); // EUR + CHF x 6 (HRK all #N/A)
    expect(pick({ segment: "personal", context: "purchase" })).toHaveLength(8);
    expect(pick({ segment: "business", context: "atm" })).toHaveLength(2);
    expect(pick({ segment: "business", context: "purchase" })).toHaveLength(2);
  });

  it("maps columns to products, networks and card types", () => {
    const [m] = pick({ segment: "personal", context: "atm", currency: "CHF", product: "Mastercard debit card for Bank Account" });
    expect(m).toMatchObject({ network: "mastercard", cardType: "debit", markupPct: 5 });
    expect(pick({ currency: "BGN", product: "Mastercard credit card" })[0]?.markupPct).toBe(6.9);
    expect(pick({ segment: "business", context: "atm", product: "VISA credit card" })[0]?.markupPct).toBe(6.1);
  });

  it("keeps negative markups and skips withdrawn currencies", () => {
    expect(pick({ currency: "CHF", product: "VISA debit card for Premier/Advance" })[0]?.markupPct).toBe(-0.1);
    expect(pick({ currency: "HRK" })).toHaveLength(0);
  });

  it("stamps every row with the PDF timestamp", () => {
    expect(r.markups.every((m) => m.publishedAt === "2026-11-21T00:08")).toBe(true);
  });

  it("ignores prose that mentions the networks, and warns on unknown labels only", () => {
    expect(r.warnings).toEqual(["unrecognised currency label: Mystery Money"]);
  });

  it("reports a changed layout", () => {
    expect(parseCbprPdfLines(["Some other document"], "x").warnings).toContain("no markup tables found; PDF layout may have changed");
  });

  it("warns when the column count doesn't fit the networks", () => {
    const odd = parseCbprPdfLines(["Personal Card", "Using an ATM", "VISA Mastercard", "EURO 1.00% 2.00% 3.00%"], "x");
    expect(odd.markups).toHaveLength(0);
    expect(odd.warnings.some((w) => w.startsWith("can't map 3 columns"))).toBe(true);
  });
});

describe("helpers", () => {
  it("productsFor", () => {
    expect(productsFor(["visa"], 2)).toEqual(["VISA debit card", "VISA credit card"]);
    expect(productsFor(["visa", "mastercard"], 6)?.[3]).toBe("Mastercard debit card for Premier/Advance");
    expect(productsFor([], 2)).toBeNull();
    expect(productsFor(["visa"], 5)).toBeNull();
  });

  it.each([
    ["11/21/2026-12:08 AM", "2026-11-21T00:08"],
    ["1/5/2027-1:30 PM", "2027-01-05T13:30"],
    ["12/31/2026-12:00 PM", "2026-12-31T12:00"],
    ["no date", null],
  ])("parseUsTimestamp(%s)", (input, expected) => {
    expect(parseUsTimestamp(input)).toBe(expected);
  });
});

/** Build a minimal one-page PDF with text drawn at absolute positions. */
function makePdf(items: { x: number; y: number; text: string }[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = items.map((i) => `BT /F1 10 Tf ${i.x} ${i.y} Td (${esc(i.text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("pdfToLines", () => {
  const pdf = makePdf([
    { x: 50, y: 760, text: "Personal Card" },
    { x: 50, y: 740, text: "Making a purchase e.g. in a shop" },
    { x: 200, y: 720, text: "Mastercard" },
    { x: 100, y: 720, text: "VISA" },
    { x: 300, y: 700, text: "2.80%" },
    { x: 50, y: 700, text: "EURO" },
    { x: 150, y: 700, text: "2.90%" },
    { x: 220, y: 700, text: "3.10%" },
    { x: 380, y: 700, text: "3.00%" },
    { x: 50, y: 40, text: "11/21/2026-12:08 AM" },
  ]);

  it("joins items on a baseline left to right, top to bottom", async () => {
    const out = await pdfToLines(pdf);
    expect(out).toEqual(["Personal Card", "Making a purchase e.g. in a shop", "VISA Mastercard", "EURO 2.90% 3.10% 2.80% 3.00%", "11/21/2026-12:08 AM"]);
  });

  it("feeds the parser end to end", async () => {
    const r = parseCbprPdfLines(await pdfToLines(pdf), "first direct");
    expect(r.warnings).toEqual([]);
    expect(r.markups.map((m) => [m.product, m.markupPct])).toEqual([
      ["VISA debit card", 2.9],
      ["VISA credit card", 3.1],
      ["Mastercard debit card", 2.8],
      ["Mastercard credit card", 3],
    ]);
  });
});
