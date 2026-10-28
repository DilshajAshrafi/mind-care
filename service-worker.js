const CACHE_NAME = "mind-care-shell-v9";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/translation-catalog.js",
  "/app-config.js",
  "/script.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/service-worker.js",
  "/language-packs/as.json",
  "/language-packs/bn.json",
  "/language-packs/brx.json",
  "/language-packs/doi.json",
  "/language-packs/gu.json",
  "/language-packs/hi.json",
  "/language-packs/kn.json",
  "/language-packs/ks.json",
  "/language-packs/kok.json",
  "/language-packs/mai.json",
  "/language-packs/ml.json",
  "/language-packs/mni.json",
  "/language-packs/mr.json",
  "/language-packs/ne.json",
  "/language-packs/or.json",
  "/language-packs/pa.json",
  "/language-packs/sa.json",
  "/language-packs/sat.json",
  "/language-packs/sd.json",
  "/language-packs/ta.json",
  "/language-packs/te.json",
  "/language-packs/ur.json",
  "/language-packs/hinglish.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("mind-care-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }

  event.respondWith(caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request)));
});
