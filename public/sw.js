
const VERSION = "v4";
const CACHE = `protext-shell-${VERSION}`;
const CACHE_PREFIX = "protext-shell-";

const BASE = new URL("./", self.registration.scope);

const HOME = new URL("./", BASE).href;
const INDEX = new URL("index.html", BASE).href;

const SHELL = [
  HOME,
  INDEX,
  new URL("manifest.webmanifest", BASE).href,
  new URL("icon.svg", BASE).href
];

// Only manage ProText's application-shell caches.
// Never delete WebLLM, tokenizer, or other caches.

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // Fetch fresh files when installing a new version.
    await Promise.all(
      SHELL.map(async (url) => {
        const response = await fetch(
          new Request(url, { cache: "reload" })
        );

        if (!response.ok) {
          throw new Error(
            `App shell download failed: ${url}`
          );
        }

        await cache.put(url, response);
      })
    );

    // Precache Vite's hashed JS/CSS assets so the
    // newly installed version can start offline.
    const htmlResponse = await cache.match(INDEX);
    const html = await htmlResponse.text();

    const assetPaths = new Set();

    const pattern =
      /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi;

    for (const match of html.matchAll(pattern)) {
      const url = new URL(match[1], INDEX);

      if (
        url.origin === self.location.origin &&
        url.pathname.startsWith(BASE.pathname)
      ) {
        assetPaths.add(url.href);
      }
    }

    await Promise.all(
      [...assetPaths].map(async (url) => {
        const response = await fetch(
          new Request(url, { cache: "reload" })
        );

        if (!response.ok) {
          throw new Error(
            `App asset download failed: ${url}`
          );
        }

        await cache.put(url, response);
      })
    );
  })());
});

// Delete obsolete shell caches only after
// the new service worker activates.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(
          (key) =>
            key.startsWith(CACHE_PREFIX) &&
            key !== CACHE
        )
        .map((key) => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

// Activate an installed update only when the
// application tells us it is safe to do so.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Return cached content when offline.
async function networkFirst(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await caches.match(request);

    if (cached) return cached;

    if (request.mode === "navigate") {
      const fallback = await caches.match(INDEX);

      if (fallback) return fallback;
    }

    throw error;
  }
}

// Hashed Vite assets can safely use cache-first:
// a changed asset receives a different filename.
async function cacheFirst(request) {
  const cached = await caches.match(request);

  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE.pathname)
  ) {
    return;
  }

  const isHashedAsset =
    /\/assets\/[^/]+\.(?:js|css)$/i.test(
      url.pathname
    );

  // HTML and other app files prefer the network.
  // Hashed assets prefer the local cache.
  event.respondWith(
    isHashedAsset
      ? cacheFirst(request)
      : networkFirst(request)
  );
});
