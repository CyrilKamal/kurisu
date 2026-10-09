import { inject } from "vitest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AniListClient, DiscoveredShow } from "../../src/anilist/client.js";
import { createDb } from "../../src/db/client.js";
import { seasonShows } from "../../src/db/schema.js";
import { refreshSeason } from "../../src/recommend/season.js";
import { resetDatabase } from "../support/harness.js";

const { db, close } = createDb(inject("databaseUrl"));
afterAll(close);
beforeEach(() => resetDatabase(db));

function show(anilistId: number): DiscoveredShow {
  return {
    anilistId,
    malId: anilistId + 1000,
    title: `Show ${String(anilistId)}`,
    titleEn: null,
    titleJa: null,
    synonyms: [],
    format: "TV",
    status: "RELEASING",
    episodes: 12,
    duration: 24,
    coverUrl: null,
    startDate: "2026-10-03",
    genres: ["Comedy"],
    tags: [],
    averageScore: 75,
    popularity: 1000,
    isAdult: false,
    prequelMalIds: [],
    streamingLinks: [],
  };
}

/** Only the two calls a season rebuild makes; each waits a moment, as AniList would. */
const anilist = {
  seasonLineup: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [[1, 2, 3], [4]];
  },
  showDetails: async (ids: number[]) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return ids.map(show);
  },
} as unknown as AniListClient;

describe("refreshSeason", () => {
  it("can run for two users' syncs at once", async () => {
    const now = new Date("2026-10-20T12:00:00Z");

    const results = await Promise.allSettled([
      refreshSeason({ db, anilist }, { now }),
      refreshSeason({ db, anilist }, { now }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const rows = await db.select({ malId: seasonShows.malId }).from(seasonShows);
    expect(rows.map((r) => r.malId).sort()).toEqual([1001, 1002, 1003, 1004]);
  });
});
