import { describe, expect, it } from "vitest";

import { airingRowsFor, frozenLatestAired, type AiringFreeze } from "../../eval/src/airing.js";
import { latestAiredEpisode, type AiringRow } from "../../src/anilist/cache.js";

const freeze: AiringFreeze = {
  description: "test",
  source: "anilist",
  frozenAt: "2026-10-06T00:00:00.000Z",
  shows: [
    { malId: 1, anilistId: 101, status: "RELEASING", latestAired: 3 },
    { malId: 2, anilistId: 102, status: "FINISHED", latestAired: 12 },
    { malId: 3, anilistId: 103, status: "NOT_YET_RELEASED", latestAired: 0 },
    { malId: 4, anilistId: 104, status: "RELEASING", latestAired: null },
    { malId: 5, anilistId: 105, status: "RELEASING", latestAired: 7 },
  ],
};

describe("frozen airing data", () => {
  it("gives the newest episode of airing shows only", () => {
    expect([1, 2, 3, 4, 6].map((id) => frozenLatestAired(freeze, id))).toEqual([
      3,
      null,
      0,
      null,
      null,
    ]);
    expect(frozenLatestAired(null, 1)).toBeNull();
  });

  it("seeds rows from which the app computes exactly the frozen newest episode", () => {
    const now = new Date();
    const rows = airingRowsFor(freeze, new Set([1, 2, 3, 4]), now);

    // Show 4 has no known newest episode and show 5 isn't in the snapshot.
    expect(rows.map((r) => r.malId)).toEqual([1, 2, 3]);
    const latest = rows.map((row) =>
      latestAiredEpisode({ episodeOffset: 0, streamingLinks: [], ...row } as AiringRow, now),
    );
    expect(latest).toEqual([3, 12, 0]);
  });
});
