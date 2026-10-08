import { describe, expect, it } from "vitest";

import { seasonKey, seasonOf } from "../../src/recommend/season.js";

describe("seasonOf", () => {
  it("names the anime season a date falls in, and the one before", () => {
    expect(seasonOf(new Date("2026-10-08T00:00:00Z"))).toEqual({
      season: "FALL",
      year: 2026,
      previous: { season: "SUMMER", year: 2026 },
    });
    expect(seasonOf(new Date("2026-04-01T00:00:00Z")).season).toBe("SPRING");
    expect(seasonOf(new Date("2027-02-14T00:00:00Z"))).toEqual({
      season: "WINTER",
      year: 2027,
      previous: { season: "FALL", year: 2026 },
    });
    expect(seasonKey({ season: "FALL", year: 2026 })).toBe("2026 FALL");
  });
});
