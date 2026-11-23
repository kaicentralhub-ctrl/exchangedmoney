/** RFC 4180 CSV with a header row; formula-looking cells are prefixed so spreadsheets don't execute them. */
export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function download(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
