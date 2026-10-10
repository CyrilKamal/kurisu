import type { ListEntry } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import {
  countMatches,
  DEFAULT_VIEW,
  facetOptions,
  isFiltered,
  listHref,
  matchesQuery,
  minutesLeft,
  readListView,
  visibleEntries,
  type ListView,
} from "../lib/listFilters";

function entry(animeId: number, fields: Partial<ListEntry> = {}): ListEntry {
  return {
    animeId,
    title: `Show ${String(animeId)}`,
    pictureUrl: null,
    mediaType: "tv",
    numEpisodes: 12,
    airingStatus: "finished_airing",
    altTitles: [],
    genres: [],
    episodeMinutes: 24,
    malMean: null,
    airing: null,
    status: "plan_to_watch",
    score: 0,
    episodesWatched: 0,
    isRewatching: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...fields,
  };
}

const view = (fields: Partial<ListView> = {}): ListView => ({ ...DEFAULT_VIEW, ...fields });

describe("readListView and listHref", () => {
  it("reads every filter and round-trips through the URL", () => {
    const read = readListView({
      status: "dropped",
      q: " frieren ",
      type: "movie",
      genre: "Slice of Life",
      airing: "currently_airing",
      sort: "mal",
    });
    expect(read).toEqual({
      status: "dropped",
      query: "frieren",
      type: "movie",
      genre: "Slice of Life",
      airing: "currently_airing",
      sort: "mal",
    });
    expect(
      readListView(Object.fromEntries(new URL(listHref(read), "http://x").searchParams)),
    ).toEqual(read);
  });

  it("falls back to the defaults for missing or unknown values", () => {
    expect(readListView({ status: "nope", sort: "nope", airing: "nope", q: "  " })).toEqual(
      DEFAULT_VIEW,
    );
    expect(readListView({ status: ["completed", "dropped"] }).status).toBe("completed");
  });

  it("leaves defaults out of the URL", () => {
    expect(listHref(DEFAULT_VIEW)).toBe("/list");
    expect(listHref(view({ status: "plan_to_watch", genre: "Slice of Life" }))).toBe(
      "/list?status=plan_to_watch&genre=Slice+of+Life",
    );
  });

  it("knows when the list is narrowed; sorting alone doesn't count", () => {
    expect(isFiltered(view({ sort: "title" }))).toBe(false);
    expect(isFiltered(view({ query: "  " }))).toBe(false);
    expect(isFiltered(view({ query: "x" }))).toBe(true);
    expect(isFiltered(view({ airing: "not_yet_aired" }))).toBe(true);
  });
});

describe("matchesQuery", () => {
  const frieren = entry(1, {
    title: "Sousou no Frieren",
    altTitles: ["Frieren: Beyond Journey's End"],
  });

  it("finds words in the title or any alternative title, in any case", () => {
    expect(matchesQuery(frieren, "frieren")).toBe(true);
    expect(matchesQuery(frieren, "SOUSOU")).toBe(true);
    expect(matchesQuery(frieren, "beyond journey")).toBe(true);
    expect(matchesQuery(frieren, "journey frieren")).toBe(true);
    expect(matchesQuery(frieren, "")).toBe(true);
  });

  it("needs every word in the same title", () => {
    expect(matchesQuery(frieren, "sousou journey")).toBe(false);
    expect(matchesQuery(frieren, "frieren mushishi")).toBe(false);
  });

  it("ignores punctuation, accents and spacing", () => {
    const rezero = entry(2, { title: "Re:Zero kara Hajimeru Isekai Seikatsu" });
    expect(matchesQuery(rezero, "re zero")).toBe(true);
    expect(matchesQuery(rezero, "rezero")).toBe(true);
    expect(matchesQuery(entry(3, { title: "Pokémon" }), "pokemon")).toBe(true);
  });
});

describe("visibleEntries", () => {
  const entries = [
    entry(1, { title: "Bocchi the Rock!", genres: ["Comedy", "Music"], malMean: 8.8 }),
    entry(2, { title: "Akira", mediaType: "movie", numEpisodes: 1, episodeMinutes: 124 }),
    entry(3, { title: "Mushishi", genres: ["Slice of Life"], malMean: 8.7, numEpisodes: 26 }),
    entry(4, { title: "Monster", status: "dropped", score: 6, episodesWatched: 10 }),
    entry(5, {
      title: "Look Back",
      mediaType: "movie",
      airingStatus: "not_yet_aired",
      numEpisodes: 1,
      episodeMinutes: 58,
    }),
  ];
  const titles = (v: ListView) => visibleEntries(entries, v).map((e) => e.title);

  it("shows one tab, in the server's order", () => {
    expect(titles(view({ status: "plan_to_watch" }))).toEqual([
      "Bocchi the Rock!",
      "Akira",
      "Mushishi",
      "Look Back",
    ]);
    expect(titles(view({ status: "dropped" }))).toEqual(["Monster"]);
  });

  it("combines filters within the tab", () => {
    expect(titles(view({ status: "plan_to_watch", type: "movie" }))).toEqual([
      "Akira",
      "Look Back",
    ]);
    expect(
      titles(view({ status: "plan_to_watch", type: "movie", airing: "finished_airing" })),
    ).toEqual(["Akira"]);
    expect(titles(view({ status: "plan_to_watch", genre: "Slice of Life" }))).toEqual(["Mushishi"]);
    expect(titles(view({ status: "dropped", query: "bocchi" }))).toEqual([]);
  });

  it("sorts by title, MAL score (unknown last) and shortest", () => {
    expect(titles(view({ status: "plan_to_watch", sort: "title" }))).toEqual([
      "Akira",
      "Bocchi the Rock!",
      "Look Back",
      "Mushishi",
    ]);
    expect(titles(view({ status: "plan_to_watch", sort: "mal" }))).toEqual([
      "Bocchi the Rock!",
      "Mushishi",
      "Akira",
      "Look Back",
    ]);
    expect(titles(view({ status: "plan_to_watch", sort: "shortest" }))).toEqual([
      "Look Back",
      "Akira",
      "Bocchi the Rock!",
      "Mushishi",
    ]);
  });

  it("sorts by your score with unscored shows last", () => {
    const scored = [
      entry(1, { status: "completed", score: 0, title: "Unscored" }),
      entry(2, { status: "completed", score: 7, title: "Seven" }),
      entry(3, { status: "completed", score: 10, title: "Ten" }),
    ];
    expect(
      visibleEntries(scored, view({ status: "completed", sort: "score" })).map((e) => e.title),
    ).toEqual(["Ten", "Seven", "Unscored"]);
  });
});

describe("minutesLeft", () => {
  it("counts what's left, a finished show in full, and nothing when unknown", () => {
    expect(minutesLeft(entry(1, { status: "watching", episodesWatched: 10 }))).toBe(48);
    expect(minutesLeft(entry(1, { status: "completed", episodesWatched: 12 }))).toBe(288);
    expect(minutesLeft(entry(1, { numEpisodes: null }))).toBeNull();
    expect(minutesLeft(entry(1, { episodeMinutes: null }))).toBeNull();
  });
});

describe("facetOptions and countMatches", () => {
  const entries = [
    entry(1, { genres: ["Comedy", "Music"] }),
    entry(2, { genres: ["Comedy"], mediaType: "movie" }),
    entry(3, { genres: ["Drama"], mediaType: "movie", status: "completed" }),
    entry(4, { genres: ["Comedy"], mediaType: "unknown", airingStatus: "currently_airing" }),
  ];

  it("lists each tab's genres by count, given the other filters", () => {
    expect(facetOptions(entries, view({ status: "plan_to_watch" }), "genre")).toEqual([
      { value: "Comedy", count: 3 },
      { value: "Music", count: 1 },
    ]);
    expect(
      facetOptions(entries, view({ status: "plan_to_watch", type: "movie" }), "genre"),
    ).toEqual([{ value: "Comedy", count: 1 }]);
  });

  it("ignores its own filter, keeps the current choice, and skips unknown types", () => {
    const filtered = view({ status: "plan_to_watch", type: "movie", genre: "Drama" });
    expect(facetOptions(entries, filtered, "genre")).toEqual([
      { value: "Comedy", count: 1 },
      { value: "Drama", count: 0 },
    ]);
    expect(facetOptions(entries, view({ status: "plan_to_watch" }), "type")).toEqual([
      { value: "movie", count: 1 },
      { value: "tv", count: 1 },
    ]);
    expect(facetOptions(entries, view({ status: "plan_to_watch" }), "airing")).toEqual([
      { value: "currently_airing", count: 1 },
      { value: "finished_airing", count: 2 },
    ]);
  });

  it("counts matches per tab", () => {
    expect(countMatches(entries, view({ type: "movie" }))).toEqual({
      watching: 0,
      completed: 1,
      on_hold: 0,
      dropped: 0,
      plan_to_watch: 1,
    });
  });
});
