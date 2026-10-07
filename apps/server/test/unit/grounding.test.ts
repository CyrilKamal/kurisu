import { describe, expect, it } from "vitest";

import { usersWords } from "../../src/list/grounding.js";
import { seasonMarkers } from "../../src/list/seasons.js";

describe("seasonMarkers", () => {
  it("reads the season and part numbers a message gives in so many words", () => {
    const cases: [string, number[], number[]][] = [
      ["finished episode 9 of cote s4", [4], []],
      ["gonna pick up sds season 3 again", [3], []],
      ["started the 2nd season", [2], []],
      ["started the second season", [2], []],
      ["watched link click II", [2], []],
      ["aot season 3 part 2", [3], [2]],
      ["the 2nd cour of it", [], [2]],
    ];
    for (const [text, seasons, parts] of cases) {
      const found = seasonMarkers(text);
      expect([[...found.seasons], [...found.parts]], text).toEqual([seasons, parts]);
    }
  });

  it("doesn't read scores, counts or episodes as seasons", () => {
    for (const text of ["rated it a 10", "watched 3 eps of tog", "ep 5 of bsd", "omp 3"]) {
      const found = seasonMarkers(text);
      expect(found.seasons.size + found.parts.size, text).toBe(0);
    }
  });
});

describe("usersWords", () => {
  it("finds a whole name as consecutive whole words", () => {
    const words = usersWords(["Just got to ep 37 in monster"]);
    expect(words.names("Monster")).toBe(true);
    expect(words.names("Re:Monster")).toBe(false);
    expect(usersWords(["Starting devilman crybaby and the eater one"]).names("Soul Eater")).toBe(
      false,
    );
  });

  it("finds a name by its initials, from three words up and past a leading article", () => {
    expect(usersWords(["next ep of ylia"]).names("Your Lie in April")).toBe(true);
    expect(usersWords(["sds season 3"]).names("The Seven Deadly Sins")).toBe(true);
    expect(usersWords(["watched se"]).names("Soul Eater")).toBe(false);
    expect(usersWords(["watched the first ep"]).names("Tokyo Hikari Engine")).toBe(false);
  });

  it("tells the user's words rearranged from a query with words of the model's own", () => {
    const words = usersWords(["started season 2 of isekai chronicles", "and the eater one"]);
    expect(words.says("Isekai Chronicles Season 2")).toBe(true);
    expect(words.says("the eater one")).toBe(true);
    expect(words.says("Soul Eater")).toBe(false);
    // Not pieced together from two messages either.
    expect(words.says("isekai eater")).toBe(false);
  });

  it("checks a season number in the same message as the name", () => {
    const s4 = { season: 4, part: null };
    expect(usersWords(["bsd s4 ep 2"]).names("BSD", s4)).toBe(true);
    expect(usersWords(["bsd ep 2"]).names("BSD", s4)).toBe(false);
    expect(usersWords(["bsd ep 2", "tog s4"]).names("BSD", s4)).toBe(false);
  });
});
