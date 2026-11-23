/**
 * Tiny router: the URL is the single source of truth for what is on screen.
 * Path picks the workspace; query parameters hold every filter, so any view can be shared.
 */
import { computed, signal } from "@preact/signals";

export const BASE = "/app";

function currentPath(): string {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  return p.replace(/\/+$/, "") || "/";
}

export const route = signal({ path: currentPath(), search: location.search });
const sync = () => (route.value = { path: currentPath(), search: location.search });
addEventListener("popstate", sync);

export const path = computed(() => route.value.path);
export const params = computed(() => new URLSearchParams(route.value.search));

export function href(to: string, query?: Record<string, string>): string {
  const qs = query ? new URLSearchParams(query).toString() : "";
  return `${BASE}${to === "/" ? "/" : to}${qs ? `?${qs}` : ""}`;
}

export function navigate(to: string, query?: Record<string, string>): void {
  history.pushState(null, "", href(to, query));
  sync();
  scrollTo({ top: 0 });
}

/** Read a query parameter, falling back to a default (defaults never appear in the URL). */
export function param(key: string, fallback: string): string {
  return params.value.get(key) ?? fallback;
}

/** Set query parameters in place (no new history entry); a value equal to its default is removed. */
export function setParams(values: Record<string, { value: string; fallback: string }>): void {
  const p = new URLSearchParams(location.search);
  for (const [key, { value, fallback }] of Object.entries(values)) {
    if (value === fallback || value === "") p.delete(key);
    else p.set(key, value);
  }
  const qs = p.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
  sync();
}

export const setParam = (key: string, value: string, fallback: string) => setParams({ [key]: { value, fallback } });
