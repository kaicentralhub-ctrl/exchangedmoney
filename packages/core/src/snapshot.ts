/**
 * Raw snapshot naming and metadata.
 * Layout: raw/{source}/{YYYY}/{MM}/{DD}/{timestamp}.{ext}  (+ ".meta.json" sidecar)
 * Timestamps are UTC and sortable; keys never collide for distinct runs.
 */

export interface SnapshotMeta {
  source: string;
  url: string;
  fetchedAt: string;
  httpStatus: number;
  contentType: string | null;
  bytes: number;
  sha256: string;
  collectorVersion: string;
}

export function snapshotKey(source: string, fetchedAt: Date, ext: string): string {
  if (!/^[a-z0-9-]+$/.test(source)) throw new Error(`invalid source id: ${source}`);
  const iso = fetchedAt.toISOString();
  const [date] = iso.split("T") as [string];
  const [y, m, d] = date.split("-");
  const stamp = iso.replace(/[:.]/g, "-");
  return `raw/${source}/${y}/${m}/${d}/${stamp}.${ext.replace(/^\./, "")}`;
}

export const metaKey = (rawKey: string): string => `${rawKey}.meta.json`;

/** Extension to store a response under, from its content type. */
export function extensionFor(contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("html")) return "html";
  if (ct.includes("csv")) return "csv";
  if (ct.includes("pdf")) return "pdf";
  return "bin";
}

/** Hex SHA-256 using Web Crypto (available in Workers and Node 20+). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Cast: under the DOM lib, a Uint8Array over ArrayBufferLike is not accepted, though it works at runtime.
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
