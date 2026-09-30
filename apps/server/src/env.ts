import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo-root .env.local (gitignored) into process.env for local runs.
 * Variables already set in the real environment win.
 */
export function loadLocalEnvFile(): void {
  const envFile = fileURLToPath(new URL("../../../.env.local", import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}
