const CACHE_NAME = "silver-billing-v7";
const OFFLINE_URL = "/offline.html";
const MAX_CACHE_ITEMS = 50;

const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  OFFLINE_URL,
  "/manifest.json",
  "/app.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/screenshot-1.png",
  "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap"
];

// Helper: Limit cache size by deleting oldest entries
const limitCacheSize = (name, maxItems) => {
  caches.open(name).then((cache) => {
    cache.keys().then((keys) => {
      if (keys.length > maxItems) {
        cache.delete(keys[0]).then(limitCacheSize(name, maxItems));
      }
    });
  });
};

// Install Event: Safer individual asset caching
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log("[SW] Prefilling Cache...");
      const results = await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url))
      );
      return self.skipWaiting();
    })
  );
});

// Activate Event: Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch Event: Strategies for different types of requests
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Navigation Requests: Show offline.html fallback if network fails
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_URL)) || (await cache.match("/index.html"));
      })
    );
    return;
  }

  // 2. API Requests: Network-focused with JSON failure fallback
  if (url.pathname.startsWith("/api") || url.port === "8000") {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ 
            offline: true, 
            status: "saved_locally"
          }), 
          { headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return;
  }

  // 3. Google Fonts: Special handling for fonts.gstatic.com (cross-origin)
  if (url.origin === "https://fonts.gstatic.com") {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        return cachedResponse || fetch(request).then((networkResponse) => {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return networkResponse;
        });
      })
    );
    return;
  }

  // 4. Static Assets: Stale-While-Revalidate Strategy (fast & always fresh)
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          // Safety: Don't cache invalid or opaque responses (unless necessary for fonts)
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
            cache.put(request, networkResponse.clone());
            limitCacheSize(CACHE_NAME, MAX_CACHE_ITEMS);
          }
          return networkResponse;
        }).catch(() => null);

        // Return cached immediately, while update happens in background
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// 5. Background Sync: Automatically trigger sync when back online
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-bills") {
    console.log("[SW] Background Sync triggered for bills...");
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => client.postMessage({ action: "sync-now" }));
    });
  }
});
