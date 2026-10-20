import { and, eq, gte, inArray, or, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { listEntries, showCast } from "../db/schema.js";
import type { AniListClient } from "./client.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A show's main cast barely changes: refetched after 90 days. */
export const CAST_MAX_AGE_MS = 90 * DAY_MS;

/**
 * The shows a user has watched something of (any episode, or completed), whose cast Stats
 * counts.
 */
export async function watchedIds(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .select({ malId: listEntries.animeId })
    .from(listEntries)
    .where(
      and(
        eq(listEntries.userId, userId),
        or(sql`${listEntries.numEpisodesWatched} > 0`, eq(listEntries.status, "completed")),
      ),
    );
  return rows.map((row) => row.malId);
}

/**
 * Makes sure `show_cast` has each show's main voice actors, fetching only shows missing or over
 * 90 days old, through the shared AniList pacer (25 shows a request). A show AniList doesn't
 * know is stored with none, so it isn't asked about again until then. Returns how many were
 * fetched. Throws if AniList fails; what was stored stays.
 */
export async function refreshCast(
  deps: { db: Db; anilist: AniListClient },
  malIds: number[],
  options: { now?: Date } = {},
): Promise<number> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  const ids = [...new Set(malIds)];
  if (ids.length === 0) return 0;
  const fresh = new Set(
    (
      await db
        .select({ malId: showCast.malId })
        .from(showCast)
        .where(
          and(
            inArray(showCast.malId, ids),
            gte(showCast.fetchedAt, new Date(now.getTime() - CAST_MAX_AGE_MS)),
          ),
        )
    ).map((row) => row.malId),
  );
  const due = ids.filter((id) => !fresh.has(id));
  if (due.length === 0) return 0;

  const cast = await anilist.castOf(due);
  await db
    .insert(showCast)
    .values(due.map((malId) => ({ malId, actors: cast.get(malId) ?? [], fetchedAt: now })))
    .onConflictDoUpdate({
      target: showCast.malId,
      set: { actors: sql`excluded.actors`, fetchedAt: sql`excluded.fetched_at` },
    });
  return due.length;
}
