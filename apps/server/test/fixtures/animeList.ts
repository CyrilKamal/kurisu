import type { FakeListItem } from "../support/fakeMal.js";

/**
 * A small synthetic MAL anime list. Titles, IDs and progress are made up; no real user's list
 * data lives in this repo. Covers every list status and MAL's awkward cases: unknown episode
 * counts (0), missing pictures, partial dates and rewatching.
 */
export function fixtureList(): FakeListItem[] {
  return [
    item(900001, "Fixture Watching Show", "watching", {
      alt: { synonyms: ["FWS"], en: "The Watching Show", ja: "" },
      num_episodes: 12,
      num_episodes_watched: 7,
      updated_at: "2026-09-28T10:00:00+00:00",
      start_date: "2026-09-01",
    }),
    item(900002, "Fixture Completed Film", "completed", {
      media_type: "movie",
      num_episodes: 1,
      num_episodes_watched: 1,
      score: 9,
      updated_at: "2026-08-15T12:30:00+00:00",
      start_date: "2026-08",
      finish_date: "2026-08-15",
    }),
    item(900003, "Fixture Paused Show", "on_hold", {
      num_episodes: 24,
      num_episodes_watched: 10,
      score: 6,
      updated_at: "2026-07-01T08:00:00+00:00",
    }),
    item(900004, "Fixture Dropped Show", "dropped", {
      num_episodes: 13,
      num_episodes_watched: 2,
      score: 3,
      updated_at: "2026-06-10T20:00:00+00:00",
    }),
    item(900005, "Fixture Unannounced Sequel", "plan_to_watch", {
      num_episodes: 0, // MAL reports 0 when the count isn't known yet
      airing: "not_yet_aired",
      picture: false,
      updated_at: "2026-05-05T05:05:00+00:00",
    }),
    item(900006, "Fixture Rewatch Show", "completed", {
      num_episodes: 26,
      num_episodes_watched: 26,
      score: 10,
      is_rewatching: true,
      updated_at: "2026-09-20T18:45:00+00:00",
    }),
  ];
}

function item(
  id: number,
  title: string,
  status: FakeListItem["list_status"]["status"],
  opts: {
    media_type?: string;
    num_episodes: number;
    num_episodes_watched?: number;
    score?: number;
    is_rewatching?: boolean;
    airing?: string;
    picture?: boolean;
    alt?: { synonyms: string[]; en: string; ja: string };
    updated_at: string;
    start_date?: string;
    finish_date?: string;
  },
): FakeListItem {
  return {
    node: {
      id,
      title,
      ...(opts.picture === false
        ? {}
        : {
            main_picture: {
              medium: `https://cdn.myanimelist.net/images/anime/0/${String(id)}.jpg`,
              large: `https://cdn.myanimelist.net/images/anime/0/${String(id)}l.jpg`,
            },
          }),
      media_type: opts.media_type ?? "tv",
      num_episodes: opts.num_episodes,
      status: opts.airing ?? "finished_airing",
      ...(opts.alt ? { alternative_titles: opts.alt } : {}),
    },
    list_status: {
      status,
      score: opts.score ?? 0,
      num_episodes_watched: opts.num_episodes_watched ?? 0,
      is_rewatching: opts.is_rewatching ?? false,
      updated_at: opts.updated_at,
      ...(opts.start_date ? { start_date: opts.start_date } : {}),
      ...(opts.finish_date ? { finish_date: opts.finish_date } : {}),
    },
  };
}
