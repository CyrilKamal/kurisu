import { describe, expect, it } from "vitest";

import { aniListFilterFor, malGenresFrom } from "../../src/anilist/genres.js";
import { catalogRowFrom, poolStrengths } from "../../src/recommend/discovery.js";

describe("malGenresFrom", () => {
  it("keeps MAL's names, translates AniList's, and uses only central, non-spoiler tags", () => {
    expect(
      malGenresFrom(
        ["Slice of Life", "Thriller", "Hentai"],
        [
          { name: "Iyashikei", rank: 85, isMediaSpoiler: false },
          { name: "Cute Girls Doing Cute Things", rank: 70, isMediaSpoiler: false },
          { name: "Seinen", rank: 40, isMediaSpoiler: false },
          { name: "Time Travel", rank: 90, isMediaSpoiler: true },
          { name: "Episodic", rank: 90, isMediaSpoiler: false },
        ],
      ),
    ).toEqual(["Slice of Life", "Suspense", "Iyashikei", "CGDCT"]);
  });
});

describe("aniListFilterFor", () => {
  it("asks AniList by genre or by tag, in AniList's words", () => {
    expect(aniListFilterFor("Slice of Life")).toEqual({ genre: "Slice of Life" });
    expect(aniListFilterFor("Suspense")).toEqual({ genre: "Thriller" });
    expect(aniListFilterFor("Iyashikei")).toEqual({ tag: "Iyashikei" });
    expect(aniListFilterFor("CGDCT")).toEqual({ tag: "Cute Girls Doing Cute Things" });
  });
});

describe("poolStrengths", () => {
  it("weighs fans' picks by rank, adds top-rated lists more weakly, and keeps why", () => {
    const pool = poolStrengths(
      [
        { seedMalId: 1, anilistId: 10, rank: 0 },
        { seedMalId: 1, anilistId: 11, rank: 1 },
        { seedMalId: 2, anilistId: 11, rank: 0 },
      ],
      new Map([
        [1, "Mushishi"],
        [2, "Frieren"],
      ]),
      new Map([["movies", [12, 10]]]),
    );
    expect(pool.get(10)).toEqual({ strength: 1.2, because: ["Mushishi"] });
    // Frieren's fans rank it first, Mushishi's second: Frieren is the stronger reason.
    expect(pool.get(11)).toEqual({ strength: 1.5, because: ["Frieren", "Mushishi"] });
    expect(pool.get(12)).toEqual({ strength: 0.4, because: [] });
  });
});

describe("catalogRowFrom", () => {
  it("stores AniList's details in MAL's words", () => {
    expect(
      catalogRowFrom({
        anilistId: 437,
        malId: 437,
        title: "PERFECT BLUE",
        titleEn: null,
        titleJa: "パーフェクトブルー",
        synonyms: ["Perfect Blue", "完美蓝"],
        format: "MOVIE",
        status: "FINISHED",
        episodes: 1,
        duration: 81,
        coverUrl: "https://s4.anilist.co/x.jpg",
        startDate: "1998-02-28",
        genres: ["Drama", "Thriller"],
        tags: [{ name: "Primarily Adult Cast", rank: 75, isMediaSpoiler: false }],
        averageScore: 85,
        popularity: 300_000,
        isAdult: false,
        prequelMalIds: [],
      }),
    ).toMatchObject({
      malId: 437,
      synonyms: ["Perfect Blue"],
      mediaType: "movie",
      airingStatus: "finished_airing",
      numEpisodes: 1,
      episodeMinutes: 81,
      genres: ["Drama", "Suspense", "Adult Cast"],
      score: 8.5,
    });
  });
});
