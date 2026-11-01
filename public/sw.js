
const CACHE = "protext-shell-v3";
const BASE = new URL("./", self.registration.scope);

const SHELL = [
  new URL("./", BASE).href,
  new URL("index.html", BASE).href,
  new URL("manifest.webmanifest", BASE).href,
  new URL("icon.svg", BASE).href
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) =>
            key.startsWith("protext-shell-") && key !== CACHE
          )
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (response.ok) {
          // Clone immediately, before returning the response.
          const copy = response.clone();

          event.waitUntil(
            caches.open(CACHE)
              .then((cache) => cache.put(request, copy))
              .catch((error) => {
                console.warn("Cache write failed:", error);
              })
          );
        }

        return response;
      } catch (error) {
        if (request.mode === "navigate") {
          const fallback = await caches.match(
            new URL("index.html", BASE).href
          );
          if (fallback) return fallback;
        }

        throw error;
      }
    })
  );
});
