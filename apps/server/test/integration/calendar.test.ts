import * as contract from "@kurisu/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import {
  airingEpisodes,
  anilistMedia,
  briefSettings,
  subscriptions,
  users,
} from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import { airingMedia, FakeAniList } from "../support/fakeAniList.js";
import {
  login,
  resetDatabase,
  startHarness,
  TEST_MAL_USER,
  type Harness,
} from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

// TEST_MAL_USER owns this kurisu, so is on Pro; Alex joins with an invite, on a Premium trial.
const ALEX = { id: 5151, name: "alex" };
const WATCHING = 900001;
const PLANNED = 900005;
const ON_HOLD = 900003;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let h: Harness;
let anilist: FakeAniList;
const cookies = new Map<string, string>();

beforeAll(async () => {
  anilist = await FakeAniList.start();
  h = await startHarness({
    env: { OWNER_MAL_USERNAME: TEST_MAL_USER.name, ANILIST_API_URL: anilist.apiUrl },
  });
});
afterAll(async () => {
  await h.close();
  await anilist.stop();
});
beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  anilist.reset();
  cookies.clear();
  const at = (ms: number) => Math.round((Date.now() + ms) / 1000);
  anilist.media = [
    airingMedia(101, WATCHING, { nextAiringEpisode: { episode: 8, airingAt: at(3 * DAY_MS) } }),
    airingMedia(105, PLANNED, {
      status: "NOT_YET_RELEASED",
      nextAiringEpisode: { episode: 1, airingAt: at(10 * DAY_MS) },
    }),
  ];
  h.fakeMal.list = fixtureList();
  h.fakeMal.lists.set(ALEX.id, fixtureList());
  await join(TEST_MAL_USER);
  await join(ALEX, await invite());
  await settled(2);
});

function send(who: { name: string }, method: "GET" | "POST" | "DELETE", url: string) {
  return h.app.inject({
    method,
    url,
    headers: { origin: TEST_WEB_ORIGIN },
    cookies: { [SESSION_COOKIE]: cookies.get(who.name) ?? "" },
  });
}

async function join(user: { id: number; name: string }, inviteCode?: string) {
  h.fakeMal.user = user;
  const { sessionCookie } = await login(h, undefined, inviteCode);
  if (!sessionCookie) throw new Error(`${user.name} couldn't log in`);
  cookies.set(user.name, sessionCookie);
}

async function invite(): Promise<string> {
  const res = await send(TEST_MAL_USER, "POST", "/invites");
  return res.json<{ url: string }>().url.split("/invite/")[1] ?? "";
}

/** Waits for both logins' background refreshes (airing, discovery) to finish. */
async function settled(logins: number) {
  const until = Date.now() + 10_000;
  for (;;) {
    const runs = await h.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM discovery_runs`,
    );
    if ((runs.rows[0]?.n ?? 0) >= logins) return;
    if (Date.now() > until) throw new Error("background refreshes didn't finish");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function userId(malId: number): Promise<string> {
  const [row] = await h.db.select({ id: users.id }).from(users).where(eq(users.malUserId, malId));
  if (!row) throw new Error("no account");
  return row.id;
}

async function turnOn(who: { name: string }) {
  const res = await send(who, "POST", "/calendar");
  expect(res.statusCode).toBe(200);
  const body = contract.calendarResponseSchema.parse(res.json());
  if (!body.feed) throw new Error("no feed");
  return body.feed;
}

/** What a calendar app gets for a feed link (the web app proxies /api to the server). */
function fetchFeed(url: string) {
  return h.app.inject({ method: "GET", url: url.replace(`${TEST_WEB_ORIGIN}/api`, "") });
}

/** Each event's SUMMARY, in the feed's order. */
function summaries(ics: string): string[] {
  return [...ics.replace(/\r\n /g, "").matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1] ?? "");
}

describe("the calendar feed", () => {
  it("turns on with Pro only, and its link works until it's replaced or turned off", async () => {
    const alex = await send(ALEX, "GET", "/calendar");
    expect(contract.calendarResponseSchema.parse(alex.json())).toEqual({
      included: false,
      feed: null,
    });
    const refused = await send(ALEX, "POST", "/calendar");
    expect(refused.statusCode).toBe(403);
    expect(contract.needsPlanErrorSchema.parse(refused.json())).toEqual({
      error: "needs_plan",
      feature: "calendar",
      plan: "pro",
    });

    const feed = await turnOn(TEST_MAL_USER);
    expect(feed.url).toMatch(
      new RegExp(`^${TEST_WEB_ORIGIN}/api/calendar/feed/[A-Za-z0-9_-]{32}\\.ics$`),
    );
    expect(feed.webcalUrl).toBe(feed.url.replace(/^https?:/, "webcal:"));
    const shown = contract.calendarResponseSchema.parse(
      (await send(TEST_MAL_USER, "GET", "/calendar")).json(),
    );
    expect(shown.feed?.url).toBe(feed.url);

    const fetched = await fetchFeed(feed.url);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(fetched.body).toMatch(/^BEGIN:VCALENDAR\r\n/);
    // Settings can say a calendar app has fetched it.
    const after = contract.calendarResponseSchema.parse(
      (await send(TEST_MAL_USER, "GET", "/calendar")).json(),
    );
    expect(after.feed?.lastFetchedAt).not.toBeNull();

    const replaced = await turnOn(TEST_MAL_USER);
    expect(replaced.url).not.toBe(feed.url);
    expect((await fetchFeed(feed.url)).statusCode).toBe(404);
    expect((await fetchFeed(replaced.url)).statusCode).toBe(200);

    const off = await send(TEST_MAL_USER, "DELETE", "/calendar");
    expect(contract.calendarResponseSchema.parse(off.json())).toEqual({
      included: true,
      feed: null,
    });
    expect((await fetchFeed(replaced.url)).statusCode).toBe(404);
  });

  it("lists Watching shows' episodes and Plan to Watch premieres, with where to watch", async () => {
    const now = Date.now();
    await h.db.insert(airingEpisodes).values([
      // Aired three weeks ago: past the two weeks the feed keeps.
      { malId: WATCHING, episode: 5, airingAt: new Date(now - 20 * DAY_MS) },
      { malId: WATCHING, episode: 6, airingAt: new Date(now - 8 * DAY_MS) },
      { malId: WATCHING, episode: 7, airingAt: new Date(now - DAY_MS) },
      // On hold: not in the feed.
      { malId: ON_HOLD, episode: 11, airingAt: new Date(now + DAY_MS) },
      // Plan to Watch: only its premiere is news.
      { malId: PLANNED, episode: 2, airingAt: new Date(now + 17 * DAY_MS) },
    ]);
    const owner = await userId(TEST_MAL_USER.id);
    await h.db.insert(briefSettings).values({ userId: owner, services: ["crunchyroll"] });

    const ics = (await fetchFeed((await turnOn(TEST_MAL_USER)).url)).body;
    // Episode 8 and the premiere come from AniList's next episodes, kept at each refresh.
    expect(summaries(ics)).toEqual([
      "Fixture Watching Show · Episode 6",
      "Fixture Watching Show · Episode 7",
      "Fixture Watching Show · Episode 8",
      "Fixture Unannounced Sequel · Premiere",
    ]);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`UID:${String(WATCHING)}-8@kurisu`);
    expect(unfolded).toContain(
      `DESCRIPTION:On Crunchyroll.\\nIn kurisu: ${TEST_WEB_ORIGIN}/shows/${String(WATCHING)}`,
    );
    // An episode is as long as MAL says (24 minutes) and never makes the reader look busy.
    const start = /DTSTART:(\d{8}T\d{6}Z)/.exec(unfolded)?.[1];
    const end = /DTEND:(\d{8}T\d{6}Z)/.exec(unfolded)?.[1];
    const parse = (s?: string) =>
      Date.parse(
        `${s?.slice(0, 4) ?? ""}-${s?.slice(4, 6) ?? ""}-${s?.slice(6, 8) ?? ""}T${s?.slice(9, 11) ?? ""}:${s?.slice(11, 13) ?? ""}:${s?.slice(13, 15) ?? ""}Z`,
      );
    expect(parse(end) - parse(start)).toBe(24 * 60_000);
    expect(unfolded).toContain("TRANSP:TRANSPARENT");
  });

  it("goes empty, not broken, when the plan no longer includes it", async () => {
    const alex = await userId(ALEX.id);
    await h.db.insert(subscriptions).values({
      userId: alex,
      plan: "pro",
      status: "active",
      provider: "manual",
    });
    const feed = await turnOn(ALEX);
    expect(summaries((await fetchFeed(feed.url)).body)).toContain(
      "Fixture Unannounced Sequel · Premiere",
    );

    await h.db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.userId, alex));
    const empty = await fetchFeed(feed.url);
    expect(empty.statusCode).toBe(200);
    expect(summaries(empty.body)).toEqual([]);
    expect(empty.body).toContain("X-WR-CALDESC:kurisu's calendar comes with Pro");
  });

  it("brings old airing data up to date in the background when a calendar app fetches it", async () => {
    const feed = await turnOn(TEST_MAL_USER);
    await h.db
      .update(anilistMedia)
      .set({ fetchedAt: new Date(Date.now() - 7 * HOUR_MS) })
      .where(eq(anilistMedia.malId, WATCHING));
    const delayed = Math.round((Date.now() + 10 * DAY_MS) / 1000);
    anilist.media = anilist.media.map((m) =>
      m.idMal === WATCHING ? { ...m, nextAiringEpisode: { episode: 8, airingAt: delayed } } : m,
    );

    await fetchFeed(feed.url);
    const until = Date.now() + 5_000;
    for (;;) {
      const [row] = await h.db
        .select({ airingAt: airingEpisodes.airingAt })
        .from(airingEpisodes)
        .where(and(eq(airingEpisodes.malId, WATCHING), eq(airingEpisodes.episode, 8)));
      if (row?.airingAt.getTime() === delayed * 1000) break;
      if (Date.now() > until) throw new Error("the feed's fetch didn't refresh the airing data");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });

  it("answers 404 for a link that isn't one", async () => {
    await turnOn(TEST_MAL_USER);
    for (const file of ["A".repeat(32) + ".ics", "short.ics", "../../etc/passwd"]) {
      const res = await h.app.inject({ method: "GET", url: `/calendar/feed/${file}` });
      expect(res.statusCode).toBe(404);
    }
  });
});
