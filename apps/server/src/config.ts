import { z } from "zod";

// .env files write unset optional variables as empty strings; treat those as missing
// so the schema defaults apply.
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyAsUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  SERVER_HOST: z.preprocess(emptyAsUndefined, z.string().default("localhost")),
  SERVER_PORT: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(65535).default(4000),
  ),
  LOG_LEVEL: z.preprocess(
    emptyAsUndefined,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  server: { host: string; port: number };
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

/**
 * Validates the environment once at startup and fails fast on anything missing or malformed.
 * Error messages name the variable but never echo its value, since some values are secrets.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join(".")}: invalid`);
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  const parsed = result.data;
  return {
    nodeEnv: parsed.NODE_ENV,
    server: { host: parsed.SERVER_HOST, port: parsed.SERVER_PORT },
    logLevel: parsed.LOG_LEVEL,
  };
}
