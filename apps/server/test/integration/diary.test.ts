import * as contract from "@kurisu/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { agentRuns, diaryNotes } from "../../src/db/schema.js";
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
  h = await startHarness({ models, roles: { agent: AGENT, escalation: null }, diary: true });
});

afterAll(async () => {
  await h.close();
});

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
  { text: "Updated." },
];

/** The diary reader's turn, after the update commits. */
function reader(reactions: { anime_id: number; words: string }[]): ScriptStep {
  return { toolCalls: [{ name: "save_reactions", arguments: { reactions } }] };
}

function send(method: "GET" | "POST" | "DELETE", url: string, payload?: object) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

/** Waits for the diary's notes: the reader runs in the background after the reply. */
async function notesSaved(count: number) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const notes = await h.db.select().from(diaryNotes);
    if (notes.length >= count) return notes;
    if (Date.now() > deadline) throw new Error("the diary reader saved no note");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Waits for the diary reader to finish, for a message that should save no note. */
async function diaryRead(): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const done = await h.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.promptVersion, "diary@1"), isNotNull(agentRuns.finishedAt)));
    if (done.length > 0) return;
    if (Date.now() > deadline) throw new Error("the diary reader didn't finish");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the diary", () => {
  it("keeps what the user said about a show they updated, in their own words", async () => {
    models.script(AGENT.ref, [
      ...update,
      reader([{ anime_id: WATCHING, words: "that twist was insane" }]),
    ]);

    const res = await send("POST", "/chat/messages", {
      text: "watched ep 8 of fixture watching show, THAT twist was insane",
    });
    expect(res.statusCode).toBe(200);
    const [note] = await notesSaved(1);
    expect(note).toMatchObject({ animeId: WATCHING, text: "THAT twist was insane" });
    // The reader only saw the message and the show it updated.
    const readerRequest = models.requests.at(-1)?.request;
    expect(readerRequest?.messages[0]?.content).toBe(
      [
        "Message: watched ep 8 of fixture watching show, THAT twist was insane",
        "Shows it updated:",
        `- anime_id ${String(WATCHING)}: Fixture Watching Show`,
      ].join("\n"),
    );

    const diary = contract.diaryResponseSchema.parse((await send("GET", "/diary")).json());
    expect(diary.entries).toEqual([
      expect.objectContaining({
        origin: "kurisu",
        kind: "update",
        animeId: WATCHING,
        before: { episodesWatched: 7 },
        after: { episodesWatched: 8 },
        note: { id: note?.id, text: "THAT twist was insane", shared: false },
      }),
    ]);
  });

  it("keeps the whole message when the reader's words aren't the user's, and only for shows updated", async () => {
    models.script(AGENT.ref, [
      ...update,
      reader([
        { anime_id: WATCHING, words: "an amazing episode" },
        { anime_id: 900003, words: "so good" },
      ]),
    ]);

    await send("POST", "/chat/messages", { text: "ep 8 of fixture watching show was so good" });
    const notes = await notesSaved(1);
    expect(notes.map((n) => [n.animeId, n.text])).toEqual([
      [WATCHING, "ep 8 of fixture watching show was so good"],
    ]);
  });

  it("saves nothing when the user said nothing about how they felt", async () => {
    models.script(AGENT.ref, [...update, reader([])]);

    await send("POST", "/chat/messages", { text: "watched ep 8 of fixture watching show" });
    await diaryRead();

    expect(await h.db.select().from(diaryNotes)).toEqual([]);
    const diary = contract.diaryResponseSchema.parse((await send("GET", "/diary")).json());
    expect(diary.entries.map((e) => e.note)).toEqual([null]);
  });

  it("goes away with an undo, and can be deleted on its own", async () => {
    models.script(AGENT.ref, [...update, reader([{ anime_id: WATCHING, words: "loved it" }])]);
    await send("POST", "/chat/messages", {
      text: "watched ep 8 of fixture watching show, loved it",
    });
    const [note] = await notesSaved(1);
    if (!note?.changeId) throw new Error("no note");

    expect((await send("DELETE", `/diary/notes/${note.id}`)).statusCode).toBe(204);
    expect(await h.db.select().from(diaryNotes)).toEqual([]);
    expect((await send("DELETE", `/diary/notes/${note.id}`)).statusCode).toBe(404);

    // A note that's still there leaves with its change's undo.
    await h.db.insert(diaryNotes).values({
      userId: note.userId,
      animeId: WATCHING,
      changeId: note.changeId,
      text: "loved it",
    });
    expect((await send("POST", `/changes/${note.changeId}/undo`)).statusCode).toBe(200);
    expect(await h.db.select().from(diaryNotes)).toEqual([]);
  });
});
