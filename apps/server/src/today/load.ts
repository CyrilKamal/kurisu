import type { TodayResponse } from "@kurisu/shared";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { latestAiredEpisode } from "../anilist/cache.js";
import { watchOn } from "../brief/services.js";
import type { Db } from "../db/client.js";
import {
  anilistMedia,
  anime,
  briefSettings,
  briefs,
  chatMessages,
  listEntries,
} from "../db/schema.js";
import { friendActivity } from "../friends/activity.js";
import { listFriends } from "../friends/friendships.js";
import { userTimeZone } from "../stats/compute.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead "Coming up" looks. */
const COMING_UP_WINDOW_MS = 7 * DAY_MS;
const OUT_NOW_MAX = 20;
const COMING_UP_MAX = 10;
const CONTINUE_MAX = 5;
const FRIENDS_MAX = 3;

/**
 * Today: what's out for the user and not watched yet, what airs in the coming week, the shows
 * they're in the middle of, their latest brief and what friends watched. It reads only what's
 * stored (AniList's cached schedule, refreshed after each sync), so it never waits on AniList
 * and changes nothing.
 */
export async function loadToday(db: Db, userId: string, now: Date): Promise<TodayResponse> {
  const rows = await db
    .select({
      animeId: listEntries.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      numEpisodes: anime.numEpisodes,
      episodeMinutes: anime.episodeMinutes,
      airingStatus: anime.airingStatus,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      updatedAt: listEntries.malUpdatedAt,
      airing: anilistMedia,
    })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .leftJoin(anilistMedia, eq(anilistMedia.malId, listEntries.animeId))
    .where(
      and(
        eq(listEntries.userId, userId),
        inArray(listEntries.status, ["watching", "plan_to_watch"]),
      ),
    )
    .orderBy(desc(listEntries.malUpdatedAt));

  const [settings] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  const services = settings?.services ?? [];

  const show = (row: (typeof rows)[number]) => ({
    animeId: row.animeId,
    title: row.title,
    pictureUrl: row.pictureUrl,
    numEpisodes: row.numEpisodes,
    episodesWatched: row.episodesWatched,
  });

  const outNow: TodayResponse["outNow"] = [];
  const behind = new Map<number, number>();
  const comingUp: TodayResponse["comingUp"] = [];
  const continueWatching: TodayResponse["continueWatching"] = [];
  for (const row of rows) {
    const latest = row.airing ? latestAiredEpisode(row.airing, now) : null;
    if (row.status === "watching" && latest !== null && latest > row.episodesWatched) {
      outNow.push({
        ...show(row),
        latestAired: latest,
        watchOn: watchOn(row.airing?.streamingLinks ?? [], services),
      });
      behind.set(row.animeId, latest - row.episodesWatched);
      continue;
    }
    const next = row.airing;
    if (
      next?.nextEpisode != null &&
      next.nextAiringAt !== null &&
      next.nextAiringAt.getTime() > now.getTime() &&
      next.nextAiringAt.getTime() - now.getTime() <= COMING_UP_WINDOW_MS &&
      // Plan to Watch shows only when they start: their later episodes aren't news yet.
      (row.status === "watching" || next.nextEpisode === 1)
    ) {
      comingUp.push({
        ...show(row),
        status: row.status,
        episode: next.nextEpisode,
        airingAt: next.nextAiringAt.toISOString(),
      });
    }
    // In the middle of a show that has finished airing: nothing to wait for.
    if (
      row.status === "watching" &&
      row.airingStatus === "finished_airing" &&
      (row.numEpisodes === null || row.episodesWatched < row.numEpisodes)
    ) {
      continueWatching.push({ ...show(row), episodeMinutes: row.episodeMinutes });
    }
  }
  // The shows they keep up with come first; rows are already last touched first.
  outNow.sort((a, b) => (behind.get(a.animeId) ?? 0) - (behind.get(b.animeId) ?? 0));
  comingUp.sort((a, b) => a.airingAt.localeCompare(b.airingAt));

  const [brief] = await db
    .select({
      conversationId: chatMessages.conversationId,
      localDate: briefs.localDate,
      summary: briefs.summary,
      at: briefs.createdAt,
      items: briefs.items,
      alerts: briefs.alerts,
    })
    .from(briefs)
    .innerJoin(chatMessages, eq(chatMessages.id, briefs.chatMessageId))
    .where(
      and(
        eq(briefs.userId, userId),
        eq(briefs.kind, "daily"),
        inArray(briefs.status, ["ready", "sent"]),
        isNotNull(briefs.chatMessageId),
      ),
    )
    .orderBy(desc(briefs.createdAt))
    .limit(1);

  const friends = await listFriends(db, userId);
  return {
    timeZone: await userTimeZone(db, userId),
    outNow: outNow.slice(0, OUT_NOW_MAX),
    comingUp: comingUp.slice(0, COMING_UP_MAX),
    continueWatching: continueWatching.slice(0, CONTINUE_MAX),
    brief: brief
      ? {
          conversationId: brief.conversationId,
          localDate: brief.localDate,
          summary: brief.summary,
          at: brief.at.toISOString(),
          episodes: (brief.items ?? []).reduce((sum, item) => sum + item.episodes.length, 0),
          premieres: brief.alerts.length,
        }
      : null,
    friends: (await friendActivity(db, friends, FRIENDS_MAX)).map((item) => ({
      ...item,
      at: item.at.toISOString(),
    })),
  };
}
