const CACHE_NAME = "running-society-github-v2-0-19";
const CORE_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "data/berlin.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/rs_icon_weiss.svg",
  "images/woche1.png",
  "images/woche2.png",
  "images/woche3.png",
  "images/woche4.png",
  "images/woche5.png",
  "images/woche6.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Browser-Erweiterungen und andere nicht unterstützte Schemes nie cachen.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Fremde Domains normal laden, aber nicht in den App-Cache schreiben.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request, { cache:"no-store" })
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
          );
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match("index.html"))
      )
  );
});
