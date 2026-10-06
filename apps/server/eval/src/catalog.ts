import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import type { CatalogSearch } from "../../src/agent/tools.js";
import { MAX_SEARCH_QUERIES, type CatalogShow } from "../../src/anilist/client.js";
import { normalizeName } from "../../src/list/seasons.js";
import { SNAPSHOTS_DIR } from "./snapshot.js";

/**
 * Shows search_anime can find in evals: AniList's answers to some title searches, frozen in
 * eval/snapshots/catalog.json so cases about adding shows have fixed answers. Built with
 * `pnpm eval:catalog <title>...`; a title already frozen keeps its first answer. Show metadata
 * only, nothing about the user.
 */
const catalogShowSchema = z
  .object({
    anilistId: z.number().int().positive(),
    malId: z.number().int().positive().nullable(),
    title: z.string(),
    titleEn: z.string().nullable(),
    titleJa: z.string().nullable(),
    synonyms: z.array(z.string()),
    format: z.string().nullable(),
    status: z.string().nullable(),
    episodes: z.number().int().positive().nullable(),
    duration: z.number().int().positive().nullable(),
    coverUrl: z.string().nullable(),
    startDate: z.string().nullable(),
  })
  .strict();

export const catalogFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("anilist"),
    searches: z.array(
      z
        .object({
          query: z.string(),
          frozenAt: z.iso.datetime(),
          shows: z.array(catalogShowSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type CatalogFreeze = z.infer<typeof catalogFreezeSchema>;

export const CATALOG_FILE = `${SNAPSHOTS_DIR}catalog.json`;

/** The frozen catalog, or null if none has been built. */
export function loadCatalog(file: string = CATALOG_FILE): CatalogFreeze | null {
  if (!existsSync(file)) return null;
  return catalogFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Results per title, as AniList's search returns. */
const PER_QUERY = 8;

/**
 * search_anime over the frozen shows: a show matches a title when every word of it appears in
 * one of the show's names, roughly as AniList's search does. Without a frozen catalog, nothing
 * is found anywhere.
 */
export function frozenCatalogSearch(freeze: CatalogFreeze | null): CatalogSearch {
  const shows = [
    ...new Map(
      (freeze?.searches ?? []).flatMap((s) => s.shows).map((show) => [show.anilistId, show]),
    ).values(),
  ];
  const namesOf = (show: CatalogShow) =>
    [show.title, show.titleEn, ...show.synonyms]
      .filter((n): n is string => !!n)
      .map((n) => ` ${normalizeName(n)} `);
  return (queries) => {
    const found = new Map<number, CatalogShow>();
    for (const query of queries.slice(0, MAX_SEARCH_QUERIES)) {
      const words = normalizeName(query).split(" ").filter(Boolean);
      if (words.length === 0) continue;
      const matches = shows.filter((show) =>
        namesOf(show).some((name) => words.every((w) => name.includes(` ${w} `))),
      );
      for (const show of matches.slice(0, PER_QUERY)) found.set(show.anilistId, show);
    }
    return Promise.resolve([...found.values()]);
  };
}
