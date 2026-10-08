import type { DiaryEntry } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { groupByDay } from "../lib/diary";

function entry(id: string, at: string): DiaryEntry {
  return {
    id,
    origin: "kurisu",
    kind: "update",
    animeId: 1,
    title: "Frieren",
    pictureUrl: null,
    before: { episodesWatched: 1 },
    after: { episodesWatched: 2 },
    at,
    note: null,
  };
}

describe("groupByDay", () => {
  it("groups by the user's local day, newest first, with today and yesterday named", () => {
    const now = new Date("2026-10-08T18:00:00Z");
    const days = groupByDay(
      [
        entry("a", "2026-10-08T17:00:00Z"),
        // 02:00 UTC on the 8th is still the 7th in Los Angeles.
        entry("b", "2026-10-08T02:00:00Z"),
        entry("c", "2026-10-05T20:00:00Z"),
      ],
      "America/Los_Angeles",
      now,
    );
    expect(days.map((d) => [d.label, d.entries.map((e) => e.id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Mon, Oct 5", ["c"]],
    ]);
  });
});
