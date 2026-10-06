import { loadConfig, type Config } from "../../src/config.js";

/** A fixed, obviously fake key. Only ever used by tests. */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

export const TEST_MAL_CLIENT = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/api/auth/mal/callback",
};

export const TEST_WEB_ORIGIN = "http://localhost:3000";

/** The minimum environment the server needs, plus any overrides. */
export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: TEST_WEB_ORIGIN,
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    MAL_CLIENT_ID: TEST_MAL_CLIENT.clientId,
    MAL_CLIENT_SECRET: TEST_MAL_CLIENT.clientSecret,
    MAL_REDIRECT_URI: TEST_MAL_CLIENT.redirectUri,
    TOKEN_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    BRIEF_SCHEDULER: "off",
    // Nothing listens here, so no test reaches the real AniList by accident.
    ANILIST_API_URL: "http://127.0.0.1:9/",
    ...overrides,
  };
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig(testEnv(overrides));
}
