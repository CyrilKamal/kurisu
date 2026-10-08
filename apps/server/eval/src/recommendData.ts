import { existsSync, readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../../src/db/client.js";
import { anilistCatalog, anilistMedia, discovery, discoveryRuns } from "../../src/db/schema.js";
import { SNAPSHOTS_DIR } from "./snapshot.js";
import { linksByMalId, type StreamingFreeze } from "./streaming.js";

/**
 * What the recommendation eval needs beyond the list snapshot, frozen once from the dev database
 * by `pnpm eval:recommend-data`:
 *
 * - details.json: MAL's genres, episode length and community score for the snapshot's shows.
 * - discovery.json: the discovery pool (shows new to the user, from AniList) with how strongly
 *   it points at each. Which favorites led to each show is left out, and so is every score the
 *   user gave: both files hold public show data only.
 */
export const DETAILS_FILE = `${SNAPSHOTS_DIR}details.json`;
export const DISCOVERY_FILE = `${SNAPSHOTS_DIR}discovery.json`;

const showDetailsSchema = z
  .object({
    malId: z.number().int().positive(),
    genres: z.array(z.string()),
    episodeMinutes: z.number().int().positive().nullable(),
    malMean: z.number().positive().nullable(),
    /** When it started airing, as MAL gives it ("2019-04-06", "2019-04"). */
    startDate: z.string().nullable().optional(),
  })
  .strict();

export const detailsFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("mal"),
    /** The list snapshot these details belong to. */
    snapshot: z.string(),
    frozenAt: z.iso.datetime(),
    shows: z.array(showDetailsSchema),
  })
  .strict();
export type DetailsFreeze = z.infer<typeof detailsFreezeSchema>;

export const poolShowSchema = z
  .object({
    malId: z.number().int().positive(),
    anilistId: z.number().int().positive(),
    title: z.string(),
    titleEn: z.string().nullable(),
    titleJa: z.string().nullable(),
    synonyms: z.array(z.string()),
    mediaType: z.string().nullable(),
    airingStatus: z.string().nullable(),
    numEpisodes: z.number().int().positive().nullable(),
    episodeMinutes: z.number().int().positive().nullable(),
    genres: z.array(z.string()),
    score: z.number().nullable(),
    popularity: z.number().int().nullable(),
    coverUrl: z.string().nullable(),
    startDate: z.string().nullable(),
    prequelMalIds: z.array(z.number().int().positive()),
    /** How strongly the pool points at the show (see src/recommend/discovery.ts). */
    strength: z.number().positive(),
  })
  .strict();
export type PoolShow = z.infer<typeof poolShowSchema>;

export const discoveryFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("anilist"),
    frozenAt: z.iso.datetime(),
    shows: z.array(poolShowSchema),
  })
  .strict();
export type DiscoveryFreeze = z.infer<typeof discoveryFreezeSchema>;

export function loadDetails(file: string = DETAILS_FILE): DetailsFreeze | null {
  if (!existsSync(file)) return null;
  return detailsFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function loadDiscovery(file: string = DISCOVERY_FILE): DiscoveryFreeze | null {
  if (!existsSync(file)) return null;
  return discoveryFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Gives the snapshot's shows their frozen details, and the user the frozen discovery pool, built
 * as of when it was frozen, with where each show streams when that's frozen too. Run after
 * loadSnapshotIntoDb.
 */
export async function loadRecommendDataIntoDb(
  db: Db,
  userId: string,
  details: DetailsFreeze,
  pool: DiscoveryFreeze,
  streaming: StreamingFreeze | null = null,
): Promise<void> {
  const links = linksByMalId(streaming);
  await db.execute(sql`
    UPDATE anime a
    SET genres = ARRAY(SELECT jsonb_array_elements_text(d.value -> 'genres')),
        episode_minutes = (d.value ->> 'episodeMinutes')::int,
        mal_mean = (d.value ->> 'malMean')::real,
        start_date = d.value ->> 'startDate'
    FROM jsonb_array_elements(${JSON.stringify(details.shows)}::jsonb) AS d
    WHERE a.mal_id = (d.value ->> 'malId')::int
  `);
  if (pool.shows.length > 0) {
    // Catalog rows are shared, not per user, so they outlive the per-case reset.
    await db
      .insert(anilistCatalog)
      .values(
        pool.shows.map((show) => ({
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
          streamingLinks: links.get(show.malId) ?? [],
        })),
      )
      .onConflictDoNothing();
    await db
      .insert(discovery)
      .values(pool.shows.map((show) => ({ userId, malId: show.malId, strength: show.strength })));
  }
  await db
    .insert(discoveryRuns)
    .values({ userId, refreshedAt: new Date(pool.frozenAt), shows: pool.shows.length });

  // List shows' links live in the AniList cache, next to any frozen airing data.
  if (streaming) {
    const onList = new Set(details.shows.map((show) => show.malId));
    const rows = streaming.shows
      .filter((show) => onList.has(show.malId))
      .map((show) => ({
        malId: show.malId,
        anilistId: show.anilistId,
        streamingLinks: show.links,
        fetchedAt: new Date(streaming.frozenAt),
      }));
    if (rows.length > 0) {
      await db
        .insert(anilistMedia)
        .values(rows)
        .onConflictDoUpdate({
          target: anilistMedia.malId,
          set: { streamingLinks: sql`excluded.streaming_links` },
        });
    }
  }
}
