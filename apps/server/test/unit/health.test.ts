import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { testConfig } from "../support/testConfig.js";

describe("GET /health", () => {
  // The pg pool connects lazily, so /health needs no running database.
  const app = buildApp(testConfig());
  afterAll(() => app.close());

  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
