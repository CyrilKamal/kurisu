import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import {
  agentRuns,
  chatMessages,
  conversations,
  imports,
  subscriptions,
  users,
} from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { fixtureList } from "../fixtures/animeList.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";
import { ScriptedModels } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const RECOMMEND = parseModelRef("ollama:test-recommend");
// TEST_MAL_USER owns this kurisu (always Pro) and invites Alex, whose plan the tests change.
const ALEX = { id: 5151, name: "alex" };
const DAY_MS = 24 * 60 * 60 * 1000;

let h: Harness;
const models = new ScriptedModels();
const cookies = new Map<string, string>();

beforeAll(async () => {
  h = await startHarness({
    env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name },
    models,
    roles: { agent: AGENT, escalation: null, recommend: RECOMMEND },
  });
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  models.reset();
  cookies.clear();
  h.fakeMal.list = fixtureList();
  h.fakeMal.lists.set(ALEX.id, fixtureList());
  await join(TEST_MAL_USER);
  await join(ALEX, await invite());
});

function send(who: { name: string }, method: "GET" | "POST", url: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookies.get(who.name) ?? "" },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function join(user: { id: number; name: string }, inviteCode?: string) {
  h.fakeMal.user = user;
  const { sessionCookie } = await login(h, undefined, inviteCode);
  if (!sessionCookie) throw new Error(`${user.name} couldn't log in`);
  cookies.set(user.name, sessionCookie);
}

async function invite(): Promise<string> {
  const res = await send(TEST_MAL_USER, "POST", "/invites", {});
  return res.json<{ url: string }>().url.split("/invite/")[1] ?? "";
}

async function alexId(): Promise<string> {
  const [row] = await h.db.select({ id: users.id }).from(users).where(eq(users.malUserId, ALEX.id));
  if (!row) throw new Error("no account");
  return row.id;
}

/** Ends Alex's trial, so Alex is on Free. */
async function endTrial() {
  await h.db
    .update(users)
    .set({ trialEndsAt: new Date(Date.now() - DAY_MS) })
    .where(eq(users.id, await alexId()));
}

/** This month's use, as if Alex had sent `messages` chat messages and asked for `picks`. */
async function used({ messages = 0, picks = 0, imported = 0 }) {
  const userId = await alexId();
  const [chat] = await h.db.insert(conversations).values({ userId }).returning();
  if (!chat) throw new Error("no conversation");
  for (let i = 0; i < messages; i++) {
    await h.db
      .insert(chatMessages)
      .values({ conversationId: chat.id, role: "user", content: `message ${String(i)}` });
  }
  for (let i = 0; i < picks; i++) {
    await h.db.insert(agentRuns).values({ userId, promptVersion: "recommend@9", model: "test:x" });
  }
  for (let i = 0; i < imported; i++) {
    await h.db.insert(imports).values({ userId, text: "frieren done", status: "done" });
  }
}

async function planOf(who: { name: string }) {
  const res = await send(who, "GET", "/plan");
  expect(res.statusCode).toBe(200);
  return contract.planResponseSchema.parse(res.json());
}

describe("plans", () => {
  it("starts a new account on a 14-day Premium trial, and keeps the owner on Pro", async () => {
    const me = contract.meResponseSchema.parse((await send(ALEX, "GET", "/me")).json());
    expect(me.plan).toMatchObject({ id: "premium", source: "trial" });
    const days = (Date.parse(me.plan.until ?? "") - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);

    // A trial has Premium's features: everything but Pro's calendar, full year and lab.
    expect(me.plan.features).toEqual({
      supporterBadge: true,
      calendar: false,
      fullYear: false,
      lab: false,
    });

    const owner = await planOf(TEST_MAL_USER);
    expect(owner.plan).toMatchObject({ id: "pro", source: "owner" });
    expect(owner.plan.features).toMatchObject({ calendar: true, fullYear: true, lab: true });
    expect(owner.usage.chat.allowance).toBeNull();
  });

  it("shows friends a supporter badge only while a paid plan counts", async () => {
    const alexAs = async () => {
      const res = await send(TEST_MAL_USER, "GET", "/friends");
      const friend = contract.friendsResponseSchema
        .parse(res.json())
        .friends.find((f) => f.malUsername === ALEX.name);
      if (!friend) throw new Error("Alex isn't a friend");
      return friend;
    };
    // A trial is free, so no badge.
    expect((await alexAs()).supporter).toBeNull();

    const userId = await alexId();
    await h.db
      .insert(subscriptions)
      .values({ userId, plan: "premium", status: "active", provider: "manual" });
    expect((await alexAs()).supporter).toBe("premium");
    const page = await send(TEST_MAL_USER, "GET", `/friends/${(await alexAs()).id}`);
    expect(contract.friendDetailResponseSchema.parse(page.json()).friend.supporter).toBe("premium");

    await h.db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.userId, userId));
    expect((await alexAs()).supporter).toBeNull();
  });

  it("drops to Free when the trial ends, with Free's allowances", async () => {
    await endTrial();
    await used({ messages: 5, picks: 2 });
    const plan = await planOf(ALEX);
    expect(plan.plan).toMatchObject({ id: "free", source: "free", until: null });
    // The 2 messages that asked what to watch count as recommendations, not chat updates.
    expect(plan.usage).toEqual({
      chat: { used: 3, allowance: 30 },
      recommendations: { used: 2, allowance: 12 },
      imports: { used: 0, allowance: 1 },
    });
    expect(plan.importLines).toBe(500);
  });

  it("turns Chat away at the month's chat updates, before any model is called", async () => {
    await endTrial();
    await used({ messages: 30 });
    const res = await send(ALEX, "POST", "/chat/messages", { text: "watched ep 8 of frieren" });
    expect(res.statusCode).toBe(429);
    const body = contract.planLimitErrorSchema.parse(res.json());
    expect(body.limit).toMatchObject({ kind: "chat", plan: "free", allowance: 30, used: 30 });
    expect(new Date(body.limit.resetsAt).getUTCDate()).toBe(1);
    expect(models.requests).toEqual([]);
  });

  it("answers a 'what should I watch' past the month's recommendations without the recommender", async () => {
    await endTrial();
    await used({ messages: 12, picks: 12 });
    models.script(AGENT.ref, [{ toolCalls: [{ name: "recommend_shows", arguments: {} }] }]);
    const res = await send(ALEX, "POST", "/chat/messages", { text: "what should i watch" });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain(
      "You've used this month's 12 recommendations on Free. They come back on the 1st.",
    );
    expect(models.requests.map((r) => r.ref)).toEqual([AGENT.ref]);
  });

  it("limits Free to one import a month, of up to 500 lines", async () => {
    await endTrial();
    const long = Array.from({ length: 501 }, (_, i) => `show ${String(i)} done`).join("\n");
    const tooLong = await send(ALEX, "POST", "/imports", { text: long });
    expect(tooLong.statusCode).toBe(429);
    expect(contract.planLimitErrorSchema.parse(tooLong.json()).limit).toMatchObject({
      kind: "import_lines",
      allowance: 500,
      used: 501,
    });

    await used({ imported: 1 });
    const second = await send(ALEX, "POST", "/imports", { text: "frieren done" });
    expect(second.statusCode).toBe(429);
    expect(contract.planLimitErrorSchema.parse(second.json()).limit).toMatchObject({
      kind: "imports",
      allowance: 1,
    });
  });

  it("follows a subscription while it lasts, then falls back", async () => {
    await endTrial();
    const userId = await alexId();
    await h.db.insert(subscriptions).values({
      userId,
      plan: "pro",
      status: "active",
      provider: "manual",
      currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
    });
    await used({ messages: 30 });
    expect((await planOf(ALEX)).plan).toMatchObject({ id: "pro", source: "subscription" });
    expect((await planOf(ALEX)).usage.chat).toEqual({ used: 30, allowance: 3000 });

    await h.db
      .update(subscriptions)
      .set({ currentPeriodEnd: new Date(Date.now() - DAY_MS) })
      .where(eq(subscriptions.userId, userId));
    expect((await planOf(ALEX)).plan).toMatchObject({ id: "free", source: "free" });
    await h.db
      .update(subscriptions)
      .set({ status: "canceled", currentPeriodEnd: null })
      .where(eq(subscriptions.userId, userId));
    expect((await planOf(ALEX)).plan.id).toBe("free");
  });
});
