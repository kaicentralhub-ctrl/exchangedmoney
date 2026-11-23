/**
 * POST /api/admin/run?job=… with "Authorization: Bearer <ADMIN_TOKEN>" starts a job now,
 * instead of waiting for its cron. Used by the go-live script for the first collection.
 * Without ADMIN_TOKEN set, the endpoint doesn't exist.
 */
export const ADMIN_JOBS = ["daily-morning", "daily-ecb", "health", "publish"] as const;
export type AdminJob = (typeof ADMIN_JOBS)[number];

/** Compares without leaking where the strings differ through timing. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function handleAdmin(
  request: Request,
  token: string | undefined,
  run: (job: AdminJob) => Promise<void>,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  if (!token || token.length < 32) return json(404, { ok: false, error: "not_found" });
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, token)) return json(401, { ok: false, error: "unauthorised" });
  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!(ADMIN_JOBS as readonly string[]).includes(job)) return json(400, { ok: false, error: "unknown_job", jobs: ADMIN_JOBS });
  waitUntil(run(job as AdminJob).catch((err) => console.error(`admin job ${job} failed`, err)));
  return json(202, { ok: true, job, started: new Date().toISOString() });
}
