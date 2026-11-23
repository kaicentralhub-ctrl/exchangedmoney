/*
 * exchangedmoney offline support.
 * - App shell: network first, cached copy when offline.
 * - /app/assets/* and hashed /data/* files: cache first (their names change when their content does).
 * - /data/manifest.json: network first; after each fresh copy, data files it no longer lists are dropped.
 */
const SHELL = "exm-shell-v1";
const DATA = "exm-data-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (![SHELL, DATA].includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName, key = request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function pruneData(manifestResponse) {
  try {
    const manifest = await manifestResponse.json();
    const keep = new Set(Object.values(manifest.files).map((f) => new URL(`/${f.path}`, self.location.origin).href));
    const cache = await caches.open(DATA);
    for (const req of await cache.keys()) {
      const url = new URL(req.url);
      if (url.pathname !== "/data/manifest.json" && !keep.has(url.href)) await cache.delete(req);
    }
  } catch {
    /* a bad manifest never breaks the app */
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname === "/data/manifest.json") {
    event.respondWith(
      networkFirst(request, DATA).then((res) => {
        if (res.ok) event.waitUntil(pruneData(res.clone()));
        return res;
      }),
    );
  } else if (url.pathname.startsWith("/data/")) {
    event.respondWith(cacheFirst(request, DATA));
  } else if (url.pathname.startsWith("/app/assets/")) {
    event.respondWith(cacheFirst(request, SHELL));
  } else if (request.mode === "navigate" && url.pathname.startsWith("/app")) {
    event.respondWith(networkFirst(request, SHELL, "/app/"));
  }
});
