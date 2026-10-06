import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import type { anilistMedia } from "../../src/db/schema.js";
import { SNAPSHOTS_DIR } from "./snapshot.js";

/**
 * AniList's airing data for the snapshots' shows, frozen at one moment (eval/snapshots/airing.json),
 * so "the newest episode" has the same answer on every eval run. Exported once with
 * `pnpm eval:airing`; never re-exported once cases depend on it.
 */
export const airingFreezeSchema = z
  .object({
    description: z.string(),
    source: z.literal("anilist"),
    frozenAt: z.iso.datetime(),
    shows: z.array(
      z
        .object({
          malId: z.number().int().positive(),
          anilistId: z.number().int().positive(),
          /** AniList's status: RELEASING, FINISHED, NOT_YET_RELEASED, ... */
          status: z.string().nullable(),
          /** The latest aired episode when frozen; null when AniList couldn't say. */
          latestAired: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type AiringFreeze = z.infer<typeof airingFreezeSchema>;

export const AIRING_FILE = `${SNAPSHOTS_DIR}airing.json`;

/** The frozen airing data, or null if it hasn't been exported. */
export function loadAiring(file: string = AIRING_FILE): AiringFreeze | null {
  if (!existsSync(file)) return null;
  return airingFreezeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** The frozen latest aired episode of an airing show, or null if unknown or finished. */
export function frozenLatestAired(freeze: AiringFreeze | null, malId: number): number | null {
  const show = freeze?.shows.find((s) => s.malId === malId);
  if (!show || show.status === "FINISHED") return null;
  return show.latestAired;
}

/**
 * `anilist_media` rows that make the app compute exactly the frozen latest episode at `now`:
 * fetched now, with the next episode airing a few days out.
 */
export function airingRowsFor(
  freeze: AiringFreeze,
  malIds: ReadonlySet<number>,
  now: Date,
): (typeof anilistMedia.$inferInsert)[] {
  const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return freeze.shows.flatMap((show) => {
    if (!malIds.has(show.malId) || show.latestAired === null) return [];
    const finished = show.status === "FINISHED";
    return [
      {
        malId: show.malId,
        anilistId: show.anilistId,
        status: show.status,
        episodes: finished ? show.latestAired : null,
        nextEpisode: finished ? null : show.latestAired + 1,
        nextAiringAt: finished ? null : inThreeDays,
        streamingLinks: [],
        fetchedAt: now,
      },
    ];
  });
}
