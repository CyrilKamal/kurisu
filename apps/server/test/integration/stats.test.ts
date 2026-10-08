import * as contract from "@kurisu/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { listEvents, syncRuns } from "../../src/db/schema.js";
import { fixtureList } from "../fixtures/animeList.js";
import { login, resetDatabase, startHarness, type Harness } from "../support/harness.js";
import { TEST_WEB_ORIGIN } from "../support/testConfig.js";

const WATCHING = 900001; // ep 7 of 12, 24-minute episodes
const PAUSED = 900003; // on hold, ep 10 of 24
const DROPPED = 900004;
const year = new Date().getUTCFullYear();

let h: Harness;
let cookie: string;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.db);
  h.fakeMal.reset();
  const list = fixtureList();
  // The completed film was finished this year, by MAL's finish date.
  const film = list.find((item) => item.node.id === 900002);
  if (!film) throw new Error("fixture changed");
  film.list_status.finish_date = `${String(year)}-01-15`;
  h.fakeMal.list = list;
  cookie = (await login(h)).sessionCookie ?? "";
});

function send(method: "GET" | "POST" | "PUT", url: string, payload?: object, origin = true) {
  return h.app.inject({
    method,
    url,
    headers: origin ? { origin: TEST_WEB_ORIGIN } : {},
    cookies: { [SESSION_COOKIE]: cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

function edit(animeId: number, change: object) {
  return send("POST", `/list/${String(animeId)}/edit`, {
    ...change,
    requestId: crypto.randomUUID(),
  });
}

async function resync() {
  // Past the manual-sync cooldown.
  await h.db.update(syncRuns).set({ startedAt: new Date(Date.now() - 61_000) });
  expect((await send("POST", "/sync")).statusCode).toBe(200);
}

describe("changes made on MAL's site", () => {
  it("are recorded by a sync, but not the first sync or kurisu's own writes", async () => {
    // The login sync built the mirror: nothing to record yet.
    expect(await h.db.select().from(listEvents)).toEqual([]);

    // Through kurisu: written to MAL and to the mirror, so a sync finds nothing new.
    expect((await edit(WATCHING, { episodesWatched: 8 })).statusCode).toBe(200);

    // On MAL's site: progress, a removal and an addition.
    // A minute ago: newer than the mirror's copy of these entries, as MAL's time would be.
    const later = new Date(Date.now() - 60_000).toISOString().replace("Z", "+00:00");
    const paused = h.fakeMal.list.find((item) => item.node.id === PAUSED);
    if (!paused) throw new Error("fixture changed");
    paused.list_status.num_episodes_watched = 12;
    paused.list_status.updated_at = later;
    const template = h.fakeMal.list[0];
    if (!template) throw new Error("fixture changed");
    h.fakeMal.list = [
      ...h.fakeMal.list.filter((item) => item.node.id !== DROPPED),
      {
        node: { ...structuredClone(template.node), id: 900008, title: "Fixture Site Show" },
        list_status: {
          status: "watching",
          score: 0,
          num_episodes_watched: 2,
          is_rewatching: false,
          updated_at: later,
        },
      },
    ];
    await resync();

    const events = await h.db.select().from(listEvents);
    expect(
      events
        .map((e) => [e.animeId, e.kind, e.before, e.after])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [PAUSED, "updated", { episodesWatched: 10 }, { episodesWatched: 12 }],
      [
        DROPPED,
        "removed",
        { status: "dropped", episodesWatched: 2, score: 3, isRewatching: false },
        {},
      ],
      [
        900008,
        "added",
        {},
        { status: "watching", episodesWatched: 2, score: 0, isRewatching: false },
      ],
    ]);

    // They count in the last 7 days next to kurisu's: 1 + 2 + 2 episodes.
    const stats = contract.statsResponseSchema.parse((await send("GET", "/stats")).json());
    expect(stats.week).toMatchObject({ episodes: 5, shows: 3 });
  });
});

describe("GET /stats", () => {
  it("adds up the whole list, this year's completions and the last 7 days", async () => {
    expect((await edit(WATCHING, { episodesWatched: 9 })).statusCode).toBe(200);
    // Completing fills in the episodes: 10 → 24.
    expect((await edit(PAUSED, { status: "completed" })).statusCode).toBe(200);

    const res = await send("GET", "/stats");

    expect(res.statusCode).toBe(200);
    const stats = contract.statsResponseSchema.parse(res.json());
    expect(stats.allTime).toMatchObject({
      shows: 6,
      byStatus: { watching: 1, completed: 3, on_hold: 0, dropped: 1, plan_to_watch: 1 },
      meanScore: 7,
      scored: 4,
      scores: [0, 0, 1, 0, 0, 1, 0, 0, 1, 1],
    });
    // The film by its MAL finish date; the paused show the day kurisu completed it. The
    // rewatched show is completed with neither, so it isn't counted.
    expect(stats.year).toMatchObject({ year, completed: 2, goal: null });
    expect(stats.year.recent.map((show) => show.animeId).sort()).toEqual([900002, PAUSED]);
    expect(stats.week).toMatchObject({
      episodes: 2 + 14,
      minutes: 16 * 24,
      shows: 2,
      finished: [{ animeId: PAUSED, title: "Fixture Paused Show" }],
    });
  });

  it("leaves out imports, undos and changes that were undone", async () => {
    const res = await edit(WATCHING, { episodesWatched: 10 });
    const change = contract.changeResponseSchema.parse(res.json()).change;
    expect((await send("POST", `/changes/${change.id}/undo`)).statusCode).toBe(200);

    const stats = contract.statsResponseSchema.parse((await send("GET", "/stats")).json());
    expect(stats.week).toMatchObject({ episodes: 0, shows: 0, finished: [] });
  });
});

describe("PUT /stats/goal", () => {
  it("sets and clears this year's goal", async () => {
    const set = await send("PUT", "/stats/goal", { target: 20 });
    expect(set.statusCode).toBe(200);
    expect(contract.statsResponseSchema.parse(set.json()).year.goal).toBe(20);

    const cleared = await send("PUT", "/stats/goal", { target: null });
    expect(contract.statsResponseSchema.parse(cleared.json()).year.goal).toBeNull();
  });

  it("rejects a bad goal, and requests from another site", async () => {
    for (const bad of [{ target: 0 }, { target: 1.5 }, { target: "20" }, {}]) {
      const res = await send("PUT", "/stats/goal", bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_goal" });
    }
    expect((await send("PUT", "/stats/goal", { target: 20 }, false)).statusCode).toBe(403);
  });
});
