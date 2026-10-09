import { and, eq, max, sql } from "drizzle-orm";

import type { AniListClient, AniListSeason } from "../anilist/client.js";
import type { Db } from "../db/client.js";
import { anilistCatalog, listEntries, seasonShows } from "../db/schema.js";
import { startYearOf, type CandidateRow } from "./candidates.js";
import { CATALOG_UPDATE, catalogRowFrom, usable } from "./discovery.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEASONS: AniListSeason[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

/** The anime season a date falls in (Jan–Mar winter, Apr–Jun spring, ...), and the one before. */
export function seasonOf(date: Date): {
  season: AniListSeason;
  year: number;
  previous: { season: AniListSeason; year: number };
} {
  const index = Math.floor(date.getUTCMonth() / 3);
  const year = date.getUTCFullYear();
  const season = SEASONS[index] ?? "WINTER";
  const previous =
    index === 0
      ? { season: "FALL" as const, year: year - 1 }
      : { season: SEASONS[index - 1] ?? "WINTER", year };
  return { season, year, previous };
}

/** "2026 FALL". */
export function seasonKey(season: { season: AniListSeason; year: number }): string {
  return `${String(season.year)} ${season.season}`;
}

/**
 * Rebuilds what's airing now unless it was built in the last day for this season (or `force`):
 * this season's series and last season's still airing, most popular first, with their details
 * in the shared catalog. Only shows on MAL that have started airing and aren't adult are kept.
 * Returns the number of shows, or null when it was fresh. Throws if AniList fails; the old
 * lineup stays.
 */
export async function refreshSeason(
  deps: { db: Db; anilist: AniListClient },
  options: { now?: Date; force?: boolean } = {},
): Promise<number | null> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  const current = seasonOf(now);
  const key = seasonKey(current);
  if (!options.force) {
    const [latest] = await db
      .select({ at: max(seasonShows.fetchedAt) })
      .from(seasonShows)
      .where(eq(seasonShows.season, key));
    if (latest?.at && now.getTime() - latest.at.getTime() < DAY_MS) return null;
  }

  const [thisSeason = [], stillAiring = []] = await anilist.seasonLineup([
    { season: current.season, year: current.year },
    { ...current.previous, airing: true },
  ]);
  const order = [...new Set([...thisSeason, ...stillAiring])];
  const details = new Map((await anilist.showDetails(order)).map((s) => [s.anilistId, s]));
  const shows = order.flatMap((id) => {
    const show = details.get(id);
    return show && usable(show) ? [show] : [];
  });
  const rows = [...new Map(shows.map((s) => [s.malId, catalogRowFrom(s)])).values()];

  await db.transaction(async (tx) => {
    // Every user's sync can rebuild the lineup; one at a time, so they can't interleave.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('season_shows'))`);
    if (rows.length > 0) {
      await tx
        .insert(anilistCatalog)
        .values(rows)
        .onConflictDoUpdate({ target: anilistCatalog.malId, set: CATALOG_UPDATE });
    }
    await tx.delete(seasonShows);
    if (rows.length > 0) {
      await tx.insert(seasonShows).values(
        rows.map((row, i) => ({
          malId: row.malId,
          anilistId: row.anilistId,
          season: key,
          rank: i + 1,
          fetchedAt: now,
        })),
      );
    }
  });
  return rows.length;
}

/** A season show ranked this high pulls like the strongest discovery link. */
const SEASON_STRENGTH = 2;

/**
 * What's airing now that isn't on the user's list, as candidates: never a sequel to a show they
 * haven't completed (as with the discovery pool). Its pull follows its popularity rank.
 */
export async function seasonRows(db: Db, userId: string): Promise<CandidateRow[]> {
  const [counted] = await db.select({ total: sql<number>`count(*)::int` }).from(seasonShows);
  const total = counted?.total ?? 0;
  const rows = await db
    .select({
      animeId: anilistCatalog.malId,
      title: anilistCatalog.title,
      titleEn: anilistCatalog.titleEn,
      numEpisodes: anilistCatalog.numEpisodes,
      episodeMinutes: anilistCatalog.episodeMinutes,
      genres: anilistCatalog.genres,
      anilistScore: anilistCatalog.score,
      mediaType: anilistCatalog.mediaType,
      airingStatus: anilistCatalog.airingStatus,
      startDate: anilistCatalog.startDate,
      streamingLinks: anilistCatalog.streamingLinks,
      rank: seasonShows.rank,
      prequelsDone: sql<boolean>`NOT EXISTS (
        SELECT 1 FROM unnest(${anilistCatalog.prequelMalIds}) AS p(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM list_entries done
          WHERE done.user_id = ${userId} AND done.anime_id = p.id AND done.status = 'completed'
        )
      )`,
    })
    .from(seasonShows)
    .innerJoin(anilistCatalog, eq(anilistCatalog.malId, seasonShows.malId))
    .leftJoin(
      listEntries,
      and(eq(listEntries.userId, userId), eq(listEntries.animeId, seasonShows.malId)),
    )
    .where(sql`${listEntries.animeId} IS NULL`);
  return rows.map(({ startDate, rank, ...row }) => ({
    ...row,
    startYear: startYearOf(startDate),
    status: null,
    isRewatching: false,
    episodesWatched: 0,
    malMean: null,
    strength: SEASON_STRENGTH * (1 - (rank - 1) / Math.max(total, 1)),
    because: [],
    seasonRank: rank,
  }));
}
