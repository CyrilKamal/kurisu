import { TOP_CHARTS, type TopChart } from "@kurisu/shared";
import { eq, inArray, max, sql } from "drizzle-orm";

import { rememberShows } from "../anilist/catalog.js";
import type { AniListClient, DiscoveredShow } from "../anilist/client.js";
import type { Db } from "../db/client.js";
import { anilistCatalog, scheduleSlots, seasonCharts, topCharts } from "../db/schema.js";
import { CATALOG_UPDATE, catalogRowFrom, rememberDiscovered } from "../recommend/discovery.js";
import { seasonKey } from "../recommend/season.js";
import { chartedSeasons, type Season } from "./seasons.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Airing times rarely move within hours: the schedule is rebuilt every 6. */
export const SCHEDULE_MAX_AGE_MS = 6 * HOUR_MS;
/** The schedule kept: from a day back (today's episodes so far) to 8 days ahead. */
const SCHEDULE_BACK_MS = DAY_MS;
const SCHEDULE_AHEAD_MS = 8 * DAY_MS;
/** A season's chart moves slowly: rebuilt daily. */
export const CHART_MAX_AGE_MS = DAY_MS;
/** An earlier season's chart barely moves: refetched when someone asks after 30 days. */
export const ARCHIVE_MAX_AGE_MS = 30 * DAY_MS;

export interface BrowseRefreshDeps {
  db: Db;
  anilist: AniListClient;
}

/**
 * Rebuilds the shared airing schedule unless it's under 6 hours old (or `force`): every episode
 * AniList has from a day back to 8 days ahead, of shows MAL knows, never adult ones. Each show
 * gets an `anime` row, so its page opens and it can be added. Returns the number of episodes, or
 * null when it was fresh. Throws if AniList fails; the old schedule stays.
 */
export async function refreshSchedule(
  deps: BrowseRefreshDeps,
  options: { now?: Date; force?: boolean } = {},
): Promise<number | null> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  if (!options.force) {
    const [latest] = await db.select({ at: max(scheduleSlots.fetchedAt) }).from(scheduleSlots);
    if (latest?.at && now.getTime() - latest.at.getTime() < SCHEDULE_MAX_AGE_MS) return null;
  }

  const episodes = await anilist.scheduleBetween(
    new Date(now.getTime() - SCHEDULE_BACK_MS),
    new Date(now.getTime() + SCHEDULE_AHEAD_MS),
  );
  await rememberShows(
    db,
    episodes.map((e) => e.show),
  );
  const rows = [
    ...new Map(
      episodes.map((e) => [
        `${String(e.show.anilistId)}:${String(e.episode)}`,
        {
          anilistId: e.show.anilistId,
          episode: e.episode,
          airingAt: e.airingAt,
          malId: e.show.malId,
          popularity: e.popularity,
          fetchedAt: now,
        },
      ]),
    ).values(),
  ];

  await db.transaction(async (tx) => {
    // Any request can start a rebuild; one at a time, so two can't interleave.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('schedule_slots'))`);
    await tx.delete(scheduleSlots);
    if (rows.length > 0) await tx.insert(scheduleSlots).values(rows);
  });
  return rows.length;
}

/** Only shows that can be charted: on MAL and not adult, out or still to come. */
function chartable(show: DiscoveredShow): show is DiscoveredShow & { malId: number } {
  return show.malId !== null && !show.isAdult;
}

/**
 * A chart's shows from AniList's ids, in order: their details fetched, only chartable ones, each
 * once, as rows for the shared catalog.
 */
async function chartRows(anilist: AniListClient, order: number[]) {
  const details = new Map((await anilist.showDetails(order)).map((s) => [s.anilistId, s]));
  const shows = order.flatMap((id) => {
    const show = details.get(id);
    return show && chartable(show) ? [show] : [];
  });
  return [...new Map(shows.map((s) => [s.malId, catalogRowFrom(s)])).values()];
}

/**
 * Rebuilds one season's chart unless it's younger than `maxAgeMs` (or `force`): its 100 most
 * popular shows, with their details in the shared catalog and an `anime` row each. Returns
 * whether it was rebuilt. Throws if AniList fails; the old chart stays.
 */
export async function refreshSeasonChart(
  deps: BrowseRefreshDeps,
  season: Season,
  options: { now?: Date; force?: boolean; maxAgeMs?: number } = {},
): Promise<boolean> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  const key = seasonKey(season);
  if (!options.force) {
    const [latest] = await db
      .select({ at: max(seasonCharts.fetchedAt) })
      .from(seasonCharts)
      .where(eq(seasonCharts.season, key));
    const maxAge = options.maxAgeMs ?? CHART_MAX_AGE_MS;
    if (latest?.at && now.getTime() - latest.at.getTime() < maxAge) return false;
  }
  const rows = await chartRows(anilist, await anilist.seasonChart(season.season, season.year));

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('season_charts'))`);
    if (rows.length > 0) {
      await tx
        .insert(anilistCatalog)
        .values(rows)
        .onConflictDoUpdate({ target: anilistCatalog.malId, set: CATALOG_UPDATE });
    }
    await tx.delete(seasonCharts).where(eq(seasonCharts.season, key));
    if (rows.length > 0) {
      await tx
        .insert(seasonCharts)
        .values(
          rows.map((row, i) => ({ season: key, malId: row.malId, rank: i + 1, fetchedAt: now })),
        );
    }
  });
  await rememberDiscovered(
    db,
    rows.map((row) => row.malId),
  );
  return true;
}

/**
 * Rebuilds the charts of last, this and next season unless each is under a day old (or
 * `force`). Returns the number of seasons rebuilt. A season AniList fails on keeps its old
 * chart, and the error is thrown after the others are done.
 */
export async function refreshSeasonCharts(
  deps: BrowseRefreshDeps,
  options: { now?: Date; force?: boolean } = {},
): Promise<number> {
  let rebuilt = 0;
  let failure: Error | null = null;
  for (const season of chartedSeasons(options.now ?? new Date())) {
    try {
      if (await refreshSeasonChart(deps, season, options)) rebuilt++;
    } catch (err) {
      failure ??= err instanceof Error ? err : new Error(String(err));
    }
  }
  if (failure !== null) throw failure;
  return rebuilt;
}

/**
 * Rebuilds the Top charts unless each is under a day old (or `force`): 100 shows each, in
 * AniList's order, with their details in the shared catalog and an `anime` row each. Returns the
 * number rebuilt; a chart AniList fails on keeps its old shows, and the error is thrown after the
 * others are done.
 */
export async function refreshTopCharts(
  deps: BrowseRefreshDeps,
  options: { now?: Date; force?: boolean } = {},
): Promise<number> {
  const { db, anilist } = deps;
  const now = options.now ?? new Date();
  const updated = await topChartsUpdatedAt(db);
  let rebuilt = 0;
  let failure: Error | null = null;

  for (const chart of TOP_CHARTS) {
    const at = updated.get(chart);
    if (!options.force && at && now.getTime() - at.getTime() < CHART_MAX_AGE_MS) continue;
    try {
      const rows = await chartRows(anilist, await anilist.topChart(chart));
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('top_charts'))`);
        if (rows.length > 0) {
          await tx
            .insert(anilistCatalog)
            .values(rows)
            .onConflictDoUpdate({ target: anilistCatalog.malId, set: CATALOG_UPDATE });
        }
        await tx.delete(topCharts).where(eq(topCharts.chart, chart));
        if (rows.length > 0) {
          await tx
            .insert(topCharts)
            .values(
              rows.map((row, i) => ({ chart, malId: row.malId, rank: i + 1, fetchedAt: now })),
            );
        }
      });
      await rememberDiscovered(
        db,
        rows.map((row) => row.malId),
      );
      rebuilt++;
    } catch (err) {
      failure ??= err instanceof Error ? err : new Error(String(err));
    }
  }
  if (failure !== null) throw failure;
  return rebuilt;
}

/** Each Top chart's last rebuild. */
export async function topChartsUpdatedAt(db: Db): Promise<Map<TopChart, Date>> {
  const rows = await db
    .select({ chart: topCharts.chart, at: max(topCharts.fetchedAt) })
    .from(topCharts)
    .groupBy(topCharts.chart);
  return new Map(
    rows.flatMap((row) => {
      const chart = TOP_CHARTS.find((c) => c === row.chart);
      return chart && row.at ? [[chart, row.at] as const] : [];
    }),
  );
}

/** When the schedule was last rebuilt, or null. */
export async function scheduleUpdatedAt(db: Db): Promise<Date | null> {
  const [latest] = await db.select({ at: max(scheduleSlots.fetchedAt) }).from(scheduleSlots);
  return latest?.at ?? null;
}

/** Charted seasons' last rebuilds, keyed "2027 WINTER". */
export async function chartsUpdatedAt(db: Db, keys: string[]): Promise<Map<string, Date>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ season: seasonCharts.season, at: max(seasonCharts.fetchedAt) })
    .from(seasonCharts)
    .where(inArray(seasonCharts.season, keys))
    .groupBy(seasonCharts.season);
  return new Map(rows.flatMap((row) => (row.at ? [[row.season, row.at] as const] : [])));
}
