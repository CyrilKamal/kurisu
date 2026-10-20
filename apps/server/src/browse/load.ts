import type { ScheduleEpisode, ScheduleResponse, SeasonChartResponse } from "@kurisu/shared";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { watchOn } from "../brief/services.js";
import type { Db } from "../db/client.js";
import {
  airingEpisodes,
  anilistCatalog,
  anilistMedia,
  anime,
  briefSettings,
  listEntries,
  scheduleSlots,
  seasonCharts,
} from "../db/schema.js";
import { seasonKey } from "../recommend/season.js";
import { userTimeZone } from "../stats/compute.js";
import { chartsUpdatedAt, scheduleUpdatedAt } from "./refresh.js";
import { chartedSeasons, seasonLabel, seasonParam, type Season } from "./seasons.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The Schedule: today's episodes so far, and the week ahead. */
const SCHEDULE_BACK_MS = DAY_MS;
const SCHEDULE_AHEAD_MS = 7 * DAY_MS;

/** Where these shows stand on the user's list, by MAL id. */
async function entriesOf(
  db: Db,
  userId: string,
  malIds: number[],
): Promise<Map<number, NonNullable<ScheduleEpisode["entry"]>>> {
  if (malIds.length === 0) return new Map();
  const rows = await db
    .select({
      animeId: listEntries.animeId,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
    })
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), inArray(listEntries.animeId, malIds)));
  return new Map(rows.map(({ animeId, ...entry }) => [animeId, entry]));
}

/**
 * Browse's Schedule: every episode from a day back to a week ahead, soonest first. AniList's
 * shared schedule gives every show; for a show on the user's list, its episode number is
 * MAL's (AniList's plus the part's offset, from the show's `anilist_media` row) and it says where
 * it streams on their services. An episode of another AniList part of a show on the list is
 * left out rather than numbered by a guess. The user's own shows' episodes that kurisu recorded
 * (`airing_episodes`) fill in anything the shared schedule lacks.
 */
export async function loadSchedule(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<ScheduleResponse> {
  const from = new Date(now.getTime() - SCHEDULE_BACK_MS);
  const to = new Date(now.getTime() + SCHEDULE_AHEAD_MS);
  const show = {
    title: anime.title,
    pictureUrl: anime.mainPictureUrl,
    mediaType: anime.mediaType,
  };

  const slots = await db
    .select({
      anilistId: scheduleSlots.anilistId,
      episode: scheduleSlots.episode,
      airingAt: scheduleSlots.airingAt,
      malId: scheduleSlots.malId,
      popularity: scheduleSlots.popularity,
      ...show,
    })
    .from(scheduleSlots)
    .innerJoin(anime, eq(anime.malId, scheduleSlots.malId))
    .where(and(gte(scheduleSlots.airingAt, from), lte(scheduleSlots.airingAt, to)))
    .orderBy(asc(scheduleSlots.airingAt));
  const recorded = await db
    .select({
      malId: airingEpisodes.malId,
      episode: airingEpisodes.episode,
      airingAt: airingEpisodes.airingAt,
      ...show,
    })
    .from(airingEpisodes)
    .innerJoin(
      listEntries,
      and(eq(listEntries.animeId, airingEpisodes.malId), eq(listEntries.userId, userId)),
    )
    .innerJoin(anime, eq(anime.malId, airingEpisodes.malId))
    .where(and(gte(airingEpisodes.airingAt, from), lte(airingEpisodes.airingAt, to)));

  const malIds = [...new Set([...slots, ...recorded].map((row) => row.malId))];
  const entries = await entriesOf(db, userId, malIds);
  const listed = malIds.filter((id) => entries.has(id));
  const media = new Map(
    (listed.length === 0
      ? []
      : await db
          .select({
            malId: anilistMedia.malId,
            anilistId: anilistMedia.anilistId,
            episodeOffset: anilistMedia.episodeOffset,
            streamingLinks: anilistMedia.streamingLinks,
          })
          .from(anilistMedia)
          .where(inArray(anilistMedia.malId, listed))
    ).map((row) => [row.malId, row]),
  );
  const [settings] = await db
    .select({ services: briefSettings.services })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  const services = settings?.services ?? [];

  const episodes = new Map<string, ScheduleEpisode>();
  const add = (
    row: { malId: number; title: string; pictureUrl: string | null; mediaType: string | null },
    episode: number,
    airingAt: Date,
    popularity: number | null,
  ) => {
    const key = `${String(row.malId)}:${String(episode)}`;
    if (episodes.has(key)) return;
    const entry = entries.get(row.malId) ?? null;
    episodes.set(key, {
      animeId: row.malId,
      title: row.title,
      pictureUrl: row.pictureUrl,
      mediaType: row.mediaType,
      episode,
      airingAt: airingAt.toISOString(),
      popularity,
      entry,
      watchOn: entry ? watchOn(media.get(row.malId)?.streamingLinks ?? [], services) : [],
    });
  };
  for (const slot of slots) {
    const part = entries.has(slot.malId) ? media.get(slot.malId) : undefined;
    if (part && part.anilistId !== slot.anilistId) continue;
    add(slot, slot.episode + (part?.episodeOffset ?? 0), slot.airingAt, slot.popularity);
  }
  for (const row of recorded) add(row, row.episode, row.airingAt, null);

  return {
    timeZone: await userTimeZone(db, userId),
    updatedAt: (await scheduleUpdatedAt(db))?.toISOString() ?? null,
    episodes: [...episodes.values()].sort(
      (a, b) => a.airingAt.localeCompare(b.airingAt) || a.title.localeCompare(b.title),
    ),
  };
}

/**
 * A charted season (last, this or next), most popular first, with where each show stands on
 * the user's list. Null for a season Browse doesn't chart.
 */
export async function loadSeasonChart(
  db: Db,
  userId: string,
  season: Season,
  now: Date = new Date(),
): Promise<SeasonChartResponse | null> {
  const charted = chartedSeasons(now);
  if (!charted.some((s) => s.season === season.season && s.year === season.year)) return null;
  const key = seasonKey(season);

  const rows = await db
    .select({
      animeId: anilistCatalog.malId,
      title: anilistCatalog.title,
      pictureUrl: anilistCatalog.coverUrl,
      mediaType: anilistCatalog.mediaType,
      numEpisodes: anilistCatalog.numEpisodes,
      episodeMinutes: anilistCatalog.episodeMinutes,
      genres: anilistCatalog.genres,
      score: anilistCatalog.score,
      popularity: anilistCatalog.popularity,
      startDate: anilistCatalog.startDate,
      airingStatus: anilistCatalog.airingStatus,
    })
    .from(seasonCharts)
    .innerJoin(anilistCatalog, eq(anilistCatalog.malId, seasonCharts.malId))
    .where(eq(seasonCharts.season, key))
    .orderBy(asc(seasonCharts.rank));
  const entries = await entriesOf(
    db,
    userId,
    rows.map((row) => row.animeId),
  );
  const updated = await chartsUpdatedAt(db, [key]);

  return {
    season: seasonParam(season),
    label: seasonLabel(season),
    seasons: charted.map((s) => ({ season: seasonParam(s), label: seasonLabel(s) })),
    updatedAt: updated.get(key)?.toISOString() ?? null,
    shows: rows.map((row) => ({ ...row, entry: entries.get(row.animeId) ?? null })),
  };
}
