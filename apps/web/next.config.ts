import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import type { NextConfig } from "next";

/**
 * The web app only needs to know where the API server lives. Read just that one value from the
 * repo-root .env.local so server secrets never enter the Next.js process.
 */
function apiInternalUrl(): string {
  const fromEnv = process.env.API_INTERNAL_URL;
  if (fromEnv) return fromEnv;

  const envFile = path.resolve(process.cwd(), "../../.env.local");
  if (existsSync(envFile)) {
    const fromFile = parseEnv(readFileSync(envFile, "utf8")).API_INTERNAL_URL;
    if (fromFile) return fromFile;
  }
  return "http://localhost:4000";
}

const nextConfig: NextConfig = {
  // Proxy /api/* to the Fastify server so the browser only ever talks to one origin.
  // That keeps the session cookie first-party and avoids CORS entirely.
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiInternalUrl()}/:path*` }]);
  },
};

export default nextConfig;
