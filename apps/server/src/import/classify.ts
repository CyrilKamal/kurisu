import type { CatalogSearch } from "../agent/tools.js";
import { rememberShows } from "../anilist/catalog.js";
import { MAX_SEARCH_QUERIES } from "../anilist/client.js";
import type { Db } from "../db/client.js";
import { searchCatalog, searchMyList, type SearchCandidate } from "../list/search.js";
import {
  normalizeChange,
  type EntryState,
  type ListChange,
  type ListState,
  type ListStatus,
  type RequestedChange,
} from "../writes/normalize.js";
import { addChange } from "../writes/propose.js";
import type { ParsedItem } from "./parse.js";

/** The review screen's groups. */
export type ImportGroup =
  "add" | "update" | "up_to_date" | "disagree" | "which_one" | "not_found" | "not_a_show";

/** Which show a line means: one clearly, several it could be, or none found. */
export type Match =
  { kind: "found"; animeId: number } | { kind: "several"; candidates: number[] } | { kind: "none" };

/** What the import will do with one item, before the user's review. */
export interface Grouped {
  group: ImportGroup;
  /** The list entry when grouped, for the review and to catch changes before a run. */
  malState: ListState | null;
  /** What will be written: the change, or for a disagreement the notes' version. */
  change: ListChange | null;
  /** Why a row can't be used as the notes say, e.g. "the notes say ep 40; it has 28". */
  note: string | null;
  /** Adds and clear updates start checked; nothing else does. */
  checked: boolean;
}

const CANDIDATES = 5;

/**
 * Whether going from one status to another is plainly moving forward: starting, pausing,
 * finishing or dropping a planned show, finishing one in progress, or picking a paused one back
 * up. Anything else (dropping a show being watched, going back to Plan to Watch) could be old
 * notes, so the user decides.
 */
function isForward(from: ListStatus, to: ListStatus): boolean {
  if (from === to || from === "plan_to_watch") return true;
  if ((from === "watching" || from === "on_hold") && to === "completed") return true;
  return from === "on_hold" && to === "watching";
}

function stateOf(entry: EntryState): ListState {
  return {
    status: entry.status,
    episodesWatched: entry.episodesWatched,
    score: entry.score,
    isRewatching: entry.isRewatching,
  };
}

function invalidNote(error: string, notes: RequestedChange, total: number | null): string {
  if (error === "episodes_exceed_total" && total !== null) {
    return `The notes say ep ${String(notes.episodesWatched ?? "?")}, but it has ${String(total)}.`;
  }
  if (error === "rewatch_not_completed") return "The notes say rewatching, but it isn't completed.";
  return "The notes don't fit this show.";
}

/**
 * Sorts a matched show into a group (the user's rules):
 * - not on the list: an add, pre-checked. A score with no status means it was watched, so it's
 *   added as Completed.
 * - on the list, and the notes only move it forward: an update, pre-checked.
 * - on the list, and the notes would lower progress, change a finished show, contradict the
 *   status or replace a different score: a disagreement, which keeps MAL unless the user taps.
 * - nothing to change: already up to date.
 */
export function groupMatched(
  notes: RequestedChange,
  numEpisodes: number | null,
  entry: EntryState | null,
): Grouped {
  if (!entry) {
    // Rewatching only applies to a show already completed on the list.
    const rest: RequestedChange = {
      ...(notes.status !== undefined && { status: notes.status }),
      ...(notes.episodesWatched !== undefined && { episodesWatched: notes.episodesWatched }),
      ...(notes.score !== undefined && { score: notes.score }),
    };
    const requested: RequestedChange =
      rest.status === undefined && rest.score !== undefined && rest.episodesWatched === undefined
        ? { ...rest, status: "completed" }
        : rest;
    const added = addChange(numEpisodes, requested);
    if (!added.ok) {
      return {
        group: "disagree",
        malState: null,
        change: null,
        note: invalidNote(added.error, notes, numEpisodes),
        checked: false,
      };
    }
    return { group: "add", malState: null, change: added.change, note: null, checked: true };
  }

  const malState = stateOf(entry);
  const normalized = normalizeChange(entry, notes);
  if (!normalized.ok) {
    return {
      group: "disagree",
      malState,
      change: null,
      note: invalidNote(normalized.error, notes, entry.numEpisodes),
      checked: false,
    };
  }
  const change = normalized.change;
  if (Object.keys(change).length === 0) {
    return { group: "up_to_date", malState, change: null, note: null, checked: false };
  }
  const lowersProgress =
    change.episodesWatched !== undefined && change.episodesWatched < entry.episodesWatched;
  const changesFinished =
    entry.status === "completed" &&
    (change.status !== undefined ||
      change.episodesWatched !== undefined ||
      change.isRewatching !== undefined);
  const contradicts = change.status !== undefined && !isForward(entry.status, change.status);
  const rescores = change.score !== undefined && entry.score > 0;
  if (lowersProgress || changesFinished || contradicts || rescores) {
    return { group: "disagree", malState, change, note: null, checked: false };
  }
  return { group: "update", malState, change, note: null, checked: true };
}

/**
 * Whether the notes only move a show forward in episodes, the one kind of change the
 * "only the one in progress" match is clear enough for (see clearBy in list/search.ts).
 */
function progressOnly(notes: RequestedChange): boolean {
  return (
    notes.episodesWatched !== undefined &&
    notes.score === undefined &&
    notes.isRewatching === undefined &&
    (notes.status === undefined || notes.status === "watching" || notes.status === "completed")
  );
}

/** A match from search results: clear only when the user's words name the show. */
export function decide(
  candidates: SearchCandidate<ListStatus | null>[],
  notes: RequestedChange,
): Match {
  const clear = candidates.filter(
    (c) =>
      c.clear &&
      (c.clearBy === "unique" || (c.clearBy === "only_in_progress" && progressOnly(notes))),
  );
  const [only] = clear;
  if (clear.length === 1 && only) return { kind: "found", animeId: only.animeId };
  if (candidates.length > 0) {
    return { kind: "several", candidates: candidates.slice(0, CANDIDATES).map((c) => c.animeId) };
  }
  return { kind: "none" };
}

/**
 * Finds the show each item means: on the user's list first (no outside calls), then on AniList
 * for the rest, a few titles per request. Each search is grounded in that line's own words, so
 * a match is clear only when the user's words name the show (list/grounding.ts).
 */
export async function matchItems(
  deps: { db: Db; userId: string; catalog: CatalogSearch | null },
  items: ParsedItem[],
): Promise<Match[]> {
  const { db, userId } = deps;
  const matches: Match[] = items.map(() => ({ kind: "none" }));
  const unresolved: number[] = [];

  for (const [i, item] of items.entries()) {
    if (!item.title) continue;
    const words = { userText: item.said, groundIn: [item.said] };
    const onList = await searchMyList(db, userId, [item.title], { limit: CANDIDATES, ...words });
    const match = decide(onList, item.notes);
    matches[i] = match;
    if (match.kind !== "found") unresolved.push(i);
  }

  const catalog = deps.catalog;
  if (!catalog) return matches;
  for (let start = 0; start < unresolved.length; start += MAX_SEARCH_QUERIES) {
    const batch = unresolved.slice(start, start + MAX_SEARCH_QUERIES);
    const titles = batch.flatMap((i) => (items[i]?.title ? [items[i].title] : []));
    let shows;
    try {
      shows = await rememberShows(db, await catalog(titles));
    } catch {
      // AniList unavailable: these keep whatever the list search found.
      continue;
    }
    const found = shows.map((s) => s.malId);
    for (const i of batch) {
      const item = items[i];
      if (!item?.title) continue;
      const onList = await searchMyList(db, userId, [item.title], { limit: CANDIDATES });
      const candidates = await searchCatalog(
        db,
        userId,
        [...new Set([...onList.map((c) => c.animeId), ...found])],
        [item.title],
        {
          limit: CANDIDATES,
          userText: item.said,
          groundIn: [item.said],
          sideStoriesDontCount: true,
        },
      );
      matches[i] = decide(candidates, item.notes);
    }
  }
  return matches;
}
