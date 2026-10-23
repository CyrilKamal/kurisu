import { describe, expect, it } from "vitest";

import { badgeCount, splitOut } from "../lib/today";

describe("splitOut", () => {
  it("keeps shows a few episodes behind as news and moves backlogs to catching up", () => {
    const shows = [
      { id: 1, latestAired: 8, episodesWatched: 7 },
      { id: 2, latestAired: 12, episodesWatched: 9 },
      { id: 3, latestAired: 12, episodesWatched: 0 },
      { id: 4, latestAired: 1180, episodesWatched: 0 },
    ];
    const { keepingUp, catchingUp } = splitOut(shows);
    expect(keepingUp.map((s) => s.id)).toEqual([1, 2]);
    expect(catchingUp.map((s) => s.id)).toEqual([3, 4]);
  });
});

describe("badgeCount", () => {
  it("caps at 99+", () => {
    expect(badgeCount(7)).toBe("7");
    expect(badgeCount(99)).toBe("99");
    expect(badgeCount(1654)).toBe("99+");
  });
});
