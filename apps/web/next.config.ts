import type { NextConfig } from "next";

import { apiInternalUrl } from "./lib/apiInternalUrl";

const nextConfig: NextConfig = {
  // Proxy /api/* to the Fastify server so the browser only ever talks to one origin.
  // That keeps the session cookie first-party and avoids CORS entirely.
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiInternalUrl()}/:path*` }]);
  },
  images: {
    // Cover art comes from MAL's CDN.
    remotePatterns: [new URL("https://cdn.myanimelist.net/**")],
  },
};

export default nextConfig;
