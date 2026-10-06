import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PROGRESS_SYNC_V9 } from "../../src/agent/prompts/progressSync.v9.js";
import { runAgent } from "../../src/agent/runAgent.js";
import { changes, dropReasons, proposals, tasteGenres, users } from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { loadTaste, refreshTaste } from "../../src/taste/profile.js";
import { createMalListWriter } from "../../src/writes/commit.js";
import { undoChange } from "../../src/writes/undo.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { lastToolResult, ScriptedModels } from "../support/scriptedModels.js";

const LITE = parseModelRef("ollama:test-lite");
const WATCHING = 900001; // Fixture Watching Show: Action, Fantasy

let h: Harness;
let userId: string;
const models = new ScriptedModels();

beforeAll(async () => {
  h = await startHarness({ models, roles: { agent: LITE, escalation: null } });
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  models.reset();
  await login(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

const writeDeps = () => ({
  db: h.db,
  writeListStatus: createMalListWriter({
    tokenStore: h.tokenStore,
    apiBaseUrl: h.config.mal.apiBaseUrl,
  }),
});

function run(message: string) {
  return runAgent(
    { ...writeDeps(), models, prompt: PROGRESS_SYNC_V9 },
    { userId, conversationId: null, history: [], message, model: LITE },
  );
}

describe("rating patterns", () => {
  it("averages scores per genre against the overall average, shrunk when few shows back it", async () => {
    // Scored: Film 9 (Drama), Paused 6 and Rewatch 10 (Comedy, Slice of Life), Dropped 3
    // (Action, Horror). Overall 7.
    await refreshTaste(h.db, userId);
    const taste = await loadTaste(h.db, userId);

    expect(taste.overallMean).toBe(7);
    expect(taste.scoredCount).toBe(4);
    const byGenre = Object.fromEntries(taste.genres.map((g) => [g.genre, g]));
    expect(byGenre.Drama).toMatchObject({ scored: 1, meanScore: 9, dropped: 0 });
    expect(byGenre.Drama?.affinity).toBeCloseTo((9 - 7) / 6);
    expect(byGenre.Comedy).toMatchObject({ scored: 2, meanScore: 8 });
    expect(byGenre.Comedy?.affinity).toBeCloseTo(((8 - 7) * 2) / 7);
    expect(byGenre.Action).toMatchObject({ scored: 1, meanScore: 3, dropped: 1 });
    expect(byGenre.Action?.affinity).toBeCloseTo(-4 / 6);
    // Nothing scored in Fantasy yet: neutral.
    expect(byGenre.Fantasy).toMatchObject({ scored: 0, meanScore: null, affinity: 0 });
    // Best first.
    expect(taste.genres[0]?.genre).toBe("Drama");
  });

  it("is refreshed in the background after a list sync", async () => {
    // beforeEach logged in, which synced.
    const deadline = Date.now() + 5_000;
    let rows = 0;
    while (Date.now() < deadline && rows === 0) {
      rows = (await h.db.select().from(tasteGenres).where(eq(tasteGenres.userId, userId))).length;
      if (rows === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(rows).toBeGreaterThan(0);
  });
});

describe("drop reasons", () => {
  function dropScript(args: Record<string, unknown>) {
    return [
      {
        toolCalls: [{ name: "search_my_list", arguments: { queries: ["fixture watching show"] } }],
      },
      { toolCalls: [{ name: "propose_update", arguments: { anime_id: WATCHING, ...args } }] },
      (req: Parameters<typeof lastToolResult>[0]) => {
        const result = lastToolResult(req);
        return result.proposal_id
          ? {
              toolCalls: [
                { name: "commit_update", arguments: { proposal_id: result.proposal_id } },
              ],
            }
          : { text: String(result.message) };
      },
      { text: "Dropped." },
    ];
  }

  it("saves the user's own words with the category when the drop commits, and undo takes it back", async () => {
    models.script(LITE.ref, dropScript({ status: "dropped", drop_reason: "pacing" }));

    const result = await run("dropping fixture watching show, way too slow");

    expect(result.committed).toHaveLength(1);
    const [reason] = await h.db.select().from(dropReasons);
    expect(reason).toMatchObject({
      userId,
      animeId: WATCHING,
      category: "pacing",
      said: "dropping fixture watching show, way too slow",
      changeId: result.committed[0]?.id,
    });
    expect((await loadTaste(h.db, userId)).dropReasons).toMatchObject([
      { animeId: WATCHING, title: "Fixture Watching Show", category: "pacing" },
    ]);

    const [change] = await h.db.select().from(changes);
    if (!change) throw new Error("no change");
    expect((await undoChange(writeDeps(), userId, change.id)).status).toBe("committed");
    expect(await h.db.select().from(dropReasons)).toEqual([]);
  });

  it("records nothing for a drop without a reason", async () => {
    models.script(LITE.ref, dropScript({ status: "dropped" }));

    await run("dropping fixture watching show");

    expect(await h.db.select().from(dropReasons)).toEqual([]);
  });

  it("refuses a reason on anything but a drop", async () => {
    models.script(LITE.ref, dropScript({ episodes_watched: 8, drop_reason: "story" }));

    const result = await run("watched ep 8 of fixture watching show");

    expect(result.committed).toEqual([]);
    expect(await h.db.select().from(proposals)).toEqual([]);
    expect(await h.db.select().from(dropReasons)).toEqual([]);
  });
});
