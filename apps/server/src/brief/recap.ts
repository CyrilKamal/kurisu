import type { Db } from "../db/client.js";
import {
  activityBetween,
  localYear,
  summarizeActivity,
  userTimeZone,
  yearStats,
  type WeekStats,
} from "../stats/compute.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Finished shows named in a recap; the rest are counted. */
const FINISHED_NAMED = 3;

/** A Sunday brief's sum of the user's week, with how this year is going. */
export interface BriefRecap {
  episodes: number;
  /** Minutes of those episodes, for shows whose episode length MAL knows. */
  minutes: number;
  shows: number;
  /** Titles of the shows finished this week. */
  finished: string[];
  year: number;
  /** Shows completed this year so far. */
  completed: number;
  /** This year's goal, if the user set one. */
  goal: number | null;
}

/** Whether a local date ("2026-10-11") is a Sunday. */
export function isSunday(localDate: string): boolean {
  const date = new Date(`${localDate}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 0;
}

/** The recap for a week, or null when nothing was watched or finished (nothing to sum up). */
export function recapFrom(
  week: Pick<WeekStats, "episodes" | "minutes" | "shows" | "finished">,
  year: { year: number; completed: number; goal: number | null },
): BriefRecap | null {
  if (week.episodes === 0 && week.finished.length === 0) return null;
  return {
    episodes: week.episodes,
    minutes: week.minutes,
    shows: week.shows,
    finished: week.finished.map((show) => show.title),
    ...year,
  };
}

/** The user's last 7 days up to `now`, and their year, as a recap (null for an empty week). */
export async function weeklyRecap(db: Db, userId: string, now: Date): Promise<BriefRecap | null> {
  const from = new Date(now.getTime() - WEEK_MS);
  const week = summarizeActivity(await activityBetween(db, userId, from, now), from, now);
  const timeZone = await userTimeZone(db, userId);
  const year = await yearStats(db, userId, localYear(now, timeZone), timeZone);
  return recapFrom(week, { year: year.year, completed: year.completed, goal: year.goal });
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? "" : "s"}`;
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function titleList(titles: string[]): string {
  const named = titles.slice(0, FINISHED_NAMED);
  const more = titles.length - named.length;
  const parts = more > 0 ? [...named, `${String(more)} more`] : named;
  const last = parts.pop() ?? "";
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : last;
}

/** How this year is going: "2026 goal: 18 of 40 shows." or "18 shows completed in 2026." */
function yearLine(recap: BriefRecap): string {
  return recap.goal === null
    ? `${plural(recap.completed, "show")} completed in ${String(recap.year)}.`
    : `${String(recap.year)} goal: ${String(recap.completed)} of ${plural(recap.goal, "show")}.`;
}

/**
 * The recap as one paragraph: "This week: 23 episodes (9.2 hours) across 4 shows. Finished
 * Bocchi the Rock! and Frieren. 2026 goal: 18 of 40 shows."
 */
export function recapText(recap: BriefRecap): string {
  const hours = recap.minutes > 0 ? ` (${(recap.minutes / 60).toFixed(1)} hours)` : "";
  const watched =
    recap.episodes > 0
      ? `${plural(recap.episodes, "episode")}${hours} across ${plural(recap.shows, "show")}.`
      : "no new episodes logged.";
  const finished = recap.finished.length > 0 ? ` Finished ${titleList(recap.finished)}.` : "";
  return `This week: ${watched}${finished} ${yearLine(recap)}`;
}

/** The notification for a Sunday brief with only the recap. */
export function recapPushText(recap: BriefRecap): { title: string; body: string } {
  const finished = recap.finished.length > 0 ? `Finished ${titleList(recap.finished)}. ` : "";
  return {
    title: `Your week: ${plural(recap.episodes, "episode")}`,
    body: `${finished}${yearLine(recap)} Tap to open the chat.`,
  };
}
