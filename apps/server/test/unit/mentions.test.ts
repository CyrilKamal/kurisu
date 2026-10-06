import { describe, expect, it } from "vitest";

import { namedShows } from "../../src/chat/mentions.js";

const FRIEREN = {
  animeId: 1,
  names: ["Sousou no Frieren", "Frieren: Beyond Journey's End", "Frieren"],
};
const FRIEREN_2 = { animeId: 2, names: ["Sousou no Frieren 2nd Season", "Frieren Season 2"] };
const ANOTHER = { animeId: 3, names: ["Another"] };
const K = { animeId: 4, names: ["K"] };
const BLUE_LOCK = { animeId: 5, names: ["Blue Lock"] };

describe("namedShows", () => {
  it("finds shows named as whole words, in the order the reply names them", () => {
    const reply = "Did you mean Blue Lock or Frieren: Beyond Journey’s End?";
    expect(namedShows(reply, [FRIEREN, BLUE_LOCK])).toEqual([5, 1]);
  });

  it("lets the longer name win, so one season doesn't also name another", () => {
    expect(namedShows("You're on ep 3 of Frieren Season 2.", [FRIEREN, FRIEREN_2])).toEqual([2]);
    expect(namedShows("Frieren Season 2, or the first Frieren?", [FRIEREN, FRIEREN_2])).toEqual([
      2, 1,
    ]);
  });

  it("ignores parts of words, lowercase one-word names and very short names", () => {
    expect(namedShows("Is it Frierens?", [FRIEREN])).toEqual([]);
    expect(namedShows("Want another season of it?", [ANOTHER])).toEqual([]);
    expect(namedShows("Did you mean Another?", [ANOTHER])).toEqual([3]);
    expect(namedShows("K is great.", [K])).toEqual([]);
  });

  it("keeps at most the limit", () => {
    expect(namedShows("Blue Lock, Frieren and Another?", [FRIEREN, BLUE_LOCK, ANOTHER], 2)).toEqual(
      [5, 1],
    );
  });
});
