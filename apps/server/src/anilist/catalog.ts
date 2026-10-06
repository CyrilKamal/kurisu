import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import type { AnimeRow } from "../sync/mirrorRows.js";
import type { CatalogShow } from "./client.js";

/** AniList formats in MAL's media_type words. */
const MEDIA_TYPES: Record<string, string> = {
  TV: "tv",
  TV_SHORT: "tv",
  MOVIE: "movie",
  SPECIAL: "special",
  OVA: "ova",
  ONA: "ona",
  MUSIC: "music",
};

/** AniList statuses in MAL's airing-status words. */
const AIRING_STATUSES: Record<string, string> = {
  FINISHED: "finished_airing",
  RELEASING: "currently_airing",
  HIATUS: "currently_airing",
  NOT_YET_RELEASED: "not_yet_aired",
};

/** Synonyms in Latin script, like MAL's; AniList also lists other languages' titles. */
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;

/**
 * A provisional `anime` row for a show found on AniList, in MAL's words. MAL's own details
 * replace it once the show is on the list (see writes/commit.ts refreshAnime and the list sync).
 */
export function animeRowFromAniList(show: CatalogShow & { malId: number }): AnimeRow {
  return {
    malId: show.malId,
    title: show.title,
    titleEn: show.titleEn,
    titleJa: show.titleJa,
    synonyms: show.synonyms.map((s) => s.trim()).filter((s) => s.length > 0 && LATIN.test(s)),
    mainPictureUrl: show.coverUrl?.startsWith("https://") ? show.coverUrl : null,
    mediaType: show.format ? (MEDIA_TYPES[show.format] ?? null) : null,
    numEpisodes: show.episodes,
    airingStatus: show.status ? (AIRING_STATUSES[show.status] ?? null) : null,
    startDate: show.startDate,
    episodeMinutes: show.duration,
  };
}

/**
 * Stores rows for shows found on AniList so they can be shown and proposed. A show the mirror
 * already has keeps MAL's row. Returns the shows that have a MAL id; the rest can't be added.
 */
export async function rememberShows(
  db: Db,
  shows: CatalogShow[],
): Promise<(CatalogShow & { malId: number })[]> {
  const mapped = shows.filter((s): s is CatalogShow & { malId: number } => s.malId !== null);
  const unique = [...new Map(mapped.map((s) => [s.malId, s])).values()];
  if (unique.length > 0) {
    await db.insert(anime).values(unique.map(animeRowFromAniList)).onConflictDoNothing();
  }
  return unique;
}
