import { randomUUID } from "node:crypto";

import * as contract from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { diaryNotes, users } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import type { FakeListItem } from "../support/fakeMal.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// TEST_MAL_USER owns this kurisu (Pro: the full review); Alex is on a Premium trial (the basics).
const ALEX = { id: 5151, name: "alex" };
const WATCHING = 900001;
const FILM = 900002;
const PAUSED = 900003;
const REWATCH = 900006;
// This year on the users' clock (UTC: neither has brief settings).
const YEAR = new Date().getUTCFullYear();
const today = () => new Date().toISOString().slice(0, 10);

let h: Harness;
const cookies = new Map<string, string>();

/** The fixture list with two shows finished this year: one new this year, one from 2019. */
function thisYearsList(): FakeListItem[] {
  return fixtureList().map((item) => {
    if (item.node.id === FILM) {
      return {
        node: { ...item.node, start_date: `${String(YEAR)}-08-01` },
        list_status: { ...item.list_status, finish_date: `${String(YEAR)}-08-15` },
      };
    }
    if (item.node.id === REWATCH) {
      return {
        node: { ...item.node, start_date: "2019-04-05" },
        list_status: { ...item.list_status, finish_date: `${String(YEAR)}-03-02` },
      };
    }
    return item;
  });
}

beforeAll(async () => {
  h = await startHarness({ env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name } });
});
afterAll(() => h.close());
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  cookies.clear();
  h.fakeMal.list = thisYearsList();
  h.fakeMal.lists.set(ALEX.id, thisYearsList());
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

async function edit(animeId: number, change: object) {
  const res = await send(TEST_MAL_USER, "POST", `/list/${String(animeId)}/edit`, {
    ...change,
    requestId: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
}

async function review(who: { name: string }, query = "") {
  const res = await send(who, "GET", `/year${query}`);
  expect(res.statusCode).toBe(200);
  return contract.yearReviewSchema.parse(res.json());
}

describe("the year in review", () => {
  it("gives Pro the full year: finishes, episodes, ratings, genres and the diary", async () => {
    await edit(WATCHING, { episodesWatched: 8 });
    await edit(PAUSED, { status: "watching" });
    await edit(PAUSED, { status: "dropped" });
    const [owner] = await h.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.malUserId, TEST_MAL_USER.id));
    if (!owner) throw new Error("no owner");
    await h.db
      .insert(diaryNotes)
      .values({ userId: owner.id, animeId: WATCHING, text: "that fight was unreal" });

    const year = await review(TEST_MAL_USER);
    expect(year).toMatchObject({ year: YEAR, currentYear: YEAR, timeZone: "UTC" });
    // The account began today, so episodes before it weren't counted.
    expect(year.countingSince).toBe(today() > `${String(YEAR)}-01-01` ? today() : null);
    expect(year.basic).toEqual({
      completed: 2,
      episodes: 1,
      minutes: 24,
      // One show each; ties go alphabetically.
      topGenre: "Comedy",
      favorite: {
        animeId: REWATCH,
        title: "Fixture Rewatch Show",
        pictureUrl: expect.any(String) as string,
        score: 10,
      },
      goal: null,
    });

    const full = year.full;
    if (!full) throw new Error("no full review");
    expect(full.completedByMonth[2]).toBe(1);
    expect(full.completedByMonth[7]).toBe(1);
    expect(full.episodesByMonth.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(full.topRated.map((show) => [show.title, show.score])).toEqual([
      ["Fixture Rewatch Show", 10],
      ["Fixture Completed Film", 9],
    ]);
    expect(full.meanScore).toBe(9.5);
    // 26 episodes of 24 minutes beats one 110-minute film.
    expect(full.longest).toMatchObject({ animeId: REWATCH, episodes: 26, minutes: 624 });
    expect(full.first).toMatchObject({ animeId: REWATCH, on: `${String(YEAR)}-03-02` });
    expect(full.last).toMatchObject({ animeId: FILM, on: `${String(YEAR)}-08-15` });
    expect({ seasonal: full.seasonal, backlog: full.backlog }).toEqual({ seasonal: 1, backlog: 1 });
    expect(full.formats).toEqual([
      { mediaType: "movie", shows: 1 },
      { mediaType: "tv", shows: 1 },
    ]);
    expect({ started: full.started, dropped: full.dropped }).toEqual({ started: 1, dropped: 1 });
    expect(full.notes).toEqual([
      {
        animeId: WATCHING,
        title: "Fixture Watching Show",
        text: "that fight was unreal",
        on: today(),
      },
    ]);
  });

  it("gives other plans the basics only", async () => {
    const year = await review(ALEX);
    expect(year.basic.completed).toBe(2);
    expect(year.full).toBeNull();
  });

  it("reviews an earlier year, but not one still to come", async () => {
    const earlier = await review(TEST_MAL_USER, `?year=${String(YEAR - 1)}`);
    expect(earlier.basic).toMatchObject({ completed: 0, episodes: 0, favorite: null });
    // The account began after that year, so nothing in it was counted episode by episode.
    expect(earlier.countingSince).toBe(today());
    for (const query of [`?year=${String(YEAR + 1)}`, "?year=soon", "?year=1900"]) {
      expect((await send(TEST_MAL_USER, "GET", `/year${query}`)).statusCode).toBe(400);
    }
  });
});
