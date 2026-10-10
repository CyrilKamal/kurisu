import type { SearchResult } from "@kurisu/shared";
import { and, asc, eq, inArray } from "drizzle-orm";

import { rememberShows } from "../anilist/catalog.js";
import type { CatalogShow } from "../anilist/client.js";
import type { Db } from "../db/client.js";
import { anilistCatalog, anime, listEntries, seasonShows } from "../db/schema.js";
import { rememberDiscovered } from "../recommend/discovery.js";

/** "Airing this season" before the user types: the most popular few. */
const SEASON_RESULTS = 20;

export interface SearchDeps {
  db: Db;
  /** AniList's title search, through the urgent client: someone is waiting. */
  catalog: (queries: string[]) => Promise<CatalogShow[]>;
}

/**
 * Shows matching the words on AniList, best match first, or with no words this season's most
 * popular. Each is stored as an `anime` row (a show the mirror has keeps MAL's), so its page
 * opens and Add works, and comes with where it stands on the user's list. Adult titles and
 * shows AniList can't map to MAL are left out. Throws if AniList is unreachable.
 */
export async function searchShows(
  deps: SearchDeps,
  userId: string,
  query: string,
): Promise<SearchResult[]> {
  const { db } = deps;
  let ids: number[];
  if (query === "") {
    const season = await db
      .select({ malId: seasonShows.malId })
      .from(seasonShows)
      .innerJoin(anilistCatalog, eq(anilistCatalog.malId, seasonShows.malId))
      .orderBy(asc(seasonShows.rank), asc(seasonShows.malId))
      .limit(SEASON_RESULTS);
    ids = season.map((row) => row.malId);
    await rememberDiscovered(db, ids);
  } else {
    ids = (await rememberShows(db, await deps.catalog([query]))).map((show) => show.malId);
  }
  if (ids.length === 0) return [];

  const shows = await db
    .select({
      animeId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      pictureUrl: anime.mainPictureUrl,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      airingStatus: anime.airingStatus,
      startDate: anime.startDate,
    })
    .from(anime)
    .where(inArray(anime.malId, ids));
  const entries = await db
    .select({
      animeId: listEntries.animeId,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
    })
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), inArray(listEntries.animeId, ids)));
  const byId = new Map(shows.map((show) => [show.animeId, show]));
  const onList = new Map(entries.map(({ animeId, ...entry }) => [animeId, entry]));

  return ids.flatMap((id) => {
    const show = byId.get(id);
    if (!show) return [];
    const { startDate, ...rest } = show;
    const year = startDate ? Number.parseInt(startDate.slice(0, 4), 10) : Number.NaN;
    return [
      {
        ...rest,
        year: Number.isFinite(year) ? year : null,
        entry: onList.get(id) ?? null,
      },
    ];
  });
}
