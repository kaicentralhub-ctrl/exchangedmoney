import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, handleSubscribe, isValidEmail } from "../src/subscribe.js";
import { MemorySubscriberStore } from "./fakes.js";

const post = (body: unknown, form = false) =>
  new Request("https://exchangedmoney.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
  });

describe("subscribe", () => {
  it("stores a pending subscriber with consent version and allowed interests only", async () => {
    const store = new MemorySubscriberStore();
    const res = await handleSubscribe(post({ email: " Kai@Example.com ", interests: ["card-league", "bogus"] }), store);
    expect(res.status).toBe(200);
    expect(store.rows).toEqual([{ email: "kai@example.com", interests: ["card-league"], consentVersion: CONSENT_VERSION }]);
  });

  it("gives the same answer for an existing address", async () => {
    const store = new MemorySubscriberStore();
    await handleSubscribe(post({ email: "a@b.co" }), store);
    const again = await handleSubscribe(post({ email: "a@b.co" }), store);
    expect(again.status).toBe(200);
    expect(store.rows).toHaveLength(1);
  });

  it("rejects invalid addresses", async () => {
    const res = await handleSubscribe(post({ email: "not-an-email" }), new MemorySubscriberStore());
    expect(res.status).toBe(400);
  });

  it("silently drops honeypot submissions", async () => {
    const store = new MemorySubscriberStore();
    const res = await handleSubscribe(post({ email: "bot@spam.com", website: "http://spam" }), store);
    expect(res.status).toBe(200);
    expect(store.rows).toHaveLength(0);
  });

  it("supports plain HTML form posts with a redirect", async () => {
    const store = new MemorySubscriberStore();
    const res = await handleSubscribe(post({ email: "form@example.org", interests: "rate-alerts,card-league" }, true), store);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/thanks.html");
    expect(store.rows[0]?.interests).toEqual(["rate-alerts", "card-league"]);
  });

  it("rejects other methods and malformed bodies", async () => {
    expect((await handleSubscribe(new Request("https://x/api/subscribe"), new MemorySubscriberStore())).status).toBe(405);
    const bad = new Request("https://x/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await handleSubscribe(bad, new MemorySubscriberStore())).status).toBe(400);
  });

  it.each([
    ["kai@exchangedmoney.com", true],
    ["a.b+tag@sub.example.co.uk", true],
    ["no-at-sign", false],
    ["two@@at.com", false],
    ["spaces in@x.com", false],
    [`${"a".repeat(250)}@x.com`, false],
  ])("isValidEmail(%s) = %s", (email, ok) => {
    expect(isValidEmail(email)).toBe(ok);
  });
});
