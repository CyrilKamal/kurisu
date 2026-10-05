"use client";

import { useEffect } from "react";

/** Registers /sw.js, which shows push notifications and opens Chat when one is tapped. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err: unknown) => {
        console.warn("Service worker registration failed", err);
      });
  }, []);
  return null;
}
