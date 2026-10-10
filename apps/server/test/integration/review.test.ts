import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadCases } from "../../eval/src/cases.js";
import { reviewDraft, writeReviewDraft } from "../../eval/src/reviewExport.js";
import { loadSnapshot } from "../../eval/src/snapshot.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { changes, chatMessages, reviewItems } from "../../src/db/schema.js";
import { ModelProviderError } from "../../src/llm/types.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { lastToolResult, ScriptedModels, type ScriptStep } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const WATCHING = 900001; // Fixture Watching Show, ep 7 of 12

let h: Harness;
let cookie: string;
const models = new ScriptedModels();

beforeAll(async () => {
  h = await startHarness({ models, roles: { agent: AGENT, escalation: null } });
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  models.reset();
  cookie = (await login(h)).sessionCookie ?? "";
});

/** The progress agent's turns: search, propose ep 8, commit, reply. */
const update: ScriptStep[] = [
  { toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture watching show"] } }] },
  {
    toolCalls: [{ name: "propose_update", arguments: { anime_id: WATCHING, episodes_watched: 8 } }],
  },
  (req) => ({
    toolCalls: [
      { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
    ],
  }),
  { text: "Updated Fixture Watching Show to episode 8." },
];

function send(url: string, payload?: object, as = cookie) {
  return h.app.inject({
    method: "POST",
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: as },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

/** Sends a chat message; returns the reply's message id. */
async function chat(text: string): Promise<string> {
  const res = await send("/chat/messages", { text });
  expect(res.statusCode).toBe(200);
  const reply = res.json<{ messages: { id: string; role: string }[] }>().messages.at(-1);
  if (reply?.role !== "assistant") throw new Error("no reply");
  return reply.id;
}

/** Waits for the queue to hold `count` items: capture runs in the background. */
async function queued(count: number) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const items = await h.db.select().from(reviewItems);
    if (items.length >= count) return items;
    if (Date.now() > deadline) throw new Error(`the queue has ${String(items.length)} items`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Gives a background capture that shouldn't happen time to (not) happen. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

describe("the review queue", () => {
  it("keeps a reported reply with the list as it was before the run", async () => {
    models.script(AGENT.ref, update);
    const replyId = await chat("watched ep 8 of fixture watching show");

    const res = await send(`/chat/messages/${replyId}/report`, { note: "I meant the film" });

    expect(res.statusCode).toBe(202);
    const [item] = await queued(1);
    expect(item).toMatchObject({
      kind: "report",
      note: "I meant the film",
      message: "watched ep 8 of fixture watching show",
      reply: "Updated Fixture Watching Show to episode 8.",
      history: [],
      status: "new",
    });
    // The run moved the show to ep 8; the queue keeps ep 7, as the agent saw it.
    const entry = (item?.listSnapshot as { id: number; episodesWatched: number }[]).find(
      (e) => e.id === WATCHING,
    );
    expect(entry?.episodesWatched).toBe(7);

    // Reporting it again doesn't queue it twice.
    expect((await send(`/chat/messages/${replyId}/report`, {})).statusCode).toBe(202);
    await settle();
    expect(await h.db.select().from(reviewItems)).toHaveLength(1);
  });

  it("queues a chat write undone soon after, but not a List-screen edit", async () => {
    models.script(AGENT.ref, update);
    await chat("watched ep 8 of fixture watching show");
    const [change] = await h.db.select({ id: changes.id }).from(changes);
    if (!change) throw new Error("no change");

    expect((await send(`/changes/${change.id}/undo`)).statusCode).toBe(200);
    const [item] = await queued(1);
    expect(item).toMatchObject({
      kind: "undone",
      message: "watched ep 8 of fixture watching show",
    });

    const edited = await send(`/list/${String(WATCHING)}/edit`, {
      episodesWatched: 9,
      requestId: crypto.randomUUID(),
    });
    const editId = edited.json<{ change: { id: string } }>().change.id;
    expect((await send(`/changes/${editId}/undo`)).statusCode).toBe(200);
    await settle();
    expect(await h.db.select().from(reviewItems)).toHaveLength(1);
  });

  it("queues a run that failed, but not a model outage", async () => {
    models.script(AGENT.ref, [{ throws: new ModelProviderError("ollama", "unavailable", "down") }]);
    await chat("watched ep 8 of fixture watching show");
    await settle();
    expect(await h.db.select().from(reviewItems)).toEqual([]);

    models.script(AGENT.ref, [
      { throws: new ModelProviderError("ollama", "bad_response", "garbled") },
    ]);
    await chat("watched ep 8 of fixture watching show");
    const [item] = await queued(1);
    expect(item).toMatchObject({ kind: "error", note: "model_bad_response" });
  });

  it("only lets you report your own replies", async () => {
    models.script(AGENT.ref, update);
    const replyId = await chat("watched ep 8 of fixture watching show");
    const [userMessage] = await h.db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.role, "user"));

    expect((await send(`/chat/messages/${crypto.randomUUID()}/report`, {})).statusCode).toBe(404);
    expect((await send(`/chat/messages/${userMessage?.id ?? ""}/report`, {})).statusCode).toBe(404);
    expect((await send(`/chat/messages/${replyId}/report`, {}, "not-a-session")).statusCode).toBe(
      401,
    );
  });

  it("exports an item as a draft case that runs against its own list once labeled", async () => {
    models.script(AGENT.ref, update);
    const replyId = await chat("watched ep 8 of fixture watching show");
    await send(`/chat/messages/${replyId}/report`, {});
    const [item] = await queued(1);
    if (!item) throw new Error("nothing queued");

    const dir = mkdtempSync(join(tmpdir(), "kurisu-review-"));
    try {
      const dirs = { drafts: `${dir}/drafts/`, snapshots: `${dir}/snapshots/` };
      const { name } = writeReviewDraft(item, dirs);
      expect(reviewDraft(item).yaml).toContain("expect: {}");

      // The owner labels it: here, as if they'd said ep 8 was right.
      const labeled = readFileSync(`${dirs.drafts}${name}.yaml`, "utf8").replace(
        "expect: {}",
        `expect:\n      writes:\n        - anime: ${String(WATCHING)}\n          episodes_watched: 8`,
      );
      writeFileSync(`${dir}/${name}.yaml`, labeled);

      const loaded = loadCases(`${dir}/`, (n) => loadSnapshot(n, dirs.snapshots), null, null);
      expect(loaded.errors).toEqual([]);
      expect(loaded.cases.map((c) => c.case.id)).toEqual([name]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
