import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";

import { ARCHIVE_MAX_WAITING, createSeasonArchive } from "../../src/browse/archive.js";
import type { BrowseRefreshDeps } from "../../src/browse/refresh.js";
import {
  browsable,
  compareSeasons,
  FIRST_SEASON,
  seasonParam,
  type Season,
} from "../../src/browse/seasons.js";

const log = { warn: () => undefined } as unknown as FastifyBaseLogger;
const noDeps = {} as BrowseRefreshDeps;
const fall = (year: number): Season => ({ season: "FALL", year });

describe("earlier seasons", () => {
  it("go back to Winter 1960 and up to next season", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(browsable(FIRST_SEASON, now)).toBe(true);
    expect(browsable({ season: "FALL", year: 1959 }, now)).toBe(false);
    expect(browsable({ season: "WINTER", year: 2027 }, now)).toBe(true);
    expect(browsable({ season: "SPRING", year: 2027 }, now)).toBe(false);
    expect(compareSeasons(fall(2019), { season: "WINTER", year: 2020 })).toBeLessThan(0);
  });

  it("are fetched one at a time, a few waiting at most, each once while on its way", async () => {
    const started: string[] = [];
    const finish: (() => void)[] = [];
    const archive = createSeasonArchive(
      { ...noDeps, log },
      {
        fetchChart: (season) => {
          started.push(seasonParam(season));
          return new Promise<void>((resolve) => finish.push(resolve));
        },
      },
    );
    archive.request(fall(2010));
    archive.request(fall(2010)); // already on its way
    archive.request(fall(2011));
    archive.request(fall(2011)); // already waiting
    for (let year = 2012; year < 2010 + ARCHIVE_MAX_WAITING + 3; year++) {
      archive.request(fall(year));
    }
    expect(started).toEqual(["2010-FALL"]);

    for (let i = 0; i <= ARCHIVE_MAX_WAITING; i++) {
      finish.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await archive.settled();
    // The first, and the three that could wait; the rest were turned away until asked again.
    expect(started).toEqual(["2010-FALL", "2011-FALL", "2012-FALL", "2013-FALL"]);
  });

  it("don't ask AniList again soon after it failed on one", async () => {
    let calls = 0;
    const archive = createSeasonArchive(
      { ...noDeps, log },
      {
        fetchChart: () => {
          calls++;
          return Promise.reject(new Error("AniList is down"));
        },
      },
    );
    archive.request(fall(2015));
    await archive.settled();
    archive.request(fall(2015));
    await archive.settled();
    expect(calls).toBe(1);
  });
});
