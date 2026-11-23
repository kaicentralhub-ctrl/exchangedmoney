/**
 * POST /api/subscribe  — alert sign-ups from the holding page.
 * Stores a pending subscriber; no email is sent until a provider is wired up for double opt-in.
 * Same response whether or not the address already exists (no account enumeration).
 */

export const CONSENT_VERSION = "2026-11-23";
const ALLOWED_INTERESTS = new Set(["card-league", "rate-alerts", "pay-in-which-currency", "street-rates"]);

export interface SubscriberStore {
  addPending(email: string, interests: string[], consentVersion: string, createdAt: string, token: string): Promise<void>;
}

export class D1SubscriberStore implements SubscriberStore {
  constructor(private db: D1Database) {}
  async addPending(email: string, interests: string[], consentVersion: string, createdAt: string, token: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO subscribers (email, interests, consent_version, created_at, token)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`,
      )
      .bind(email, JSON.stringify(interests), consentVersion, createdAt, token)
      .run();
  }
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/.test(email);
}

export async function handleSubscribe(request: Request, store: SubscriberStore, now: () => Date = () => new Date()): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const isForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  let fields: Record<string, unknown>;
  try {
    fields = isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  if (!fields || typeof fields !== "object") return json({ ok: false, error: "bad_request" }, 400);

  // Honeypot: real people never fill the hidden "website" field.
  if (typeof fields.website === "string" && fields.website.trim() !== "") return done(isForm);

  const email = String(fields.email ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) return isForm ? redirect("/?signup=invalid") : json({ ok: false, error: "invalid_email" }, 400);

  const rawInterests = Array.isArray(fields.interests) ? fields.interests : String(fields.interests ?? "").split(",");
  const interests = rawInterests.map((i) => String(i).trim()).filter((i) => ALLOWED_INTERESTS.has(i));

  await store.addPending(email, interests, CONSENT_VERSION, now().toISOString(), crypto.randomUUID());
  return done(isForm);
}

const done = (isForm: boolean) => (isForm ? redirect("/thanks.html") : json({ ok: true }, 200));
const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
