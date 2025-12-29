const CACHE_NAME = "pontoview-vyre-v3";
const ASSETS = [
  "./",
  "./painel.html",
  "./sw.js",
  "./data/news.json",
  "./data/tips.json",
  "./data/campaigns.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((networkResp) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResp.clone()));
        return networkResp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
