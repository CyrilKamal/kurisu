import { and, eq, gte, inArray, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anilistSequels, anime, listEntries } from "../db/schema.js";
import type { AniListClient, SequelShow } from "./client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sequels are announced months before they air, so the relations are refetched weekly. */
export const SEQUELS_MAX_AGE_MS = 7 * DAY_MS;

/** Series formats: a movie or special has no airing schedule to say when it starts. */
const SERIES_FORMATS = ["TV", "TV_SHORT", "ONA"];
/** AniList statuses of a show that could still premiere (null: AniList doesn't say). */
const NOT_FINISHED = ["RELEASING", "NOT_YET_RELEASED", "HIATUS"];

/**
 * Makes sure `anilist_sequels` has a recent row for each MAL id, fetching only rows that are
 * missing or older than `maxAgeMs`. A show AniList doesn't know is stored with no sequels, so
 * it isn't asked about again until the row is old. Returns how many shows were fetched. Throws
 * if AniList is unreachable; the old rows stay as they were.
 */
export async function refreshSequels(
  deps: { db: Db; anilist: AniListClient },
  malIds: number[],
  options: { now?: Date; maxAgeMs?: number } = {},
): Promise<number> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  const ids = [...new Set(malIds)];
  if (ids.length === 0) return 0;

  const freshSince = new Date(now.getTime() - (options.maxAgeMs ?? SEQUELS_MAX_AGE_MS));
  const fresh = await db
    .select({ malId: anilistSequels.malId })
    .from(anilistSequels)
    .where(and(inArray(anilistSequels.malId, ids), gte(anilistSequels.fetchedAt, freshSince)));
  const freshIds = new Set(fresh.map((row) => row.malId));
  const due = ids.filter((id) => !freshIds.has(id));
  if (due.length === 0) return 0;

  const found = await anilist.sequelsOf(due);
  await db
    .insert(anilistSequels)
    .values(due.map((malId) => ({ malId, sequels: found.get(malId) ?? [], fetchedAt: now })))
    .onConflictDoUpdate({
      target: anilistSequels.malId,
      set: { sequels: sql`excluded.sequels`, fetchedAt: sql`excluded.fetched_at` },
    });
  return due.length;
}

/** The user's completed shows, whose sequels the brief watches for. */
export async function completedIds(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .select({ malId: listEntries.animeId })
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.status, "completed")));
  return rows.map((row) => row.malId);
}

export interface SequelCandidate {
  sequel: SequelShow & { malId: number };
  /** The title of the completed show it follows. */
  after: string;
}

/**
 * Sequels of the user's completed shows that could start airing for them: series on MAL, not
 * adult, not finished, and not on their list in any status (a Plan to Watch one is the brief's
 * Plan to Watch news; one they're watching is already in the brief). From the cached
 * relations only; refreshSequels keeps them current.
 */
export async function sequelCandidates(db: Db, userId: string): Promise<SequelCandidate[]> {
  const rows = await db
    .select({ title: anime.title, sequels: anilistSequels.sequels })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .innerJoin(anilistSequels, eq(anilistSequels.malId, listEntries.animeId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.status, "completed")));
  if (rows.length === 0) return [];
  const onList = new Set(
    (
      await db
        .select({ malId: listEntries.animeId })
        .from(listEntries)
        .where(eq(listEntries.userId, userId))
    ).map((row) => row.malId),
  );

  const candidates = new Map<number, SequelCandidate>();
  for (const row of rows) {
    for (const sequel of row.sequels) {
      if (sequel.malId === null || sequel.isAdult || onList.has(sequel.malId)) continue;
      if (!sequel.format || !SERIES_FORMATS.includes(sequel.format)) continue;
      if (sequel.status !== null && !NOT_FINISHED.includes(sequel.status)) continue;
      if (!candidates.has(sequel.malId)) {
        candidates.set(sequel.malId, {
          sequel: { ...sequel, malId: sequel.malId },
          after: row.title,
        });
      }
    }
  }
  return [...candidates.values()];
}
