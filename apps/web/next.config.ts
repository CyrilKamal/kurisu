import type { NextConfig } from "next";

import { apiInternalUrl } from "./lib/apiInternalUrl";

const nextConfig: NextConfig = {
  experimental: {
    // The proxy's default 30 s can cut off a first login, which waits for a full list sync,
    // or a slow chat reply that escalates and hands off.
    proxyTimeout: 120_000,
  },
  // Proxy /api/* to the Fastify server so the browser only ever talks to one origin.
  // That keeps the session cookie first-party and avoids CORS entirely.
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiInternalUrl()}/:path*` }]);
  },
  headers() {
    return Promise.resolve([
      {
        // Browsers must always fetch the latest service worker.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]);
  },
  images: {
    // Cover art comes from MAL's CDN, and from AniList's for shows found outside your list.
    remotePatterns: [
      new URL("https://cdn.myanimelist.net/**"),
      new URL("https://s4.anilist.co/file/anilistcdn/**"),
    ],
  },
};

export default nextConfig;
