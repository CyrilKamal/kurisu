import type { ListStatus } from "@kurisu/shared";
import { and, eq, gte, isNull, lt, notInArray, sql } from "drizzle-orm";

import { localClock } from "../brief/timing.js";
import type { Db } from "../db/client.js";
import {
  anime,
  briefSettings,
  changes,
  listEntries,
  listEvents,
  proposals,
  yearlyGoals,
} from "../db/schema.js";
import type { ListChange } from "../writes/normalize.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUSES: ListStatus[] = ["watching", "completed", "on_hold", "dropped", "plan_to_watch"];
const TOP_GENRES = 6;
const RECENT_COMPLETIONS = 8;

/**
 * One change to the list in a window: made through kurisu (`changes`, without undos, undone
 * changes or imports) or found on MAL by a sync (`list_events`).
 */
export interface ActivityRow {
  animeId: number;
  title: string;
  episodeMinutes: number | null;
  origin: "kurisu" | "mal";
  kind: "added" | "updated" | "removed";
  before: ListChange;
  after: ListChange;
  at: Date;
}

export interface WeekStats {
  from: Date;
  to: Date;
  episodes: number;
  /** Minutes of those episodes, for shows whose episode length MAL knows. */
  minutes: number;
  /** Shows with at least one episode watched. */
  shows: number;
  finished: { animeId: number; title: string }[];
}

/**
 * The episodes a change says were watched: an increase in progress; for a show added through
 * kurisu, its progress (the user said they watched it); for a show added on MAL, its progress
 * only while it's being watched (a show added as completed is usually an old one being logged).
 * Going back (a correction, or a rewatch starting over) counts as nothing.
 */
export function episodesWatched(row: ActivityRow): number {
  const after = row.after.episodesWatched;
  if (after === undefined) return 0;
  if (row.kind === "added") {
    return row.origin === "kurisu" || row.after.status === "watching" ? after : 0;
  }
  if (row.kind !== "updated") return 0;
  const before = row.before.episodesWatched;
  return before === undefined ? 0 : Math.max(0, after - before);
}

/** Whether a change finished the show: it became completed (an add only through kurisu). */
export function finishedShow(row: ActivityRow): boolean {
  if (row.after.status !== "completed") return false;
  if (row.kind === "added") return row.origin === "kurisu";
  return row.kind === "updated" && row.before.status !== "completed";
}

/** What a stretch of activity adds up to. */
export function summarizeActivity(rows: ActivityRow[], from: Date, to: Date): WeekStats {
  let episodes = 0;
  let minutes = 0;
  const shows = new Set<number>();
  const finished = new Map<number, string>();
  for (const row of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const eps = episodesWatched(row);
    if (eps > 0) {
      episodes += eps;
      minutes += eps * (row.episodeMinutes ?? 0);
      shows.add(row.animeId);
    }
    if (finishedShow(row)) finished.set(row.animeId, row.title);
  }
  return {
    from,
    to,
    episodes,
    minutes,
    shows: shows.size,
    finished: [...finished].map(([animeId, title]) => ({ animeId, title })),
  };
}

/** The list's changes between two times, through kurisu or on MAL. */
export async function activityBetween(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<ActivityRow[]> {
  const kinds = { add: "added", update: "updated", remove: "removed" } as const;
  const ours = await db
    .select({
      animeId: changes.animeId,
      title: anime.title,
      episodeMinutes: anime.episodeMinutes,
      kind: changes.kind,
      before: changes.before,
      after: changes.after,
      at: changes.committedAt,
    })
    .from(changes)
    .innerJoin(proposals, eq(proposals.id, changes.proposalId))
    .innerJoin(anime, eq(anime.malId, changes.animeId))
    .where(
      and(
        eq(changes.userId, userId),
        gte(changes.committedAt, from),
        lt(changes.committedAt, to),
        isNull(changes.undoneByChangeId),
        // An undo takes a change back, and an import logs what was watched before.
        notInArray(proposals.source, ["undo", "import"]),
      ),
    );
  const theirs = await db
    .select({
      animeId: listEvents.animeId,
      title: anime.title,
      episodeMinutes: anime.episodeMinutes,
      kind: listEvents.kind,
      before: listEvents.before,
      after: listEvents.after,
      at: listEvents.at,
    })
    .from(listEvents)
    .innerJoin(anime, eq(anime.malId, listEvents.animeId))
    .where(and(eq(listEvents.userId, userId), gte(listEvents.at, from), lt(listEvents.at, to)));
  return [
    ...ours.map((row) => ({ ...row, kind: kinds[row.kind], origin: "kurisu" as const })),
    ...theirs.map((row) => ({ ...row, origin: "mal" as const })),
  ];
}

/** The year in MAL's date ("2026-03-14", "2026-03" or "2026"), or null. */
function yearIn(date: string | null): number | null {
  const year = date ? Number(/^(\d{4})/.exec(date)?.[1]) : NaN;
  return Number.isFinite(year) ? year : null;
}

/** The month (1–12) in MAL's date, or null when it has none. */
function monthIn(date: string): number | null {
  const month = Number(/^\d{4}-(\d{2})/.exec(date)?.[1]);
  return month >= 1 && month <= 12 ? month : null;
}

/**
 * When a completed show was finished: MAL's finish date, or else the user's local date of the
 * last change that completed it (kurisu doesn't send MAL a finish date). Null when neither
 * says (an old show logged as completed).
 */
export function finishedOn(
  finishDate: string | null,
  completedAt: Date | null,
  timeZone: string,
): string | null {
  if (yearIn(finishDate) !== null) return finishDate;
  return completedAt ? localClock(completedAt, timeZone).date : null;
}

export interface YearStats {
  year: number;
  completed: number;
  /** Completions per month, January first; ones without a month aren't in it. */
  byMonth: number[];
  goal: number | null;
  /** The latest completions, newest first. */
  recent: { animeId: number; title: string; on: string }[];
}

export interface AllTimeStats {
  shows: number;
  byStatus: Record<ListStatus, number>;
  episodes: number;
  /** Minutes of those episodes, for shows whose episode length MAL knows. */
  minutes: number;
  /** Shows with episodes watched whose episode length MAL doesn't know. */
  unknownLength: number;
  meanScore: number | null;
  scored: number;
  /** How many shows got each score, 1 to 10. */
  scores: number[];
  /** The genres of the most completed shows. */
  topGenres: { genre: string; shows: number }[];
}

export interface Stats {
  timeZone: string;
  allTime: AllTimeStats;
  year: YearStats;
  week: WeekStats;
}

/** The user's time zone, from their brief settings; UTC if they have none. */
export async function userTimeZone(db: Db, userId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: briefSettings.timeZone })
    .from(briefSettings)
    .where(eq(briefSettings.userId, userId));
  return row?.timeZone ?? "UTC";
}

/** The current year on the user's clock. */
export function localYear(now: Date, timeZone: string): number {
  return Number(localClock(now, timeZone).date.slice(0, 4));
}

/** Everything the Stats page shows, from Postgres only. */
export async function loadStats(db: Db, userId: string, now: Date = new Date()): Promise<Stats> {
  const timeZone = await userTimeZone(db, userId);
  const year = localYear(now, timeZone);
  const weekFrom = new Date(now.getTime() - 7 * DAY_MS);
  return {
    timeZone,
    allTime: await allTime(db, userId),
    year: await yearStats(db, userId, year, timeZone),
    week: summarizeActivity(await activityBetween(db, userId, weekFrom, now), weekFrom, now),
  };
}

async function allTime(db: Db, userId: string): Promise<AllTimeStats> {
  const totals = await db.execute<{
    status: ListStatus;
    shows: number;
    episodes: number;
    minutes: number;
    unknown_length: number;
  }>(sql`
    SELECT e.status,
      count(*)::int AS shows,
      coalesce(sum(e.num_episodes_watched), 0)::int AS episodes,
      coalesce(sum(e.num_episodes_watched * a.episode_minutes), 0)::int AS minutes,
      count(*) FILTER (WHERE e.num_episodes_watched > 0 AND a.episode_minutes IS NULL)::int
        AS unknown_length
    FROM ${listEntries} e JOIN ${anime} a ON a.mal_id = e.anime_id
    WHERE e.user_id = ${userId}
    GROUP BY e.status
  `);
  const scores = await db.execute<{ score: number; shows: number }>(sql`
    SELECT score, count(*)::int AS shows FROM ${listEntries}
    WHERE user_id = ${userId} AND score > 0
    GROUP BY score
  `);
  const genres = await db.execute<{ genre: string; shows: number }>(sql`
    SELECT g AS genre, count(*)::int AS shows
    FROM ${listEntries} e JOIN ${anime} a ON a.mal_id = e.anime_id
    CROSS JOIN LATERAL unnest(a.genres) AS g
    WHERE e.user_id = ${userId} AND e.status = 'completed'
    GROUP BY g
    ORDER BY shows DESC, g
    LIMIT ${TOP_GENRES}
  `);

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ListStatus, number>;
  let shows = 0;
  let episodes = 0;
  let minutes = 0;
  let unknownLength = 0;
  for (const row of totals.rows) {
    byStatus[row.status] = row.shows;
    shows += row.shows;
    episodes += row.episodes;
    minutes += row.minutes;
    unknownLength += row.unknown_length;
  }
  const counts = Array.from({ length: 10 }, () => 0);
  let scored = 0;
  let sum = 0;
  for (const row of scores.rows) {
    if (row.score < 1 || row.score > 10) continue;
    counts[row.score - 1] = row.shows;
    scored += row.shows;
    sum += row.score * row.shows;
  }
  return {
    shows,
    byStatus,
    episodes,
    minutes,
    unknownLength,
    meanScore: scored > 0 ? Math.round((sum / scored) * 100) / 100 : null,
    scored,
    scores: counts,
    topGenres: genres.rows,
  };
}

export async function yearStats(
  db: Db,
  userId: string,
  year: number,
  timeZone: string,
): Promise<YearStats> {
  // For each completed show, its MAL finish date and the last time a change completed it: through
  // kurisu (not an import or an undone change) or on MAL (an update, not an add).
  const rows = await db.execute<{
    anime_id: number;
    title: string;
    finish_date: string | null;
    completed_at: Date | string | null;
  }>(sql`
    SELECT e.anime_id, a.title, e.finish_date,
      greatest(
        (SELECT max(c.committed_at) FROM ${changes} c JOIN ${proposals} p ON p.id = c.proposal_id
          WHERE c.user_id = e.user_id AND c.anime_id = e.anime_id
            AND c.after ->> 'status' = 'completed' AND c.undone_by_change_id IS NULL
            AND p.source NOT IN ('undo', 'import')),
        (SELECT max(l.at) FROM ${listEvents} l
          WHERE l.user_id = e.user_id AND l.anime_id = e.anime_id
            AND l.kind = 'updated' AND l.after ->> 'status' = 'completed')
      ) AS completed_at
    FROM ${listEntries} e JOIN ${anime} a ON a.mal_id = e.anime_id
    WHERE e.user_id = ${userId} AND e.status = 'completed'
  `);
  const done = rows.rows.flatMap((row) => {
    const at = row.completed_at === null ? null : new Date(row.completed_at);
    const on = finishedOn(row.finish_date, at, timeZone);
    return on !== null && yearIn(on) === year
      ? [{ animeId: row.anime_id, title: row.title, on }]
      : [];
  });
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const show of done) {
    const month = monthIn(show.on);
    if (month !== null) byMonth[month - 1] = (byMonth[month - 1] ?? 0) + 1;
  }
  const [goal] = await db
    .select({ target: yearlyGoals.target })
    .from(yearlyGoals)
    .where(and(eq(yearlyGoals.userId, userId), eq(yearlyGoals.year, year)));
  return {
    year,
    completed: done.length,
    byMonth,
    goal: goal?.target ?? null,
    recent: done
      .sort((a, b) => b.on.localeCompare(a.on) || a.title.localeCompare(b.title))
      .slice(0, RECENT_COMPLETIONS),
  };
}

/** Sets this year's goal (shows to complete), or clears it with null. */
export async function setYearlyGoal(
  db: Db,
  userId: string,
  target: number | null,
  now: Date = new Date(),
): Promise<void> {
  const year = localYear(now, await userTimeZone(db, userId));
  if (target === null) {
    await db
      .delete(yearlyGoals)
      .where(and(eq(yearlyGoals.userId, userId), eq(yearlyGoals.year, year)));
    return;
  }
  await db
    .insert(yearlyGoals)
    .values({ userId, year, target })
    .onConflictDoUpdate({
      target: [yearlyGoals.userId, yearlyGoals.year],
      set: { target, updatedAt: new Date() },
    });
}
