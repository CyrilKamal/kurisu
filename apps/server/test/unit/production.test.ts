import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { testConfig } from "../support/testConfig.js";

describe("errors in production", () => {
  const app = buildApp(testConfig({ NODE_ENV: "production", OWNER_MAL_USERNAME: "owner" }));
  app.get("/boom", () => {
    throw new Error("connection to db:5432 refused");
  });
  app.get("/teapot", () => {
    throw Object.assign(new Error("not a coffee pot"), { statusCode: 418 });
  });
  afterAll(() => app.close());

  it("never tells the browser what went wrong inside the server", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Something went wrong",
    });
    expect(res.body).not.toContain("5432");
  });

  it("still explains a request the server turned down", async () => {
    const res = await app.inject({ method: "GET", url: "/teapot" });

    expect(res.statusCode).toBe(418);
    expect(res.json()).toMatchObject({ statusCode: 418, message: "not a coffee pot" });
  });
});
