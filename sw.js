// Offline cache for the compass. Bump VERSION when files change.
const VERSION = "compass-v22";
const CORE = ["./", "index.html", "manifest.webmanifest", "scoring.js", "data/compass.json", "data/party_logos.json", "data/education_minister_2026.json", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first, so updated questions and positions arrive; cache as fallback when offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    // Revalidate with the server so a new deploy shows up right away, not after the HTTP cache expires.
    fetch(e.request, new URL(e.request.url).origin === self.location.origin ? { cache: "no-cache" } : undefined)
      .then(res => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
