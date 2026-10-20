import { describe, expect, it } from "vitest";

import {
  chartedSeasons,
  parseSeasonParam,
  seasonLabel,
  seasonParam,
  shiftSeason,
} from "../../src/browse/seasons.js";

describe("Browse's seasons", () => {
  it("steps through seasons across a year's end", () => {
    expect(shiftSeason({ season: "FALL", year: 2026 }, 1)).toEqual({
      season: "WINTER",
      year: 2027,
    });
    expect(shiftSeason({ season: "WINTER", year: 2027 }, -1)).toEqual({
      season: "FALL",
      year: 2026,
    });
    expect(shiftSeason({ season: "SPRING", year: 2026 }, 4)).toEqual({
      season: "SPRING",
      year: 2027,
    });
  });

  it("charts last, this and next season", () => {
    expect(chartedSeasons(new Date("2026-10-19T12:00:00Z"))).toEqual([
      { season: "SUMMER", year: 2026 },
      { season: "FALL", year: 2026 },
      { season: "WINTER", year: 2027 },
    ]);
    expect(chartedSeasons(new Date("2027-01-05T12:00:00Z"))).toEqual([
      { season: "FALL", year: 2026 },
      { season: "WINTER", year: 2027 },
      { season: "SPRING", year: 2027 },
    ]);
  });

  it("names a season for URLs and for people", () => {
    const winter = { season: "WINTER" as const, year: 2027 };
    expect(seasonParam(winter)).toBe("2027-WINTER");
    expect(parseSeasonParam("2027-WINTER")).toEqual(winter);
    expect(seasonLabel(winter)).toBe("Winter 2027");
    for (const bad of ["2027-winter", "WINTER-2027", "2027 WINTER", "", "27-FALL"]) {
      expect(parseSeasonParam(bad)).toBeNull();
    }
  });
});
