import { describe, expect, it } from "vitest";

import {
  eraYears,
  poolOf,
  rankCandidates,
  startYearOf,
  type CandidateRow,
  type TasteSignals,
} from "../../src/recommend/candidates.js";

function row(id: number, overrides: Partial<CandidateRow>): CandidateRow {
  return {
    animeId: id,
    title: `Show ${String(id)}`,
    titleEn: null,
    status: "plan_to_watch",
    isRewatching: false,
    episodesWatched: 0,
    numEpisodes: 12,
    episodeMinutes: 24,
    genres: [],
    malMean: 7.5,
    mediaType: "tv",
    airingStatus: "finished_airing",
    startYear: 2015,
    streamingLinks: [],
    ...overrides,
  };
}

const noTaste: TasteSignals = { genres: new Map(), dropCategories: new Map() };
const ids = (rows: { animeId: number }[]) => rows.map((r) => r.animeId);

describe("poolOf", () => {
  it("is Plan to Watch, in progress or queued, never completed, dropped or unaired", () => {
    expect(poolOf(row(1, { status: "plan_to_watch" }))).toBe("plan_to_watch");
    expect(poolOf(row(1, { status: "watching", episodesWatched: 3 }))).toBe("in_progress");
    expect(poolOf(row(1, { status: "on_hold", episodesWatched: 3 }))).toBe("in_progress");
    // The user queues shows on Watching at episode 0: not started.
    expect(poolOf(row(1, { status: "watching" }))).toBe("queued");
    expect(poolOf(row(1, { status: "on_hold" }))).toBe("queued");
    expect(poolOf(row(1, { status: "completed", isRewatching: true }))).toBe("in_progress");
    expect(poolOf(row(1, { status: "completed" }))).toBeNull();
    expect(poolOf(row(1, { status: "dropped" }))).toBeNull();
    expect(poolOf(row(1, { status: "plan_to_watch", airingStatus: "not_yet_aired" }))).toBeNull();
  });
});

describe("rankCandidates", () => {
  const rows = [
    row(1, { genres: ["Slice of Life", "Iyashikei"], episodeMinutes: 24 }),
    row(2, { genres: ["Action"], episodeMinutes: 24, numEpisodes: 64 }),
    row(3, { genres: ["Drama"], mediaType: "movie", numEpisodes: 1, episodeMinutes: 110 }),
    row(4, { genres: ["Comedy"], episodeMinutes: 4, numEpisodes: 12 }),
    row(5, {
      genres: ["Slice of Life"],
      status: "watching",
      episodesWatched: 5,
      episodeMinutes: 24,
    }),
    row(6, { genres: ["Slice of Life"], status: "completed" }),
    row(7, { genres: ["Slice of Life"], episodeMinutes: null }),
  ];

  it("keeps only shows that meet every constraint", () => {
    expect(ids(rankCandidates(rows, noTaste, { availableMinutes: 30 })).sort()).toEqual([
      1, 2, 4, 5,
    ]);
    expect(ids(rankCandidates(rows, noTaste, { genresAny: ["slice of life"] })).sort()).toEqual([
      1, 5, 7,
    ]);
    expect(ids(rankCandidates(rows, noTaste, { genresNone: ["Action", "Drama"] })).sort()).toEqual([
      1, 4, 5, 7,
    ]);
    expect(ids(rankCandidates(rows, noTaste, { mediaTypes: ["movie"] }))).toEqual([3]);
    expect(ids(rankCandidates(rows, noTaste, { maxEpisodesLeft: 12 })).sort()).toEqual([
      1, 3, 4, 5, 7,
    ]);
    expect(ids(rankCandidates(rows, noTaste, { from: ["in_progress"] }))).toEqual([5]);
  });

  it("never offers completed shows, and drops unknown lengths when time is limited", () => {
    expect(ids(rankCandidates(rows, noTaste, {}))).not.toContain(6);
    expect(ids(rankCandidates(rows, noTaste, { availableMinutes: 60 }))).not.toContain(7);
  });

  it("counts how many episodes fit", () => {
    const fourMinutes = rows.filter((r) => r.animeId === 4);
    const [short] = rankCandidates(fourMinutes, noTaste, { availableMinutes: 30 });
    expect(short?.episodesThatFit).toBe(7);
    expect(short?.facts).toContain("7 eps fit in your time");
  });

  it("ranks by taste, then nudges shows already under way", () => {
    const taste: TasteSignals = {
      genres: new Map([
        ["Slice of Life", { affinity: 0.8, dropped: 0 }],
        ["Action", { affinity: -0.5, dropped: 3 }],
      ]),
      dropCategories: new Map(),
    };
    const ranked = rankCandidates(rows, taste, {});
    // In progress and well liked first; the disliked, often-dropped genre last.
    expect(ranked[0]?.animeId).toBe(5);
    expect(ranked.at(-1)?.animeId).toBe(2);
    expect(ranked[0]?.facts).toContain("you rate Slice of Life above your average");
  });

  it("adds shows new to the user, after their own list when the fit is about equal", () => {
    const fresh = (id: number, extra: Partial<CandidateRow>) =>
      row(id, { status: null, strength: 1, because: ["Mushishi"], anilistScore: 8.4, ...extra });
    const mixed = [
      row(1, { genres: ["Slice of Life"] }),
      fresh(2, { genres: ["Slice of Life"], malMean: null }),
      fresh(3, { genres: ["Slice of Life"], malMean: null, prequelsDone: false }),
    ];

    const ranked = rankCandidates(mixed, noTaste, {});
    // The sequel to a show they haven't completed is left out.
    expect(ids(ranked)).toEqual([1, 2]);
    const newShow = ranked.find((c) => c.animeId === 2);
    expect(newShow?.pool).toBe("new");
    expect(newShow?.facts).toEqual(
      expect.arrayContaining([
        "new to you: not on your list",
        "fans of Mushishi also like it",
        "AniList score 8.4",
      ]),
    );
    expect(ids(rankCandidates(mixed, noTaste, { from: ["new"] }))).toEqual([2]);
    expect(ids(rankCandidates(mixed, noTaste, { from: ["plan_to_watch"] }))).toEqual([1]);

    // A much better fit still wins over the list's boost.
    const loved: TasteSignals = {
      genres: new Map([["Mystery", { affinity: 1.5, dropped: 0 }]]),
      dropCategories: new Map(),
    };
    const mystery = [row(1, { genres: ["Comedy"] }), fresh(2, { genres: ["Mystery"] })];
    expect(ids(rankCandidates(mystery, loved, {}))).toEqual([2, 1]);
  });

  it("steers away from long shows for someone who drops shows for being too long", () => {
    const long = [row(1, { numEpisodes: 64 }), row(2, { numEpisodes: 12 })];
    const tired: TasteSignals = { genres: new Map(), dropCategories: new Map([["too_long", 2]]) };
    expect(ids(rankCandidates(long, noTaste, {}))).toEqual([1, 2]);
    expect(ids(rankCandidates(long, tired, {}))).toEqual([2, 1]);
  });
});

describe("queued shows", () => {
  it("say they haven't been started, and stay out of in-progress searches", () => {
    const rows = [
      row(1, { status: "watching", episodesWatched: 0 }),
      row(2, { status: "watching", episodesWatched: 4 }),
    ];
    const [queued] = rankCandidates(rows, noTaste, { from: ["queued"] });
    expect(queued?.animeId).toBe(1);
    expect(queued?.facts).toContain("queued on your Watching list, not started yet");
    expect(queued?.facts.join(" ")).not.toContain("you're on ep");
    expect(ids(rankCandidates(rows, noTaste, { from: ["in_progress"] }))).toEqual([2]);
    expect(ids(rankCandidates(rows, noTaste, {})).sort()).toEqual([1, 2]);
  });
});

describe("time grace", () => {
  const rows = [
    row(1, { episodeMinutes: 16, malMean: 7 }),
    row(2, { episodeMinutes: 18, malMean: 7 }),
    row(3, { episodeMinutes: 24, malMean: 9 }),
    row(4, { episodeMinutes: 26, malMean: 9 }),
  ];

  it("adds shows up to 5 minutes over, after the ones that fit, when too few fit", () => {
    const ranked = rankCandidates(rows, noTaste, { availableMinutes: 20 });
    // The better-rated 24-minute show still comes after the ones that fit; 26 is too long.
    expect(ids(ranked)).toEqual([1, 2, 3]);
    expect(ranked[2]?.minutesOver).toBe(4);
    expect(ranked[2]?.facts).toContain("runs 4 min over your time (24 min episodes)");
    expect(ranked[0]).toMatchObject({ minutesOver: null, episodesThatFit: 1 });
  });

  it("leaves them out when enough shows fit", () => {
    const enough = [...rows, row(5, { episodeMinutes: 12 })];
    expect(ids(rankCandidates(enough, noTaste, { availableMinutes: 20 })).sort()).toEqual([
      1, 2, 5,
    ]);
  });

  it("offers only shows in the grace when none fit", () => {
    expect(ids(rankCandidates(rows, noTaste, { availableMinutes: 15 }))).toEqual([1, 2]);
  });
});

describe("years", () => {
  it("reads the start year from full or partial dates", () => {
    expect(startYearOf("2019-04-06")).toBe(2019);
    expect(startYearOf("2019-04")).toBe(2019);
    expect(startYearOf("1998")).toBe(1998);
    expect(startYearOf(null)).toBeNull();
    expect(startYearOf("")).toBeNull();
  });

  it("turns old and recent into years, counting recent from this year", () => {
    expect(eraYears("old", 2026)).toEqual({ yearTo: 1999 });
    expect(eraYears("recent", 2026)).toEqual({ yearFrom: 2022 });
  });

  const rows = [
    row(1, { startYear: 1995, malMean: 7 }),
    row(2, { startYear: 1998, malMean: 7 }),
    row(3, { startYear: 2001, malMean: 9 }),
    row(4, { startYear: 2003, malMean: 9 }),
    row(5, { startYear: null, malMean: 9 }),
  ];

  it("keeps the years asked for, then shows up to 2 years outside when too few fit", () => {
    const ranked = rankCandidates(rows, noTaste, { yearFrom: 1990, yearTo: 1999 });
    // The better-rated 2001 show comes after the two that fit; 2003 and unknown years are out.
    expect(ids(ranked)).toEqual([1, 2, 3]);
    expect(ranked[0]?.facts).toContain("aired 1995");
    expect(ranked[2]).toMatchObject({ yearsOff: 2 });
    expect(ranked[2]?.facts).toContain("aired 2001, 2 years after the years asked for");
  });

  it("leaves the near misses out when enough fit, and counts years before the range too", () => {
    const enough = [...rows, row(6, { startYear: 1999 })];
    expect(ids(rankCandidates(enough, noTaste, { yearTo: 1999 })).sort()).toEqual([1, 2, 6]);
    const recent = rankCandidates([row(7, { startYear: 2021 })], noTaste, { yearFrom: 2022 });
    expect(recent[0]?.facts).toContain("aired 2021, 1 year before the years asked for");
  });
});

describe("rankCandidates and where to watch", () => {
  const netflix = { siteId: 10, site: "Netflix", url: "https://www.netflix.com/title/1" };
  const crunchyroll = { siteId: 5, site: "Crunchyroll", url: "https://www.crunchyroll.com/x" };
  const rows = [
    row(1, { streamingLinks: [netflix], malMean: 7 }),
    row(2, { streamingLinks: [crunchyroll, netflix], malMean: 8 }),
    row(3, { streamingLinks: [crunchyroll], malMean: 9 }),
    row(4, { streamingLinks: [] }),
  ];

  it("keeps only shows on a service asked for, and never one AniList lists nowhere", () => {
    expect(ids(rankCandidates(rows, noTaste, { services: ["netflix"] }))).toEqual([2, 1]);
    expect(ids(rankCandidates(rows, noTaste, { services: ["hidive"] }))).toEqual([]);
  });

  it("says where each streams among their services and the ones asked for, without reranking", () => {
    const ranked = rankCandidates(rows, noTaste, {}, ["crunchyroll"]);
    expect(ranked.map((c) => [c.animeId, c.streamsOn])).toEqual([
      [3, ["Crunchyroll"]],
      [2, ["Crunchyroll"]],
      [4, []],
      [1, []],
    ]);
    const asked = rankCandidates(rows, noTaste, { services: ["netflix"] }, ["crunchyroll"]);
    expect(asked.map((c) => [c.animeId, c.streamsOn])).toEqual([
      [2, ["Crunchyroll", "Netflix"]],
      [1, ["Netflix"]],
    ]);
  });
});
