import * as contract from "@kurisu/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PROGRESS_SYNC_V12 } from "../../src/agent/prompts/progressSync.v12.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { anime, listEntries, proposals, users } from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { fixtureList } from "../fixtures/animeList.js";
import { catalogMedia, FakeAniList } from "../support/fakeAniList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { lastToolResult, ScriptedModels, type ScriptStep } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const FLASH = parseModelRef("ollama:test-flash");
const NEW_SHOW = 777001;

const models = new ScriptedModels();
let h: Harness;
let anilist: FakeAniList;
let cookie: string;
let userId: string;

beforeAll(async () => {
  anilist = await FakeAniList.start();
  h = await startHarness({
    models,
    roles: { agent: AGENT, escalation: FLASH },
    prompt: PROGRESS_SYNC_V12,
    env: { ANILIST_API_URL: anilist.apiUrl },
  });
});

afterAll(async () => {
  await h.close();
  await anilist.stop();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  h.fakeMal.list = fixtureList();
  // MAL's own view of the show, which replaces AniList's once it's added.
  h.fakeMal.catalog = [
    {
      id: NEW_SHOW,
      title: "Fixture New Show",
      alternative_titles: { synonyms: [], en: "The New Show", ja: "" },
      media_type: "tv",
      num_episodes: 12,
      status: "finished_airing",
      genres: [{ id: 36, name: "Slice of Life" }],
      average_episode_duration: 1440,
      mean: 7.9,
    },
  ];
  anilist.reset();
  anilist.catalog = [
    catalogMedia(5001, NEW_SHOW, "Fixture New Show"),
    catalogMedia(5002, 777002, "Fixture New Show 2nd Season"),
  ];
  models.reset();
  const result = await login(h);
  cookie = result.sessionCookie ?? "";
  const [user] = await h.db.select().from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

function post(url: string, body?: Record<string, unknown>) {
  return h.app.inject({
    method: "POST",
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(body ? { payload: body } : {}),
  });
}

async function say(text: string) {
  const res = await post("/chat/messages", { text });
  return contract.chatThreadResponseSchema.parse(res.json());
}

/** Finds the new show outside the list and proposes it, then tries to commit it anyway. */
function addScript(change: Record<string, unknown> = {}): ScriptStep[] {
  return [
    { toolCalls: [{ name: "search_anime", arguments: { queries: ["Fixture New Show"] } }] },
    (req) => {
      const results = lastToolResult(req).results as { anime_id: number }[];
      return {
        toolCalls: [
          { name: "propose_update", arguments: { anime_id: results[0]?.anime_id, ...change } },
        ],
      };
    },
    (req) => ({
      toolCalls: [
        { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
      ],
    }),
    { text: "Tap Add to put Fixture New Show on your list." },
  ];
}

async function entry() {
  const [row] = await h.db
    .select()
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, NEW_SHOW)));
  return row ?? null;
}

async function addAndConfirm(change: Record<string, unknown> = {}) {
  models.script(AGENT.ref, addScript(change));
  const chat = await say("add fixture new show");
  const pending = chat.messages[1]?.pending[0];
  const res = await post(`/proposals/${pending?.id ?? ""}/confirm`);
  return contract.changeResponseSchema.parse(res.json()).change;
}

describe("adding a show that isn't on the list", () => {
  it("always waits for the user, even when the model commits it", async () => {
    models.script(AGENT.ref, addScript());

    const chat = await say("add fixture new show to my plan to watch");

    const reply = chat.messages[1];
    expect(reply?.changes).toEqual([]);
    expect(reply?.pending).toHaveLength(1);
    const held = reply?.pending[0];
    expect(held).toMatchObject({
      animeId: NEW_SHOW,
      kind: "add",
      reason: "adds_to_list",
      before: {},
      change: { status: "plan_to_watch" },
    });
    expect(held?.show).toMatchObject({ title: "Fixture New Show", status: null });
    expect(held?.show?.pictureUrl).toContain("s4.anilist.co");
    expect(h.fakeMal.patchRequests).toEqual([]);
    expect(await entry()).toBeNull();
    // Holding an add is by design, so it doesn't escalate to the stronger model.
    expect(models.requests.map((r) => r.ref)).not.toContain(FLASH.ref);
  });

  it("adds what the user said: progress makes it Watching, finishing it Completed", async () => {
    models.script(AGENT.ref, addScript({ episodes_watched: 3 }));
    const watching = await say("watched ep 3 of fixture new show");
    expect(watching.messages[1]?.pending[0]?.change).toEqual({
      status: "watching",
      episodesWatched: 3,
    });

    models.script(AGENT.ref, addScript({ status: "completed", score: 8 }));
    const finished = await say("finished fixture new show, 8/10");
    expect(finished.messages[1]?.pending[0]?.change).toEqual({
      status: "completed",
      episodesWatched: 12,
      score: 8,
    });
  });

  it("puts the show on the list once confirmed, with MAL's own details", async () => {
    const change = await addAndConfirm();

    expect(change).toMatchObject({ kind: "add", before: {}, after: { status: "plan_to_watch" } });
    expect(h.fakeMal.patchRequests).toEqual([
      { animeId: NEW_SHOW, form: { status: "plan_to_watch" } },
    ]);
    expect(await entry()).toMatchObject({ status: "plan_to_watch", numEpisodesWatched: 0 });
    const [row] = await h.db.select().from(anime).where(eq(anime.malId, NEW_SHOW));
    expect(row).toMatchObject({ titleEn: "The New Show", genres: ["Slice of Life"], malMean: 7.9 });
    const list = contract.listResponseSchema.parse(
      (
        await h.app.inject({ method: "GET", url: "/list", cookies: { [SESSION_COOKIE]: cookie } })
      ).json(),
    );
    expect(list.entries.map((e) => e.animeId)).toContain(NEW_SHOW);
  });

  it("won't add a show that got onto the list in the meantime", async () => {
    models.script(AGENT.ref, addScript());
    const chat = await say("add fixture new show");
    await h.db.insert(listEntries).values({
      userId,
      animeId: NEW_SHOW,
      status: "watching",
      score: 0,
      numEpisodesWatched: 2,
      isRewatching: false,
      malUpdatedAt: new Date(),
      syncedAt: new Date(),
    });

    const res = await post(`/proposals/${chat.messages[1]?.pending[0]?.id ?? ""}/confirm`);

    expect(res.statusCode).toBe(409);
    expect(h.fakeMal.patchRequests).toEqual([]);
  });

  it("undo takes the show off the list again, and undoing that puts it back", async () => {
    const added = await addAndConfirm();

    const undo = await post(`/changes/${added.id}/undo`);
    expect(undo.statusCode).toBe(200);
    const removed = contract.changeResponseSchema.parse(undo.json()).change;
    expect(removed).toMatchObject({ kind: "remove", isUndo: true, after: {} });
    expect(h.fakeMal.deleteRequests).toEqual([NEW_SHOW]);
    expect(await entry()).toBeNull();

    const redo = await post(`/changes/${removed.id}/undo`);
    expect(redo.statusCode).toBe(200);
    expect(contract.changeResponseSchema.parse(redo.json()).change.kind).toBe("add");
    expect(await entry()).toMatchObject({ status: "plan_to_watch" });
  });

  it("won't undo an add once the show has progress, which removing would lose", async () => {
    const added = await addAndConfirm();
    await h.db
      .update(listEntries)
      .set({ status: "watching", numEpisodesWatched: 1 })
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, NEW_SHOW)));

    const undo = await post(`/changes/${added.id}/undo`);

    expect(undo.statusCode).toBe(409);
    expect(contract.writeErrorResponseSchema.parse(undo.json()).error).toBe("changed_since");
    expect(h.fakeMal.deleteRequests).toEqual([]);
  });

  it("finds shows on the list too, which are updated as usual, not added", async () => {
    models.script(AGENT.ref, [
      { toolCalls: [{ name: "search_anime", arguments: { queries: ["Fixture Watching Show"] } }] },
      (req) => {
        const results = lastToolResult(req).results as {
          anime_id: number;
          on_your_list: unknown;
          clear_match: boolean;
        }[];
        expect(results[0]).toMatchObject({
          anime_id: 900001,
          on_your_list: { status: "watching", episodes_watched: 7 },
          clear_match: true,
        });
        return {
          toolCalls: [
            {
              name: "propose_update",
              arguments: { anime_id: results[0]?.anime_id, episodes_watched: 8 },
            },
          ],
        };
      },
      (req) => ({
        toolCalls: [
          { name: "commit_update", arguments: { proposal_id: lastToolResult(req).proposal_id } },
        ],
      }),
      { text: "Updated Fixture Watching Show to episode 8." },
    ]);

    const chat = await say("watched ep 8 of fixture watching show");

    expect(chat.messages[1]?.changes.map((c) => [c.kind, c.after])).toEqual([
      ["update", { episodesWatched: 8 }],
    ]);
    expect(chat.messages[1]?.pending).toEqual([]);
  });

  it("asks which show with cards when several fit", async () => {
    models.script(AGENT.ref, [
      { toolCalls: [{ name: "search_anime", arguments: { queries: ["fixture new show"] } }] },
      { text: "Did you mean Fixture New Show or Fixture New Show 2nd Season?" },
    ]);

    const chat = await say("add fixture new show");

    const reply = chat.messages[1];
    expect(reply?.asksToChoose).toBe(true);
    expect(reply?.shows.map((s) => [s.title, s.status])).toEqual([
      ["Fixture New Show", null],
      ["Fixture New Show 2nd Season", null],
    ]);
    expect(await h.db.select().from(proposals)).toEqual([]);
  });
});
