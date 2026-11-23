import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceById, type SourceDefinition } from "@exm/core";
import { describe, expect, it } from "vitest";
import { collectSource, USER_AGENT } from "../src/collect.js";
import { checkHealth, healthMessage, tariffReminder } from "../src/health.js";
import { clock, fakeFetch, MemoryRawStore, MemoryWarehouse } from "./fakes.js";

const coreFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url)), "utf8");

const ecb = sourceById("ecb-daily")!;
const hsbc = sourceById("issuer-hsbc-uk")!;

function setup(handler: (url: string) => Response | Promise<Response>, start = "2026-11-23T16:30:00.000Z") {
  const raw = new MemoryRawStore();
  const warehouse = new MemoryWarehouse();
  const deps = { fetch: fakeFetch(handler), raw, warehouse, now: clock(start), collectorVersion: "test" };
  return { raw, warehouse, deps };
}

describe("collectSource", () => {
  it("archives raw, parses, stores rows and records an ok run", async () => {
    const { raw, warehouse, deps } = setup(() => new Response(coreFixture("ecb-daily.synthetic.xml"), { headers: { "content-type": "text/xml" } }));
    const run = await collectSource(ecb, deps);

    expect(run.status).toBe("ok");
    expect(run.observations).toBe(4);
    expect(run.changed).toBe(true);
    expect(run.rawKey).toMatch(/^raw\/ecb-daily\/2026\/11\/23\/.+\.xml$/);
    expect(raw.objects.size).toBe(1);
    const stored = raw.objects.get(run.rawKey!)!;
    expect(stored.meta).toMatchObject({ source: "ecb-daily", httpStatus: 200, contentType: "text/xml", sha256: run.sha256 });
    expect(warehouse.observations).toHaveLength(4);
    expect(warehouse.runs).toHaveLength(1);
  });

  it("flags unchanged content on the next run", async () => {
    const { deps } = setup(() => new Response(coreFixture("ecb-daily.synthetic.xml"), { headers: { "content-type": "text/xml" } }));
    await collectSource(ecb, deps);
    const second = await collectSource(ecb, deps);
    expect(second.changed).toBe(false);
  });

  it("identifies itself with a contact User-Agent", async () => {
    let seenUa: string | null = null;
    const raw = new MemoryRawStore();
    const warehouse = new MemoryWarehouse();
    const fetchSpy = (async (_url: string, init?: RequestInit) => {
      seenUa = new Headers(init?.headers).get("user-agent");
      return new Response("<Cube time='2026-11-20'><Cube currency='USD' rate='1.08'/></Cube>");
    }) as typeof fetch;
    await collectSource(ecb, { fetch: fetchSpy, raw, warehouse, now: clock("2026-11-23T00:00:00Z"), collectorVersion: "t" });
    expect(seenUa).toBe(USER_AGENT);
  });

  it("parses issuer markups end to end", async () => {
    const { warehouse, deps } = setup(() => new Response(coreFixture("hsbc-cbpr.synthetic.html"), { headers: { "content-type": "text/html" } }));
    const run = await collectSource(hsbc, deps);
    expect(run.status).toBe("parse_warning"); // fixture includes an unknown currency label on purpose
    expect(warehouse.markups.length).toBe(29);
  });

  it("archives the body of an HTTP error but stores no rows", async () => {
    const { raw, warehouse, deps } = setup(() => new Response("Service Unavailable", { status: 503, headers: { "content-type": "text/html" } }));
    const run = await collectSource(ecb, deps);
    expect(run).toMatchObject({ status: "http_error", httpStatus: 503, error: "HTTP 503" });
    expect(raw.objects.size).toBe(1);
    expect(warehouse.observations).toHaveLength(0);
  });

  it("records a layout change as parse_empty", async () => {
    const { deps } = setup(() => new Response("<html>we moved</html>", { headers: { "content-type": "text/html" } }));
    const run = await collectSource(hsbc, deps);
    expect(run.status).toBe("parse_empty");
    expect(run.warnings.some((w) => /layout may have changed/.test(w))).toBe(true);
  });

  it("records network failures without throwing", async () => {
    const { raw, deps } = setup(() => {
      throw new TypeError("network down");
    });
    const run = await collectSource(ecb, deps);
    expect(run).toMatchObject({ status: "fetch_error", error: "network down", rawKey: null });
    expect(raw.objects.size).toBe(0);
  });

  it("keeps the raw snapshot when the warehouse is down", async () => {
    const { raw, warehouse, deps } = setup(() => new Response(coreFixture("ecb-daily.synthetic.xml")));
    warehouse.failWrites = true;
    const run = await collectSource(ecb, deps);
    expect(raw.objects.size).toBe(1);
    expect(run.error).toMatch(/warehouse write failed/);
  });
});

describe("health", () => {
  const sources: SourceDefinition[] = [ecb, hsbc];

  it("is healthy right after successful runs", async () => {
    const { warehouse, deps } = setup((url) =>
      url.includes("ecb") ? new Response(coreFixture("ecb-daily.synthetic.xml")) : new Response(coreFixture("hsbc-cbpr.synthetic.html")),
    );
    await collectSource(ecb, deps);
    await collectSource(hsbc, deps);
    const report = await checkHealth(warehouse, new Date("2026-11-24T09:00:00Z"), sources);
    expect(report.every((r) => !r.stale)).toBe(true);
    expect(healthMessage(report)).toBeNull();
  });

  it("flags sources that never succeeded or went quiet", async () => {
    const { warehouse, deps } = setup(() => new Response(coreFixture("ecb-daily.synthetic.xml")), "2026-11-20T16:30:00Z");
    await collectSource(ecb, deps);
    const report = await checkHealth(warehouse, new Date("2026-11-25T09:00:00Z"), sources);
    expect(report.find((r) => r.source === "ecb-daily")?.stale).toBe(true); // ~113h > 80h
    expect(report.find((r) => r.source === "issuer-hsbc-uk")?.lastSuccess).toBeNull();
    expect(healthMessage(report)).toMatch(/issuer-hsbc-uk: no successful run yet/);
  });
});

describe("fee schedule reminders", () => {
  const products = [{ id: "x/y", issuer: "Bank", name: "Card", cardType: "debit", segment: "personal", networks: ["visa"], markupMatch: { purchase: "x", atm: "x" }, fees: [], caveats: [], sources: [{ label: "l", url: "https://e.test", checkedAt: "2026-01-05" }] }] as const;
  it("lists overdue schedules on Mondays only", () => {
    expect(tariffReminder(new Date("2026-11-23T09:00:00Z"), products as never)).toMatch(/Bank: Card \(last checked 2026-01-05\)/); // a Monday
    expect(tariffReminder(new Date("2026-11-24T09:00:00Z"), products as never)).toBeNull();
    expect(tariffReminder(new Date("2026-02-02T09:00:00Z"), products as never)).toBeNull(); // not yet 90 days
  });
});

