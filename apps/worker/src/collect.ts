import { extensionFor, sha256Hex, snapshotKey, type SnapshotMeta, type SourceDefinition } from "@exm/core";
import type { RawStore, RunRecord, RunStatus, Warehouse } from "./storage.js";

export const USER_AGENT = "exchangedmoney-collector/0.1 (+https://exchangedmoney.com/collector.html)";

export interface CollectDeps {
  fetch: typeof fetch;
  raw: RawStore;
  warehouse: Warehouse;
  now: () => Date;
  collectorVersion: string;
  timeoutMs?: number;
}

/**
 * Collect one source: fetch -> archive raw (always, if we got a body) -> parse -> store rows -> record run.
 * Never throws: every outcome becomes a run record so the health check can see it.
 */
export async function collectSource(source: SourceDefinition, deps: CollectDeps): Promise<RunRecord> {
  const started = deps.now();
  const base: Omit<RunRecord, "finishedAt" | "status"> = {
    source: source.id,
    startedAt: started.toISOString(),
    httpStatus: null,
    rawKey: null,
    sha256: null,
    bytes: null,
    changed: null,
    observations: 0,
    markups: 0,
    warnings: [],
    error: null,
  };

  let response: Response;
  let body: ArrayBuffer;
  try {
    response = await deps.fetch(source.url, {
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
      redirect: "follow",
    });
    body = await response.arrayBuffer();
  } catch (err) {
    return finish(deps, { ...base, status: "fetch_error", error: errorMessage(err) });
  }

  const contentType = response.headers.get("content-type");
  const sha256 = await sha256Hex(body);
  const rawKey = snapshotKey(source.id, started, extensionFor(contentType));
  const meta: SnapshotMeta = {
    source: source.id,
    url: source.url,
    fetchedAt: started.toISOString(),
    httpStatus: response.status,
    contentType,
    bytes: body.byteLength,
    sha256,
    collectorVersion: deps.collectorVersion,
  };

  const archived = { ...base, httpStatus: response.status, rawKey, sha256, bytes: body.byteLength };
  try {
    archived.changed = (await deps.warehouse.lastSha(source.id)) !== sha256;
    await deps.raw.put(rawKey, body, meta);
  } catch (err) {
    return finish(deps, { ...archived, rawKey: null, status: "fetch_error", error: `archive failed: ${errorMessage(err)}` });
  }

  if (!response.ok) {
    return finish(deps, { ...archived, status: "http_error", error: `HTTP ${response.status}` });
  }

  let parsed;
  try {
    parsed = await source.parse(new TextDecoder().decode(body), new Uint8Array(body));
  } catch (err) {
    // Parsers shouldn't throw, but a corrupt PDF can make the PDF library do so. Raw is already safe.
    return finish(deps, { ...archived, status: "parse_empty", warnings: [`parser threw: ${errorMessage(err)}`] });
  }
  const status: RunStatus =
    parsed.observations.length + parsed.markups.length === 0 ? "parse_empty" : parsed.warnings.length ? "parse_warning" : "ok";

  return finish(
    deps,
    { ...archived, status, observations: parsed.observations.length, markups: parsed.markups.length, warnings: parsed.warnings },
    async (runId, collectedAt) => {
      await deps.warehouse.insertObservations(parsed.observations, runId, collectedAt);
      await deps.warehouse.insertMarkups(parsed.markups, runId, collectedAt);
    },
  );
}

async function finish(
  deps: CollectDeps,
  run: Omit<RunRecord, "finishedAt">,
  afterRecord?: (runId: number, collectedAt: string) => Promise<void>,
): Promise<RunRecord> {
  const record: RunRecord = { ...run, finishedAt: deps.now().toISOString() };
  try {
    const runId = await deps.warehouse.recordRun(record);
    if (afterRecord) await afterRecord(runId, record.finishedAt);
  } catch (err) {
    // The raw snapshot is safe in R2; derived rows can be rebuilt from it later.
    record.error = [record.error, `warehouse write failed: ${errorMessage(err)}`].filter(Boolean).join("; ");
    console.error(`[${record.source}] ${record.error}`);
  }
  console.log(`[${record.source}] ${record.status} obs=${record.observations} markups=${record.markups} changed=${record.changed}`);
  return record;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
