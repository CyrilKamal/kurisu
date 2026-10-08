import * as contract from "@kurisu/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { listEntries, users } from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { fixtureList } from "../fixtures/animeList.js";
import { catalogMedia, FakeAniList } from "../support/fakeAniList.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";
import { ScriptedModels } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const WATCHING = 900001; // Fixture Watching Show: watching, ep 7 of 12
const PAUSED = 900003; // Fixture Paused Show: on hold, ep 10 of 24
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
    roles: { agent: AGENT, escalation: null },
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
  h.fakeMal.catalog = [
    {
      id: NEW_SHOW,
      title: "Fixture New Show",
      media_type: "tv",
      num_episodes: 12,
      status: "finished_airing",
    },
  ];
  anilist.reset();
  anilist.catalog = [catalogMedia(5001, NEW_SHOW, "Fixture New Show")];
  models.reset();
  cookie = (await login(h)).sessionCookie ?? "";
  await backgroundSettled(h);
  const [user] = await h.db.select().from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

function request(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}

/** What the model reports for the notes: one report_items call. */
function reads(items: Record<string, unknown>[]) {
  models.script(AGENT.ref, [{ toolCalls: [{ name: "report_items", arguments: { items } }] }]);
}

async function settle(id: string, statuses: contract.ImportStatus[]) {
  const until = Date.now() + 5000;
  for (;;) {
    const res = await request("GET", `/imports/${id}`);
    const view = contract.importResponseSchema.parse(res.json()).import;
    if (statuses.includes(view.status)) return view;
    if (Date.now() > until) throw new Error(`import stuck at ${view.status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function start(text: string) {
  const res = await request("POST", "/imports", { text });
  expect(res.statusCode).toBe(202);
  const { id } = contract.importResponseSchema.parse(res.json()).import;
  return settle(id, ["review", "failed"]);
}

async function entry(animeId: number) {
  const [row] = await h.db
    .select()
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)));
  return row ?? null;
}

const byLine = (view: contract.ImportView, lineNo: number) => {
  const item = view.items.find((i) => i.lineNo === lineNo);
  if (!item) throw new Error(`no item for line ${String(lineNo)}`);
  return item;
};

describe("importing notes", () => {
  it("groups each line, writes only what's checked, and undoes it all", async () => {
    reads([
      { line: 1, not_a_show: true },
      {
        line: 2,
        said: "fixture watching show ep 9",
        title: "fixture watching show",
        episodes_watched: 9,
      },
      {
        line: 3,
        said: "fixture paused show ep 3",
        title: "fixture paused show",
        episodes_watched: 3,
      },
      { line: 4, said: "fixture completed film 9/10", title: "fixture completed film", score: 9 },
      { line: 5, said: "Fixture New Show 10/10", title: "Fixture New Show", score: 10 },
      { line: 6, said: "zzz nothing", title: "zzz nothing" },
    ]);
    const review = await start(
      [
        "my anime notes",
        "fixture watching show ep 9",
        "fixture paused show ep 3",
        "fixture completed film 9/10",
        "Fixture New Show 10/10",
        "zzz nothing",
        "fixture zzz rewatch",
      ].join("\n"),
    );

    expect(review.status).toBe("review");
    expect(byLine(review, 1).group).toBe("not_a_show");
    expect(byLine(review, 2)).toMatchObject({
      group: "update",
      show: { animeId: WATCHING },
      malState: { status: "watching", episodesWatched: 7 },
      change: { episodesWatched: 9 },
      checked: true,
    });
    // Lower progress: kept as MAL has it unless the user says otherwise.
    expect(byLine(review, 3)).toMatchObject({
      group: "disagree",
      change: { episodesWatched: 3 },
      checked: false,
      resolution: "keep_mal",
    });
    expect(byLine(review, 4).group).toBe("up_to_date");
    // Not on the list, a score and no status: added as Completed.
    expect(byLine(review, 5)).toMatchObject({
      group: "add",
      show: { animeId: NEW_SHOW, status: null },
      change: { status: "completed", episodesWatched: 12, score: 10 },
      checked: true,
    });
    expect(byLine(review, 6).group).toBe("not_found");
    // The model skipped line 7: it still shows, as unread.
    expect(byLine(review, 7)).toMatchObject({
      group: "not_found",
      note: "Couldn't read this line.",
    });
    expect(h.fakeMal.patchRequests).toEqual([]);

    const run = await request("POST", `/imports/${review.id}/run`);
    expect(run.statusCode).toBe(202);
    const done = await settle(review.id, ["done", "failed"]);

    expect(done.status).toBe("done");
    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([WATCHING, NEW_SHOW]);
    expect(byLine(done, 2).status).toBe("committed");
    expect(byLine(done, 5).status).toBe("committed");
    expect(byLine(done, 3).status).toBe("skipped");
    expect(await entry(WATCHING)).toMatchObject({ numEpisodesWatched: 9 });
    expect(await entry(NEW_SHOW)).toMatchObject({ status: "completed", score: 10 });
    expect(await entry(PAUSED)).toMatchObject({ numEpisodesWatched: 10 });

    const history = contract.changesResponseSchema.parse((await request("GET", "/changes")).json());
    expect(history.changes.map((c) => [c.animeId, c.source])).toEqual([
      [NEW_SHOW, "import"],
      [WATCHING, "import"],
    ]);

    const undo = await request("POST", `/imports/${review.id}/undo`);
    expect(undo.statusCode).toBe(202);
    const undone = await settle(review.id, ["undone", "failed"]);
    expect(undone.status).toBe("undone");
    expect(byLine(undone, 2).status).toBe("undone");
    expect(await entry(WATCHING)).toMatchObject({ numEpisodesWatched: 7 });
    expect(await entry(NEW_SHOW)).toBeNull();
    expect(h.fakeMal.deleteRequests).toEqual([NEW_SHOW]);
  });

  it("writes a disagreement the user settles in favor of the notes", async () => {
    reads([
      {
        line: 1,
        said: "fixture paused show ep 3",
        title: "fixture paused show",
        episodes_watched: 3,
      },
    ]);
    const review = await start("fixture paused show ep 3");
    const item = byLine(review, 1);

    const patched = await request("PATCH", `/imports/${review.id}/items/${item.id}`, {
      resolution: "use_notes",
    });
    expect(contract.importItemResponseSchema.parse(patched.json()).item).toMatchObject({
      checked: true,
      resolution: "use_notes",
    });
    await request("POST", `/imports/${review.id}/run`);
    await settle(review.id, ["done"]);
    expect(await entry(PAUSED)).toMatchObject({ numEpisodesWatched: 3 });
  });

  it("lets the user say which show a line means", async () => {
    reads([{ line: 1, said: "fixture show ep 8", title: "fixture show", episodes_watched: 8 }]);
    const review = await start("fixture show ep 8");
    const item = byLine(review, 1);
    expect(item.group).toBe("which_one");
    expect(item.candidates.map((c) => c.animeId)).toContain(WATCHING);

    const picked = await request("PATCH", `/imports/${review.id}/items/${item.id}`, {
      animeId: WATCHING,
    });
    expect(contract.importItemResponseSchema.parse(picked.json()).item).toMatchObject({
      group: "update",
      show: { animeId: WATCHING },
      change: { episodesWatched: 8 },
      checked: true,
    });
    // Only one of its candidates can be picked.
    const wrong = await request("PATCH", `/imports/${review.id}/items/${item.id}`, {
      animeId: 123456,
    });
    expect(wrong.statusCode).toBe(400);

    await request("POST", `/imports/${review.id}/run`);
    await settle(review.id, ["done"]);
    expect(await entry(WATCHING)).toMatchObject({ numEpisodesWatched: 8 });
  });

  it("doesn't write a row whose show changed since the review", async () => {
    reads([
      {
        line: 1,
        said: "fixture watching show ep 9",
        title: "fixture watching show",
        episodes_watched: 9,
      },
    ]);
    const review = await start("fixture watching show ep 9");
    // A sync brought in progress made on MAL meanwhile.
    await h.db
      .update(listEntries)
      .set({ numEpisodesWatched: 8 })
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, WATCHING)));

    await request("POST", `/imports/${review.id}/run`);
    const done = await settle(review.id, ["done"]);
    expect(byLine(done, 1)).toMatchObject({ status: "failed", error: "changed_since_review" });
    expect(h.fakeMal.patchRequests).toEqual([]);
  });

  it("fails cleanly when the notes can't be read, and can be thrown away", async () => {
    models.script(AGENT.ref, [{ text: "I can't do that." }]);
    const failed = await start("something");
    expect(failed).toMatchObject({ status: "failed", error: "parse_failed" });

    expect((await request("DELETE", `/imports/${failed.id}`)).statusCode).toBe(204);
    const latest = contract.latestImportResponseSchema.parse(
      (await request("GET", "/imports/latest")).json(),
    );
    expect(latest.import).toBeNull();
  });

  it("only runs an import in review, and only the user's own", async () => {
    reads([
      {
        line: 1,
        said: "fixture watching show ep 9",
        title: "fixture watching show",
        episodes_watched: 9,
      },
    ]);
    const review = await start("fixture watching show ep 9");
    expect((await request("POST", `/imports/${review.id}/undo`)).statusCode).toBe(409);
    expect((await request("POST", `/imports/${crypto.randomUUID()}/run`)).statusCode).toBe(404);
    const noOrigin = await h.app.inject({
      method: "POST",
      url: `/imports/${review.id}/run`,
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(noOrigin.statusCode).toBe(403);
    expect((await request("POST", "/imports", { text: "" })).statusCode).toBe(400);
  });
});
