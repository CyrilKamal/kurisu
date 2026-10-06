import { describe, expect, it } from "vitest";

import {
  poolOf,
  rankCandidates,
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
    ...overrides,
  };
}

const noTaste: TasteSignals = { genres: new Map(), dropCategories: new Map() };
const ids = (rows: { animeId: number }[]) => rows.map((r) => r.animeId);

describe("poolOf", () => {
  it("is Plan to Watch or in progress, never completed, dropped or unaired", () => {
    expect(poolOf(row(1, { status: "plan_to_watch" }))).toBe("plan_to_watch");
    expect(poolOf(row(1, { status: "watching" }))).toBe("in_progress");
    expect(poolOf(row(1, { status: "on_hold" }))).toBe("in_progress");
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
