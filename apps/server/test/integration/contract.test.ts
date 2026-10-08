import * as contract from "@kurisu/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { LoginError } from "../../src/auth/routes.js";
import type { BriefErrorCode } from "../../src/brief/routes.js";
import { STREAMING_SERVICES } from "../../src/brief/services.js";
import { CHAT_TITLE_MAX } from "../../src/chat/titles.js";
import { DROP_CATEGORIES } from "../../src/taste/dropReasons.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { chatMessages, conversations, syncRuns, users } from "../../src/db/schema.js";
import { MAL_LIST_STATUSES } from "../../src/mal/client.js";
import type { PushErrorCode } from "../../src/push/routes.js";
import { generateVapidKeys } from "../../src/push/send.js";
import type { SyncErrorCode } from "../../src/sync/listSync.js";
import { fixtureList } from "../fixtures/animeList.js";
import { FakeAniList } from "../support/fakeAniList.js";
import { FakePushService } from "../support/fakePushService.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

/**
 * The web app parses every response with the schemas in @kurisu/shared. These tests hold the
 * server to that contract, so a response shape can't change without the web app noticing.
 */

let h: Harness;
let cookie: string;
let pushService: FakePushService;
let anilist: FakeAniList;

beforeAll(async () => {
  pushService = await FakePushService.start();
  anilist = await FakeAniList.start();
  const vapid = generateVapidKeys();
  h = await startHarness({
    env: {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:test@example.com",
      ANILIST_API_URL: anilist.apiUrl,
    },
    pushOrigins: [pushService.origin],
    anilist: { minIntervalMs: 0 },
  });
});

afterAll(async () => {
  await h.close();
  await pushService.stop();
  await anilist.stop();
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
    expectTypeOf<PushErrorCode>().toEqualTypeOf<contract.PushError>();
    expectTypeOf<BriefErrorCode>().toEqualTypeOf<contract.BriefError>();
    expect(CHAT_TITLE_MAX).toBe(contract.CHAT_TITLE_MAX);
    expect([...DROP_CATEGORIES]).toEqual([...contract.DROP_CATEGORIES]);
    expect(STREAMING_SERVICES.map(({ id, label }) => ({ id, label }))).toEqual(
      contract.STREAMING_SERVICES.map(({ id, label }) => ({ id, label })),
    );
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

  it("GET /taste", async () => {
    const res = await get("/taste");
    expect(res.statusCode).toBe(200);
    expect(() => contract.tasteResponseSchema.parse(res.json())).not.toThrow();
  });

  it("POST /list/:animeId/edit and /remove", async () => {
    const post = (url: string, payload: Record<string, unknown>) =>
      h.app.inject({
        method: "POST",
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        payload,
      });
    const edited = await post("/list/900001/edit", { score: 7, requestId: crypto.randomUUID() });
    expect(edited.statusCode).toBe(200);
    expect(contract.changeResponseSchema.parse(edited.json()).change.source).toBe("user");

    const refused = await post("/list/900001/edit", { score: 7, requestId: crypto.randomUUID() });
    expect(refused.statusCode).toBe(400);
    expect(contract.editErrorResponseSchema.parse(refused.json()).error).toBe("no_change");

    const removed = await post("/list/900004/remove", { requestId: crypto.randomUUID() });
    expect(removed.statusCode).toBe(200);
    expect(contract.changeResponseSchema.parse(removed.json()).change.kind).toBe("remove");
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

  it("push endpoints", async () => {
    const send = (method: "POST" | "DELETE", url: string, payload?: Record<string, unknown>) =>
      h.app.inject({
        method,
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        ...(payload ? { payload } : {}),
      });
    const browser = pushService.browser("contract");

    const publicKey = contract.pushPublicKeyResponseSchema.parse(
      (await get("/push/public-key")).json(),
    ).publicKey;
    expect(typeof publicKey).toBe("string");

    const noSubscriptions = await send("POST", "/push/test");
    expect(noSubscriptions.statusCode).toBe(409);
    expect(contract.pushErrorResponseSchema.parse(noSubscriptions.json()).error).toBe(
      "no_subscriptions",
    );

    const subscribed = await send("POST", "/push/subscriptions", browser.subscription);
    expect(contract.pushSubscriptionResponseSchema.parse(subscribed.json())).toEqual({
      subscribed: true,
    });

    const rejected = await send("POST", "/push/subscriptions", {
      ...browser.subscription,
      endpoint: "https://evil.example/push",
    });
    expect(contract.pushErrorResponseSchema.parse(rejected.json()).error).toBe(
      "unsupported_push_service",
    );

    const unsubscribed = await send("DELETE", "/push/subscriptions", {
      endpoint: browser.subscription.endpoint,
    });
    expect(contract.pushSubscriptionResponseSchema.parse(unsubscribed.json())).toEqual({
      subscribed: false,
    });
  });

  it("POST /push/test success", async () => {
    await h.app.inject({
      method: "POST",
      url: "/push/subscriptions",
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
      payload: pushService.browser("contract-test").subscription,
    });
    const res = await h.app.inject({
      method: "POST",
      url: "/push/test",
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(contract.pushTestResponseSchema.parse(res.json())).toEqual({
      sent: 1,
      removed: 0,
      failed: 0,
    });
  });

  it("chat endpoints", async () => {
    const [user] = await h.db.select().from(users);
    if (!user) throw new Error("no user");
    const [chat] = await h.db
      .insert(conversations)
      .values({ userId: user.id, title: "watched ep 3" })
      .returning();
    if (!chat) throw new Error("no chat");
    await h.db.insert(chatMessages).values([
      { conversationId: chat.id, role: "user", content: "watched ep 3" },
      { conversationId: chat.id, role: "assistant", content: "Which show?" },
    ]);

    const list = contract.conversationsResponseSchema.parse(
      (await get("/chat/conversations")).json(),
    );
    expect(list.conversations.map((c) => c.id)).toEqual([chat.id]);

    const thread = contract.chatThreadResponseSchema.parse(
      (await get(`/chat/conversations/${chat.id}`)).json(),
    );
    expect(thread.messages).toHaveLength(2);

    const missing = await get(`/chat/conversations/${crypto.randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(contract.writeErrorResponseSchema.parse(missing.json()).error).toBe("not_found");

    const renamed = await h.app.inject({
      method: "PATCH",
      url: `/chat/conversations/${chat.id}`,
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { title: "Frieren catch-up" },
    });
    expect(contract.conversationResponseSchema.parse(renamed.json()).conversation.title).toBe(
      "Frieren catch-up",
    );

    const deleted = await h.app.inject({
      method: "DELETE",
      url: `/chat/conversations/${chat.id}`,
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("brief endpoints", async () => {
    const send = (method: "POST" | "PUT", url: string, payload?: Record<string, unknown>) =>
      h.app.inject({
        method,
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        ...(payload ? { payload } : {}),
      });

    const defaults = await get("/brief/settings");
    expect(contract.briefSettingsResponseSchema.parse(defaults.json()).enabled).toBe(false);

    const saved = await send("PUT", "/brief/settings", {
      enabled: true,
      time: "08:30",
      timeZone: "Europe/Berlin",
      services: ["crunchyroll"],
    });
    expect(contract.briefSettingsResponseSchema.parse(saved.json()).time).toBe("08:30");

    const invalid = await send("PUT", "/brief/settings", { enabled: true });
    expect(contract.briefErrorResponseSchema.parse(invalid.json()).error).toBe("invalid_settings");

    const test = await send("POST", "/brief/test");
    expect(contract.briefTestResponseSchema.parse(test.json()).status).toBe("empty");

    const tooSoon = await send("POST", "/brief/test");
    expect(contract.briefErrorResponseSchema.parse(tooSoon.json()).error).toBe("too_soon");
  });
});
