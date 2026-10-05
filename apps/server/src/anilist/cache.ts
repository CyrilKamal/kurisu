import { and, gte, inArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import type { Db } from "../db/client.js";
import { anilistMedia, anime } from "../db/schema.js";
import type { AniListClient } from "./client.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Rows younger than this aren't refetched. Airing times rarely move within hours. */
export const AIRING_MAX_AGE_MS = 6 * HOUR_MS;
/** Older rows are too stale to say which episode is the latest. */
const STALE_AFTER_MS = 7 * DAY_MS;
/**
 * Once the cached "next" episode has aired, the one after it may have aired too, about a week
 * later for a weekly show. Past this, the latest episode is unknown until the next refresh.
 */
const NEXT_EPISODE_TRUSTED_FOR_MS = 6 * DAY_MS;

export type AiringRow = typeof anilistMedia.$inferSelect;

export interface RefreshResult {
  /** MAL ids fetched from AniList (fresh rows are skipped). */
  fetched: number;
  /** MAL ids AniList has no entry for. */
  unmapped: number[];
}

/**
 * Makes sure `anilist_media` has a recent row for each MAL id, fetching only rows that are
 * missing or older than `maxAgeMs`. Titles AniList doesn't know are logged and stored without
 * an AniList id, so they're skipped until the next refresh. Throws if AniList is unreachable;
 * the old rows stay as they were.
 */
export async function refreshAiring(
  deps: { db: Db; anilist: AniListClient; log: FastifyBaseLogger },
  malIds: number[],
  options: { now?: Date; maxAgeMs?: number } = {},
): Promise<RefreshResult> {
  const { db, anilist, log } = deps;
  const now = options.now ?? new Date();
  const ids = [...new Set(malIds)];
  if (ids.length === 0) return { fetched: 0, unmapped: [] };

  const freshSince = new Date(now.getTime() - (options.maxAgeMs ?? AIRING_MAX_AGE_MS));
  const fresh = await db
    .select({ malId: anilistMedia.malId })
    .from(anilistMedia)
    .where(and(inArray(anilistMedia.malId, ids), gte(anilistMedia.fetchedAt, freshSince)));
  const freshIds = new Set(fresh.map((row) => row.malId));
  const due = ids.filter((id) => !freshIds.has(id));
  if (due.length === 0) return { fetched: 0, unmapped: [] };

  const found = new Map((await anilist.mediaByMalIds(due)).map((m) => [m.malId, m]));
  const rows: AiringRow[] = due.map((malId) => {
    const media = found.get(malId);
    return {
      malId,
      anilistId: media?.anilistId ?? null,
      status: media?.status ?? null,
      episodes: media?.episodes ?? null,
      nextEpisode: media?.nextEpisode?.episode ?? null,
      nextAiringAt: media?.nextEpisode?.airingAt ?? null,
      streamingLinks: media?.streamingLinks ?? [],
      fetchedAt: now,
    };
  });
  await db
    .insert(anilistMedia)
    .values(rows)
    .onConflictDoUpdate({
      target: anilistMedia.malId,
      set: {
        anilistId: sql`excluded.anilist_id`,
        status: sql`excluded.status`,
        episodes: sql`excluded.episodes`,
        nextEpisode: sql`excluded.next_episode`,
        nextAiringAt: sql`excluded.next_airing_at`,
        streamingLinks: sql`excluded.streaming_links`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });

  const unmapped = due.filter((id) => !found.has(id));
  if (unmapped.length > 0) {
    const titles = await db
      .select({ malId: anime.malId, title: anime.title })
      .from(anime)
      .where(inArray(anime.malId, unmapped));
    for (const { malId, title } of titles) {
      log.warn({ malId, title }, "no AniList entry for this MAL id; skipping it");
    }
  }
  return { fetched: due.length, unmapped };
}

/** Cached airing rows for these MAL ids, keyed by MAL id. */
export async function airingRows(db: Db, malIds: number[]): Promise<Map<number, AiringRow>> {
  if (malIds.length === 0) return new Map();
  const rows = await db.select().from(anilistMedia).where(inArray(anilistMedia.malId, malIds));
  return new Map(rows.map((row) => [row.malId, row]));
}

/**
 * The latest episode that has aired, from a cached row, or null when we can't tell: no AniList
 * match, a stale row, or a show airing without a scheduled next episode. 0 means nothing has
 * aired yet.
 */
export function latestAiredEpisode(
  row: Pick<
    AiringRow,
    "anilistId" | "status" | "episodes" | "nextEpisode" | "nextAiringAt" | "fetchedAt"
  >,
  now: Date,
): number | null {
  if (row.anilistId === null) return null;
  if (now.getTime() - row.fetchedAt.getTime() > STALE_AFTER_MS) return null;

  if (row.nextEpisode !== null && row.nextAiringAt !== null) {
    const sinceAiring = now.getTime() - row.nextAiringAt.getTime();
    if (sinceAiring < 0) return row.nextEpisode - 1;
    return sinceAiring <= NEXT_EPISODE_TRUSTED_FOR_MS ? row.nextEpisode : null;
  }
  if (row.status === "FINISHED") return row.episodes;
  if (row.status === "NOT_YET_RELEASED") return 0;
  return null;
}
