import type { anime, listEntries } from "../db/schema.js";
import type { MalAnimeListItem } from "../mal/client.js";

export type AnimeRow = typeof anime.$inferInsert;
export type ListEntryRow = typeof listEntries.$inferInsert;

/** Maps one item of MAL's anime list to rows in the local mirror. */
export function toMirrorRows(
  item: MalAnimeListItem,
  userId: string,
  syncedAt: Date,
): { anime: AnimeRow; entry: ListEntryRow } {
  const { node, list_status: listStatus } = item;
  const alt = node.alternative_titles;
  return {
    anime: {
      malId: node.id,
      title: node.title,
      titleEn: nonEmptyOrNull(alt?.en),
      titleJa: nonEmptyOrNull(alt?.ja),
      synonyms: (alt?.synonyms ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
      mainPictureUrl: httpsUrlOrNull(node.main_picture?.medium ?? node.main_picture?.large),
      mediaType: node.media_type ?? null,
      // MAL reports 0 when the episode count isn't known yet.
      numEpisodes: node.num_episodes === 0 ? null : (node.num_episodes ?? null),
      airingStatus: node.status ?? null,
      updatedAt: syncedAt,
    },
    entry: {
      userId,
      animeId: node.id,
      status: listStatus.status,
      score: listStatus.score,
      numEpisodesWatched: listStatus.num_episodes_watched,
      isRewatching: listStatus.is_rewatching,
      startDate: listStatus.start_date ?? null,
      finishDate: listStatus.finish_date ?? null,
      malUpdatedAt: new Date(listStatus.updated_at),
      syncedAt,
    },
  };
}

/** MAL sends "" for missing alternative titles. */
function nonEmptyOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

/** Only keep image URLs that are plain https links. */
function httpsUrlOrNull(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
