/* Service worker ЕГЭ·ПРО: кэширует только /assets/* (хешированные бандлы Vite).
   HTML, API и всё остальное — сеть напрямую, без offline-shell и без перехвата. */
const CACHE = "ege-pro-assets-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/assets/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const resp = await fetch(event.request);
      if (resp.ok) cache.put(event.request, resp.clone());
      return resp;
    })
  );
});
