const SHELL_CACHE = "school-shell-v5";
const ASSET_CACHE = "school-assets-v5";
const SHELL_URLS = [
  "/", "/index.html", "/manifest.webmanifest", "/site-pattern.svg",
  "/assets/etablissement/logo-128.webp", "/assets/etablissement/logo-compact.webp",
  "/assets/etablissement/pwa-192.png", "/assets/officiel/armoiries-togo.png",
  "/assets/ecole/IMG_6466-960.webp", "/assets/ecole/IMG_6467-960.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => ![SHELL_CACHE, ASSET_CACHE].includes(key)).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", response.clone())));
        }
        return response;
      }).catch(async () => (await caches.match(request)) ?? (await caches.match("/index.html")) ?? Response.error()),
    );
    return;
  }

  if (["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((response) => {
          if (response.ok) event.waitUntil(cache.put(request, response.clone()));
          return response;
        });
        return cached ?? network;
      }),
    );
  }
});
