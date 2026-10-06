import { and, desc, eq, getTableColumns, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

import type { AniListClient, DiscoveredShow, FanRecommendation } from "../anilist/client.js";
import { aniListFilterFor, malGenresFrom } from "../anilist/genres.js";
import type { Db } from "../db/client.js";
import {
  anilistCatalog,
  anime,
  discovery,
  discoveryRuns,
  listEntries,
  tasteGenres,
} from "../db/schema.js";

/**
 * Shows new to the user, for recommendations beyond their list: what fans of their favorite
 * shows like, and the top-rated shows in the genres they rate highest, plus top-rated movies.
 * Built in the background after a list sync, at most daily, so a recommendation never waits on
 * AniList. Shows on the user's list are filtered out when ranking, since the list changes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Favorites whose "fans also liked" lists are used. */
const SEEDS = 25;
/** Genres whose top-rated lists are used. */
const TOP_GENRES = 3;
/** A genre needs this many scored shows before it says anything about taste. */
const MIN_SCORED = 3;
/** Shows kept in the pool, strongest first. */
const MAX_POOL = 300;
/** A top-rated list is a weaker signal than fans of a favorite. */
const TOP_LIST_WEIGHT = 0.4;

export type CatalogRow = typeof anilistCatalog.$inferInsert;

/** The pool from the fans' links and the top-rated lists: strength per AniList id, and why. */
export function poolStrengths(
  fans: FanRecommendation[],
  seedTitles: Map<number, string>,
  lists: Map<string, number[]>,
): Map<number, { strength: number; because: string[] }> {
  const pool = new Map<
    number,
    { strength: number; because: { title: string; weight: number }[] }
  >();
  const entry = (id: number) => {
    let e = pool.get(id);
    if (!e) {
      e = { strength: 0, because: [] };
      pool.set(id, e);
    }
    return e;
  };
  for (const link of fans) {
    // The most recommended show for a seed counts 1, the next ½, then ⅓, ...
    const weight = 1 / (1 + link.rank);
    const e = entry(link.anilistId);
    e.strength += weight;
    const title = seedTitles.get(link.seedMalId);
    if (title) e.because.push({ title, weight });
  }
  for (const ids of lists.values()) {
    ids.forEach((id, rank) => {
      entry(id).strength += TOP_LIST_WEIGHT * (1 - rank / Math.max(ids.length, 1));
    });
  }
  return new Map(
    [...pool].map(([id, e]) => [
      id,
      {
        strength: Math.round(e.strength * 1000) / 1000,
        because: e.because.sort((a, b) => b.weight - a.weight).map((b) => b.title),
      },
    ]),
  );
}

/** AniList's details in MAL's words, as the catalog stores them. */
export function catalogRowFrom(show: DiscoveredShow & { malId: number }): CatalogRow {
  const mediaTypes: Record<string, string> = {
    TV: "tv",
    TV_SHORT: "tv",
    MOVIE: "movie",
    SPECIAL: "special",
    OVA: "ova",
    ONA: "ona",
    MUSIC: "music",
  };
  const airing: Record<string, string> = {
    FINISHED: "finished_airing",
    RELEASING: "currently_airing",
    HIATUS: "currently_airing",
  };
  return {
    malId: show.malId,
    anilistId: show.anilistId,
    title: show.title,
    titleEn: show.titleEn,
    titleJa: show.titleJa,
    synonyms: show.synonyms.filter((s) => /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(s)),
    mediaType: show.format ? (mediaTypes[show.format] ?? null) : null,
    airingStatus: show.status ? (airing[show.status] ?? null) : null,
    numEpisodes: show.episodes,
    episodeMinutes: show.duration,
    genres: malGenresFrom(show.genres, show.tags),
    score: show.averageScore === null ? null : show.averageScore / 10,
    popularity: show.popularity,
    coverUrl: show.coverUrl?.startsWith("https://") ? show.coverUrl : null,
    startDate: show.startDate,
    prequelMalIds: show.prequelMalIds,
    fetchedAt: new Date(),
  };
}

/** Only shows that can be recommended: on MAL, not adult, and out (or airing). */
function usable(show: DiscoveredShow): show is DiscoveredShow & { malId: number } {
  return (
    show.malId !== null &&
    !show.isAdult &&
    (show.status === "FINISHED" || show.status === "RELEASING" || show.status === "HIATUS")
  );
}

/**
 * Rebuilds the user's discovery pool unless it was built in the last day (or `force`). Returns
 * the number of shows in it, or null when it was fresh. If AniList fails, the old pool stays and
 * the error is recorded.
 */
export async function refreshDiscovery(
  deps: { db: Db; anilist: AniListClient; log: FastifyBaseLogger },
  userId: string,
  options: { now?: Date; force?: boolean } = {},
): Promise<number | null> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  if (!options.force) {
    const [fresh] = await db
      .select({ at: discoveryRuns.refreshedAt })
      .from(discoveryRuns)
      .where(
        and(
          eq(discoveryRuns.userId, userId),
          gt(discoveryRuns.refreshedAt, new Date(now.getTime() - DAY_MS)),
        ),
      );
    if (fresh) return null;
  }

  try {
    const seeds = await db
      .select({ malId: anime.malId, title: anime.title })
      .from(listEntries)
      .innerJoin(anime, eq(anime.malId, listEntries.animeId))
      .where(
        and(
          eq(listEntries.userId, userId),
          eq(listEntries.status, "completed"),
          gt(listEntries.score, 0),
        ),
      )
      .orderBy(desc(listEntries.score), anime.malId)
      .limit(SEEDS);
    const genres = await db
      .select({ genre: tasteGenres.genre })
      .from(tasteGenres)
      .where(
        and(
          eq(tasteGenres.userId, userId),
          sql`${tasteGenres.scored} >= ${MIN_SCORED}`,
          gt(tasteGenres.affinity, 0),
        ),
      )
      .orderBy(desc(tasteGenres.affinity))
      .limit(TOP_GENRES);

    const fans = seeds.length > 0 ? await anilist.fansAlsoLiked(seeds.map((s) => s.malId)) : [];
    const lists = await anilist.topRated([
      ...genres.map((g) => ({ key: `genre:${g.genre}`, ...aniListFilterFor(g.genre) })),
      { key: "movies", format: "MOVIE" },
    ]);
    const strengths = poolStrengths(fans, new Map(seeds.map((s) => [s.malId, s.title])), lists);
    const strongest = [...strengths]
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, MAX_POOL)
      .map(([id]) => id);
    const shows = (await anilist.showDetails(strongest)).filter(usable);

    const rows = [...new Map(shows.map((s) => [s.malId, catalogRowFrom(s)])).values()];
    const pool = rows.flatMap((row) => {
      const e = strengths.get(row.anilistId);
      return e
        ? [{ userId, malId: row.malId, strength: e.strength, because: e.because.slice(0, 3) }]
        : [];
    });
    await db.transaction(async (tx) => {
      if (rows.length > 0) {
        await tx
          .insert(anilistCatalog)
          .values(rows)
          .onConflictDoUpdate({ target: anilistCatalog.malId, set: CATALOG_UPDATE });
      }
      await tx.delete(discovery).where(eq(discovery.userId, userId));
      if (pool.length > 0) await tx.insert(discovery).values(pool);
      await recordRun(tx, userId, now, pool.length, null);
    });
    return pool.length;
  } catch (err) {
    deps.log.warn({ err: { name: (err as Error).name } }, "could not refresh discovery");
    const [kept] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(discovery)
      .where(eq(discovery.userId, userId));
    await recordRun(db, userId, now, kept?.n ?? 0, errorCode(err));
    return kept?.n ?? 0;
  }
}

async function recordRun(
  db: Pick<Db, "insert">,
  userId: string,
  at: Date,
  shows: number,
  error: string | null,
): Promise<void> {
  await db
    .insert(discoveryRuns)
    .values({ userId, refreshedAt: at, shows, error })
    .onConflictDoUpdate({ target: discoveryRuns.userId, set: { refreshedAt: at, shows, error } });
}

/** An upsert takes AniList's latest details for every column but the key. */
const CATALOG_UPDATE: Record<string, SQL> = Object.fromEntries(
  Object.entries(getTableColumns(anilistCatalog))
    .filter(([key]) => key !== "malId")
    .map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
);

function errorCode(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "AniListApiError") return "anilist_unavailable";
  if (name === "AniListResponseError") return "anilist_response";
  if (err instanceof TypeError) return "anilist_unavailable";
  return "internal_error";
}

/**
 * Stores `anime` rows for discovered shows from the catalog, so a pick can be shown and added.
 * A show the mirror already has keeps MAL's row.
 */
export async function rememberDiscovered(db: Db, malIds: number[]): Promise<void> {
  if (malIds.length === 0) return;
  const rows = await db.select().from(anilistCatalog).where(inArray(anilistCatalog.malId, malIds));
  if (rows.length === 0) return;
  await db
    .insert(anime)
    .values(
      rows.map((r) => ({
        malId: r.malId,
        title: r.title,
        titleEn: r.titleEn,
        titleJa: r.titleJa,
        synonyms: r.synonyms,
        mainPictureUrl: r.coverUrl,
        mediaType: r.mediaType,
        numEpisodes: r.numEpisodes,
        airingStatus: r.airingStatus,
        startDate: r.startDate,
        genres: r.genres,
        episodeMinutes: r.episodeMinutes,
      })),
    )
    .onConflictDoNothing();
}
