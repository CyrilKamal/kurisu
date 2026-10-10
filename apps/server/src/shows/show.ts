import type { ShowResponse } from "@kurisu/shared";
import { and, eq, inArray } from "drizzle-orm";

import { airingView } from "../anilist/cache.js";
import type { SynopsisLoader } from "../anilist/synopsis.js";
import { watchOn } from "../brief/services.js";
import type { Db } from "../db/client.js";
import { anilistCatalog, anilistMedia, anime, briefSettings, listEntries } from "../db/schema.js";
import { listFriends } from "../friends/friendships.js";
import { loadJournal } from "../journal/load.js";
import { altTitles } from "../list/altTitles.js";

/** A show page's journal: this show's updates, newest first. */
const SHOW_JOURNAL_LIMIT = 50;

export interface ShowDeps {
  db: Db;
  synopsis: SynopsisLoader;
  /**
   * Fetches the show's AniList row in the background when it's missing or old, so its airing
   * and where to watch are there on the next view. Never awaited by the page.
   */
  refreshAiring: (malId: number) => void;
}

/**
 * One show as its page shows it: what kurisu knows of it, the user's entry, its airing and where
 * it streams on their services, their updates of it, and friends who have it. Null when kurisu
 * has never seen the show (not on a list, not found by a search).
 */
export async function loadShow(
  deps: ShowDeps,
  userId: string,
  malId: number,
  now: Date,
): Promise<ShowResponse | null> {
  const { db } = deps;
  const [show] = await db.select().from(anime).where(eq(anime.malId, malId)).limit(1);
  if (!show) return null;

  const [entry] = await db
    .select()
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, malId)))
    .limit(1);
  const [airing] = await db.select().from(anilistMedia).where(eq(anilistMedia.malId, malId));
  // A show from the season or discovery lists has its links on the catalog row until then.
  const [catalog] = airing
    ? []
    : await db
        .select({ streamingLinks: anilistCatalog.streamingLinks })
        .from(anilistCatalog)
        .where(eq(anilistCatalog.malId, malId));
  deps.refreshAiring(malId);

  const [settings] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));

  const sharing = (await listFriends(db, userId)).filter((friend) => friend.shareActivity);
  const theirs =
    sharing.length === 0
      ? []
      : await db
          .select({
            userId: listEntries.userId,
            status: listEntries.status,
            score: listEntries.score,
            episodesWatched: listEntries.numEpisodesWatched,
          })
          .from(listEntries)
          .where(
            and(
              eq(listEntries.animeId, malId),
              inArray(
                listEntries.userId,
                sharing.map((friend) => friend.id),
              ),
            ),
          );
  const names = new Map(sharing.map((friend) => [friend.id, friend.malUsername]));

  const [synopsis, journal] = await Promise.all([
    deps.synopsis.get(malId),
    loadJournal(db, userId, { animeId: malId, limit: SHOW_JOURNAL_LIMIT }),
  ]);

  return {
    show: {
      animeId: show.malId,
      title: show.title,
      altTitles: altTitles(show.title, show.titleEn, show.synonyms),
      pictureUrl: show.mainPictureUrl,
      mediaType: show.mediaType,
      numEpisodes: show.numEpisodes,
      episodeMinutes: show.episodeMinutes,
      airingStatus: show.airingStatus,
      startDate: show.startDate,
      genres: show.genres,
      malMean: show.malMean,
      synopsis,
    },
    entry: entry
      ? {
          status: entry.status,
          score: entry.score,
          episodesWatched: entry.numEpisodesWatched,
          isRewatching: entry.isRewatching,
          startDate: entry.startDate,
          finishDate: entry.finishDate,
          updatedAt: entry.malUpdatedAt.toISOString(),
        }
      : null,
    airing: airingView(airing, now),
    watchOn: watchOn(
      airing?.streamingLinks ?? catalog?.streamingLinks ?? [],
      settings?.services ?? [],
    ),
    journal: journal.items,
    friends: theirs
      .map((row) => ({
        friendId: row.userId,
        malUsername: names.get(row.userId) ?? "",
        status: row.status,
        score: row.score,
        episodesWatched: row.episodesWatched,
      }))
      .sort((a, b) => a.malUsername.localeCompare(b.malUsername)),
  };
}
