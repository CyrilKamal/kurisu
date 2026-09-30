import { z } from "zod";

// .env files write unset optional variables as empty strings; treat those as missing
// so the schema defaults apply.
const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyAsUndefined, schema);

const url = z.url({ protocol: /^https?$/ });

const envSchema = z.object({
  NODE_ENV: optional(z.enum(["development", "test", "production"]).default("development")),
  SERVER_HOST: optional(z.string().default("localhost")),
  SERVER_PORT: optional(z.coerce.number().int().min(1).max(65535).default(4000)),
  LOG_LEVEL: optional(
    z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ),
  WEB_ORIGIN: optional(url.default("http://localhost:3000")),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  MAL_CLIENT_ID: z.string().min(1),
  MAL_CLIENT_SECRET: z.string().min(1),
  MAL_REDIRECT_URI: optional(url.default("http://localhost:3000/api/auth/mal/callback")),
  MAL_AUTH_BASE_URL: optional(url.default("https://myanimelist.net/v1/oauth2")),
  MAL_API_BASE_URL: optional(url.default("https://api.myanimelist.net/v2")),

  // 32 random bytes, base64-encoded. Encrypts MAL tokens at rest.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "must be 32 bytes, base64"),

  // Models. Which model plays each role lives in config/models.json; these override it.
  GEMINI_API_KEY: optional(z.string().min(1).optional()),
  OLLAMA_BASE_URL: optional(url.default("http://127.0.0.1:11434")),
  AGENT_MODEL: optional(z.string().optional()),
  AGENT_ESCALATION_MODEL: optional(z.string().optional()),
  EVAL_MODEL: optional(z.string().optional()),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  server: { host: string; port: number };
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  webOrigin: string;
  databaseUrl: string;
  mal: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authBaseUrl: string;
    apiBaseUrl: string;
  };
  tokenEncryptionKey: string;
  llm: {
    geminiApiKey: string | null;
    ollamaBaseUrl: string;
    /** Per-role overrides of config/models.json, as "provider:model" refs. */
    overrides: { agent?: string; escalation?: string; eval?: string };
  };
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
    webOrigin: new URL(parsed.WEB_ORIGIN).origin,
    databaseUrl: parsed.DATABASE_URL,
    mal: {
      clientId: parsed.MAL_CLIENT_ID,
      clientSecret: parsed.MAL_CLIENT_SECRET,
      redirectUri: parsed.MAL_REDIRECT_URI,
      authBaseUrl: parsed.MAL_AUTH_BASE_URL.replace(/\/+$/, ""),
      apiBaseUrl: parsed.MAL_API_BASE_URL.replace(/\/+$/, ""),
    },
    tokenEncryptionKey: parsed.TOKEN_ENCRYPTION_KEY,
    llm: {
      geminiApiKey: parsed.GEMINI_API_KEY ?? null,
      ollamaBaseUrl: parsed.OLLAMA_BASE_URL.replace(/\/+$/, ""),
      overrides: {
        ...(parsed.AGENT_MODEL ? { agent: parsed.AGENT_MODEL } : {}),
        ...(parsed.AGENT_ESCALATION_MODEL ? { escalation: parsed.AGENT_ESCALATION_MODEL } : {}),
        ...(parsed.EVAL_MODEL ? { eval: parsed.EVAL_MODEL } : {}),
      },
    },
  };
}
