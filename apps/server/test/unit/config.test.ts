import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { testEnv } from "../support/testConfig.js";

describe("loadConfig", () => {
  it("applies defaults for optional variables", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      MAL_CLIENT_ID: "id",
      MAL_CLIENT_SECRET: "secret",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    });

    expect(config.nodeEnv).toBe("development");
    expect(config.server).toEqual({ host: "localhost", port: 4000 });
    expect(config.logLevel).toBe("info");
    expect(config.webOrigin).toBe("http://localhost:3000");
    expect(config.mal.redirectUri).toBe("http://localhost:3000/api/auth/mal/callback");
    expect(config.mal.authBaseUrl).toBe("https://myanimelist.net/v1/oauth2");
    expect(config.mal.apiBaseUrl).toBe("https://api.myanimelist.net/v2");
  });

  it("treats empty strings from .env files as unset", () => {
    const config = loadConfig(
      testEnv({ SERVER_HOST: "", SERVER_PORT: "", LOG_LEVEL: "", MAL_API_BASE_URL: "" }),
    );

    expect(config.server).toEqual({ host: "localhost", port: 4000 });
    expect(config.logLevel).toBe("info");
    expect(config.mal.apiBaseUrl).toBe("https://api.myanimelist.net/v2");
  });

  it("parses provided values and normalizes URLs", () => {
    const config = loadConfig(
      testEnv({
        NODE_ENV: "production",
        SERVER_PORT: "8080",
        WEB_ORIGIN: "https://kurisu.example/some/path",
        MAL_API_BASE_URL: "http://127.0.0.1:9999/v2/",
      }),
    );

    expect(config.nodeEnv).toBe("production");
    expect(config.server.port).toBe(8080);
    expect(config.webOrigin).toBe("https://kurisu.example");
    expect(config.mal.apiBaseUrl).toBe("http://127.0.0.1:9999/v2");
  });

  it("requires the secrets and the database URL", () => {
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL[\s\S]*MAL_CLIENT_ID[\s\S]*MAL_CLIENT_SECRET[\s\S]*TOKEN_ENCRYPTION_KEY/,
    );
  });

  it("rejects an encryption key that isn't 32 bytes", () => {
    const shortKey = Buffer.alloc(16).toString("base64");
    expect(() => loadConfig(testEnv({ TOKEN_ENCRYPTION_KEY: shortKey }))).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it("names the bad variable without echoing its value", () => {
    const env = testEnv({ SERVER_PORT: "not-a-port-s3cret", MAL_CLIENT_SECRET: "" });

    expect(() => loadConfig(env)).toThrow(/SERVER_PORT/);
    expect(() => loadConfig(env)).not.toThrow(/s3cret/);
  });

  it("turns push on only with all three VAPID variables", () => {
    expect(loadConfig(testEnv()).push).toBeNull();
    expect(
      loadConfig(testEnv({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" })).push,
    ).toBeNull();

    const vapid = {
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:a@b.example",
    };
    expect(loadConfig(testEnv(vapid)).push).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:a@b.example",
    });

    expect(() => loadConfig(testEnv({ VAPID_PUBLIC_KEY: "pub" }))).toThrow(/must be set together/);
    expect(() => loadConfig(testEnv({ ...vapid, VAPID_SUBJECT: "someone@example.com" }))).toThrow(
      /VAPID_SUBJECT: invalid/,
    );
  });

  it("never echoes a VAPID private key in errors", () => {
    let message = "";
    try {
      loadConfig(testEnv({ VAPID_PRIVATE_KEY: "very-secret-value", VAPID_SUBJECT: "nope" }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^Invalid environment configuration/);
    expect(message).not.toContain("very-secret-value");
  });
});
