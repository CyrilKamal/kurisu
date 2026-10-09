import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkBudget, friendsSpendThisMonth } from "../../src/budget/budget.js";
import { createSession, SESSION_COOKIE } from "../../src/auth/sessions.js";
import { agentRuns, chatMessages, imports, users } from "../../src/db/schema.js";
import { loadModelsFile } from "../../src/llm/modelConfig.js";
import { resetDatabase, startHarness, TEST_MAL_USER, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const models = loadModelsFile();
const BUDGET = { dailyRuns: 3, monthlyUsd: 5 };
// Flash-Lite's list price is $0.30 per million input tokens: 20M tokens is $6, over the cap.
const OVER_THE_MONTH = 20_000_000;
const NOW = new Date("2026-10-20T12:00:00Z");

let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    env: {
      OWNER_MAL_USERNAME: TEST_MAL_USER.name,
      FRIEND_DAILY_RUNS: String(BUDGET.dailyRuns),
      MONTHLY_MODEL_BUDGET_USD: String(BUDGET.monthlyUsd),
    },
  });
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
});

async function account(name: string, isOwner = false) {
  const [row] = await h.db
    .insert(users)
    .values({ malUserId: name.length * 1000 + name.charCodeAt(0), malUsername: name, isOwner })
    .returning({ id: users.id, isOwner: users.isOwner });
  if (!row) throw new Error("no user");
  return row;
}

async function runs(userId: string, count: number, startedAt: Date, inputTokens = 1000) {
  await h.db.insert(agentRuns).values(
    Array.from({ length: count }, () => ({
      userId,
      promptVersion: "progress-sync@17",
      model: "gemini:gemini-3.5-flash-lite",
      startedAt,
      inputTokens,
      outputTokens: 100,
    })),
  );
}

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

describe("checkBudget", () => {
  it("lets a friend run until the day's runs are used, counting only the last 24 hours", async () => {
    const alex = await account("alex");
    await runs(alex.id, 2, hoursAgo(1));
    await runs(alex.id, 5, hoursAgo(25));
    expect(await checkBudget(h.db, models, BUDGET, alex, NOW)).toBeNull();

    await runs(alex.id, 1, hoursAgo(2));
    expect(await checkBudget(h.db, models, BUDGET, alex, NOW)).toBe("daily_limit");
  });

  it("stops every friend once friends together pass the month's spend, but never the owner", async () => {
    const owner = await account("owner", true);
    const alex = await account("alex");
    const sam = await account("sam");
    await runs(alex.id, 1, hoursAgo(48), OVER_THE_MONTH);

    expect(await friendsSpendThisMonth(h.db, models, NOW)).toBeGreaterThan(BUDGET.monthlyUsd);
    expect(await checkBudget(h.db, models, BUDGET, sam, NOW)).toBe("monthly_limit");
    expect(await checkBudget(h.db, models, BUDGET, owner, NOW)).toBeNull();
  });

  it("leaves out the owner's own spend and last month's", async () => {
    const owner = await account("owner", true);
    const alex = await account("alex");
    await runs(owner.id, 1, hoursAgo(1), OVER_THE_MONTH);
    await runs(alex.id, 1, new Date("2026-09-30T23:00:00Z"), OVER_THE_MONTH);

    expect(await friendsSpendThisMonth(h.db, models, NOW)).toBe(0);
    expect(await checkBudget(h.db, models, BUDGET, alex, NOW)).toBeNull();
  });

  it("limits nobody while sign-up is open", async () => {
    const alex = await account("alex");
    await runs(alex.id, 10, hoursAgo(1), OVER_THE_MONTH);
    expect(await checkBudget(h.db, models, null, alex, NOW)).toBeNull();
  });
});

describe("a spent budget", () => {
  async function friendCookie() {
    const alex = await account("alex");
    await runs(alex.id, BUDGET.dailyRuns, new Date());
    return { alex, cookie: (await createSession(h.db, alex.id)).token };
  }

  function post(url: string, cookie: string, payload: object) {
    return h.app.inject({
      method: "POST",
      url,
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
      payload,
    });
  }

  it("turns a chat message away before saving it or calling a model", async () => {
    const { cookie } = await friendCookie();

    const res = await post("/chat/messages", cookie, { text: "watched ep 3 of frieren" });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "daily_limit" });
    expect(await h.db.select().from(chatMessages)).toEqual([]);
  });

  it("turns an import away before reading the notes", async () => {
    const { cookie } = await friendCookie();

    const res = await post("/imports", cookie, { text: "frieren 10/10" });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "daily_limit" });
    expect(await h.db.select().from(imports)).toEqual([]);
  });
});
