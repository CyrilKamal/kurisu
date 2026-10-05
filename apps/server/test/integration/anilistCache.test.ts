import type { FastifyBaseLogger } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";

import { airingRows, refreshAiring } from "../../src/anilist/cache.js";
import { AniListApiError, createAniListClient } from "../../src/anilist/client.js";
import { createDb, type Db } from "../../src/db/client.js";
import { anime } from "../../src/db/schema.js";
import { airingMedia, FakeAniList } from "../support/fakeAniList.js";
import { resetDatabase } from "../support/harness.js";

let fake: FakeAniList;
let db: Db;
let closeDb: () => Promise<void>;
let warnings: { obj: unknown; msg: string }[];

const anilist = () =>
  createAniListClient({
    apiUrl: fake.apiUrl,
    retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 },
    minIntervalMs: 0,
  });

const log = {
  warn: (obj: unknown, msg: string) => warnings.push({ obj, msg }),
} as unknown as FastifyBaseLogger;

const now = new Date("2026-10-06T12:00:00Z");
const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

beforeAll(async () => {
  fake = await FakeAniList.start();
  ({ db, close: closeDb } = createDb(inject("databaseUrl")));
});

afterAll(async () => {
  await closeDb();
  await fake.stop();
});

beforeEach(async () => {
  await resetDatabase(db);
  fake.reset();
  warnings = [];
  await db.insert(anime).values([
    { malId: 1, title: "Airing Show" },
    { malId: 2, title: "Finished Show" },
    { malId: 3, title: "Obscure Show" },
  ]);
  fake.media = [
    airingMedia(101, 1, {
      nextAiringEpisode: { episode: 8, airingAt: Date.parse("2026-10-07T15:00:00Z") / 1000 },
    }),
    airingMedia(102, 2, { status: "FINISHED", episodes: 24, externalLinks: [] }),
  ];
});

describe("refreshAiring", () => {
  it("stores AniList's data, and records and logs titles it doesn't know", async () => {
    const result = await refreshAiring({ db, anilist: anilist(), log }, [1, 2, 3], { now });

    expect(result).toEqual({ fetched: 3, unmapped: [3] });
    const rows = await airingRows(db, [1, 2, 3]);
    expect(rows.get(1)).toMatchObject({
      anilistId: 101,
      status: "RELEASING",
      nextEpisode: 8,
      nextAiringAt: new Date("2026-10-07T15:00:00Z"),
      streamingLinks: [
        { siteId: 5, site: "Crunchyroll", url: "https://www.crunchyroll.com/series/101" },
      ],
      fetchedAt: now,
    });
    expect(rows.get(2)).toMatchObject({ anilistId: 102, status: "FINISHED", episodes: 24 });
    expect(rows.get(3)).toMatchObject({ anilistId: null, status: null, streamingLinks: [] });
    expect(warnings).toEqual([
      {
        obj: { malId: 3, title: "Obscure Show" },
        msg: "no AniList entry for this MAL id; skipping it",
      },
    ]);
  });

  it("skips rows fetched recently and refetches old ones", async () => {
    await refreshAiring({ db, anilist: anilist(), log }, [1, 2, 3], { now });
    fake.requests.length = 0;

    expect(
      await refreshAiring({ db, anilist: anilist(), log }, [1, 2, 3], { now: later(5) }),
    ).toEqual({ fetched: 0, unmapped: [] });
    expect(fake.requests).toHaveLength(0);

    fake.media[0] = airingMedia(101, 1, {
      nextAiringEpisode: { episode: 9, airingAt: Date.parse("2026-10-14T15:00:00Z") / 1000 },
    });
    const result = await refreshAiring({ db, anilist: anilist(), log }, [1, 2, 3, 3], {
      now: later(7),
    });

    expect(result).toEqual({ fetched: 3, unmapped: [3] });
    expect(fake.requests).toHaveLength(1);
    expect((await airingRows(db, [1])).get(1)).toMatchObject({
      nextEpisode: 9,
      fetchedAt: later(7),
    });
  });

  it("keeps the old rows when AniList is down", async () => {
    await refreshAiring({ db, anilist: anilist(), log }, [1], { now });
    fake.failNext(503, 2);

    await expect(
      refreshAiring({ db, anilist: anilist(), log }, [1], { now: later(7) }),
    ).rejects.toBeInstanceOf(AniListApiError);
    expect((await airingRows(db, [1])).get(1)).toMatchObject({ nextEpisode: 8, fetchedAt: now });
  });

  it("does nothing for an empty list", async () => {
    expect(await refreshAiring({ db, anilist: anilist(), log }, [], { now })).toEqual({
      fetched: 0,
      unmapped: [],
    });
    expect(fake.requests).toHaveLength(0);
  });
});
