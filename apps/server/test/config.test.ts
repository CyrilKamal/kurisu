import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when variables are unset", () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: "development",
      server: { host: "localhost", port: 4000 },
      logLevel: "info",
    });
  });

  it("treats empty strings from .env files as unset", () => {
    const config = loadConfig({ SERVER_HOST: "", SERVER_PORT: "", LOG_LEVEL: "" });

    expect(config.server).toEqual({ host: "localhost", port: 4000 });
    expect(config.logLevel).toBe("info");
  });

  it("parses provided values", () => {
    const config = loadConfig({ NODE_ENV: "production", SERVER_PORT: "8080", LOG_LEVEL: "warn" });

    expect(config.nodeEnv).toBe("production");
    expect(config.server.port).toBe(8080);
    expect(config.logLevel).toBe("warn");
  });

  it("names the bad variable without echoing its value", () => {
    expect(() => loadConfig({ SERVER_PORT: "not-a-port-s3cret" })).toThrow(/SERVER_PORT/);
    expect(() => loadConfig({ SERVER_PORT: "not-a-port-s3cret" })).not.toThrow(/s3cret/);
  });
});
