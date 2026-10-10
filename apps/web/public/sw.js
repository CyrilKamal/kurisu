// kurisu's service worker: shows push notifications and opens the app when one is tapped, and
// keeps kurisu usable offline: pages come from the network, or the offline page when there's
// none; built files, whose names change with their contents, come from a cache.
// Plain JS, served as-is from /sw.js (see next.config.ts for its headers).

// Bump when this file's caching changes, so old caches go.
const STATIC_CACHE = "kurisu-static-v1";
// The list the List screen saved for the offline page (lib/offline.ts). Kept across versions;
// logging out clears it.
const DATA_CACHE = "kurisu-data";
const OFFLINE_URL = "/offline";
// In development (registered as /sw.js?dev=1) nothing is cached, so code changes always show.
const CACHING = new URL(self.location.href).searchParams.get("dev") !== "1";

self.addEventListener("install", (event) => {
  if (!CACHING) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // The offline page, and the built files it needs to run without a connection.
      const response = await fetch(OFFLINE_URL, { cache: "no-store" });
      if (!response.ok) return;
      const html = await response.clone().text();
      await cache.put(OFFLINE_URL, response);
      const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map(
        (match) => match[1],
      );
      await Promise.allSettled([...new Set(assets)].map((url) => cache.add(url)));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = CACHING ? [STATIC_CACHE, DATA_CACHE] : [DATA_CACHE];
      for (const name of await caches.keys()) {
        if (!keep.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!CACHING || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always the network, so nothing is ever stale; the offline page when it's gone.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? Response.error();
      }),
    );
    return;
  }

  // Built files and icons never change under the same name: the cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
  // Everything else, the API included, goes to the network as usual.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "kurisu", {
      body: data.body || "",
      icon: "/icons/192.png",
      badge: "/icons/badge-96.png",
      ...(data.tag ? { tag: data.tag } : {}),
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    safePath(event.notification.data && event.notification.data.url),
    self.location.origin,
  );

  event.waitUntil(
    (async () => {
      // Reuse an open kurisu window if there is one.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        const focused = await client.focus();
        if (focused && "navigate" in focused) await focused.navigate(url.href);
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});

/** Only paths inside the app; anything else opens Chat. */
function safePath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/chat";
}
