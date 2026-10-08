import type { CatalogSearch } from "../agent/tools.js";
import { rememberShows } from "../anilist/catalog.js";
import { MAX_SEARCH_QUERIES } from "../anilist/client.js";
import type { Db } from "../db/client.js";
import { isSideStory, searchCatalog, searchMyList, type SearchCandidate } from "../list/search.js";
import { wordsInName } from "../list/grounding.js";
import { normalizeName } from "../list/seasons.js";
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
 * A score with no status means the show was watched (the user's rule), so a show that isn't on
 * the list, or sits at Plan to Watch on it, is marked Completed. An episode count of 0 next to
 * the score is a misread (watched none, yet rated it), so it's dropped.
 */
function scoreMeansWatched(notes: RequestedChange, entry: EntryState | null): RequestedChange {
  if (notes.score === undefined || notes.status !== undefined) return notes;
  if (notes.episodesWatched !== undefined && notes.episodesWatched !== 0) return notes;
  if (entry && (entry.status !== "plan_to_watch" || notes.isRewatching !== undefined)) return notes;
  return { status: "completed", score: notes.score };
}

/**
 * Why a reading contradicts itself, or null: a score or episodes watched for a show it would
 * leave at Plan to Watch, or a show it says is finished short of its last episode ("finished
 * ep 3" of 12 could mean up to ep 3). Such a row is never written from the review, so neither
 * half is guessed.
 */
function contradiction(
  notes: RequestedChange,
  after: { status: ListStatus; episodesWatched: number },
  total: number | null,
): string | null {
  if (after.status === "plan_to_watch") {
    if (notes.score !== undefined) return "The notes say plan to watch, but also give a score.";
    if ((notes.episodesWatched ?? 0) > 0) {
      return "The notes say plan to watch, but also give episodes watched.";
    }
  }
  const finishedAt = notes.status === "completed" ? notes.episodesWatched : undefined;
  if (after.status === "completed" && finishedAt !== undefined) {
    if (finishedAt === 0) return "The notes say finished, but with no episodes watched.";
    if (total !== null && finishedAt < total) {
      return `The notes say finished, but at ep ${String(finishedAt)} of ${String(total)}.`;
    }
  }
  return null;
}

function held(malState: ListState | null, note: string): Grouped {
  return { group: "disagree", malState, change: null, note, checked: false };
}

/**
 * Sorts a matched show into a group (the user's rules):
 * - a score with no status means it was watched: a show not on the list, or on Plan to Watch on
 *   it, is marked Completed.
 * - not on the list: an add, pre-checked.
 * - on the list, and the notes only move it forward: an update, pre-checked.
 * - on the list, and the notes would lower progress, change a finished show, contradict the
 *   status or replace a different score: a disagreement, which keeps MAL unless the user taps.
 * - a reading that contradicts itself (Plan to Watch with a score or episodes, finished short of
 *   the last episode): a disagreement with only a note, which nothing writes.
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
    const requested = scoreMeansWatched(rest, null);
    const added = addChange(numEpisodes, requested);
    if (!added.ok) return held(null, invalidNote(added.error, requested, numEpisodes));
    const after = {
      status: added.change.status ?? "plan_to_watch",
      episodesWatched: added.change.episodesWatched ?? 0,
    };
    const why = contradiction(requested, after, numEpisodes);
    if (why) return held(null, why);
    return { group: "add", malState: null, change: added.change, note: null, checked: true };
  }

  const malState = stateOf(entry);
  const read = scoreMeansWatched(notes, entry);
  const normalized = normalizeChange(entry, read);
  if (!normalized.ok) {
    return held(malState, invalidNote(normalized.error, read, entry.numEpisodes));
  }
  const change = normalized.change;
  if (Object.keys(change).length === 0) {
    return { group: "up_to_date", malState, change: null, note: null, checked: false };
  }
  const why = contradiction(
    read,
    {
      status: change.status ?? entry.status,
      episodesWatched: change.episodesWatched ?? entry.episodesWatched,
    },
    entry.numEpisodes,
  );
  if (why) return held(malState, why);
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

/**
 * A match from search results: clear only when the search's clear-match rule says so (grounded
 * in the user's words), and every word of the title as written is in the matched name.
 */
/** A name with a leading article dropped: "The Tatami Galaxy" and "tatami galaxy" are one name. */
function withoutArticle(name: string): string {
  return normalizeName(name).replace(/^(?:the|a|an) /, "");
}

/**
 * When nothing is clear, but exactly one candidate's name is the title (a leading "The" aside)
 * and every other candidate is a movie, special or OVA: it's that show ("tatami galaxy" is The
 * Tatami Galaxy, not its Specials). Seasons never count as side stories, so a title shared by
 * seasons still asks.
 */
function namedDespiteArticle(
  candidates: SearchCandidate<ListStatus | null>[],
  title: string,
): SearchCandidate<ListStatus | null> | null {
  const wanted = withoutArticle(title);
  const named = candidates.filter((c) =>
    [c.title, c.titleEn, c.matchedName].some((n) => n !== null && withoutArticle(n) === wanted),
  );
  const [only] = named;
  if (named.length !== 1 || !only || isSideStory(only)) return null;
  return candidates.every((c) => c === only || isSideStory(c)) ? only : null;
}

/** A bare number ending a title ("bsd 4", "clevatess 2"), which usually means the season. */
export function trailingNumber(title: string): number | null {
  const found = /^\D.*\s(\d{1,2})$/.exec(normalizeName(title));
  return found?.[1] ? Number(found[1]) : null;
}

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${String(n)}${suffix}`;
}

/** Whether a show's names already carry this number ("Mob Psycho 100", "Clevatess Season 2"). */
function namesHaveNumber(show: SearchCandidate<ListStatus | null>, n: number): boolean {
  const words = new Set(
    [show.title, show.titleEn, show.matchedName]
      .filter((name): name is string => name !== null)
      .flatMap((name) => normalizeName(name).split(" ")),
  );
  return words.has(String(n)) || words.has(ordinal(n));
}

export function decide(
  candidates: SearchCandidate<ListStatus | null>[],
  notes: RequestedChange,
  title: string,
): Match {
  const clear = candidates.filter(
    (c) =>
      c.clear &&
      wordsInName(title, c.matchedName) &&
      (c.clearBy === "unique" || (c.clearBy === "only_in_progress" && progressOnly(notes))),
  );
  const [only] = clear;
  if (clear.length === 1 && only) return { kind: "found", animeId: only.animeId };
  const named = clear.length === 0 ? namedDespiteArticle(candidates, title) : null;
  if (named) return { kind: "found", animeId: named.animeId };
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
/**
 * "bsd 4" named Bungou Stray Dogs by its nickname, and the 4 is the season: finds that season of
 * the same show on the list, by its own names ("Bungou Stray Dogs 4th Season"). Only an entry
 * named exactly that way counts; otherwise the user picks.
 */
async function thatSeason(
  db: Db,
  userId: string,
  show: SearchCandidate,
  season: number,
): Promise<Match> {
  const bases = [show.title, show.titleEn].filter((t): t is string => t !== null);
  const queries = bases.flatMap((base) => [
    `${base} ${String(season)}`,
    `${base} season ${String(season)}`,
    `${base} ${ordinal(season)} season`,
  ]);
  const found = await searchMyList(db, userId, queries, { limit: CANDIDATES });
  const clear = found.filter((c) => c.clear && c.animeId !== show.animeId);
  const [only] = clear;
  if (clear.length === 1 && only) return { kind: "found", animeId: only.animeId };
  const ids = [...new Set([show.animeId, ...found.map((c) => c.animeId)])];
  return { kind: "several", candidates: ids.slice(0, CANDIDATES) };
}

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
    let match = decide(onList, item.notes, item.title);
    const foundId = match.kind === "found" ? match.animeId : null;
    const show = foundId === null ? null : onList.find((c) => c.animeId === foundId);
    const season = trailingNumber(item.title);
    if (show && season !== null && !namesHaveNumber(show, season)) {
      match = await thatSeason(db, userId, show, season);
    }
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
      matches[i] = decide(candidates, item.notes, item.title);
    }
  }
  return matches;
}
