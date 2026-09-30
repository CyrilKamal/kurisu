import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("GET /health", () => {
  const app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));
  afterAll(() => app.close());

  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
