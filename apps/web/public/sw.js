// kurisu's service worker: shows push notifications and opens the app when one is tapped.
// Plain JS, served as-is from /sw.js (see next.config.ts for its headers).

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
