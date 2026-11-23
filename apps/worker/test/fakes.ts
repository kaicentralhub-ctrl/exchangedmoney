import type { IssuerMarkup, RateObservation, SnapshotMeta } from "@exm/core";
import type { RawStore, RunRecord, Warehouse } from "../src/storage.js";
import type { SubscriberStore } from "../src/subscribe.js";

export class MemoryRawStore implements RawStore {
  objects = new Map<string, { body: ArrayBuffer; meta: SnapshotMeta }>();
  async put(key: string, body: ArrayBuffer, meta: SnapshotMeta): Promise<void> {
    if (this.objects.has(key)) throw new Error(`refusing to overwrite existing snapshot ${key}`);
    this.objects.set(key, { body, meta });
  }
}

export class MemoryWarehouse implements Warehouse {
  runs: (RunRecord & { id: number })[] = [];
  observations: RateObservation[] = [];
  markups: IssuerMarkup[] = [];
  failWrites = false;

  async lastSha(source: string) {
    return [...this.runs].reverse().find((r) => r.source === source && r.sha256)?.sha256 ?? null;
  }
  async lastSuccess(source: string) {
    return [...this.runs].reverse().find((r) => r.source === source && (r.status === "ok" || r.status === "parse_warning"))?.finishedAt ?? null;
  }
  async recordRun(run: RunRecord) {
    if (this.failWrites) throw new Error("D1 unavailable");
    const id = this.runs.length + 1;
    this.runs.push({ ...run, id });
    return id;
  }
  async insertObservations(rows: RateObservation[]) {
    this.observations.push(...rows);
  }
  async insertMarkups(rows: IssuerMarkup[]) {
    this.markups.push(...rows);
  }
}

export class MemorySubscriberStore implements SubscriberStore {
  rows: { email: string; interests: string[]; consentVersion: string }[] = [];
  async addPending(email: string, interests: string[], consentVersion: string) {
    if (!this.rows.some((r) => r.email === email)) this.rows.push({ email, interests, consentVersion });
  }
}

/** A fixed clock that advances 1 second per call, so start/finish differ. */
export function clock(startIso: string): () => Date {
  let t = Date.parse(startIso);
  return () => new Date((t += 1000));
}

export function fakeFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input instanceof Request ? input.url : input))) as typeof fetch;
}
