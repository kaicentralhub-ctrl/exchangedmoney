/**
 * Data loading. The manifest is small and re-fetched; bundles are content-hashed and
 * fetched once (the service worker keeps them for offline use).
 */
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { MANIFEST_PATH, type Manifest } from "@exm/core/bundles";

export const manifest = signal<Manifest | null>(null);
export const manifestError = signal<string | null>(null);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadManifest(): Promise<void> {
  try {
    manifest.value = await getJson<Manifest>(`/${MANIFEST_PATH}`);
    manifestError.value = null;
  } catch (err) {
    manifestError.value = err instanceof Error ? err.message : String(err);
  }
}

const cache = new Map<string, Promise<unknown>>();

export function loadBundle<T>(name: string): Promise<T> {
  const entry = manifest.value?.files[name];
  if (!entry) return Promise.reject(new Error(`No published data called “${name}” yet.`));
  let p = cache.get(entry.path);
  if (!p) {
    p = getJson<T>(`/${entry.path}`);
    p.catch(() => cache.delete(entry.path));
    cache.set(entry.path, p);
  }
  return p as Promise<T>;
}

export type Loaded<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; data: T };

/** Load one or more bundles by name; re-runs when the manifest points at new files. */
export function useBundles<T extends unknown[]>(names: string[]): Loaded<T> {
  const m = manifest.value;
  const key = names.map((n) => m?.files[n]?.path ?? `?${n}`).join("|");
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    if (!m) return;
    let live = true;
    setResult({ state: "loading" });
    Promise.all(names.map((n) => loadBundle(n)))
      .then((data) => live && setResult({ state: "ready", data: data as T }))
      .catch((err: unknown) => live && setResult({ state: "error", error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [key]);
  return m ? result : manifestError.value ? { state: "error", error: manifestError.value } : { state: "loading" };
}
