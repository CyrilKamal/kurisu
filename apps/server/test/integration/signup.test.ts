import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { malTokens, sessions, users } from "../../src/db/schema.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";

// The fake MAL always logs in as TEST_MAL_USER ("test_user").
describe("sign-up while kurisu has an owner", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { OWNER_MAL_USERNAME: "someone_else" } });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
  });

  it("turns away a MAL account that has no kurisu account, keeping nothing of it", async () => {
    const { callbackResponse, sessionCookie } = await login(h);

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("/?login_error=invite_only");
    expect(sessionCookie).toBeUndefined();
    expect(await h.db.select().from(users)).toEqual([]);
    expect(await h.db.select().from(malTokens)).toEqual([]);
    expect(await h.db.select().from(sessions)).toEqual([]);
  });

  it("lets in an account that already exists", async () => {
    await h.db
      .insert(users)
      .values({ malUserId: TEST_MAL_USER.id, malUsername: TEST_MAL_USER.name });

    const { callbackResponse, sessionCookie } = await login(h);

    expect(callbackResponse.headers.location).toBe("/today");
    expect(sessionCookie).toBeDefined();
  });

  it("answers the database healthcheck", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health/db" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("the owner's first login", () => {
  let h: Harness;

  beforeAll(async () => {
    // MAL usernames aren't case-sensitive.
    h = await startHarness({ env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name.toUpperCase() } });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await resetDatabase(h.db);
    h.fakeMal.reset();
  });

  it("creates the owner's account", async () => {
    const { callbackResponse, sessionCookie } = await login(h);

    expect(callbackResponse.headers.location).toBe("/welcome");
    expect(sessionCookie).toBeDefined();
    const rows = await h.db.select({ malUsername: users.malUsername }).from(users);
    expect(rows).toEqual([{ malUsername: TEST_MAL_USER.name }]);
  });
});
