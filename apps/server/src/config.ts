import { z } from "zod";

import { DEFAULT_ANILIST_API_URL } from "./anilist/client.js";

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

  // AniList GraphQL API (airing schedules, streaming links). Only tests point it elsewhere.
  ANILIST_API_URL: optional(url.default(DEFAULT_ANILIST_API_URL)),

  // 32 random bytes, base64-encoded. Encrypts MAL tokens at rest.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "must be 32 bytes, base64"),

  // Web push (VAPID). All three or none; without them, push notifications are off.
  VAPID_PUBLIC_KEY: optional(z.string().min(1).optional()),
  VAPID_PRIVATE_KEY: optional(z.string().min(1).optional()),
  VAPID_SUBJECT: optional(
    z
      .string()
      .regex(/^(mailto:|https:\/\/)/, "must start with mailto: or https://")
      .optional(),
  ),

  // Models. Which model plays each role lives in config/models.json; these override it.
  GEMINI_API_KEY: optional(z.string().min(1).optional()),
  OLLAMA_BASE_URL: optional(url.default("http://127.0.0.1:11434")),
  AGENT_MODEL: optional(z.string().optional()),
  AGENT_ESCALATION_MODEL: optional(z.string().optional()),
  EVAL_MODEL: optional(z.string().optional()),
  BRIEF_MODEL: optional(z.string().optional()),
  RECOMMEND_MODEL: optional(z.string().optional()),

  // "off" stops the daily brief job (the routes still work). Tests turn it off.
  BRIEF_SCHEDULER: optional(z.enum(["on", "off"]).default("on")),

  // The MAL account that owns this kurisu. When set, no other MAL account can sign up.
  // Required in production, where the app is reachable from the internet.
  OWNER_MAL_USERNAME: optional(z.string().min(1).optional()),
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
  anilist: { apiUrl: string };
  /** Null when the VAPID variables aren't set: push notifications are off. */
  push: { publicKey: string; privateKey: string; subject: string } | null;
  llm: {
    geminiApiKey: string | null;
    ollamaBaseUrl: string;
    /** Per-role overrides of config/models.json, as "provider:model" refs. */
    overrides: {
      agent?: string;
      escalation?: string;
      eval?: string;
      brief?: string;
      recommend?: string;
    };
  };
  brief: { scheduler: boolean };
  /** The owner's MAL username; when set, only that account can create a kurisu account. */
  owner: { malUsername: string } | null;
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
  const vapid = [parsed.VAPID_PUBLIC_KEY, parsed.VAPID_PRIVATE_KEY, parsed.VAPID_SUBJECT];
  if (vapid.some(Boolean) && !vapid.every(Boolean)) {
    throw new Error(
      "Invalid environment configuration:\n  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together",
    );
  }
  if (parsed.NODE_ENV === "production" && !parsed.OWNER_MAL_USERNAME) {
    throw new Error(
      "Invalid environment configuration:\n  OWNER_MAL_USERNAME must be set in production, or anyone could sign up",
    );
  }
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
    anilist: { apiUrl: parsed.ANILIST_API_URL },
    push:
      parsed.VAPID_PUBLIC_KEY && parsed.VAPID_PRIVATE_KEY && parsed.VAPID_SUBJECT
        ? {
            publicKey: parsed.VAPID_PUBLIC_KEY,
            privateKey: parsed.VAPID_PRIVATE_KEY,
            subject: parsed.VAPID_SUBJECT,
          }
        : null,
    llm: {
      geminiApiKey: parsed.GEMINI_API_KEY ?? null,
      ollamaBaseUrl: parsed.OLLAMA_BASE_URL.replace(/\/+$/, ""),
      overrides: {
        ...(parsed.AGENT_MODEL ? { agent: parsed.AGENT_MODEL } : {}),
        ...(parsed.AGENT_ESCALATION_MODEL ? { escalation: parsed.AGENT_ESCALATION_MODEL } : {}),
        ...(parsed.EVAL_MODEL ? { eval: parsed.EVAL_MODEL } : {}),
        ...(parsed.BRIEF_MODEL ? { brief: parsed.BRIEF_MODEL } : {}),
        ...(parsed.RECOMMEND_MODEL ? { recommend: parsed.RECOMMEND_MODEL } : {}),
      },
    },
    brief: { scheduler: parsed.BRIEF_SCHEDULER === "on" },
    owner: parsed.OWNER_MAL_USERNAME ? { malUsername: parsed.OWNER_MAL_USERNAME } : null,
  };
}
