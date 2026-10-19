import type { YearReview } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { yearShareText } from "../lib/year";

const review = (basic: Partial<YearReview["basic"]>, year = 2026): YearReview => ({
  year,
  currentYear: 2026,
  timeZone: "UTC",
  countingSince: null,
  basic: {
    completed: 42,
    episodes: 512,
    minutes: 12_780,
    topGenre: "Fantasy",
    favorite: { animeId: 1, title: "Frieren", pictureUrl: null, score: 10 },
    goal: null,
    ...basic,
  },
  full: null,
});

describe("sharing a year", () => {
  it("says what the year counted, and only that", () => {
    expect(yearShareText(review({}))).toBe(
      "My 2026 in anime so far: 42 shows finished · 512 episodes, 213 hours · Mostly Fantasy · Favorite: Frieren (10/10)",
    );
    expect(
      yearShareText(
        review({ completed: 1, episodes: 0, minutes: 0, topGenre: null, favorite: null }, 2025),
      ),
    ).toBe("My 2025 in anime: 1 show finished");
  });
});
