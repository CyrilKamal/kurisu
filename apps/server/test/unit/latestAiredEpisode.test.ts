import { describe, expect, it } from "vitest";

import { latestAiredEpisode, type AiringRow } from "../../src/anilist/cache.js";

const now = new Date("2026-10-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000);

function row(overrides: Partial<AiringRow>): AiringRow {
  return {
    malId: 1,
    anilistId: 101,
    status: "RELEASING",
    episodes: 12,
    nextEpisode: null,
    nextAiringAt: null,
    streamingLinks: [],
    episodeOffset: 0,
    fetchedAt: hoursAgo(1),
    ...overrides,
  };
}

describe("latestAiredEpisode", () => {
  it("is the episode before the next one, until the next one airs", () => {
    expect(latestAiredEpisode(row({ nextEpisode: 8, nextAiringAt: hoursFromNow(3) }), now)).toBe(7);
  });

  it("is the next episode once its air time has passed", () => {
    expect(latestAiredEpisode(row({ nextEpisode: 8, nextAiringAt: hoursAgo(2) }), now)).toBe(8);
  });

  it("is unknown when the next episode aired so long ago that another may have followed", () => {
    expect(
      latestAiredEpisode(row({ nextEpisode: 8, nextAiringAt: hoursAgo(24 * 6 + 1) }), now),
    ).toBeNull();
  });

  it("is 0 before a premiere", () => {
    expect(
      latestAiredEpisode(
        row({ status: "NOT_YET_RELEASED", nextEpisode: 1, nextAiringAt: hoursFromNow(48) }),
        now,
      ),
    ).toBe(0);
    expect(latestAiredEpisode(row({ status: "NOT_YET_RELEASED" }), now)).toBe(0);
  });

  it("is the episode count for a finished show", () => {
    expect(latestAiredEpisode(row({ status: "FINISHED", episodes: 24 }), now)).toBe(24);
  });

  it("is unknown for an airing show with no scheduled episode", () => {
    expect(latestAiredEpisode(row({ status: "RELEASING" }), now)).toBeNull();
    expect(latestAiredEpisode(row({ status: "HIATUS" }), now)).toBeNull();
  });

  it("is unknown without an AniList match or with a row older than a week", () => {
    expect(latestAiredEpisode(row({ anilistId: null, status: null }), now)).toBeNull();
    expect(
      latestAiredEpisode(
        row({ nextEpisode: 8, nextAiringAt: hoursFromNow(3), fetchedAt: hoursAgo(24 * 7 + 1) }),
        now,
      ),
    ).toBeNull();
  });
});
