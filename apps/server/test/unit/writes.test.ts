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

  it("outside the list, a series' own movies and specials don't stop its exact name", () => {
    const tatami = [
      entry(7785, 1, { names: ["Yojouhan Shinwa Taikei", "The Tatami Galaxy"], exact: true }),
      entry(8985, 0.95, {
        names: ["Yojouhan Shinwa Taikei Specials", "The Tatami Galaxy Specials"],
        mediaType: "special",
      }),
    ];
    const outside = (pool: ScoredEntry[], query: string) =>
      markClear(pool, [query], { sideStoriesDontCount: true })
        .filter((c) => c.clear)
        .map((c) => c.animeId);
    expect(outside(tatami, "the tatami galaxy")).toEqual([7785]);
    // On the list the rule stays as it was: the user put the specials there.
    expect(clearIds(tatami, ["the tatami galaxy"])).toEqual([]);

    // Another TV season still counts: "mushishi" has Zoku Shou too.
    const mushishi = [
      entry(457, 1, { names: ["Mushishi"], exact: true }),
      entry(21939, 0.95, { names: ["Mushishi Zoku Shou"] }),
      entry(28957, 0.9, { names: ["Mushishi Tokubetsu-hen: Suzu no Shizuku"], mediaType: "movie" }),
    ];
    expect(outside(mushishi, "mushishi")).toEqual([]);
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

  describe("grounded in the user's words", () => {
    /** The clear matches when the user's messages are known, as the agent's tools search. */
    const grounded = (
      pool: ScoredEntry[],
      queries: string[],
      message: string,
      earlier: string[] = [],
    ) =>
      markClear(pool, queries, { userText: message, groundIn: [message, ...earlier] })
        .filter((c) => c.clear)
        .map((c) => c.animeId);
    /**
     * The same entries with a first query of the user's own words that matches none of them well
     * ("mha"), so the search isn't all the model's guesses.
     */
    const withUsersWords = (pool: ScoredEntry[]) =>
      pool.map((e) => ({ ...e, scores: [0.3, ...e.scores], exact: [false, ...e.exact] }));

    const eater = () => [
      entry(3588, [1, 0.4], { names: ["Soul Eater"], exact: [true, false] }),
      entry(27631, [0.5, 0.4], { names: ["God Eater"] }),
    ];
    const devilmanAndEater = "Starting devilman crybaby and the eater one";

    it("a title the model made up from vague words waits for the user", () => {
      // "the eater one" -> "Soul Eater" is an exact name, but the user never said it.
      expect(grounded(eater(), ["soul eater", "the eater one"], devilmanAndEater)).toEqual([]);
      // Searching beyond the list (search_anime) holds it the same way.
      expect(
        markClear(eater(), ["soul eater", "the eater one"], {
          userText: devilmanAndEater,
          groundIn: [devilmanAndEater],
          sideStoriesDontCount: true,
        }).some((c) => c.clear),
      ).toBe(false);
      // Without the user's messages to check against, it's clear as before.
      expect(
        markClear(eater(), ["soul eater", "the eater one"], { userText: devilmanAndEater })
          .filter((c) => c.clear)
          .map((c) => c.animeId),
      ).toEqual([3588]);
    });

    it("a show the user named is clear, by any of its names", () => {
      const devilman = [entry(35120, 1, { names: ["Devilman: Crybaby"], exact: true })];
      expect(grounded(devilman, ["devilman crybaby"], devilmanAndEater)).toEqual([35120]);
      // The model searched the Japanese title; the user wrote the English one.
      const ylia = [
        entry(23273, 1, { names: ["Shigatsu wa Kimi no Uso", "Your Lie in April"], exact: true }),
      ];
      const message = "watched ep 4 of your lie in april";
      expect(grounded(ylia, ["shigatsu wa kimi no uso"], message)).toEqual([23273]);
    });

    it("the initials of a title of three or more words name it", () => {
      const ylia = [
        entry(23273, 1, { names: ["Shigatsu wa Kimi no Uso", "Your Lie in April"], exact: true }),
      ];
      expect(grounded(ylia, ["your lie in april"], "I watched the next ep of ylia")).toEqual([
        23273,
      ]);
      // Two words are too few to be sure of, and everyday words aren't initials.
      const grand = [entry(1, 1, { names: ["Grand Blue"], exact: true })];
      expect(grounded(grand, ["grand blue"], "watched gb ep 2")).toEqual([]);
      const made = [entry(2, 1, { names: ["Tokyo Hikari Engine"], exact: true })];
      expect(grounded(made, ["tokyo hikari engine"], "watched the first ep")).toEqual([]);
    });

    it("another season the user named lets the code pick the one in progress", () => {
      // "bsd" is only season 1's nickname; "ep 5 of bsd" means the season being watched.
      const bsd = [
        entry(31478, [1, 1], { names: ["Bungou Stray Dogs", "BSD"], exact: [true, true] }),
        entry(50330, [0.2, 0.95], { names: ["Bungou Stray Dogs 4th Season"], status: "watching" }),
        entry(54898, [0.2, 0.95], {
          names: ["Bungou Stray Dogs 5th Season"],
          status: "plan_to_watch",
        }),
      ];
      expect(
        grounded(bsd, ["bsd", "bungou stray dogs"], "Watched episode 5 of bsd").sort(),
      ).toEqual([31478, 50330]);
      // Vague words the model read as Bungou Stray Dogs name no season of it.
      const vague = bsd.map((e) => ({
        ...e,
        scores: [0.3, e.scores[1] ?? 0],
        exact: [false, e.exact[1] ?? false],
      }));
      expect(
        grounded(vague, ["the stray one", "bungou stray dogs"], "Watched ep 5 of the stray one"),
      ).toEqual([]);
      // MHA More: "mha" names season 1 by its initials, and More is the season being watched.
      const mha = [
        entry(31964, 1, { names: ["Boku no Hero Academia", "My Hero Academia"], exact: true }),
        entry(63130, 0.95, {
          names: ["Boku no Hero Academia: More", "My Hero Academia: More"],
          status: "watching",
        }),
        entry(54789, 0.95, { names: ["Boku no Hero Academia 7th Season"] }),
      ];
      expect(
        grounded(withUsersWords(mha), ["mha", "my hero academia"], "Just watched MHA more"),
      ).toEqual([63130]);
    });

    it("a season number counts only when the user gave it", () => {
      const bsd5 = [
        entry(31478, 0.9, { names: ["Bungou Stray Dogs", "BSD"] }),
        entry(54898, 1, { names: ["Bungou Stray Dogs 5th Season"], exact: true }),
      ];
      const fifth = "bungou stray dogs 5th season";
      expect(grounded(withUsersWords(bsd5), ["bsd", fifth], "Watched episode 5 of bsd")).toEqual(
        [],
      );
      expect(grounded(withUsersWords(bsd5), ["bsd s5", fifth], "watched ep 2 of bsd s5")).toEqual([
        54898,
      ]);

      // "cote s4": the user's initials name season 1, the number picks season 4.
      const cote = [
        entry(35507, 0.85, {
          names: ["Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e", "Classroom of the Elite"],
        }),
        entry(51180, 0.85, {
          names: ["Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 3rd Season"],
        }),
        entry(59708, 0.95, {
          names: [
            "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season: 2-nensei-hen 1 Gakki",
            "Classroom of the Elite 4th Season: Second Year, First Semester",
          ],
          status: "watching",
        }),
      ];
      const season4 = "classroom of the elite season 4";
      expect(
        grounded(withUsersWords(cote), ["cote s4", season4], "finished episode 9 of cote s4"),
      ).toEqual([59708]);
      expect(
        grounded(withUsersWords(cote), ["cote", season4], "finished episode 9 of cote"),
      ).toEqual([]);

      // "sds season 3": initials of "The Seven Deadly Sins", and a season MAL names after its arc.
      const sds = [
        entry(23755, 0.95, { names: ["Nanatsu no Taizai", "The Seven Deadly Sins"] }),
        entry(34577, 0.95, {
          names: ["Nanatsu no Taizai: Imashime no Fukkatsu", "Seven Deadly Sins Season 2"],
        }),
        entry(39701, 0.95, {
          names: ["Nanatsu no Taizai: Kamigami no Gekirin"],
          status: "on_hold",
        }),
      ];
      expect(
        grounded(
          withUsersWords(sds),
          ["sds season 3", "seven deadly sins season 3"],
          "gonna pick up sds season 3 again",
        ),
      ).toEqual([39701]);
    });

    it("the user's earlier messages count, but a name can't span two of them", () => {
      const monster = [entry(19, 1, { names: ["Monster"], exact: true, status: "watching" })];
      expect(
        grounded(monster, ["monster"], "actually I meant ep 38", ["Just got to ep 37 in monster"]),
      ).toEqual([19]);
      expect(grounded(monster, ["monster"], "actually I meant ep 38")).toEqual([]);

      const grand = [entry(1, 1, { names: ["Grand Blue"], exact: true })];
      expect(
        grounded(grand, ["grand blue"], "and ep 2 of blue", ["finally watched grand"]),
      ).toEqual([]);
    });

    it("the user's own words need nothing more", () => {
      // "frieren" isn't a whole name of either season, but the user typed the query.
      const frieren = [
        entry(52991, 0.95, { names: ["Sousou no Frieren", "Frieren: Beyond Journey's End"] }),
        entry(59978, 0.95, { names: ["Sousou no Frieren 2nd Season"], status: "watching" }),
      ];
      expect(grounded(frieren, ["frieren"], "frieren ep 5")).toEqual([59978]);
    });

    it("the user's own words in another order are still theirs", () => {
      // No title is in the message, but the model only rearranged what the user wrote.
      const chronicles = [
        entry(900011, 0.85, { names: ["Isekai Chronicles: Reborn as a Fixture"] }),
        entry(900012, 0.95, {
          names: ["Isekai Chronicles: Reborn as a Fixture Season 2"],
          status: "plan_to_watch",
        }),
      ];
      const message = "started season 2 of isekai chronicles";
      // Rearranged words aren't the model's guesses, so the season number decides even alone.
      expect(grounded(chronicles, ["isekai chronicles season 2"], message)).toEqual([900012]);
      expect(
        grounded(
          withUsersWords(chronicles),
          ["season 2 of", "isekai chronicles season 2"],
          message,
        ),
      ).toEqual([900012]);
      // One word of its own ("reborn") makes it the model's title again.
      const reborn = "isekai chronicles reborn season 2";
      expect(grounded(withUsersWords(chronicles), ["season 2 of", reborn], message)).toEqual([]);
    });
  });

  describe("the query's words are in the name", () => {
    const clearFor = (pool: ScoredEntry[], query: string, message = query) =>
      markClear(pool, [query], { userText: message, groundIn: [message] })
        .filter((c) => c.clear)
        .map((c) => c.animeId);

    it("a fuzzy score alone doesn't make the user's words mean a show", () => {
      // Perfect Blue isn't on the list; "perfect blue" scores 0.615 against Blue Period.
      const blue = [
        entry(46352, 0.615, { names: ["Blue Period", "ブルーピリオド"] }),
        entry(49596, 0.4, { names: ["Blue Lock"] }),
      ];
      expect(clearFor(blue, "perfect blue", "finished perfect blue 10/10")).toEqual([]);
      // Without the user's messages, the same.
      expect(markClear(blue, ["perfect blue"]).some((c) => c.clear)).toBe(false);
    });

    it("keeps nicknames that are part of a name, synonyms and joined-up words", () => {
      const kusuriya = [
        entry(1, 0.7, { names: ["Kusuriya no Hitorigoto", "The Apothecary Diaries"] }),
      ];
      expect(clearFor(kusuriya, "kusuriya")).toEqual([1]);
      const frieren = [
        entry(52991, 0.7, { names: ["Sousou no Frieren", "Frieren: Beyond Journey's End"] }),
      ];
      expect(clearFor(frieren, "frieren")).toEqual([52991]);
      expect(clearFor(frieren, "frieren beyond journeys end")).toEqual([52991]);
      const rezero = [entry(31240, 0.7, { names: ["Re:Zero kara Hajimeru Isekai Seikatsu"] })];
      expect(clearFor(rezero, "rezero")).toEqual([31240]);
      const synonym = [entry(2, 0.95, { names: ["Bungou Stray Dogs", "BSD"] })];
      expect(clearFor(synonym, "bsd")).toEqual([2]);
    });

    it("a season can be reached through another season's name", () => {
      // "JJK" is only season 1's synonym; the number picks season 2.
      const jjk = [
        entry(40748, 0.9, { names: ["Jujutsu Kaisen", "JJK"] }),
        entry(51009, 0.9, { names: ["Jujutsu Kaisen 2nd Season"] }),
      ];
      expect(clearFor(jjk, "jjk s2")).toEqual([51009]);
      // A show that only resembles one of them gets nothing from it.
      const pool = [...jjk, entry(3, 0.95, { names: ["Jujutsu Kaitei"] })];
      expect(clearFor(pool, "jujutsu kaitei 2")).toEqual([]);
    });

    it("a close spelling counts, a different word doesn't", () => {
      const frieren = [entry(52991, 0.8, { names: ["Sousou no Frieren"] })];
      expect(clearFor(frieren, "frieran", "watched ep 5 of frieran")).toEqual([52991]);
      const hyouka = [entry(12189, 0.7, { names: ["Hyouka"] })];
      expect(clearFor(hyouka, "hoyuka", "started hoyuka")).toEqual([]);
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
