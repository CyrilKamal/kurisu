import type {
  ChartShow,
  ScheduleEpisode,
  ScheduleResponse,
  SeasonChartResponse,
  TopChart,
  TopChartResponse,
} from "@kurisu/shared";
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
  topCharts,
} from "../db/schema.js";
import { seasonKey } from "../recommend/season.js";
import { userTimeZone } from "../stats/compute.js";
import { chartsUpdatedAt, scheduleUpdatedAt, topChartsUpdatedAt } from "./refresh.js";
import {
  browsable,
  chartedSeasons,
  seasonLabel,
  seasonParam,
  shiftSeason,
  type Season,
} from "./seasons.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The Schedule: today's episodes so far, and the week ahead. */
const SCHEDULE_BACK_MS = DAY_MS;
const SCHEDULE_AHEAD_MS = 7 * DAY_MS;

/** A slot of AniList's shared schedule, in AniList's episode numbers. */
export interface ScheduleSlotRow {
  anilistId: number;
  malId: number;
  episode: number;
  airingAt: Date;
}

/** An airing time kurisu recorded for a show (`airing_episodes`), in MAL's episode numbers. */
export interface RecordedEpisodeRow {
  malId: number;
  episode: number;
  airingAt: Date;
}

/** Which AniList part a listed show is, and how far its episode numbers are from MAL's. */
export interface ShowPart {
  anilistId: number | null;
  episodeOffset: number;
}

/**
 * Numbers each episode as MAL does for shows on the user's list: AniList's episode plus the
 * part's offset (from `anilist_media`). A slot of another AniList part of a listed show is left
 * out rather than numbered by a guess; shows not on the list keep AniList's numbers. Recorded
 * times (already in MAL's numbers) fill in what the slots lack. One per show and episode, the
 * slot's first.
 */
export function numberEpisodes<S extends ScheduleSlotRow, R extends RecordedEpisodeRow>(
  slots: S[],
  recorded: R[],
  partOf: (malId: number) => ShowPart | undefined,
): { row: S | R; episode: number; airingAt: Date; fromSlot: boolean }[] {
  const out = new Map<string, { row: S | R; episode: number; airingAt: Date; fromSlot: boolean }>();
  const add = (row: S | R, episode: number, fromSlot: boolean) => {
    const key = `${String(row.malId)}:${String(episode)}`;
    if (!out.has(key)) out.set(key, { row, episode, airingAt: row.airingAt, fromSlot });
  };
  for (const slot of slots) {
    const part = partOf(slot.malId);
    if (part && part.anilistId !== slot.anilistId) continue;
    add(slot, slot.episode + (part?.episodeOffset ?? 0), true);
  }
  for (const row of recorded) add(row, row.episode, false);
  return [...out.values()];
}

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
    genres: anime.genres,
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

  const numbered = numberEpisodes(slots, recorded, (malId) =>
    entries.has(malId) ? media.get(malId) : undefined,
  );
  const episodes = numbered.map(({ row, episode, airingAt }): ScheduleEpisode => {
    const entry = entries.get(row.malId) ?? null;
    return {
      animeId: row.malId,
      title: row.title,
      pictureUrl: row.pictureUrl,
      mediaType: row.mediaType,
      episode,
      airingAt: airingAt.toISOString(),
      popularity: "popularity" in row ? row.popularity : null,
      genres: row.genres,
      entry,
      watchOn: entry ? watchOn(media.get(row.malId)?.streamingLinks ?? [], services) : [],
    };
  });

  return {
    timeZone: await userTimeZone(db, userId),
    updatedAt: (await scheduleUpdatedAt(db))?.toISOString() ?? null,
    episodes: episodes.sort(
      (a, b) => a.airingAt.localeCompare(b.airingAt) || a.title.localeCompare(b.title),
    ),
  };
}

/** A chart's columns: what the shared catalog knows of each show. */
const CHART_SHOW = {
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
};

/** A chart's shows with where each stands on the user's list. */
async function withEntries(
  db: Db,
  userId: string,
  rows: Omit<ChartShow, "entry">[],
): Promise<ChartShow[]> {
  const entries = await entriesOf(
    db,
    userId,
    rows.map((row) => row.animeId),
  );
  return rows.map((row) => ({ ...row, entry: entries.get(row.animeId) ?? null }));
}

/**
 * A season's chart, most popular first, with where each show stands on the user's list, and the
 * seasons around it. Any season from Winter 1960 to next one; null for another. A season with no
 * chart yet says so (`updatedAt` null); the route asks for it.
 */
export async function loadSeasonChart(
  db: Db,
  userId: string,
  season: Season,
  now: Date = new Date(),
): Promise<SeasonChartResponse | null> {
  if (!browsable(season, now)) return null;
  const key = seasonKey(season);

  const rows = await db
    .select(CHART_SHOW)
    .from(seasonCharts)
    .innerJoin(anilistCatalog, eq(anilistCatalog.malId, seasonCharts.malId))
    .where(eq(seasonCharts.season, key))
    .orderBy(asc(seasonCharts.rank));
  const updated = (await chartsUpdatedAt(db, [key])).get(key) ?? null;
  const previous = shiftSeason(season, -1);
  const next = shiftSeason(season, 1);

  return {
    season: seasonParam(season),
    label: seasonLabel(season),
    seasons: chartedSeasons(now).map((s) => ({ season: seasonParam(s), label: seasonLabel(s) })),
    previous: browsable(previous, now) ? seasonParam(previous) : null,
    next: browsable(next, now) ? seasonParam(next) : null,
    updatedAt: updated?.toISOString() ?? null,
    pending: updated === null,
    shows: await withEntries(db, userId, rows),
  };
}

/** One of the Top charts, in AniList's order, with where each show stands on the user's list. */
export async function loadTopChart(
  db: Db,
  userId: string,
  chart: TopChart,
): Promise<TopChartResponse> {
  const rows = await db
    .select(CHART_SHOW)
    .from(topCharts)
    .innerJoin(anilistCatalog, eq(anilistCatalog.malId, topCharts.malId))
    .where(eq(topCharts.chart, chart))
    .orderBy(asc(topCharts.rank));
  return {
    chart,
    updatedAt: (await topChartsUpdatedAt(db)).get(chart)?.toISOString() ?? null,
    shows: await withEntries(db, userId, rows),
  };
}
