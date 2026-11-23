import { describe, expect, it } from "vitest";
import { handleAdmin, safeEqual, type AdminJob } from "../src/admin.js";

const TOKEN = "a".repeat(64);
const call = async (opts: { token?: string; method?: string; auth?: string; job?: string }) => {
  const ran: AdminJob[] = [];
  const waits: Promise<unknown>[] = [];
  const req = new Request(`https://x.test/api/admin/run${opts.job ? `?job=${opts.job}` : ""}`, {
    method: opts.method ?? "POST",
    headers: opts.auth ? { authorization: opts.auth } : {},
  });
  const res = await handleAdmin(req, "token" in opts ? opts.token : TOKEN, async (j) => void ran.push(j), (p) => void waits.push(p));
  await Promise.all(waits);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, ran };
};

describe("admin endpoint", () => {
  it("doesn't exist without a strong token configured", async () => {
    expect((await call({ token: undefined, auth: "Bearer x", job: "publish" })).status).toBe(404);
    expect((await call({ token: "short", auth: "Bearer short", job: "publish" })).status).toBe(404);
  });
  it("rejects other methods, missing or wrong tokens, and unknown jobs", async () => {
    expect((await call({ method: "GET", auth: `Bearer ${TOKEN}`, job: "publish" })).status).toBe(405);
    expect((await call({ job: "publish" })).status).toBe(401);
    expect((await call({ auth: `Bearer ${"b".repeat(64)}`, job: "publish" })).status).toBe(401);
    const bad = await call({ auth: `Bearer ${TOKEN}`, job: "drop-tables" });
    expect(bad.status).toBe(400);
    expect(bad.ran).toEqual([]);
  });
  it("starts the job in the background and answers 202", async () => {
    const r = await call({ auth: `Bearer ${TOKEN}`, job: "daily-ecb" });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ ok: true, job: "daily-ecb" });
    expect(r.ran).toEqual(["daily-ecb"]);
  });
  it("compares tokens safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
