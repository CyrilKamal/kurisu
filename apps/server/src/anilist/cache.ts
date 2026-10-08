import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import type { Db } from "../db/client.js";
import { anilistMedia, anime, listEntries } from "../db/schema.js";
import type { AniListClient } from "./client.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Rows younger than this aren't refetched. Airing times rarely move within hours. */
export const AIRING_MAX_AGE_MS = 6 * HOUR_MS;
/**
 * Where a show streams changes far less often than when it airs: rows kept only for where to
 * watch are refetched weekly.
 */
export const STREAMING_MAX_AGE_MS = 7 * DAY_MS;
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

  // MAL's own start date and episode count, to line up shows AniList splits into parts.
  const facts = await db
    .select({ malId: anime.malId, startDate: anime.startDate, numEpisodes: anime.numEpisodes })
    .from(anime)
    .where(inArray(anime.malId, due));
  const lookup = await anilist.mediaByMalIds(
    due,
    new Map(facts.map(({ malId, ...rest }) => [malId, rest])),
  );
  const found = new Map(lookup.media.map((m) => [m.malId, m]));
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
      episodeOffset: media?.episodeOffset ?? 0,
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
        episodeOffset: sql`excluded.episode_offset`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });

  const unmapped = due.filter((id) => !found.has(id));
  if (unmapped.length > 0) {
    const unjoinable = new Set(lookup.unjoinable);
    const titles = await db
      .select({ malId: anime.malId, title: anime.title })
      .from(anime)
      .where(inArray(anime.malId, unmapped));
    for (const { malId, title } of titles) {
      log.warn(
        { malId, title },
        unjoinable.has(malId)
          ? "several AniList entries share this MAL id and they don't line up with MAL's start date or episode count; skipping it"
          : "no AniList entry for this MAL id; skipping it",
      );
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

/**
 * The user's entries worth keeping airing data for: Watching shows, and anything MAL says is
 * airing or about to. "The newest episode" and the brief only ever ask about these.
 */
export async function airingCandidateIds(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .select({ malId: anime.malId })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .where(
      and(
        eq(listEntries.userId, userId),
        or(
          eq(listEntries.status, "watching"),
          inArray(anime.airingStatus, ["currently_airing", "not_yet_aired"]),
        ),
      ),
    );
  return rows.map((row) => row.malId);
}

/**
 * The user's entries the recommender can pick from (Plan to Watch, Watching, On hold, and
 * rewatches), whose rows are kept for where to watch them.
 */
export async function recommendableIds(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .select({ malId: listEntries.animeId })
    .from(listEntries)
    .where(
      and(
        eq(listEntries.userId, userId),
        or(
          inArray(listEntries.status, ["plan_to_watch", "watching", "on_hold"]),
          eq(listEntries.isRewatching, true),
        ),
      ),
    );
  return rows.map((row) => row.malId);
}
