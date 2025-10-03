// service-worker.js

// ⚡ Update this version when you deploy new assets
const CACHE_VERSION = "v2";
const CACHE_NAME = `easyweather-${CACHE_VERSION}`;

const APP_SHELL = [
  "/",
  "/manifest.json",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/offline.html"
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Network-first for CSS/JS/HTML (so updates appear without hard refresh)
  if (
    req.destination === "style" ||
    req.destination === "script" ||
    req.destination === "document"
  ) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 2. Cache-first for images/icons
  if (req.destination === "image" || req.destination === "icon") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 3. Default: try network, fallback to cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((res) => res || caches.match("/offline.html")))
  );
});

// --- Helpers ---
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    return cached || (req.mode === "navigate" ? caches.match("/offline.html") : null);
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  cache.put(req, res.clone());
  return res;
}
