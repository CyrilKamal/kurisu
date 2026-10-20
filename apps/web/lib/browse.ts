import type { ChartShow, ScheduleEpisode } from "@kurisu/shared";

import { mediaTypeLabel } from "./format";
import { shortDate } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-10-21": the day a time falls on in a time zone. */
export function localDay(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** "6:30 PM" in a time zone. */
export function airTime(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(at),
  );
}

/** A row on the Schedule: one episode, or a run of a show's episodes out at once. */
export interface ScheduleRow extends ScheduleEpisode {
  /** The run's last episode; `episode` when it's one. */
  lastEpisode: number;
}

export interface ScheduleDay {
  date: string;
  /** "Today", "Tomorrow", then "Wednesday, Oct 21". */
  label: string;
  episodes: ScheduleRow[];
}

/**
 * A show's episodes that air at the same moment (a whole season out at once) as one row,
 * "eps 1–10"; everything else as it was.
 */
export function foldReleases(episodes: ScheduleEpisode[]): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const byRelease = new Map<string, ScheduleRow>();
  for (const episode of episodes) {
    const key = `${String(episode.animeId)}@${episode.airingAt}`;
    const row = byRelease.get(key);
    if (row) {
      row.episode = Math.min(row.episode, episode.episode);
      row.lastEpisode = Math.max(row.lastEpisode, episode.episode);
      continue;
    }
    const added = { ...episode, lastEpisode: episode.episode };
    byRelease.set(key, added);
    rows.push(added);
  }
  return rows;
}

/** "ep 8", or "eps 1–10" for a run. */
export function episodeLabel(row: ScheduleRow): string {
  return row.lastEpisode > row.episode
    ? `eps ${String(row.episode)}–${String(row.lastEpisode)}`
    : `ep ${String(row.episode)}`;
}

/** The schedule by day in the user's time zone, from today on, soonest first. */
export function scheduleDays(
  episodes: ScheduleEpisode[],
  timeZone: string,
  now: Date = new Date(),
): ScheduleDay[] {
  const today = localDay(now, timeZone);
  const tomorrow = localDay(new Date(now.getTime() + DAY_MS), timeZone);
  const days = new Map<string, ScheduleEpisode[]>();
  for (const episode of episodes) {
    const day = localDay(episode.airingAt, timeZone);
    if (day < today) continue;
    days.set(day, [...(days.get(day) ?? []), episode]);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      label:
        date === today
          ? "Today"
          : date === tomorrow
            ? "Tomorrow"
            : new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
                timeZone,
              }).format(new Date(list[0]?.airingAt ?? now)),
      episodes: foldReleases(list),
    }));
}

/** "My shows": anything on the list except what was dropped. */
export function isMine(episode: Pick<ScheduleEpisode, "entry">): boolean {
  return episode.entry !== null && episode.entry.status !== "dropped";
}

export const CHART_SORTS = ["popularity", "score", "start"] as const;
export type ChartSort = (typeof CHART_SORTS)[number];
export const CHART_SORT_LABELS: Record<ChartSort, string> = {
  popularity: "Most popular",
  score: "Highest scored",
  start: "Starting soonest",
};

/** The kinds of show a chart has, in MAL's words, in the order people look for them. */
export const CHART_FORMATS = ["tv", "ona", "movie", "ova"] as const;

export interface ChartFilters {
  format: string | null;
  genre: string | null;
  sort: ChartSort;
  hideMine: boolean;
}

export const NO_CHART_FILTERS: ChartFilters = {
  format: null,
  genre: null,
  sort: "popularity",
  hideMine: false,
};

/**
 * A chart's shows as filtered and sorted. The chart comes most popular first, so that order
 * breaks ties; shows with no score or start date go last.
 */
export function chartShows(shows: ChartShow[], filters: ChartFilters): ChartShow[] {
  const kept = shows
    .map((show, rank) => ({ show, rank }))
    .filter(
      ({ show }) =>
        (filters.format === null || show.mediaType === filters.format) &&
        (filters.genre === null || show.genres.includes(filters.genre)) &&
        (!filters.hideMine || show.entry === null),
    );
  const by = {
    popularity: () => 0,
    score: (a: ChartShow, b: ChartShow) => (b.score ?? -1) - (a.score ?? -1),
    start: (a: ChartShow, b: ChartShow) =>
      (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"),
  }[filters.sort];
  return kept.sort((a, b) => by(a.show, b.show) || a.rank - b.rank).map(({ show }) => show);
}

/** A chart's genres, the most common first. */
export function chartGenres(shows: ChartShow[]): string[] {
  const counts = new Map<string, number>();
  for (const show of shows) {
    for (const genre of show.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([genre]) => genre);
}

/** "TV · 12 eps · Jan 9". */
export function chartMeta(show: ChartShow): string {
  return [
    mediaTypeLabel(show.mediaType),
    show.numEpisodes === null
      ? null
      : `${String(show.numEpisodes)} ${show.numEpisodes === 1 ? "ep" : "eps"}`,
    show.startDate === null ? null : shortDate(show.startDate),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

const SEASON_ORDER = ["WINTER", "SPRING", "SUMMER", "FALL"];

/**
 * The years Browse's Seasons offers for one season of the year, newest first: back to 1960, and
 * forward only as far as next season ("2027-WINTER"), so Fall 2027 isn't offered in Winter 2027.
 */
export function seasonYears(season: string, latest: string): number[] {
  const [yearText = "", latestSeason = "WINTER"] = latest.split("-");
  const lastYear =
    SEASON_ORDER.indexOf(season) <= SEASON_ORDER.indexOf(latestSeason)
      ? Number(yearText)
      : Number(yearText) - 1;
  return Array.from({ length: Math.max(0, lastYear - 1960 + 1) }, (_, i) => lastYear - i);
}

/** How the Schedule orders each day: by air time, or the most popular first. */
export const SCHEDULE_SORTS = ["time", "popularity"] as const;
export type ScheduleSort = (typeof SCHEDULE_SORTS)[number];
export const SCHEDULE_SORT_LABELS: Record<ScheduleSort, string> = {
  time: "By time",
  popularity: "Most popular",
};

/** The genres the week's episodes have, the most common first. */
export function scheduleGenres(episodes: ScheduleEpisode[]): string[] {
  const counts = new Map<string, number>();
  for (const show of new Map(episodes.map((e) => [e.animeId, e])).values()) {
    for (const genre of show.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([genre]) => genre);
}

/** A day's rows in the chosen order; popularity unknown goes last, ties by time. */
export function sortDay(rows: ScheduleRow[], sort: ScheduleSort): ScheduleRow[] {
  if (sort === "time") return rows;
  return [...rows].sort(
    (a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || a.airingAt.localeCompare(b.airingAt),
  );
}
