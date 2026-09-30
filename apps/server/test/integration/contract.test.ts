import * as contract from "@kurisu/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { LoginError } from "../../src/auth/routes.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { syncRuns } from "../../src/db/schema.js";
import { MAL_LIST_STATUSES } from "../../src/mal/client.js";
import type { SyncErrorCode } from "../../src/sync/listSync.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

/**
 * The web app parses every response with the schemas in @kurisu/shared. These tests hold the
 * server to that contract, so a response shape can't change without the web app noticing.
 */

let h: Harness;
let cookie: string;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  const result = await login(h);
  if (!result.sessionCookie) throw new Error("login failed");
  cookie = result.sessionCookie;
});

function get(url: string) {
  return h.app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: cookie } });
}

function postSync() {
  return h.app.inject({
    method: "POST",
    url: "/sync",
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

async function skipCooldown() {
  await h.db.update(syncRuns).set({ startedAt: new Date(Date.now() - 61_000) });
}

describe("shared constants", () => {
  it("agree between server and contract", () => {
    expect(SESSION_COOKIE).toBe(contract.SESSION_COOKIE);
    expect([...MAL_LIST_STATUSES]).toEqual([...contract.LIST_STATUSES]);
    // Checked by the type checker (pnpm typecheck), not at runtime.
    expectTypeOf<LoginError>().toEqualTypeOf<contract.LoginError>();
    expectTypeOf<SyncErrorCode>().toEqualTypeOf<contract.SyncError>();
  });
});

describe("responses match the contract", () => {
  it("GET /me", async () => {
    const res = await get("/me");
    expect(() => contract.meResponseSchema.parse(res.json())).not.toThrow();
  });

  it("GET /list", async () => {
    const res = await get("/list");
    const parsed = contract.listResponseSchema.parse(res.json());
    expect(parsed.entries).toHaveLength(fixtureList().length);
  });

  it("POST /sync success", async () => {
    await skipCooldown();
    const res = await postSync();
    expect(res.statusCode).toBe(200);
    expect(() => contract.syncResponseSchema.parse(res.json())).not.toThrow();
  });

  it("POST /sync cooldown", async () => {
    const res = await postSync();
    expect(res.statusCode).toBe(429);
    expect(contract.syncErrorResponseSchema.parse(res.json()).error).toBe("cooldown");
  });

  it("POST /sync reauth required", async () => {
    await skipCooldown();
    h.fakeMal.invalidateAccessTokens();
    h.fakeMal.revokeRefreshTokens();
    const res = await postSync();
    expect(res.statusCode).toBe(409);
    expect(contract.syncErrorResponseSchema.parse(res.json()).error).toBe("reauth_required");
  });

  it("POST /sync failure", async () => {
    await skipCooldown();
    h.fakeMal.animeListFailures = [503, 503, 503, 503];
    const res = await postSync();
    expect(res.statusCode).toBe(502);
    expect(contract.syncErrorResponseSchema.parse(res.json()).error).toBe("sync_failed");
  });
});
