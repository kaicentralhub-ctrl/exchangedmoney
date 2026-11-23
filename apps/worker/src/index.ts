import { sourcesFor } from "@exm/core";
import { collectSource, type CollectDeps } from "./collect.js";
import { CRON_JOBS, type Env } from "./env.js";
import { checkHealth, healthMessage } from "./health.js";
import { notify } from "./notify.js";
import { R2PublishStore, publishBundles, serveData } from "./publish.js";
import { D1Warehouse, R2RawStore } from "./storage.js";
import { D1SubscriberStore, handleSubscribe } from "./subscribe.js";

function deps(env: Env): CollectDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    raw: new R2RawStore(env.SNAPSHOTS),
    warehouse: new D1Warehouse(env.DB),
    now: () => new Date(),
    collectorVersion: env.COLLECTOR_VERSION,
  };
}

async function runJob(job: "daily-morning" | "daily-ecb" | "health", env: Env): Promise<void> {
  const d = deps(env);
  if (job === "health") {
    const message = healthMessage(await checkHealth(d.warehouse, d.now()));
    if (message) await notify(env.NTFY_URL, "exchangedmoney: collector stale", message);
    return;
  }
  // One source at a time keeps us polite and well inside subrequest limits.
  const failures: string[] = [];
  for (const source of sourcesFor(job)) {
    const run = await collectSource(source, d);
    if (run.status !== "ok" && run.status !== "parse_warning") failures.push(`${source.id}: ${run.status} ${run.error ?? ""}`.trim());
  }
  // Publish whatever we have, even after a failure: the app should see the freshest good data.
  try {
    await publishBundles(new R2PublishStore(env.PUBLISHED), new D1Warehouse(env.DB), d.now(), { history: job === "daily-ecb" });
  } catch (err) {
    failures.push(`publish: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (failures.length) await notify(env.NTFY_URL, "exchangedmoney: collection problem", failures.join("\n"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/subscribe") return handleSubscribe(request, new D1SubscriberStore(env.DB));
    if (url.pathname === "/api/health") {
      const report = await checkHealth(new D1Warehouse(env.DB), new Date());
      return Response.json({ ok: report.every((r) => !r.stale), sources: report }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/data/")) return serveData(request, env.PUBLISHED);
    if (url.pathname.startsWith("/api/")) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = CRON_JOBS[controller.cron];
    if (!job) {
      console.error(`no job mapped to cron "${controller.cron}"`);
      return;
    }
    ctx.waitUntil(runJob(job, env));
  },
} satisfies ExportedHandler<Env>;
