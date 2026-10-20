import type { FavoriteShow } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { moved } from "../lib/favorites";
import {
  meanText,
  scoreAxisLabel,
  scoreOptions,
  scoreScale,
  scoreSpoken,
  scoreText,
} from "../lib/score";

describe("score styles", () => {
  it("show MAL's 1–10 exactly in each style", () => {
    expect([8, 7, 1].map((s) => scoreText(s, "point_10"))).toEqual(["8", "7", "1"]);
    expect([8, 7, 1].map((s) => scoreText(s, "point_100"))).toEqual(["80", "70", "10"]);
    expect([10, 8, 7, 1].map((s) => scoreText(s, "stars_5"))).toEqual([
      "★★★★★",
      "★★★★",
      "★★★½",
      "½",
    ]);
    expect([scoreScale("point_10"), scoreScale("point_100"), scoreScale("stars_5")]).toEqual([
      "/10",
      "/100",
      "",
    ]);
    expect(scoreSpoken(7, "stars_5")).toBe("3.5 stars");
    expect(scoreSpoken(2, "stars_5")).toBe("1 star");
    expect(scoreSpoken(8, "point_100")).toBe("80 out of 100");
  });

  it("offer every MAL score, best first, and each choice saves its own 1–10", () => {
    for (const style of ["point_10", "point_100", "stars_5"] as const) {
      const options = scoreOptions(style);
      expect(options.map((o) => o.value)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      // Ten different labels: no two scores look the same, so nothing is rounded.
      expect(new Set(options.map((o) => o.label)).size).toBe(10);
    }
  });

  it("label chart columns and means in the style", () => {
    expect([1, 2, 7, 10].map((s) => scoreAxisLabel(s, "stars_5"))).toEqual(["½", "1", "3½", "5"]);
    expect(scoreAxisLabel(7, "point_100")).toBe("70");
    expect(meanText(7.84, "point_10")).toBe("7.84");
    expect(meanText(7.84, "point_100")).toBe("78.4");
    expect(meanText(7.84, "stars_5")).toBe("3.92");
  });
});

describe("reordering favorites", () => {
  const show = (animeId: number): FavoriteShow => ({
    animeId,
    title: `Show ${String(animeId)}`,
    pictureUrl: null,
    mediaType: "tv",
    startDate: null,
  });
  const ids = (shows: FavoriteShow[]) => shows.map((s) => s.animeId);

  it("moves one up or down a place, and nothing past either end", () => {
    const shows = [show(1), show(2), show(3)];
    expect(ids(moved(shows, 2, -1))).toEqual([1, 3, 2]);
    expect(ids(moved(shows, 0, 1))).toEqual([2, 1, 3]);
    expect(ids(moved(shows, 0, -1))).toEqual([1, 2, 3]);
    expect(ids(moved(shows, 2, 1))).toEqual([1, 2, 3]);
  });
});
