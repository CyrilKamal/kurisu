"use client";

import { useEffect } from "react";

import { listenForInstall } from "@/lib/install";

/**
 * Registers /sw.js, which shows push notifications, opens Chat when one is tapped and keeps
 * kurisu usable offline (not in development, where it caches nothing). Also listens for the
 * browser's install prompt, which fires once, early.
 */
export function ServiceWorker() {
  useEffect(() => {
    const stopListening = listenForInstall();
    if ("serviceWorker" in navigator) {
      const url = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";
      navigator.serviceWorker
        .register(url, { scope: "/", updateViaCache: "none" })
        .catch((err: unknown) => {
          console.warn("Service worker registration failed", err);
        });
    }
    return stopListening;
  }, []);
  return null;
}
