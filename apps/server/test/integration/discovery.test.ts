import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAniListClient } from "../../src/anilist/client.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { anilistCatalog, anime, discovery, discoveryRuns, users } from "../../src/db/schema.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { refreshDiscovery } from "../../src/recommend/discovery.js";
import { fixtureList } from "../fixtures/animeList.js";
import { detailedMedia, FakeAniList } from "../support/fakeAniList.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";
import { lastToolResult, ScriptedModels, type ScriptStep } from "../support/scriptedModels.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const AGENT = parseModelRef("ollama:test-agent");
const RECOMMEND = parseModelRef("ollama:test-recommend");
// The fixture's favorites: completed and scored 10 and 9.
const REWATCH_SHOW = 900006;
const COMPLETED_FILM = 900002;
// Shows AniList knows, by MAL id.
const CALM = 800001; // fans of both favorites like it
const MOVIE = 800005; // a top-rated movie
const CALM_2 = 800006; // the sequel to CALM, which the user hasn't seen
const PAUSED = 900003; // already on the list (on hold)

const models = new ScriptedModels();
let h: Harness;
let anilist: FakeAniList;
let cookie: string;
let userId: string;

beforeAll(async () => {
  anilist = await FakeAniList.start();
  h = await startHarness({
    models,
    roles: { agent: AGENT, escalation: null, recommend: RECOMMEND },
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
  anilist.reset();
  anilist.fans = new Map([
    [REWATCH_SHOW, [7001, 7002, 7003, 7006, 7007]],
    [COMPLETED_FILM, [7001, 7004]],
  ]);
  anilist.detailed = [
    detailedMedia(7001, CALM, "Calm Village Days", {
      genres: ["Slice of Life"],
      tags: [{ name: "Iyashikei", rank: 85, isMediaSpoiler: false }],
      averageScore: 84,
    }),
    detailedMedia(7002, 800002, "Adult Thing", { isAdult: true }),
    detailedMedia(7003, 800003, "Upcoming Show", { status: "NOT_YET_RELEASED" }),
    detailedMedia(7004, null, "Not On MAL"),
    detailedMedia(7005, MOVIE, "Great Movie", {
      format: "MOVIE",
      episodes: 1,
      duration: 110,
      averageScore: 88,
    }),
    detailedMedia(7006, CALM_2, "Calm Village Days 2", {
      relations: { edges: [{ relationType: "PREQUEL", node: { idMal: CALM, type: "ANIME" } }] },
    }),
    detailedMedia(7007, PAUSED, "Fixture Paused Show"),
  ];
  models.reset();
  const result = await login(h);
  cookie = result.sessionCookie ?? "";
  const [user] = await h.db.select().from(users);
  if (!user) throw new Error("no user");
  userId = user.id;
  // The sync builds the pool in the background; wait for it.
  await backgroundSettled(h);
});

describe("discovery after a sync", () => {
  it("pools what fans of the user's favorites like and top-rated movies, in MAL's words", async () => {
    const pool = await h.db.select().from(discovery);
    expect(pool.map((p) => p.malId).sort()).toEqual([CALM, MOVIE, CALM_2, PAUSED].sort());
    const calm = pool.find((p) => p.malId === CALM);
    expect(calm?.because.sort()).toEqual(["Fixture Completed Film", "Fixture Rewatch Show"]);
    expect(calm?.strength).toBeGreaterThan(pool.find((p) => p.malId === MOVIE)?.strength ?? 0);

    const [row] = await h.db.select().from(anilistCatalog).where(eq(anilistCatalog.malId, CALM));
    expect(row).toMatchObject({ genres: ["Slice of Life", "Iyashikei"], score: 8.4 });
    const [run] = await h.db.select().from(discoveryRuns);
    expect(run).toMatchObject({ shows: 4, error: null });
  });

  it("keeps the pool when AniList fails, and records why", async () => {
    anilist.failNext(500, 10);
    const client = createAniListClient({
      apiUrl: anilist.apiUrl,
      minIntervalMs: 0,
      retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    });

    const kept = await refreshDiscovery({ db: h.db, anilist: client, log: h.app.log }, userId, {
      force: true,
    });

    expect(kept).toBe(4);
    expect(await h.db.select().from(discovery)).toHaveLength(4);
    const [run] = await h.db.select().from(discoveryRuns);
    expect(run?.error).toBe("anilist_unavailable");
  });
});

describe("recommending shows new to the user", () => {
  it("offers new shows, never ones on the list or sequels to unseen shows, as cards", async () => {
    let offered: { anime_id: number; list: string; facts: string[] }[] = [];
    models.script(AGENT.ref, [{ toolCalls: [{ name: "recommend_shows", arguments: {} }] }]);
    const recommender: ScriptStep[] = [
      { toolCalls: [{ name: "find_candidates", arguments: { from: ["new"] } }] },
      (req) => {
        offered = lastToolResult(req).candidates as typeof offered;
        return {
          toolCalls: [
            {
              name: "present_picks",
              arguments: { picks: [{ anime_id: CALM, why: "Fans of your favorites love it." }] },
            },
          ],
        };
      },
      { text: "Here's something new." },
    ];
    models.script(RECOMMEND.ref, recommender);

    const res = await h.app.inject({
      method: "POST",
      url: "/chat/messages",
      headers: { origin: TEST_WEB_ORIGIN },
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { text: "something new I haven't seen" },
    });

    expect(offered.map((c) => c.anime_id).sort()).toEqual([CALM, MOVIE].sort());
    expect(offered.every((c) => c.list === "new")).toBe(true);
    expect(offered.find((c) => c.anime_id === CALM)?.facts).toContain(
      "fans of Fixture Rewatch Show and Fixture Completed Film also like it",
    );
    const reply = contract.chatThreadResponseSchema.parse(res.json()).messages[1];
    expect(reply?.picks).toEqual([
      expect.objectContaining({
        animeId: CALM,
        title: "Calm Village Days",
        status: null,
        episodesWatched: 0,
        why: "Fans of your favorites love it.",
      }),
    ]);
    // The pick has a row to show it by, and to add it from.
    const [row] = await h.db.select().from(anime).where(eq(anime.malId, CALM));
    expect(row?.genres).toEqual(["Slice of Life", "Iyashikei"]);
  });
});
