import type { ChartShow, ScheduleEpisode } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import {
  airTime,
  chartGenres,
  episodeLabel,
  chartMeta,
  chartShows,
  isMine,
  NO_CHART_FILTERS,
  scheduleDays,
  scheduleGenres,
  seasonYears,
  sortDay,
} from "../lib/browse";

const episode = (overrides: Partial<ScheduleEpisode>): ScheduleEpisode => ({
  animeId: 1,
  title: "Show",
  pictureUrl: null,
  mediaType: "tv",
  episode: 1,
  airingAt: "2026-10-19T12:00:00.000Z",
  popularity: null,
  genres: [],
  entry: null,
  watchOn: [],
  ...overrides,
});

const show = (overrides: Partial<ChartShow>): ChartShow => ({
  animeId: 1,
  title: "Show",
  pictureUrl: null,
  mediaType: "tv",
  numEpisodes: 12,
  episodeMinutes: 24,
  genres: [],
  score: null,
  popularity: null,
  startDate: null,
  airingStatus: null,
  entry: null,
  ...overrides,
});

describe("the schedule", () => {
  // 2026-10-19 21:00 in Los Angeles is already the 20th in UTC.
  const now = new Date("2026-10-20T04:00:00Z");
  const tz = "America/Los_Angeles";

  it("groups episodes by the user's own days, from today on", () => {
    const days = scheduleDays(
      [
        episode({ animeId: 1, airingAt: "2026-10-19T05:00:00Z" }), // the 18th there: gone
        episode({ animeId: 2, airingAt: "2026-10-20T05:30:00Z" }), // the 19th, 10:30 PM
        episode({ animeId: 3, airingAt: "2026-10-20T16:00:00Z" }), // the 20th
        episode({ animeId: 4, airingAt: "2026-10-22T16:00:00Z" }), // the 22nd
      ],
      tz,
      now,
    );
    expect(days.map((d) => [d.date, d.label, d.episodes.map((e) => e.animeId)])).toEqual([
      ["2026-10-19", "Today", [2]],
      ["2026-10-20", "Tomorrow", [3]],
      ["2026-10-22", "Thursday, Oct 22", [4]],
    ]);
    expect(airTime("2026-10-20T05:30:00Z", tz)).toBe("10:30 PM");
  });

  it("folds a show's episodes that come out at once into one row", () => {
    const at = "2026-10-20T14:05:00Z";
    const [day] = scheduleDays(
      [
        episode({ animeId: 7, episode: 1, airingAt: at }),
        episode({ animeId: 7, episode: 2, airingAt: at }),
        episode({ animeId: 7, episode: 3, airingAt: at }),
        episode({ animeId: 8, episode: 4, airingAt: at }),
      ],
      tz,
      now,
    );
    expect(day?.episodes.map((row) => [row.animeId, episodeLabel(row)])).toEqual([
      [7, "eps 1–3"],
      [8, "ep 4"],
    ]);
  });

  it("counts any show on the list as the user's, but not a dropped one", () => {
    expect(isMine(episode({ entry: { status: "plan_to_watch", episodesWatched: 0 } }))).toBe(true);
    expect(isMine(episode({ entry: { status: "dropped", episodesWatched: 2 } }))).toBe(false);
    expect(isMine(episode({ entry: null }))).toBe(false);
  });
});

describe("a season chart", () => {
  const shows = [
    show({ animeId: 1, genres: ["Action"], score: 7.5, startDate: "2027-01-09" }),
    show({ animeId: 2, mediaType: "movie", genres: ["Drama"], score: 8.8, startDate: "2027-02" }),
    show({ animeId: 3, genres: ["Action", "Comedy"], score: null, startDate: "2027-01-05" }),
    show({ animeId: 4, genres: ["Action"], entry: { status: "watching", episodesWatched: 1 } }),
  ];
  const ids = (list: ChartShow[]) => list.map((s) => s.animeId);

  it("keeps the chart's order, or sorts by score or start, unknowns last", () => {
    expect(ids(chartShows(shows, NO_CHART_FILTERS))).toEqual([1, 2, 3, 4]);
    expect(ids(chartShows(shows, { ...NO_CHART_FILTERS, sort: "score" }))).toEqual([2, 1, 3, 4]);
    expect(ids(chartShows(shows, { ...NO_CHART_FILTERS, sort: "start" }))).toEqual([3, 1, 2, 4]);
  });

  it("filters by kind, genre and what's already on the list", () => {
    expect(ids(chartShows(shows, { ...NO_CHART_FILTERS, format: "movie" }))).toEqual([2]);
    expect(ids(chartShows(shows, { ...NO_CHART_FILTERS, genre: "Action" }))).toEqual([1, 3, 4]);
    expect(ids(chartShows(shows, { ...NO_CHART_FILTERS, hideMine: true }))).toEqual([1, 2, 3]);
    expect(chartGenres(shows)).toEqual(["Action", "Comedy", "Drama"]);
  });

  it("says what each show is in a line", () => {
    expect(chartMeta(show({ numEpisodes: 12, startDate: "2027-01-09" }))).toBe(
      "TV · 12 eps · Jan 9",
    );
    expect(chartMeta(show({ mediaType: "movie", numEpisodes: 1, startDate: null }))).toBe(
      "Movie · 1 ep",
    );
  });
});

describe("the schedule's filters", () => {
  it("lists the week's genres by how many shows have them, each show once", () => {
    expect(
      scheduleGenres([
        episode({ animeId: 1, episode: 1, genres: ["Action", "Comedy"] }),
        episode({ animeId: 1, episode: 2, genres: ["Action", "Comedy"] }),
        episode({ animeId: 2, genres: ["Comedy"] }),
      ]),
    ).toEqual(["Comedy", "Action"]);
  });

  it("orders a day by time, or the most popular first", () => {
    const rows = [
      {
        ...episode({ animeId: 1, popularity: 10, airingAt: "2026-10-19T09:00:00.000Z" }),
        lastEpisode: 1,
      },
      {
        ...episode({ animeId: 2, popularity: null, airingAt: "2026-10-19T08:00:00.000Z" }),
        lastEpisode: 1,
      },
      {
        ...episode({ animeId: 3, popularity: 90, airingAt: "2026-10-19T10:00:00.000Z" }),
        lastEpisode: 1,
      },
    ];
    expect(sortDay(rows, "time").map((r) => r.animeId)).toEqual([1, 2, 3]);
    expect(sortDay(rows, "popularity").map((r) => r.animeId)).toEqual([3, 1, 2]);
  });

  it("offers each season's years back to 1960, never past next season", () => {
    const winters = seasonYears("WINTER", "2027-WINTER");
    expect(winters[0]).toBe(2027);
    expect(winters.at(-1)).toBe(1960);
    expect(winters).toHaveLength(68);
    expect(seasonYears("FALL", "2027-WINTER")[0]).toBe(2026);
    expect(seasonYears("SPRING", "2026-SUMMER")[0]).toBe(2026);
  });
});
