import { describe, expect, it } from "vitest";

import { rankingLabel, relationLabel, sourceLine } from "../lib/showExtras";

describe("a show page's extras", () => {
  it("says where a show comes from in words", () => {
    expect(sourceLine("LIGHT_NOVEL")).toBe("From the light novel");
    expect(sourceLine("ORIGINAL")).toBe("Original story");
    expect(sourceLine("OTHER")).toBeNull();
    expect(sourceLine(null)).toBeNull();
    expect(sourceLine("SOMETHING_NEW")).toBeNull();
  });

  it("names relations and rankings", () => {
    expect(relationLabel("SIDE_STORY")).toBe("Side story");
    expect(relationLabel("SOMETHING_NEW")).toBe("Related");
    expect(rankingLabel({ rank: 4, kind: "popular", scope: "Fall 2026" })).toBe(
      "#4 most popular, Fall 2026",
    );
    expect(rankingLabel({ rank: 120, kind: "rated", scope: "all time" })).toBe(
      "#120 highest rated, all time",
    );
  });
});
