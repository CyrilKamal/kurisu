import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseModelRef } from "../../src/llm/modelConfig.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import {
  anilistCatalog,
  anilistMedia,
  anime,
  briefSettings,
  briefs,
  chatMessages,
  conversations,
  listEvents,
  seasonShows,
  users,
} from "../../src/db/schema.js";
import { SEARCHES_PER_MINUTE } from "../../src/shows/routes.js";
import { fixtureList } from "../fixtures/animeList.js";
import { airingMedia, catalogMedia, FakeAniList } from "../support/fakeAniList.js";
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
const WATCHING = 900001; // Fixture Watching Show: watching, ep 7 of 12, finished airing
const COMPLETED = 900002; // Fixture Completed Film
const PLANNED = 900005; // Fixture Unannounced Sequel: plan to watch, not yet aired
const NEW_SHOW = 777001;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
  anilist.catalog = [
    catalogMedia(5001, NEW_SHOW, "Fixture New Show", {
      title: { romaji: "Fixture New Show", english: "The New Show", native: null },
    }),
  ];
  models.reset();
  cookie = (await login(h)).sessionCookie ?? "";
  await backgroundSettled(h);
  const [user] = await h.db.select({ id: users.id }).from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
});

function request(method: "GET" | "POST", url: string, body?: unknown) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}

/** Replaces the cached AniList row for a show. */
async function airing(malId: number, values: Partial<typeof anilistMedia.$inferInsert>) {
  await h.db.delete(anilistMedia).where(eq(anilistMedia.malId, malId));
  await h.db.insert(anilistMedia).values({
    malId,
    anilistId: malId + 1,
    status: "RELEASING",
    episodes: 12,
    fetchedAt: new Date(),
    ...values,
  });
}

const crunchyroll = { siteId: 5, site: "Crunchyroll", url: "https://www.crunchyroll.com/series/1" };

describe("GET /today", () => {
  it("shows what's out, what's next, and the latest brief", async () => {
    await h.db.delete(anilistMedia);
    // Episode 10 airs in two days, so 9 is out; they're at 7.
    await airing(WATCHING, {
      nextEpisode: 10,
      nextAiringAt: new Date(Date.now() + 2 * DAY_MS),
      streamingLinks: [crunchyroll],
    });
    // A Plan to Watch show premieres in three days.
    await airing(PLANNED, {
      status: "NOT_YET_RELEASED",
      nextEpisode: 1,
      nextAiringAt: new Date(Date.now() + 3 * DAY_MS),
    });
    await h.db.insert(briefSettings).values({ userId, services: ["crunchyroll"] });
    const [chat] = await h.db.insert(conversations).values({ userId }).returning();
    if (!chat) throw new Error("no conversation");
    const [message] = await h.db
      .insert(chatMessages)
      .values({ conversationId: chat.id, role: "assistant", content: "Two new episodes." })
      .returning();
    await h.db.insert(briefs).values({
      userId,
      kind: "daily",
      localDate: "2026-10-09",
      status: "sent",
      summary: "Two new episodes.",
      items: [
        {
          malId: WATCHING,
          title: "Fixture Watching Show",
          episodes: [8, 9],
          premiere: false,
          finale: false,
          episodesWatched: 7,
          services: [],
        },
      ],
      chatMessageId: message?.id ?? null,
    });

    const res = await request("GET", "/today");
    expect(res.statusCode).toBe(200);
    const today = contract.todayResponseSchema.parse(res.json());
    expect(today.outNow).toEqual([
      expect.objectContaining({
        animeId: WATCHING,
        episodesWatched: 7,
        latestAired: 9,
        watchOn: [{ service: "Crunchyroll", url: crunchyroll.url }],
      }),
    ]);
    expect(today.comingUp).toEqual([
      expect.objectContaining({ animeId: PLANNED, status: "plan_to_watch", episode: 1 }),
    ]);
    // Watching, but with new episodes out: it's under "out", not "continue".
    expect(today.continueWatching).toEqual([]);
    expect(today.brief).toMatchObject({
      conversationId: chat.id,
      localDate: "2026-10-09",
      episodes: 2,
      premieres: 0,
    });
  });

  it("lists a show with nothing new airing under Continue, and is empty for a new list", async () => {
    await h.db.delete(anilistMedia);
    const today = contract.todayResponseSchema.parse((await request("GET", "/today")).json());
    expect(today.outNow).toEqual([]);
    expect(today.comingUp).toEqual([]);
    expect(today.continueWatching.map((s) => s.animeId)).toEqual([WATCHING]);
    expect(today.brief).toBeNull();
    expect(today.friends).toEqual([]);
  });
});

describe("GET /shows/:animeId", () => {
  it("fetches the synopsis once, as plain text without spoilers", async () => {
    anilist.media = [
      airingMedia(5100, WATCHING, {
        description:
          "A <i>quiet</i> story &amp; its keeper.<br><br>\n~!The keeper was a ghost.!~<br>\n(Source: Fixture)",
      }),
    ];
    const res = await request("GET", `/shows/${String(WATCHING)}`);
    expect(res.statusCode).toBe(200);
    const page = contract.showResponseSchema.parse(res.json());
    expect(page.show).toMatchObject({
      animeId: WATCHING,
      title: "Fixture Watching Show",
      altTitles: ["The Watching Show", "FWS"],
      synopsis: "A quiet story & its keeper.\n\n(Source: Fixture)",
    });
    expect(page.entry).toMatchObject({ status: "watching", episodesWatched: 7 });

    const again = contract.showResponseSchema.parse(
      (await request("GET", `/shows/${String(WATCHING)}`)).json(),
    );
    expect(again.show.synopsis).toBe(page.show.synopsis);
    expect(anilist.requests.filter((r) => r.query.includes("description"))).toHaveLength(1);
  });

  it("remembers that AniList has no synopsis, and opens without one when AniList is down", async () => {
    anilist.media = [airingMedia(5100, WATCHING, { description: null })];
    const none = contract.showResponseSchema.parse(
      (await request("GET", `/shows/${String(WATCHING)}`)).json(),
    );
    expect(none.show.synopsis).toBeNull();
    const [row] = await h.db
      .select({ synopsis: anime.synopsis })
      .from(anime)
      .where(eq(anime.malId, WATCHING));
    expect(row?.synopsis).toBe("");

    anilist.failNext(500, 5);
    const down = await request("GET", `/shows/${String(COMPLETED)}`);
    expect(down.statusCode).toBe(200);
    expect(contract.showResponseSchema.parse(down.json()).show.synopsis).toBeNull();
    const [film] = await h.db
      .select({ synopsis: anime.synopsis })
      .from(anime)
      .where(eq(anime.malId, COMPLETED));
    // Nothing stored, so the next view tries again.
    expect(film?.synopsis).toBeNull();
  });

  it("shows this show's journal and where to watch it, and 404s a show kurisu never saw", async () => {
    await airing(WATCHING, { streamingLinks: [crunchyroll] });
    await h.db.insert(briefSettings).values({ userId, services: ["crunchyroll"] });
    const edit = await request("POST", `/list/${String(WATCHING)}/edit`, {
      episodesWatched: 8,
      requestId: crypto.randomUUID(),
    });
    expect(edit.statusCode).toBe(200);

    const page = contract.showResponseSchema.parse(
      (await request("GET", `/shows/${String(WATCHING)}`)).json(),
    );
    expect(page.watchOn).toEqual([{ service: "Crunchyroll", url: crunchyroll.url }]);
    expect(page.journal).toEqual([
      expect.objectContaining({ type: "change", source: "user", after: { episodesWatched: 8 } }),
    ]);
    expect(page.friends).toEqual([]);

    expect((await request("GET", "/shows/123456789")).statusCode).toBe(404);
    expect((await request("GET", "/shows/abc")).statusCode).toBe(404);
  });
});

describe("GET /search", () => {
  it("finds shows on AniList, says which are on the list, and opens their pages", async () => {
    anilist.catalog.push(catalogMedia(5002, WATCHING, "Fixture Watching Show"));
    const res = await request("GET", "/search?q=fixture");
    expect(res.statusCode).toBe(200);
    const found = contract.searchResponseSchema.parse(res.json());
    expect(found.query).toBe("fixture");
    expect(found.results).toEqual([
      expect.objectContaining({
        animeId: NEW_SHOW,
        title: "Fixture New Show",
        titleEn: "The New Show",
        year: 2024,
        entry: null,
      }),
      // On the list: MAL's own row, with where it stands.
      expect.objectContaining({
        animeId: WATCHING,
        entry: { status: "watching", episodesWatched: 7 },
      }),
    ]);
    const page = await request("GET", `/shows/${String(NEW_SHOW)}`);
    expect(page.statusCode).toBe(200);
    expect(contract.showResponseSchema.parse(page.json()).entry).toBeNull();
  });

  it("shows this season's popular shows before any words", async () => {
    await h.db.insert(anilistCatalog).values([
      {
        malId: 880001,
        anilistId: 8001,
        title: "Fixture Season Hit",
        mediaType: "tv",
        startDate: "2026-10-02",
      },
      { malId: 880002, anilistId: 8002, title: "Fixture Season Second", mediaType: "tv" },
    ]);
    await h.db.insert(seasonShows).values([
      { malId: 880002, anilistId: 8002, season: "2026 FALL", rank: 2, fetchedAt: new Date() },
      { malId: 880001, anilistId: 8001, season: "2026 FALL", rank: 1, fetchedAt: new Date() },
    ]);
    const found = contract.searchResponseSchema.parse(
      (await request("GET", "/search?q=%20")).json(),
    );
    expect(found.query).toBe("");
    expect(found.results.map((r) => [r.animeId, r.year])).toEqual([
      [880001, 2026],
      [880002, null],
    ]);
    // Stored, so their pages open and Add works.
    expect((await request("GET", "/shows/880001")).statusCode).toBe(200);
    expect(anilist.requests.filter((r) => r.query.includes("search:"))).toEqual([]);
  });

  it("limits each user's searches, and says when AniList is down", async () => {
    anilist.failNext(500, 2);
    const down = await request("GET", "/search?q=fixture");
    expect(down.statusCode).toBe(502);
    expect(contract.searchErrorResponseSchema.parse(down.json()).error).toBe("search_unavailable");

    for (let i = 1; i < SEARCHES_PER_MINUTE; i++) {
      expect((await request("GET", `/search?q=fixture${String(i)}`)).statusCode).toBe(200);
    }
    const limited = await request("GET", "/search?q=fixture");
    expect(limited.statusCode).toBe(429);
    expect(contract.searchErrorResponseSchema.parse(limited.json()).error).toBe("rate_limited");
  });
});

describe("POST /list/add", () => {
  it("adds a show the user found, once per tap, and undoing it takes it off MAL", async () => {
    await request("GET", "/search?q=new");
    const tap = crypto.randomUUID();
    const added = await request("POST", "/list/add", { animeId: NEW_SHOW, requestId: tap });
    expect(added.statusCode).toBe(200);
    const { change } = contract.changeResponseSchema.parse(added.json());
    expect(change).toMatchObject({
      animeId: NEW_SHOW,
      kind: "add",
      source: "user",
      after: { status: "plan_to_watch" },
    });
    expect(h.fakeMal.patchRequests.map((p) => p.animeId)).toEqual([NEW_SHOW]);

    // The same tap again reports the same add without writing twice.
    const retried = await request("POST", "/list/add", { animeId: NEW_SHOW, requestId: tap });
    expect(contract.changeResponseSchema.parse(retried.json()).change.id).toBe(change.id);
    expect(h.fakeMal.patchRequests).toHaveLength(1);

    const twice = await request("POST", "/list/add", {
      animeId: NEW_SHOW,
      requestId: crypto.randomUUID(),
    });
    expect(twice.statusCode).toBe(409);
    expect(contract.addErrorResponseSchema.parse(twice.json()).error).toBe("already_on_list");

    const undo = await request("POST", `/changes/${change.id}/undo`);
    expect(undo.statusCode).toBe(200);
    expect(h.fakeMal.deleteRequests).toEqual([NEW_SHOW]);
  });

  it("follows the add rules, and refuses shows kurisu never saw", async () => {
    await request("GET", "/search?q=new");
    const finished = await request("POST", "/list/add", {
      animeId: NEW_SHOW,
      status: "completed",
      score: 8,
      requestId: crypto.randomUUID(),
    });
    expect(contract.changeResponseSchema.parse(finished.json()).change.after).toEqual({
      status: "completed",
      episodesWatched: 12,
      score: 8,
    });

    const unknown = await request("POST", "/list/add", {
      animeId: 123456789,
      requestId: crypto.randomUUID(),
    });
    expect(unknown.statusCode).toBe(404);
    expect(contract.addErrorResponseSchema.parse(unknown.json()).error).toBe("unknown_anime");
    expect((await request("POST", "/list/add", { animeId: NEW_SHOW })).statusCode).toBe(400);
  });
});

describe("GET /journal", () => {
  it("merges kurisu's changes, MAL-site ones and imports, newest first", async () => {
    // An import of one row, which shows as one line.
    models.script(AGENT.ref, [
      {
        toolCalls: [
          {
            name: "report_items",
            arguments: {
              items: [
                { line: 1, said: "Fixture New Show 10/10", title: "Fixture New Show", score: 10 },
              ],
            },
          },
        ],
      },
    ]);
    const started = await request("POST", "/imports", { text: "Fixture New Show 10/10" });
    const importId = contract.importResponseSchema.parse(started.json()).import.id;
    await until(async () => {
      const view = await request("GET", `/imports/${importId}`);
      return contract.importResponseSchema.parse(view.json()).import.status === "review";
    });
    expect((await request("POST", `/imports/${importId}/run`)).statusCode).toBe(202);
    await until(async () => {
      const view = await request("GET", `/imports/${importId}`);
      return contract.importResponseSchema.parse(view.json()).import.status === "done";
    });

    // A change on MAL's site, found by a sync, a minute ago.
    await h.db.insert(listEvents).values({
      userId,
      animeId: COMPLETED,
      kind: "updated",
      before: { score: 9 },
      after: { score: 10 },
      at: new Date(Date.now() - 60_000),
    });
    // An edit, then undone: one struck-through line, and no line for the undo.
    const edit = await request("POST", `/list/${String(WATCHING)}/edit`, {
      episodesWatched: 8,
      requestId: crypto.randomUUID(),
    });
    const editId = contract.changeResponseSchema.parse(edit.json()).change.id;
    expect((await request("POST", `/changes/${editId}/undo`)).statusCode).toBe(200);

    const res = await request("GET", "/journal");
    expect(res.statusCode).toBe(200);
    const journal = contract.journalResponseSchema.parse(res.json());
    expect(journal.timeZone).toBe("UTC");
    expect(journal.items.map((item) => item.type)).toEqual(["change", "import", "mal"]);
    expect(journal.items[0]).toMatchObject({ id: editId, undone: true, source: "user" });
    expect(journal.items[1]).toMatchObject({ id: importId, count: 1, undone: false });
    expect(journal.items[2]).toMatchObject({
      animeId: COMPLETED,
      kind: "update",
      after: { score: 10 },
    });

    // A show's page lists its import row on its own.
    const page = contract.showResponseSchema.parse(
      (await request("GET", `/shows/${String(NEW_SHOW)}`)).json(),
    );
    expect(page.journal).toEqual([expect.objectContaining({ type: "change", source: "import" })]);
  });
});

describe("welcome", () => {
  it("is false for a new account until POST /me/welcomed", async () => {
    const before = contract.meResponseSchema.parse((await request("GET", "/me")).json());
    expect(before.welcomed).toBe(false);
    const done = await request("POST", "/me/welcomed");
    expect(done.statusCode).toBe(200);
    expect(contract.welcomedResponseSchema.parse(done.json())).toEqual({ welcomed: true });
    const after = contract.meResponseSchema.parse((await request("GET", "/me")).json());
    expect(after.welcomed).toBe(true);
  });
});

describe("GET /list", () => {
  it("carries each entry's airing from the cache", async () => {
    await airing(WATCHING, { nextEpisode: 10, nextAiringAt: new Date(Date.now() + HOUR_MS) });
    const list = contract.listResponseSchema.parse((await request("GET", "/list")).json());
    const watching = list.entries.find((e) => e.animeId === WATCHING);
    expect(watching?.airing).toMatchObject({ latestAired: 9, nextEpisode: 10 });
    expect(list.entries.find((e) => e.animeId === COMPLETED)?.airing ?? null).toBeNull();
  });
});

async function until(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
