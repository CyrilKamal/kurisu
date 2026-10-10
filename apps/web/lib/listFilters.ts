import { LIST_STATUSES, type ListEntry, type ListStatus } from "@kurisu/shared";

import { countByStatus } from "./format";

/**
 * What the List screen shows: one status tab, narrowed by a title search, type, genre and
 * airing state, in some order. Filters stay set when you switch tabs, and live in the URL so a
 * reload keeps them.
 */
export interface ListView {
  status: ListStatus;
  /** Words to find in the title, English title or synonyms. */
  query: string;
  /** A MAL media type such as "tv" or "movie". */
  type: string | null;
  genre: string | null;
  airing: AiringFilter | null;
  sort: ListSort;
  /** Rows, or a grid of posters. */
  layout: ListLayout;
}

export const LIST_LAYOUTS = ["rows", "grid"] as const;
export type ListLayout = (typeof LIST_LAYOUTS)[number];

export const LIST_SORTS = ["updated", "title", "score", "mal", "shortest"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const SORT_LABELS: Record<ListSort, string> = {
  updated: "Recently updated",
  title: "Title",
  score: "Your score",
  mal: "MAL score",
  shortest: "Shortest",
};

export const AIRING_FILTERS = ["currently_airing", "finished_airing", "not_yet_aired"] as const;
export type AiringFilter = (typeof AIRING_FILTERS)[number];

export const AIRING_LABELS: Record<AiringFilter, string> = {
  currently_airing: "Airing now",
  finished_airing: "Finished airing",
  not_yet_aired: "Not aired yet",
};

export const DEFAULT_VIEW: ListView = {
  status: "watching",
  query: "",
  type: null,
  genre: null,
  airing: null,
  sort: "updated",
  layout: "rows",
};

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, name: string): string | null {
  const value = params[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

/** Reads a view from the page's search params; anything unknown falls back to the default. */
export function readListView(params: Params): ListView {
  return {
    status: oneOf(LIST_STATUSES, one(params, "status")) ?? DEFAULT_VIEW.status,
    query: one(params, "q") ?? "",
    type: one(params, "type"),
    genre: one(params, "genre"),
    airing: oneOf(AIRING_FILTERS, one(params, "airing")),
    sort: oneOf(LIST_SORTS, one(params, "sort")) ?? DEFAULT_VIEW.sort,
    layout: oneOf(LIST_LAYOUTS, one(params, "layout")) ?? DEFAULT_VIEW.layout,
  };
}

/** The URL for a view, leaving out what's at its default: "/list?status=dropped&q=frieren". */
export function listHref(view: ListView): string {
  const params = new URLSearchParams();
  if (view.status !== DEFAULT_VIEW.status) params.set("status", view.status);
  if (view.query.trim()) params.set("q", view.query.trim());
  if (view.type) params.set("type", view.type);
  if (view.genre) params.set("genre", view.genre);
  if (view.airing) params.set("airing", view.airing);
  if (view.sort !== DEFAULT_VIEW.sort) params.set("sort", view.sort);
  if (view.layout !== DEFAULT_VIEW.layout) params.set("layout", view.layout);
  const search = params.toString();
  return search ? `/list?${search}` : "/list";
}

/** Whether anything narrows the list beyond its status tab. */
export function isFiltered(view: ListView): boolean {
  return (
    view.query.trim() !== "" || view.type !== null || view.genre !== null || view.airing !== null
  );
}

export function clearFilters(view: ListView): ListView {
  return { ...view, query: "", type: null, genre: null, airing: null };
}

/** Lowercase letters and digits only, accents dropped: "Re:Zero" -> "re zero". */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether every word of the query appears in one of the entry's titles. Spacing doesn't matter
 * either: "rezero" finds "Re:Zero".
 */
export function matchesQuery(
  entry: Pick<ListEntry, "title" | "altTitles">,
  query: string,
): boolean {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  return [entry.title, ...entry.altTitles].some((title) => {
    const name = normalize(title);
    return (
      words.every((word) => name.includes(word)) ||
      name.replaceAll(" ", "").includes(words.join(""))
    );
  });
}

type Facet = "type" | "genre" | "airing";

/** Whether an entry passes the view's filters (not its status), ignoring one facet if asked. */
export function matchesFilters(entry: ListEntry, view: ListView, ignoring?: Facet): boolean {
  return (
    matchesQuery(entry, view.query) &&
    (ignoring === "type" || view.type === null || entry.mediaType === view.type) &&
    (ignoring === "genre" || view.genre === null || entry.genres.includes(view.genre)) &&
    (ignoring === "airing" || view.airing === null || entry.airingStatus === view.airing)
  );
}

/** Minutes it takes to watch what's left; a finished show counts in full. Null when unknown. */
export function minutesLeft(entry: ListEntry): number | null {
  if (entry.numEpisodes === null || entry.episodeMinutes === null) return null;
  const episodes =
    entry.status === "completed"
      ? entry.numEpisodes
      : Math.max(0, entry.numEpisodes - entry.episodesWatched);
  return episodes * entry.episodeMinutes;
}

/** Sorts a copy. Ties, and "Recently updated", keep the server's order: newest update first. */
export function sortEntries(entries: ListEntry[], sort: ListSort): ListEntry[] {
  const sorted = [...entries];
  switch (sort) {
    case "updated":
      return sorted;
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
    case "score":
      // Unscored (0) last.
      return sorted.sort((a, b) => (b.score || -1) - (a.score || -1));
    case "mal":
      return sorted.sort((a, b) => (b.malMean ?? -1) - (a.malMean ?? -1));
    case "shortest":
      return sorted.sort((a, b) => (minutesLeft(a) ?? Infinity) - (minutesLeft(b) ?? Infinity));
  }
}

/** The entries one view shows, in order. */
export function visibleEntries(entries: ListEntry[], view: ListView): ListEntry[] {
  return sortEntries(
    entries.filter((entry) => entry.status === view.status && matchesFilters(entry, view)),
    view.sort,
  );
}

export interface FacetOption {
  value: string;
  count: number;
}

/**
 * The choices for one filter on the current tab, with how many entries each would show given
 * the other filters. The current choice stays listed even when nothing matches it.
 */
export function facetOptions(entries: ListEntry[], view: ListView, facet: Facet): FacetOption[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== view.status || !matchesFilters(entry, view, facet)) continue;
    const values =
      facet === "genre"
        ? entry.genres
        : facet === "type"
          ? [entry.mediaType]
          : [oneOf(AIRING_FILTERS, entry.airingStatus)];
    for (const value of values) {
      if (value && value !== "unknown") counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const selected = view[facet];
  if (selected !== null && !counts.has(selected)) counts.set(selected, 0);

  const options = [...counts].map(([value, count]) => ({ value, count }));
  if (facet === "airing") {
    // Airing states read best in their natural order.
    return options.sort(
      (a, b) =>
        AIRING_FILTERS.indexOf(a.value as AiringFilter) -
        AIRING_FILTERS.indexOf(b.value as AiringFilter),
    );
  }
  return options.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** How many entries each tab would show with the view's filters. */
export function countMatches(entries: ListEntry[], view: ListView): Record<ListStatus, number> {
  return countByStatus(entries.filter((entry) => matchesFilters(entry, view)));
}
