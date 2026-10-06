import { describe, expect, it } from "vitest";

import { frozenCatalogSearch, type CatalogFreeze } from "../../eval/src/catalog.js";

const show = (
  anilistId: number,
  title: string,
  extra: { titleEn?: string; synonyms?: string[] } = {},
) => ({
  anilistId,
  malId: anilistId + 1000,
  title,
  titleEn: extra.titleEn ?? null,
  titleJa: null,
  synonyms: extra.synonyms ?? [],
  format: "TV",
  status: "FINISHED",
  episodes: 12,
  duration: 24,
  coverUrl: null,
  startDate: "2024",
});

const freeze: CatalogFreeze = {
  description: "test",
  source: "anilist",
  searches: [
    {
      query: "frieren",
      frozenAt: "2026-10-06T00:00:00.000Z",
      shows: [
        show(1, "Sousou no Frieren", { titleEn: "Frieren: Beyond Journey's End" }),
        show(2, "Sousou no Frieren 2nd Season"),
      ],
    },
    { query: "dandadan", frozenAt: "2026-10-06T00:00:00.000Z", shows: [show(3, "Dandadan")] },
  ],
};

describe("frozenCatalogSearch", () => {
  it("finds shows whose names contain every word of a title", async () => {
    const search = frozenCatalogSearch(freeze);
    const ids = async (queries: string[]) => (await search(queries)).map((s) => s.anilistId);

    expect(await ids(["frieren"])).toEqual([1, 2]);
    expect(await ids(["Frieren: Beyond Journey's End"])).toEqual([1]);
    expect(await ids(["sousou no frieren 2nd season", "dandadan"])).toEqual([2, 3]);
    expect(await ids(["one piece"])).toEqual([]);
  });

  it("finds nothing without a frozen catalog", async () => {
    expect(await frozenCatalogSearch(null)(["frieren"])).toEqual([]);
  });
});
