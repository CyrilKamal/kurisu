import { describe, expect, it } from "vitest";

import type { ShowPageExtras } from "../../src/anilist/client.js";
import { keepShowable } from "../../src/anilist/showPage.js";
import { bestRankings, episodesOnServices, trailerLink } from "../../src/shows/extras.js";

const show = (malId: number | null) => ({
  anilistId: 1,
  malId,
  title: "Show",
  titleEn: null,
  titleJa: null,
  synonyms: [],
  format: "TV",
  status: "FINISHED",
  episodes: 12,
  duration: 24,
  coverUrl: null,
  startDate: null,
});

describe("a show page's extras", () => {
  it("links out to the trailer on YouTube or Dailymotion only", () => {
    expect(
      trailerLink({ site: "youtube", id: "a_B-1", thumbnail: "https://i.ytimg.com/x.jpg" }),
    ).toEqual({
      url: "https://www.youtube.com/watch?v=a_B-1",
      thumbnail: "https://i.ytimg.com/x.jpg",
    });
    expect(
      trailerLink({ site: "youtube", id: "a", thumbnail: "https://evil.example/x.jpg" }),
    ).toEqual({
      url: "https://www.youtube.com/watch?v=a",
      thumbnail: null,
    });
    expect(trailerLink({ site: "dailymotion", id: "x8abc", thumbnail: null })).toEqual({
      url: "https://www.dailymotion.com/video/x8abc",
      thumbnail: null,
    });
    expect(trailerLink({ site: "vimeo", id: "1", thumbnail: null })).toBeNull();
    expect(trailerLink({ site: "youtube", id: "a/../b", thumbnail: null })).toBeNull();
    expect(trailerLink(null)).toBeNull();
  });

  it("keeps the best ranking of each kind, the widest scope on a tie", () => {
    expect(
      bestRankings([
        { rank: 300, type: "RATED", allTime: true, season: null, year: null },
        { rank: 4, type: "POPULAR", allTime: false, season: "FALL", year: 2026 },
        { rank: 9, type: "RATED", allTime: false, season: null, year: 2026 },
        { rank: 50, type: "POPULAR", allTime: true, season: null, year: null },
      ]),
    ).toEqual([
      { rank: 4, kind: "popular", scope: "Fall 2026" },
      { rank: 9, kind: "rated", scope: "2026" },
    ]);
    // "#1 highest rated" all time, in 2023 and in Fall 2023: all time says the most.
    expect(
      bestRankings([
        { rank: 1, type: "RATED", allTime: false, season: "FALL", year: 2023 },
        { rank: 1, type: "RATED", allTime: false, season: null, year: 2023 },
        { rank: 1, type: "RATED", allTime: true, season: null, year: null },
      ]),
    ).toEqual([{ rank: 1, kind: "rated", scope: "all time" }]);
  });

  it("keeps episode links on the user's services, https only", () => {
    const episodes = [
      { title: "Episode 1", url: "https://www.crunchyroll.com/1", site: "crunchyroll" },
      { title: "Episode 1", url: "https://www.netflix.com/1", site: "Netflix" },
      { title: "Episode 2", url: "http://www.crunchyroll.com/2", site: "Crunchyroll" },
    ];
    expect(episodesOnServices(episodes, ["crunchyroll"])).toEqual([
      { title: "Episode 1", url: "https://www.crunchyroll.com/1", service: "Crunchyroll" },
    ]);
    expect(episodesOnServices(episodes, [])).toEqual([]);
  });

  it("drops what can't be shown: adult titles and shows MAL doesn't know", () => {
    const extras: ShowPageExtras = {
      studios: [],
      source: null,
      season: null,
      averageScore: null,
      rankings: [],
      trailer: null,
      tags: [],
      relations: [
        { relation: "SEQUEL", show: show(1), isAdult: false },
        { relation: "OTHER", show: { ...show(5), format: "MUSIC" }, isAdult: false },
        { relation: "SEQUEL", show: show(2), isAdult: true },
        { relation: "SIDE_STORY", show: show(null), isAdult: false },
      ],
      characters: [],
      recommendations: [
        { show: show(3), isAdult: false },
        { show: show(4), isAdult: true },
      ],
      episodes: [{ title: "Episode 1", url: "http://x.example/1", site: "Crunchyroll" }],
    };
    const kept = keepShowable(extras);
    expect(kept.relations.map((r) => r.show.malId)).toEqual([1]);
    expect(kept.recommendations.map((r) => r.show.malId)).toEqual([3]);
    expect(kept.episodes).toEqual([]);
  });
});
