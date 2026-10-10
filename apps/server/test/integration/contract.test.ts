import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { LoginError } from "../../src/auth/routes.js";
import type { BudgetLimit } from "../../src/budget/budget.js";
import type { BriefErrorCode } from "../../src/brief/routes.js";
import { STREAMING_SERVICES } from "../../src/brief/services.js";
import { CHAT_TITLE_MAX } from "../../src/chat/titles.js";
import { DROP_CATEGORIES } from "../../src/taste/dropReasons.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { agentRuns, chatMessages, conversations, syncRuns, users } from "../../src/db/schema.js";
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
    expectTypeOf<BudgetLimit>().toEqualTypeOf<contract.BudgetLimit>();
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

  it("the /invites endpoints", async () => {
    // Only the owner invites; this harness has none, so make the test user one.
    await h.db.update(users).set({ isOwner: true });
    const send = (method: "POST" | "DELETE", url: string) =>
      h.app.inject({
        method,
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        payload: method === "POST" ? { note: "Alex" } : undefined,
      });

    const created = await send("POST", "/invites");
    expect(created.statusCode).toBe(201);
    const invite = contract.createdInviteSchema.parse(created.json());

    const listed = await get("/invites");
    expect(contract.invitesResponseSchema.parse(listed.json()).invites).toHaveLength(1);

    const code = new URL(invite.url).pathname.split("/").pop() ?? "";
    const check = await h.app.inject({ method: "GET", url: `/invites/code/${code}` });
    expect(() => contract.inviteCodeResponseSchema.parse(check.json())).not.toThrow();

    expect((await send("DELETE", `/invites/${invite.id}`)).statusCode).toBe(204);
  });

  it("the /friends endpoints", async () => {
    const send = (method: "POST" | "PUT", url: string, payload?: object) =>
      h.app.inject({
        method,
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        ...(payload === undefined ? {} : { payload }),
      });

    const friends = contract.friendsResponseSchema.parse((await get("/friends")).json());
    const code = new URL(friends.link).pathname.split("/").pop() ?? "";
    const check = await get(`/friends/links/${code}`);
    expect(contract.friendLinkCheckSchema.parse(check.json())).toMatchObject({ self: true });

    const reset = await send("POST", "/friends/link/reset");
    expect(() => contract.friendLinkResponseSchema.parse(reset.json())).not.toThrow();
    const sharing = await send("PUT", "/friends/sharing", { shareActivity: false });
    expect(contract.sharingResponseSchema.parse(sharing.json())).toEqual({ shareActivity: false });
    expect((await send("POST", "/friends", { code: "nobody" })).statusCode).toBe(404);
    expect((await get(`/friends/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });

  it("GET /list", async () => {
    const res = await get("/list");
    const parsed = contract.listResponseSchema.parse(res.json());
    expect(parsed.entries).toHaveLength(fixtureList().length);
  });

  it("the Today, Journal, show, search and add endpoints", async () => {
    const send = (url: string, payload?: object) =>
      h.app.inject({
        method: "POST",
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        ...(payload ? { payload: payload as Record<string, unknown> } : {}),
      });
    const today = await get("/today");
    expect(() => contract.todayResponseSchema.parse(today.json())).not.toThrow();
    const journal = await get("/journal");
    expect(() => contract.journalResponseSchema.parse(journal.json())).not.toThrow();
    const show = await get("/shows/900001");
    expect(show.statusCode).toBe(200);
    expect(() => contract.showResponseSchema.parse(show.json())).not.toThrow();
    const search = await get("/search");
    expect(search.statusCode).toBe(200);
    expect(() => contract.searchResponseSchema.parse(search.json())).not.toThrow();

    const added = await send("/list/add", { animeId: 900001, requestId: crypto.randomUUID() });
    expect(added.statusCode).toBe(409);
    expect(contract.addErrorResponseSchema.parse(added.json()).error).toBe("already_on_list");

    const welcomed = await send("/me/welcomed");
    expect(contract.welcomedResponseSchema.parse(welcomed.json())).toEqual({ welcomed: true });
  });

  it("GET /taste", async () => {
    const res = await get("/taste");
    expect(res.statusCode).toBe(200);
    expect(() => contract.tasteResponseSchema.parse(res.json())).not.toThrow();
  });

  it("GET /diary and DELETE /diary/notes/:id", async () => {
    const diary = await get("/diary");
    expect(diary.statusCode).toBe(200);
    expect(() => contract.diaryResponseSchema.parse(diary.json())).not.toThrow();

    const missing = await h.app.inject({
      method: "DELETE",
      url: `/diary/notes/${crypto.randomUUID()}`,
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "not_found" });
  });

  it("GET /stats and PUT /stats/goal", async () => {
    const stats = await get("/stats");
    expect(stats.statusCode).toBe(200);
    expect(() => contract.statsResponseSchema.parse(stats.json())).not.toThrow();

    const goal = await h.app.inject({
      method: "PUT",
      url: "/stats/goal",
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { target: 12 } satisfies contract.GoalRequest,
    });
    expect(goal.statusCode).toBe(200);
    expect(contract.statsResponseSchema.parse(goal.json()).year.goal).toBe(12);
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

  it("the /imports endpoints", async () => {
    const send = (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      h.app.inject({
        method,
        url,
        headers: { origin: TEST_WEB_ORIGIN },
        cookies: { [SESSION_COOKIE]: cookie },
        ...(payload ? { payload: payload as Record<string, unknown> } : {}),
      });
    const created = await send("POST", "/imports", { text: "frieren 10/10" });
    expect(created.statusCode).toBe(202);
    const { id } = contract.importResponseSchema.parse(created.json()).import;

    // No model in this harness: reading the notes fails, cleanly.
    let view = contract.importResponseSchema.parse((await get(`/imports/${id}`)).json()).import;
    for (let i = 0; i < 100 && view.status === "parsing"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      view = contract.importResponseSchema.parse((await get(`/imports/${id}`)).json()).import;
    }
    expect(view.status).toBe("failed");
    expect(
      contract.latestImportResponseSchema.parse((await get("/imports/latest")).json()).import?.id,
    ).toBe(id);

    const run = await send("POST", `/imports/${id}/run`);
    expect(run.statusCode).toBe(409);
    expect(contract.importErrorResponseSchema.parse(run.json()).error).toBe("not_ready");
    const patch = await send("PATCH", `/imports/${id}/items/${crypto.randomUUID()}`, {
      checked: true,
    });
    expect(contract.importErrorResponseSchema.parse(patch.json()).error).toBe("not_ready");
    const undo = await send("POST", `/imports/${id}/undo`);
    expect(contract.importErrorResponseSchema.parse(undo.json()).error).toBe("not_ready");
    expect((await send("DELETE", `/imports/${id}`)).statusCode).toBe(204);
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

    // Reporting a reply needs the run behind it.
    const [run] = await h.db
      .insert(agentRuns)
      .values({ userId: user.id, promptVersion: "progress-sync@17", model: "ollama:test" })
      .returning({ id: agentRuns.id });
    const replyId = thread.messages.find((m) => m.role === "assistant")?.id ?? "";
    await h.db
      .update(chatMessages)
      .set({ runId: run?.id ?? null })
      .where(eq(chatMessages.id, replyId));
    const reported = await h.app.inject({
      method: "POST",
      url: `/chat/messages/${replyId}/report`,
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
      payload: contract.reportRequestSchema.parse({ note: "wrong show" }),
    });
    expect(reported.statusCode).toBe(202);
    expect(() => contract.reportResponseSchema.parse(reported.json())).not.toThrow();

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
