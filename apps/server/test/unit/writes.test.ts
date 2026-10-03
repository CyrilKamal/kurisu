import { describe, expect, it } from "vitest";

import { markClear, type ScoredEntry } from "../../src/list/search.js";
import { matchesSeason, normalizeName, seasonRef } from "../../src/list/seasons.js";
import type { ListStatus } from "../../src/writes/normalize.js";
import { keyFor } from "../../src/writes/propose.js";

/** One entry scored against the queries (one score per query; a single number for one query). */
function entry(
  animeId: number,
  scores: number | number[],
  opts: {
    status?: ListStatus;
    airing?: string;
    names?: string[];
    exact?: boolean | boolean[];
  } = {},
): ScoredEntry {
  const perQuery = Array.isArray(scores) ? scores : [scores];
  const exact = opts.exact ?? false;
  return {
    animeId,
    title: opts.names?.[0] ?? `Show ${String(animeId)}`,
    titleEn: null,
    mediaType: "tv",
    numEpisodes: 12,
    status: opts.status ?? "completed",
    episodesWatched: 0,
    score: 0,
    isRewatching: false,
    airingStatus: opts.airing ?? "finished_airing",
    matchScore: Math.max(...perQuery),
    matchedName: `Show ${String(animeId)}`,
    names: opts.names ?? [`Show ${String(animeId)}`],
    scores: perQuery,
    exact: Array.isArray(exact) ? exact : perQuery.map(() => exact),
  };
}

const clearIds = (pool: ScoredEntry[], queries = ["show"]) =>
  markClear(pool, queries)
    .filter((c) => c.clear)
    .map((c) => c.animeId);

describe("markClear", () => {
  it("a strong top match with a clear margin is clear", () => {
    expect(clearIds([entry(1, 0.9), entry(2, 0.5)])).toEqual([1]);
    expect(clearIds([entry(1, 0.7)])).toEqual([1]);
  });

  it("a weak top match is never clear", () => {
    expect(clearIds([entry(1, 0.5)])).toEqual([]);
  });

  it("near-ties are unclear", () => {
    expect(clearIds([entry(1, 0.95), entry(2, 0.9)])).toEqual([]);
  });

  it("an exact name beats names that only contain the query", () => {
    // "another" is a whole word of "...in Another World", but only one show is called Another.
    const pool = [
      entry(1, 1, { names: ["Another"], exact: true, status: "plan_to_watch" }),
      entry(2, 0.95, { names: ["Re:ZERO -Starting Life in Another World-"] }),
    ];
    expect(clearIds(pool, ["another"])).toEqual([1]);
    expect(markClear(pool, ["another"])[0]?.clearBy).toBe("unique");
  });

  it("an exact name that later seasons start with falls back to the season in progress", () => {
    // "bsd ep 5": the franchise name is also season 1's title, but season 4 is the one watched.
    const pool = [
      entry(1, 1, { names: ["Bungou Stray Dogs"], exact: true }),
      entry(4, 0.95, { names: ["Bungou Stray Dogs 4th Season"], status: "watching" }),
      entry(5, 0.95, { names: ["Bungou Stray Dogs 5th Season"], status: "plan_to_watch" }),
    ];
    const marked = markClear(pool, ["bungou stray dogs"]);
    expect(marked.filter((c) => c.clear).map((c) => [c.animeId, c.clearBy])).toEqual([
      [4, "only_in_progress"],
    ]);
  });

  it("a season or part number in the query picks that entry", () => {
    const danmachi = [
      entry(1, 0.95, { names: ["DanMachi"] }),
      entry(2, 0.95, { names: ["DanMachi II"] }),
      entry(4, 0.95, { names: ["DanMachi IV: Shin Shou"], status: "plan_to_watch" }),
    ];
    expect(clearIds(danmachi, ["danmachi 4th season"])).toEqual([4]);
    expect(clearIds(danmachi, ["danmachi"])).toEqual([]);

    // Two entries are both "Season 2": still ambiguous.
    const tog = [
      entry(1, 0.95, { names: ["Tower of God"] }),
      entry(2, 0.95, {
        names: ["Tower of God Season 2: Return of the Prince"],
        status: "watching",
      }),
      entry(3, 0.95, { names: ["Tower of God Season 2: Workshop Battle"], status: "watching" }),
    ];
    expect(clearIds(tog, ["tog s2"])).toEqual([]);
  });

  it("ignores season numbers for franchises that name seasons after arcs", () => {
    const sds = [
      entry(1, 0.95, { names: ["Nanatsu no Taizai", "The Seven Deadly Sins"] }),
      entry(2, 0.95, { names: ["Nanatsu no Taizai: Imashime no Fukkatsu"] }),
      entry(3, 0.95, { names: ["Nanatsu no Taizai: Kamigami no Gekirin"], status: "on_hold" }),
    ];
    expect(markClear(sds, ["seven deadly sins season 3"]).find((c) => c.clear)).toMatchObject({
      animeId: 3,
      clearBy: "only_in_progress",
    });
  });

  it("finds nothing when the franchise numbers its seasons and that one isn't on the list", () => {
    const frieren = [
      entry(1, 0.95, { names: ["Sousou no Frieren"] }),
      entry(2, 0.95, { names: ["Sousou no Frieren 2nd Season"], status: "watching" }),
    ];
    expect(clearIds(frieren, ["frieren season 3"])).toEqual([]);
    expect(clearIds(frieren, ["frieren"])).toEqual([2]);
  });

  it("only breaks ties between seasons of one franchise, not shows that share a word", () => {
    const blue = [
      entry(1, 0.95, { names: ["Blue Lock"] }),
      entry(2, 0.95, {
        names: ["Blue Lock vs. U-20 Japan", "Blue Lock Season 2"],
        status: "watching",
      }),
      entry(3, 0.95, { names: ["Grand Blue"], status: "plan_to_watch" }),
    ];
    expect(clearIds(blue, ["blue"])).toEqual([]);
    expect(clearIds(blue.slice(0, 2), ["blue lock"])).toEqual([2]);
  });

  it("judges each query on its own, so one search can cover several shows", () => {
    const pool = [
      entry(1, [1, 0.3], { names: ["World Trigger"], exact: [true, false] }),
      entry(2, [0.3, 1], { names: ["One Piece"], exact: [false, true], status: "watching" }),
    ];
    expect(clearIds(pool, ["world trigger", "one piece"]).sort()).toEqual([1, 2]);
  });

  it("breaks a tie when exactly one tied show is in progress (sequel seasons)", () => {
    // "frieren ep 5": season 1 completed, season 2 watching, both match "frieren" equally.
    expect(clearIds([entry(1, 0.95), entry(2, 0.95, { status: "watching" })])).toEqual([2]);
    expect(
      clearIds([
        entry(1, 0.95, { status: "on_hold" }),
        entry(2, 0.95, { status: "plan_to_watch" }),
      ]),
    ).toEqual([1]);
  });

  it("says why a match is clear", () => {
    const [unique] = markClear([entry(1, 0.9), entry(2, 0.5)], ["show"]);
    const tied = markClear([entry(1, 0.95), entry(2, 0.95, { status: "watching" })], ["show"]);
    expect(unique?.clearBy).toBe("unique");
    expect(tied.map((c) => c.clearBy)).toEqual([null, "only_in_progress"]);
  });

  it("stays unclear when several tied shows are in progress", () => {
    expect(
      clearIds([entry(1, 0.95, { status: "watching" }), entry(2, 0.95, { status: "watching" })]),
    ).toEqual([]);
  });

  it("a show that hasn't aired isn't in progress, even if the list says watching", () => {
    // "black clover ep 3": season 1 completed, season 2 parked in Watching before it airs.
    const unaired = { status: "watching" as const, airing: "not_yet_aired" };
    expect(clearIds([entry(1, 0.95), entry(2, 0.95, unaired)])).toEqual([]);
    // Once it airs, the tie-break picks it again.
    expect(
      clearIds([
        entry(1, 0.95),
        entry(2, 0.95, { status: "watching", airing: "currently_airing" }),
      ]),
    ).toEqual([2]);
    // A unique match is still clear; propose_update holds progress on it instead.
    expect(clearIds([entry(1, 0.9, unaired)])).toEqual([1]);
  });

  it("an in-progress show outside the tie doesn't count", () => {
    expect(
      clearIds([entry(1, 0.95), entry(2, 0.94), entry(3, 0.5, { status: "watching" })]),
    ).toEqual([]);
  });
});

describe("seasons", () => {
  it("reads season and part numbers in their usual forms", () => {
    const cases: [string, number | null, number | null][] = [
      ["Bungou Stray Dogs 4th Season", 4, null],
      ["Tower of God Season 2: Workshop Battle", 2, null],
      ["Mushoku Tensei II: Isekai Ittara Honki Dasu Part 2", 2, 2],
      ["Is It Wrong to Try to Pick Up Girls in a Dungeon? IV", 4, null],
      ["tog s2", 2, null],
      ["omp 3", 3, null],
      ["NieR:Automata Ver1.1a Part 2", null, 2],
      ["NieR:Automata Ver1.1a (Cour 2)", null, 2],
      ["the second season of jjk", 2, null],
      ["bsd ep 5", null, null],
      ["Mob Psycho 100", null, null],
      ["Spy x Family", null, null],
    ];
    for (const [text, season, part] of cases) {
      expect([text, seasonRef(text)]).toEqual([text, { season, part }]);
    }
  });

  it("treats an entry without numbers as season 1, part 1", () => {
    expect(matchesSeason(["Tower of God"], { season: 1, part: null })).toBe(true);
    expect(matchesSeason(["Tower of God"], { season: 2, part: null })).toBe(false);
    expect(
      matchesSeason(["Kami no Tou: Koubou-sen", "Kami no Tou 2nd Season"], seasonRef("s2")),
    ).toBe(true);
  });

  it("normalizes names for exact comparison", () => {
    expect(normalizeName("Gangsta.")).toBe("gangsta");
    expect(normalizeName("  Re:ZERO -Starting Life-  ")).toBe("re zero starting life");
  });
});

describe("keyFor", () => {
  it("is stable regardless of field order and differs by run, anime and value", () => {
    const a = keyFor("run-1", 5, { status: "completed", episodesWatched: 12 });
    expect(keyFor("run-1", 5, { episodesWatched: 12, status: "completed" })).toBe(a);
    expect(keyFor("run-2", 5, { status: "completed", episodesWatched: 12 })).not.toBe(a);
    expect(keyFor("run-1", 6, { status: "completed", episodesWatched: 12 })).not.toBe(a);
    expect(keyFor("run-1", 5, { status: "completed", episodesWatched: 11 })).not.toBe(a);
  });
});
