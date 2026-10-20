import * as contract from "@kurisu/shared";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAniListClient } from "../../src/anilist/client.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import {
  refreshSchedule,
  refreshSeasonCharts,
  refreshTopCharts,
} from "../../src/browse/refresh.js";
import { chartedSeasons, seasonParam, shiftSeason } from "../../src/browse/seasons.js";
import { airingEpisodes, anilistMedia, anime, briefSettings, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import {
  catalogMedia,
  detailedMedia,
  FakeAniList,
  type FakeScheduled,
} from "../support/fakeAniList.js";
import {
  backgroundSettled,
  login,
  resetDatabase,
  startHarness,
  type Harness,
} from "../support/harness.js";

const WATCHING = 900001;
const PLANNED = 900005;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let h: Harness;
let anilist: FakeAniList;
let session = "";

beforeAll(async () => {
  anilist = await FakeAniList.start();
  h = await startHarness({ env: { ANILIST_API_URL: anilist.apiUrl } });
});
afterAll(async () => {
  await h.close();
  await anilist.stop();
});
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  anilist.reset();
  h.fakeMal.list = fixtureList();
  const { sessionCookie } = await login(h);
  session = sessionCookie ?? "";
  await backgroundSettled(h);
});

const client = () =>
  createAniListClient({
    apiUrl: anilist.apiUrl,
    minIntervalMs: 0,
    retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 },
  });
const deps = () => ({ db: h.db, anilist: client() });

function get(url: string) {
  return h.app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: session } });
}

/** An episode on AniList's schedule, `hours` from now. */
function scheduled(
  id: number,
  idMal: number | null,
  title: string,
  episode: number,
  hours: number,
  overrides: Partial<FakeScheduled["media"]> = {},
): FakeScheduled {
  return {
    episode,
    airingAt: Math.round((Date.now() + hours * HOUR_MS) / 1000),
    media: {
      ...catalogMedia(id, idMal, title, { status: "RELEASING" }),
      popularity: 1000,
      ...overrides,
    },
  };
}

describe("the shared schedule", () => {
  it("keeps shows MAL knows, never adult ones, and isn't rebuilt while fresh", async () => {
    anilist.schedule = [
      scheduled(201, 7001, "Fresh Show", 3, 24),
      scheduled(202, 7002, "Adult Show", 1, 48, { isAdult: true }),
      scheduled(203, null, "Unmapped Show", 5, 72),
    ];
    expect(await refreshSchedule(deps())).toBe(1);

    // The show gets an anime row, so its page opens and it can be added.
    const rows = await h.db
      .select({ malId: anime.malId, title: anime.title })
      .from(anime)
      .where(inArray(anime.malId, [7001, 7002]));
    expect(rows).toEqual([{ malId: 7001, title: "Fresh Show" }]);

    const requests = anilist.requests.length;
    expect(await refreshSchedule(deps())).toBeNull();
    expect(anilist.requests.length).toBe(requests);
    expect(await refreshSchedule(deps(), { force: true })).toBe(1);
  });

  it("lists the week's episodes, in MAL's numbers for the user's own shows", async () => {
    // The Watching show is AniList's second part (101) of a show MAL counts straight through.
    const part = {
      anilistId: 101,
      status: "RELEASING",
      episodeOffset: 12,
      streamingLinks: [{ siteId: 5, site: "Crunchyroll", url: "https://www.crunchyroll.com/x" }],
      fetchedAt: new Date(),
    };
    await h.db
      .insert(anilistMedia)
      .values({ malId: WATCHING, ...part })
      .onConflictDoUpdate({ target: anilistMedia.malId, set: part });
    const [user] = await h.db.select({ id: users.id }).from(users);
    if (!user) throw new Error("no user");
    await h.db.insert(briefSettings).values({ userId: user.id, services: ["crunchyroll"] });
    // A Plan to Watch premiere kurisu recorded, which the shared schedule doesn't have.
    await h.db
      .insert(airingEpisodes)
      .values({ malId: PLANNED, episode: 1, airingAt: new Date(Date.now() + 5 * DAY_MS) });
    anilist.schedule = [
      scheduled(101, WATCHING, "Fixture Watching Show", 1, 2),
      // Another AniList part of the same MAL entry: its number can't be MAL's, so it's left out.
      scheduled(150, WATCHING, "Fixture Watching Show Part 1", 5, 3),
      scheduled(201, 7001, "Fresh Show", 3, 24),
    ];
    await refreshSchedule(deps(), { force: true });

    const res = await get("/browse/schedule");
    expect(res.statusCode).toBe(200);
    const schedule = contract.scheduleResponseSchema.parse(res.json());
    expect(schedule.updatedAt).not.toBeNull();
    expect(
      schedule.episodes.map((e) => [e.animeId, e.episode, e.entry?.status ?? null, e.watchOn]),
    ).toEqual([
      [
        WATCHING,
        13,
        "watching",
        [{ service: "Crunchyroll", url: "https://www.crunchyroll.com/x" }],
      ],
      [7001, 3, null, []],
      [PLANNED, 1, "plan_to_watch", []],
    ]);
  });
});

describe("the season charts", () => {
  it("charts last, this and next season, and no other", async () => {
    const [previous, current, next] = chartedSeasons(new Date());
    if (!previous || !current || !next) throw new Error("no seasons");
    const key = (s: { season: string; year: number }) => `${s.season} ${String(s.year)}`;
    anilist.charts.set(key(previous), [304, 305]);
    anilist.charts.set(key(current), [301, 302]);
    anilist.charts.set(key(next), [303]);
    anilist.detailed = [
      detailedMedia(301, 8001, "Current Hit", { status: "RELEASING", averageScore: 85 }),
      detailedMedia(302, 8002, "Current Second", { status: "RELEASING" }),
      detailedMedia(303, 8003, "Next Big Thing", {
        status: "NOT_YET_RELEASED",
        averageScore: null,
      }),
      detailedMedia(304, 8004, "Last Season Show"),
      detailedMedia(305, 8005, "Adult Show", { isAdult: true }),
    ];
    expect(await refreshSeasonCharts(deps())).toBe(3);
    expect(await refreshSeasonCharts(deps())).toBe(0);

    const chart = async (season?: string) => {
      const res = await get(`/browse/seasons${season ? `?season=${season}` : ""}`);
      expect(res.statusCode).toBe(200);
      return contract.seasonChartResponseSchema.parse(res.json());
    };
    const now = await chart();
    expect(now.season).toBe(seasonParam(current));
    expect(now.seasons.map((s) => s.season)).toEqual([previous, current, next].map(seasonParam));
    expect(now.shows.map((s) => [s.title, s.score, s.entry])).toEqual([
      ["Current Hit", 8.5, null],
      ["Current Second", 8, null],
    ]);
    const coming = await chart(seasonParam(next));
    expect(coming.shows.map((s) => [s.title, s.airingStatus, s.score])).toEqual([
      ["Next Big Thing", "not_yet_aired", null],
    ]);
    expect((await chart(seasonParam(previous))).shows.map((s) => s.title)).toEqual([
      "Last Season Show",
    ]);

    // Each charted show can be opened and added.
    const [row] = await h.db.select().from(anime).where(eq(anime.malId, 8003));
    expect(row?.title).toBe("Next Big Thing");

    expect(now.previous).toBe(seasonParam(previous));
    expect(coming.next).toBeNull();
    expect(
      (await get(`/browse/seasons?season=${seasonParam(shiftSeason(next, 1))}`)).statusCode,
    ).toBe(404);
    expect((await get("/browse/seasons?season=1959-FALL")).statusCode).toBe(404);
    expect((await get("/browse/seasons?season=soon")).statusCode).toBe(400);
  });

  it("fetches an earlier season in the background when someone asks for it", async () => {
    anilist.charts.set("FALL 2019", [311]);
    anilist.detailed = [detailedMedia(311, 8011, "Old Favourite", { averageScore: 90 })];
    const first = contract.seasonChartResponseSchema.parse(
      (await get("/browse/seasons?season=2019-FALL")).json(),
    );
    expect(first).toMatchObject({
      season: "2019-FALL",
      label: "Fall 2019",
      previous: "2019-SUMMER",
      next: "2020-WINTER",
      updatedAt: null,
      pending: true,
      shows: [],
    });

    let chart = first;
    for (let i = 0; i < 50 && chart.pending; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      chart = contract.seasonChartResponseSchema.parse(
        (await get("/browse/seasons?season=2019-FALL")).json(),
      );
    }
    expect(chart.pending).toBe(false);
    expect(chart.shows.map((s) => [s.title, s.score])).toEqual([["Old Favourite", 9]]);
    // Fetched once: asking again doesn't go back to AniList.
    const asked = anilist.requests.filter((r) => r.query.includes("seasonYear: 2019")).length;
    await get("/browse/seasons?season=2019-FALL");
    expect(anilist.requests.filter((r) => r.query.includes("seasonYear: 2019")).length).toBe(asked);
  });
});

describe("the Top charts", () => {
  it("keeps each chart in AniList's order, without adult titles", async () => {
    anilist.tops.set("trending", [402, 401, 403]);
    anilist.tops.set("airing", [401]);
    anilist.tops.set("upcoming", [404]);
    anilist.tops.set("popular", [401, 402]);
    anilist.tops.set("top", [402]);
    anilist.detailed = [
      detailedMedia(401, 8101, "Second Trending", { averageScore: 80 }),
      detailedMedia(402, 8102, "First Trending", { averageScore: 75 }),
      detailedMedia(403, 8103, "Adult Trending", { isAdult: true }),
      detailedMedia(404, 8104, "Coming Soon", { status: "NOT_YET_RELEASED", averageScore: null }),
    ];
    expect(await refreshTopCharts(deps())).toBe(5);
    expect(await refreshTopCharts(deps())).toBe(0);

    const top = async (chart?: string) =>
      contract.topChartResponseSchema.parse(
        (await get(`/browse/top${chart ? `?chart=${chart}` : ""}`)).json(),
      );
    const trending = await top();
    expect(trending.chart).toBe("trending");
    expect(trending.updatedAt).not.toBeNull();
    expect(trending.shows.map((s) => [s.title, s.score, s.entry])).toEqual([
      ["First Trending", 7.5, null],
      ["Second Trending", 8, null],
    ]);
    expect((await top("upcoming")).shows.map((s) => [s.title, s.airingStatus])).toEqual([
      ["Coming Soon", "not_yet_aired"],
    ]);
    expect((await top("popular")).shows.map((s) => s.title)).toEqual([
      "Second Trending",
      "First Trending",
    ]);
    expect((await get("/browse/top?chart=nope")).statusCode).toBe(400);
  });
});
