const CACHE_NAME = "cloudie-shell-v1";
const SHELL = ["/", "/offline", "/manifest.json"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))); self.clients.claim(); });
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // Never cache/replay charges or other mutations.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(request).then((response) => { if (response.ok && (request.mode === "navigate" || SHELL.includes(url.pathname))) { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); } return response; }).catch(async () => (await caches.match(request)) || (request.mode === "navigate" ? (await caches.match("/offline")) : Response.error())));
});
