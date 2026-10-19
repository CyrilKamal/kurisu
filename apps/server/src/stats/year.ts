import type { YearReview } from "@kurisu/shared";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { localClock } from "../brief/timing.js";
import type { Db } from "../db/client.js";
import { anime, diaryNotes, listEntries, users, yearlyGoals } from "../db/schema.js";
import {
  activityBetween,
  completionsIn,
  episodesWatched,
  localYear,
  monthIn,
  userTimeZone,
  yearIn,
  type ActivityRow,
  type Completion,
} from "./compute.js";

const TOP_GENRES = 5;
const TOP_RATED = 5;
const NOTES = 3;

/** A finished show with what the review needs about it. */
interface Finished extends Completion {
  pictureUrl: string | null;
  genres: string[];
  mediaType: string | null;
  startDate: string | null;
  episodeMinutes: number | null;
  score: number;
  episodes: number;
}

/** Whether a change moved the show into a status (an add only counts through kurisu). */
function became(row: ActivityRow, status: "watching" | "dropped"): boolean {
  if (row.after.status !== status || row.before.status === status) return false;
  if (row.kind === "added") return row.origin === "kurisu";
  return row.kind === "updated";
}

const byCount =
  <T extends { shows: number }>(key: (t: T) => string) =>
  (a: T, b: T) =>
    b.shows - a.shows || key(a).localeCompare(key(b));

function counted(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/**
 * A year in review on the user's clock (GET /year): the basics for everyone, and the full review
 * when `full` (Pro). Shows finished count as on the Stats page; episodes come from kurisu's
 * changes and the MAL-site changes syncs found, so only since the account began.
 */
export async function loadYearReview(
  db: Db,
  userId: string,
  year: number,
  options: { full: boolean; now?: Date },
): Promise<YearReview> {
  const now = options.now ?? new Date();
  const timeZone = await userTimeZone(db, userId);
  const localDate = (at: Date) => localClock(at, timeZone).date;
  const inYear = (at: Date) => localDate(at).startsWith(`${String(year)}-`);

  const done = await completionsIn(db, userId, year, timeZone);
  const details = done.length
    ? await db
        .select({
          animeId: anime.malId,
          pictureUrl: anime.mainPictureUrl,
          genres: anime.genres,
          mediaType: anime.mediaType,
          startDate: anime.startDate,
          episodeMinutes: anime.episodeMinutes,
          score: listEntries.score,
          episodes: listEntries.numEpisodesWatched,
        })
        .from(listEntries)
        .innerJoin(anime, eq(anime.malId, listEntries.animeId))
        .where(
          and(
            eq(listEntries.userId, userId),
            inArray(
              listEntries.animeId,
              done.map((show) => show.animeId),
            ),
          ),
        )
    : [];
  const about = new Map(details.map((row) => [row.animeId, row]));
  const finished: Finished[] = done.flatMap((show) => {
    const row = about.get(show.animeId);
    return row ? [{ ...show, ...row }] : [];
  });
  const show = (f: Finished) => ({ animeId: f.animeId, title: f.title, pictureUrl: f.pictureUrl });
  const newestFirst = (a: Finished, b: Finished) =>
    b.on.localeCompare(a.on) || a.title.localeCompare(b.title);

  // A few days either side of the year in UTC, then the user's own dates decide.
  const activity = (
    await activityBetween(
      db,
      userId,
      new Date(Date.UTC(year - 1, 11, 30)),
      new Date(Date.UTC(year + 1, 0, 2)),
    )
  ).filter((row) => inYear(row.at));
  const episodesByMonth = Array.from({ length: 12 }, () => 0);
  let minutes = 0;
  for (const row of activity) {
    const eps = episodesWatched(row);
    const month = Number(localDate(row.at).slice(5, 7));
    episodesByMonth[month - 1] = (episodesByMonth[month - 1] ?? 0) + eps;
    minutes += eps * (row.episodeMinutes ?? 0);
  }

  const genres = [...counted(finished.flatMap((f) => f.genres))]
    .map(([genre, shows]) => ({ genre, shows }))
    .sort(byCount((g) => g.genre));
  const scored = finished.filter((f) => f.score > 0);
  const best = [...scored].sort((a, b) => b.score - a.score || newestFirst(a, b));
  const favorite = best[0];

  const [user] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  const joined = user ? localDate(user.createdAt) : null;
  const [goal] = await db
    .select({ target: yearlyGoals.target })
    .from(yearlyGoals)
    .where(and(eq(yearlyGoals.userId, userId), eq(yearlyGoals.year, year)));

  return {
    year,
    currentYear: localYear(now, timeZone),
    timeZone,
    countingSince: joined !== null && joined > `${String(year)}-01-01` ? joined : null,
    basic: {
      completed: finished.length,
      episodes: episodesByMonth.reduce((sum, n) => sum + n, 0),
      minutes,
      topGenre: genres[0]?.genre ?? null,
      favorite: favorite ? { ...show(favorite), score: favorite.score } : null,
      goal: goal?.target ?? null,
    },
    full: options.full ? await fullReview() : null,
  };

  async function fullReview(): Promise<NonNullable<YearReview["full"]>> {
    const completedByMonth = Array.from({ length: 12 }, () => 0);
    for (const f of finished) {
      const month = monthIn(f.on);
      if (month !== null) completedByMonth[month - 1] = (completedByMonth[month - 1] ?? 0) + 1;
    }
    const timed = finished
      .filter((f) => f.episodeMinutes !== null && f.episodes > 0)
      .map((f) => ({ ...f, minutes: f.episodes * (f.episodeMinutes ?? 0) }))
      .sort((a, b) => b.minutes - a.minutes || newestFirst(a, b));
    const longest = timed[0];
    const byDate = [...finished].sort((a, b) => a.on.localeCompare(b.on));
    const first = byDate[0];
    const last = byDate.at(-1);
    const startYears = finished.map((f) => yearIn(f.startDate));

    const notes = await db
      .select({
        animeId: diaryNotes.animeId,
        title: anime.title,
        text: diaryNotes.text,
        at: diaryNotes.createdAt,
      })
      .from(diaryNotes)
      .innerJoin(anime, eq(anime.malId, diaryNotes.animeId))
      .where(
        and(
          eq(diaryNotes.userId, userId),
          gte(diaryNotes.createdAt, new Date(Date.UTC(year - 1, 11, 30))),
          lt(diaryNotes.createdAt, new Date(Date.UTC(year + 1, 0, 2))),
        ),
      )
      .orderBy(desc(diaryNotes.createdAt));

    return {
      completedByMonth,
      episodesByMonth,
      topGenres: genres.slice(0, TOP_GENRES),
      topRated: best.slice(0, TOP_RATED).map((f) => ({ ...show(f), score: f.score, on: f.on })),
      meanScore:
        scored.length > 0
          ? Math.round((scored.reduce((sum, f) => sum + f.score, 0) / scored.length) * 100) / 100
          : null,
      scored: scored.length,
      longest: longest
        ? { ...show(longest), episodes: longest.episodes, minutes: longest.minutes }
        : null,
      first: first ? { ...show(first), on: first.on } : null,
      last: last ? { ...show(last), on: last.on } : null,
      seasonal: startYears.filter((y) => y === year).length,
      backlog: startYears.filter((y) => y !== null && y < year).length,
      formats: [...counted(finished.map((f) => f.mediaType ?? "unknown"))]
        .map(([mediaType, shows]) => ({ mediaType, shows }))
        .sort(byCount((f) => f.mediaType)),
      started: new Set(activity.filter((row) => became(row, "watching")).map((r) => r.animeId))
        .size,
      dropped: new Set(activity.filter((row) => became(row, "dropped")).map((r) => r.animeId)).size,
      notes: notes
        .filter((note) => inYear(note.at))
        .slice(0, NOTES)
        .map((note) => ({
          animeId: note.animeId,
          title: note.title,
          text: note.text,
          on: localDate(note.at),
        })),
    };
  }
}
