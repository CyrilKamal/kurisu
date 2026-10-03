import type { MAL_LIST_STATUSES } from "../mal/client.js";

/**
 * Deterministic rules that turn what the user asked for into the exact list-status change to
 * write. propose_update applies them to every proposal, and the eval harness applies them to
 * expected writes, so a test case only has to state what the user meant.
 *
 * Rules:
 * - Reaching the final episode (when the total is known) completes the show and ends a rewatch.
 * - Setting status to completed without an episode count fills in the total, when known.
 * - Progress on a plan_to_watch or on_hold show moves it to watching.
 * - A dropped show stays dropped unless the status is set explicitly.
 * - Rewatching only applies to a completed show.
 * - Fields already at the requested value are left out, so the result is only real changes.
 */

export type ListStatus = (typeof MAL_LIST_STATUSES)[number];

/** The parts of a list entry the rules look at. */
export interface EntryState {
  status: ListStatus;
  episodesWatched: number;
  /** Null when MAL doesn't know the episode count yet. */
  numEpisodes: number | null;
  isRewatching: boolean;
  score: number;
}

/** What was asked for. Every field is optional; at least one should be set. */
export interface RequestedChange {
  status?: ListStatus;
  episodesWatched?: number;
  score?: number;
  isRewatching?: boolean;
}

/** The four list fields a proposal can change, as they stand. */
export type ListState = Pick<EntryState, "status" | "episodesWatched" | "score" | "isRewatching">;

export type ListChange = Partial<
  Pick<EntryState, "status" | "episodesWatched" | "score" | "isRewatching">
>;

export type NormalizeResult =
  | { ok: true; change: ListChange }
  | {
      ok: false;
      error:
        | "episodes_exceed_total"
        | "negative_episodes"
        | "score_out_of_range"
        | "rewatch_not_completed";
    };

export function normalizeChange(entry: EntryState, requested: RequestedChange): NormalizeResult {
  const total = entry.numEpisodes;
  let episodes = requested.episodesWatched ?? entry.episodesWatched;
  let status = requested.status ?? entry.status;
  let isRewatching = requested.isRewatching ?? entry.isRewatching;
  const score = requested.score ?? entry.score;

  if (episodes < 0) return { ok: false, error: "negative_episodes" };
  if (total !== null && episodes > total) return { ok: false, error: "episodes_exceed_total" };
  if (score < 0 || score > 10 || !Number.isInteger(score)) {
    return { ok: false, error: "score_out_of_range" };
  }

  const episodesChanged = episodes !== entry.episodesWatched;

  if (
    requested.status === "completed" &&
    requested.episodesWatched === undefined &&
    total !== null
  ) {
    episodes = total;
  }

  if (requested.status === undefined && episodesChanged) {
    const finished = total !== null && episodes === total;
    if (finished && status !== "dropped") {
      status = "completed";
    } else if (
      (status === "plan_to_watch" || status === "on_hold") &&
      episodes > entry.episodesWatched
    ) {
      status = "watching";
    }
  }

  // A rewatch is of a show already completed (MAL keeps it completed while rewatching).
  // Starting one on a show not finished is a misread, e.g. "start it again" after a pause.
  if (requested.isRewatching === true && status !== "completed") {
    return { ok: false, error: "rewatch_not_completed" };
  }

  // Finishing the last episode of a rewatch ends the rewatch.
  if (isRewatching && total !== null && episodes === total && requested.isRewatching !== true) {
    isRewatching = false;
  }

  const change: ListChange = {};
  if (status !== entry.status) change.status = status;
  if (episodes !== entry.episodesWatched) change.episodesWatched = episodes;
  if (score !== entry.score) change.score = score;
  if (isRewatching !== entry.isRewatching) change.isRewatching = isRewatching;
  return { ok: true, change };
}
