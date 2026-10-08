import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import type { Db } from "../../src/db/client.js";
import { anilistCatalog, seasonShows } from "../../src/db/schema.js";
import { poolShowSchema } from "./recommendData.js";
import { SNAPSHOTS_DIR } from "./snapshot.js";

/**
 * What was airing when it was frozen, from AniList, by `pnpm eval:season`: this season's series and
 * last season's still airing, most popular first, as the app's lineup (recommend/season.ts) has
 * them. Public show data only.
 */
export const SEASON_FILE = `${SNAPSHOTS_DIR}season.json`;

const linkSchema = z
  .object({ siteId: z.number().int().positive(), site: z.string(), url: z.string() })
  .strict();

export const seasonFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("anilist"),
    /** "2026 FALL". */
    season: z.string(),
    frozenAt: z.iso.datetime(),
    shows: z.array(
      poolShowSchema
        .omit({ strength: true })
        .extend({ rank: z.number().int().positive(), links: z.array(linkSchema) })
        .strict(),
    ),
  })
  .strict();
export type SeasonFreeze = z.infer<typeof seasonFreezeSchema>;

export function loadSeason(file: string = SEASON_FILE): SeasonFreeze | null {
  if (!existsSync(file)) return null;
  return seasonFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Gives the eval database the frozen lineup: the shows' details and their ranks. */
export async function loadSeasonIntoDb(db: Db, season: SeasonFreeze): Promise<void> {
  if (season.shows.length === 0) return;
  // Shared rows, like the discovery pool's: a show the pool has keeps its row.
  await db
    .insert(anilistCatalog)
    .values(
      season.shows.map((show) => ({
        malId: show.malId,
        anilistId: show.anilistId,
        title: show.title,
        titleEn: show.titleEn,
        titleJa: show.titleJa,
        synonyms: show.synonyms,
        mediaType: show.mediaType,
        airingStatus: show.airingStatus,
        numEpisodes: show.numEpisodes,
        episodeMinutes: show.episodeMinutes,
        genres: show.genres,
        score: show.score,
        popularity: show.popularity,
        coverUrl: show.coverUrl,
        startDate: show.startDate,
        prequelMalIds: show.prequelMalIds,
        streamingLinks: show.links,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(seasonShows)
    .values(
      season.shows.map((show) => ({
        malId: show.malId,
        anilistId: show.anilistId,
        season: season.season,
        rank: show.rank,
        fetchedAt: new Date(season.frozenAt),
      })),
    )
    .onConflictDoNothing();
}
