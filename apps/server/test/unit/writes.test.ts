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
    mediaType?: string;
    rewatching?: boolean;
  } = {},
): ScoredEntry {
  const perQuery = Array.isArray(scores) ? scores : [scores];
  const exact = opts.exact ?? false;
  return {
    animeId,
    title: opts.names?.[0] ?? `Show ${String(animeId)}`,
    titleEn: null,
    mediaType: opts.mediaType ?? "tv",
    numEpisodes: 12,
    status: opts.status ?? "completed",
    episodesWatched: 0,
    score: 0,
    isRewatching: opts.rewatching ?? false,
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

  describe("a tie stays a tie", () => {
    const blue = () => [
      entry(1, [0.95, 1], { names: ["Blue Lock"], exact: [false, true] }),
      entry(2, [0.95, 0.95], { names: ["Blue Lock Season 2"], status: "watching" }),
      entry(3, [0.95, 0.3], { names: ["Grand Blue"], status: "plan_to_watch" }),
    ];
    /** The same entries, scored only on the second query, as a later search would. */
    const secondQueryOnly = (pool: ScoredEntry[]) =>
      pool.map((e) => ({ ...e, scores: [e.scores[1] ?? 0], exact: [e.exact[1] ?? false] }));

    it("a title the model supplied can't pick between entries another query left tied", () => {
      // "blue" ties Blue Lock and Grand Blue; "blue lock" is the model's guess.
      expect(
        markClear(blue(), ["blue", "blue lock"], { userText: "watched ep 1 of blue" }).some(
          (c) => c.clear,
        ),
      ).toBe(false);
      // Searched on its own, the same title does decide.
      expect(clearIds(secondQueryOnly(blue()), ["blue lock"])).toEqual([2]);
    });

    it("holds within one franchise too, even against an exact name", () => {
      // "tog s2": two entries are both Season 2. Naming one exactly is the model choosing.
      const tog = [
        entry(1, [0.7, 0.4], { names: ["Tower of God"] }),
        entry(2, [0.95, 1], {
          names: ["Kami no Tou: Ouji no Kikan", "Tower of God Season 2: Return of the Prince"],
          exact: [false, true],
          status: "watching",
        }),
        entry(3, [0.95, 0.5], {
          names: ["Kami no Tou: Koubou-sen", "Tower of God Season 2: Workshop Battle"],
          status: "watching",
        }),
      ];
      const queries = ["tower of god season 2", "kami no tou ouji no kikan"];
      expect(
        markClear(tog, queries, { userText: "3 episodes done of tog s2" }).some((c) => c.clear),
      ).toBe(false);
    });

    it("the user's own words can settle it", () => {
      const danmachi = [
        entry(1, [0.95, 0.9], { names: ["DanMachi"] }),
        entry(2, [0.95, 0.9], { names: ["DanMachi II"] }),
        entry(4, [0.95, 0.95], { names: ["DanMachi IV: Shin Shou"], status: "plan_to_watch" }),
      ];
      const marked = markClear(danmachi, ["danmachi", "danmachi 4th season"], {
        userText: "Started DanMachi 4th Season",
      });
      expect(marked.filter((c) => c.clear).map((c) => c.animeId)).toEqual([4]);
    });

    it("remembers a tie across the searches of one run", () => {
      const contested = new Set<number>();
      const context = { userText: "watched ep 1 of blue", contested };
      markClear(blue(), ["blue"], context);
      expect(markClear(secondQueryOnly(blue()), ["blue lock"], context).some((c) => c.clear)).toBe(
        false,
      );
    });

    it("still lets the model decode a nickname that ties with nothing", () => {
      const pool = [entry(7, [0, 1], { names: ["One Punch Man 3"], exact: [false, true] })];
      expect(
        markClear(pool, ["omp 3", "one punch man 3"], { userText: "started omp 3" }).map(
          (c) => c.clear,
        ),
      ).toEqual([true]);
    });
  });

  describe("batch 2 fixes", () => {
    it("other shows' alternative names don't make them look like later seasons", () => {
      // Kaiju No. 8 is also called "Monster #8"; that doesn't make it a season of Monster.
      const pool = [
        entry(19, 1, { names: ["Monster"], exact: true, status: "watching" }),
        entry(52588, 0.95, { names: ["Kaijuu 8-gou", "Kaiju No. 8", "Monster #8"] }),
        entry(40908, 0.95, { names: ["Kemono Jihen", "Monster Incidents"] }),
        entry(46095, 0.95, { names: ["Re:Monster"] }),
      ];
      expect(
        markClear(pool, ["monster"])
          .filter((c) => c.clear)
          .map((c) => [c.animeId, c.clearBy]),
      ).toEqual([[19, "unique"]]);
    });

    it("a show being rewatched counts as the season in progress", () => {
      const geass = [
        entry(1575, 0.95, { names: ["Code Geass"], rewatching: true }),
        entry(2904, 0.95, { names: ["Code Geass R2"] }),
      ];
      expect(
        markClear(geass, ["code geass"])
          .filter((c) => c.clear)
          .map((c) => c.clearBy),
      ).toEqual(["only_in_progress"]);
    });

    it("naming an entry exactly settles it when the user is answering 'which one?'", () => {
      const clannad = [
        entry(2167, 1, { names: ["Clannad"], exact: true }),
        entry(4181, 0.95, { names: ["Clannad: After Story"] }),
      ];
      expect(clearIds(clannad, ["clannad"])).toEqual([]);
      expect(
        markClear(clannad, ["clannad"], { userText: "clannad", answering: true })
          .filter((c) => c.clear)
          .map((c) => c.animeId),
      ).toEqual([2167]);
    });
  });

  describe("conflicting guesses", () => {
    const mha = () => [
      entry(60098, [1, 0.5], {
        names: ["Boku no Hero Academia: Final Season", "My Hero Academia Final Season"],
        exact: [true, false],
      }),
      entry(54789, [0.5, 0.95], {
        names: ["Boku no Hero Academia 7th Season", "My Hero Academia Season 7"],
      }),
    ];

    it("the model's own titles pointing at two seasons of one show make neither clear", () => {
      const marked = markClear(mha(), ["my hero academia final season", "mha season 7"], {
        userText: "Im rating the final mha season a 10",
      });
      expect(marked.some((c) => c.clear)).toBe(false);
      // Each title on its own would have been clear.
      expect(
        clearIds(mha(), ["my hero academia final season", "mha season 7"].slice(0, 1)),
      ).toEqual([60098]);
    });

    it("a vague title from the model that fits different shows doesn't block a precise one", () => {
      // "mha final season" also fits Attack on Titan's Final Season; it says nothing about MHA's.
      const pool = [
        entry(60098, [0.7, 1], {
          names: ["Boku no Hero Academia: Final Season", "My Hero Academia Final Season"],
          exact: [false, true],
        }),
        entry(40028, [0.76, 0.5], { names: ["Shingeki no Kyojin: The Final Season"] }),
        entry(30654, [0.76, 0.3], { names: ["Ansatsu Kyoushitsu 2nd Season"] }),
      ];
      const marked = markClear(pool, ["mha final season", "my hero academia final season"], {
        userText: "Im rating the final mha season a 10",
      });
      expect(marked.filter((c) => c.clear).map((c) => c.animeId)).toEqual([60098]);
    });

    it("seasons sharing an alternative name still count as later seasons", () => {
      // "DanMachi" is season 1's alternative name, and season 2's is "DanMachi II".
      const danmachi = [
        entry(28121, 1, {
          names: ["Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka", "DanMachi"],
          exact: true,
        }),
        entry(37347, 0.95, {
          names: ["Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka II", "DanMachi II"],
        }),
      ];
      expect(clearIds(danmachi, ["danmachi"])).toEqual([]);
    });

    it("a search of only the model's guesses needs an exact name", () => {
      // The user said "blue"; the model only searched its guess. The season tie-break that would
      // pick Blue Lock Season 2 is a guess on a guess.
      const blue = [
        entry(49596, 1, { names: ["Blue Lock"], exact: true }),
        entry(54865, 0.95, { names: ["Blue Lock Season 2"], status: "watching" }),
      ];
      const said = { userText: "Just watched episode one of blue" };
      expect(markClear(blue, ["blue lock"], said).some((c) => c.clear)).toBe(false);
      expect(clearIds(blue, ["blue lock"])).toEqual([54865]);

      // An exact name still decodes a nickname the user wrote ("omp 3").
      const opm = [entry(52807, 1, { names: ["One Punch Man 3"], exact: true })];
      expect(
        markClear(opm, ["one punch man 3"], { userText: "started omp 3" }).map((c) => c.clear),
      ).toEqual([true]);
    });

    it("different shows that share a first word aren't a conflict", () => {
      const tokyo = [
        entry(22319, [1, 0.4], { names: ["Tokyo Ghoul"], exact: [true, false] }),
        entry(42249, [0.4, 1], { names: ["Tokyo Revengers"], exact: [false, true] }),
      ];
      expect(clearIds(tokyo, ["tokyo ghoul", "tokyo revengers"]).sort()).toEqual([22319, 42249]);
    });

    it("a match from the user's own words isn't a guess", () => {
      // "bsd" (the user's word) is season 1's alternative name; the model's full title finds the
      // season in progress. Both stay clear and the model picks.
      const bsd = [
        entry(31478, [1, 1], { names: ["Bungou Stray Dogs", "BSD"], exact: [true, true] }),
        entry(50330, [0, 0.95], { names: ["Bungou Stray Dogs 4th Season"], status: "watching" }),
      ];
      const marked = markClear(bsd, ["bsd", "bungou stray dogs"], {
        userText: "Watched episode 5 of bsd",
      });
      expect(
        marked
          .filter((c) => c.clear)
          .map((c) => c.animeId)
          .sort(),
      ).toEqual([31478, 50330]);
    });
  });

  describe("seasons MAL names after their arc", () => {
    const sds = [
      entry(23755, 0.95, { names: ["Nanatsu no Taizai", "The Seven Deadly Sins"] }),
      entry(34577, 0.95, {
        names: ["Nanatsu no Taizai: Imashime no Fukkatsu", "Seven Deadly Sins Season 2"],
      }),
      entry(39701, 0.95, { names: ["Nanatsu no Taizai: Kamigami no Gekirin"], status: "on_hold" }),
    ];

    it("finds season N as the one unnumbered entry newer than the numbered seasons before it", () => {
      const marked = markClear(sds, ["seven deadly sins season 3"]);
      expect(marked.filter((c) => c.clear).map((c) => [c.animeId, c.clearBy])).toEqual([
        [39701, "unique"],
      ]);
      expect(clearIds(sds, ["seven deadly sins season 4"])).toEqual([]);
    });

    it("doesn't guess when that season comes in parts or only older entries fit", () => {
      const aot = [
        entry(25777, 0.95, { names: ["Attack on Titan Season 2"] }),
        entry(35760, 0.95, { names: ["Attack on Titan Season 3"] }),
        entry(40028, 0.95, { names: ["Attack on Titan: Final Season"] }),
        entry(48583, 0.95, { names: ["Attack on Titan: Final Season Part 2"] }),
        entry(51535, 0.95, {
          names: ["Attack on Titan: Final Season - The Final Chapters"],
          mediaType: "tv_special",
          status: "plan_to_watch",
        }),
      ];
      expect(clearIds(aot, ["aot season 4"])).toEqual([]);

      // Mushoku Tensei's season 1 part 2 is older than season 2, so it can't be "season 4".
      const mushoku = [
        entry(39535, 0.95, { names: ["Mushoku Tensei"] }),
        entry(45576, 0.95, { names: ["Mushoku Tensei Part 2"] }),
        entry(51179, 0.95, { names: ["Mushoku Tensei II"] }),
        entry(59193, 0.95, { names: ["Mushoku Tensei III"], status: "watching" }),
      ];
      expect(clearIds(mushoku, ["mushoku tensei season 4"])).toEqual([]);
    });
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
