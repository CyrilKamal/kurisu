import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Where the Fastify server lives, as seen from the Next.js server. Reads only this one value
 * from the repo-root .env.local, so server secrets never enter the Next.js process.
 */
export function apiInternalUrl(): string {
  const fromEnv = process.env.API_INTERNAL_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const envFile = path.resolve(process.cwd(), "../../.env.local");
  if (existsSync(envFile)) {
    const fromFile = parseEnv(readFileSync(envFile, "utf8")).API_INTERNAL_URL;
    if (fromFile) return fromFile.replace(/\/+$/, "");
  }
  return "http://localhost:4000";
}
