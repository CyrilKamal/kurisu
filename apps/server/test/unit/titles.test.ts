import { describe, expect, it } from "vitest";

import { showsIn, swapTitles } from "../../src/titles/localize.js";

describe("titles in the user's language", () => {
  it("finds every show in a reply: an animeId beside a title, at any depth", () => {
    const reply = {
      title: "Not a show",
      entries: [
        { animeId: 1, title: "Sousou no Frieren", episodes: 28 },
        { animeId: 2, title: "Ookami to Koushinryou" },
      ],
      page: { show: { animeId: 3, title: "Dandadan", altTitles: ["DAN DA DAN"] } },
      chat: { id: "c1", title: "Frieren chat" },
      when: new Date(),
      odd: { animeId: "4", title: "Not a number id" },
    };
    expect(showsIn(reply).map((show) => show.animeId)).toEqual([1, 2, 3]);
  });

  it("swaps in the English or Japanese title where there is one, romaji first in altTitles", () => {
    const shows = [
      {
        animeId: 1,
        title: "Sousou no Frieren",
        altTitles: ["Frieren: Beyond Journey's End", "FBJE"],
      },
      { animeId: 2, title: "Ookami to Koushinryou" },
      { animeId: 3, title: "Dandadan" },
    ];
    const titles = new Map([
      [1, { english: "Frieren: Beyond Journey's End", japanese: "葬送のフリーレン" }],
      [2, { english: "  ", japanese: null }],
    ]);
    swapTitles(shows, titles, "english");
    expect(shows).toEqual([
      {
        animeId: 1,
        title: "Frieren: Beyond Journey's End",
        altTitles: ["Sousou no Frieren", "FBJE"],
      },
      // A blank English title, or none at all, keeps the romaji one.
      { animeId: 2, title: "Ookami to Koushinryou" },
      { animeId: 3, title: "Dandadan" },
    ]);

    const again = [{ animeId: 1, title: "Sousou no Frieren" }];
    swapTitles(again, titles, "japanese");
    expect(again[0]?.title).toBe("葬送のフリーレン");
  });
});
