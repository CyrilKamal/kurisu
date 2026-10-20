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
 *
 * MAL's other list fields (comments, tags, priority, times rewatched) are only ever set by the
 * user on the List screen, and no rule touches them: they're checked and passed through. One the
 * mirror doesn't know (MAL didn't send it) can't be changed, so kurisu never overwrites a value it
 * hasn't seen.
 */

export type ListStatus = (typeof MAL_LIST_STATUSES)[number];

/**
 * MAL's other list fields: the user's comments, tags, priority (0 low, 1 medium, 2 high) and how
 * many times they rewatched it. Null in the mirror when MAL didn't send it.
 */
export interface EntryExtras {
  comments: string;
  tags: string[];
  priority: number;
  timesRewatched: number;
}

/** The parts of a list entry the rules look at. */
export interface EntryState {
  status: ListStatus;
  episodesWatched: number;
  /** Null when MAL doesn't know the episode count yet. */
  numEpisodes: number | null;
  isRewatching: boolean;
  score: number;
  /** MAL's other fields, when the mirror has them; missing or null means unknown. */
  extras?: { [K in keyof EntryExtras]?: EntryExtras[K] | null };
}

/** What was asked for. Every field is optional; at least one should be set. */
export interface RequestedChange extends Partial<EntryExtras> {
  status?: ListStatus;
  episodesWatched?: number;
  score?: number;
  isRewatching?: boolean;
}

/**
 * The list fields a proposal can change, as they stand: the four every entry has, and MAL's
 * other fields when the mirror knows them.
 */
export type ListState = Pick<EntryState, "status" | "episodesWatched" | "score" | "isRewatching"> &
  Partial<EntryExtras>;

export type ListChange = Partial<
  Pick<EntryState, "status" | "episodesWatched" | "score" | "isRewatching"> & EntryExtras
>;

/** The four fields every entry has, which the rules, stats and friends' activity look at. */
export const CORE_FIELDS = ["status", "episodesWatched", "score", "isRewatching"] as const;
/** MAL's other fields, set only by the user. */
export const EXTRA_FIELDS = ["comments", "tags", "priority", "timesRewatched"] as const;
/** Every field a change can carry. */
export const LIST_FIELDS = [...CORE_FIELDS, ...EXTRA_FIELDS] as const;
export type ListField = (typeof LIST_FIELDS)[number];

/** MAL's limits, as kurisu keeps them: a comment's length, and tags' number and length. */
export const COMMENTS_MAX = 2000;
export const TAGS_MAX = 20;
export const TAG_MAX = 50;
export const TIMES_REWATCHED_MAX = 999;

/** Whether two values of a list field are the same; tags are the same set in any order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const key = (tags: unknown[]) => tags.map(String).sort().join("\u0000");
    return key(a) === key(b);
  }
  return a === b;
}

/** Tags as MAL keeps them: trimmed, without commas (MAL's separator), each once. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags.flatMap((tag) => tag.split(","))) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (tag === "" || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

export type NormalizeError =
  | "episodes_exceed_total"
  | "negative_episodes"
  | "score_out_of_range"
  | "rewatch_not_completed"
  | "field_unknown"
  | "comments_too_long"
  | "too_many_tags"
  | "tag_too_long"
  | "priority_out_of_range"
  | "rewatch_count_out_of_range";

export type NormalizeResult =
  { ok: true; change: ListChange } | { ok: false; error: NormalizeError };

/** Checks MAL's other fields the user set, and keeps the ones that change. */
function extrasChange(
  entry: EntryState,
  requested: RequestedChange,
): { ok: true; change: Partial<EntryExtras> } | { ok: false; error: NormalizeError } {
  const change: Partial<EntryExtras> = {};
  for (const field of EXTRA_FIELDS) {
    if (requested[field] === undefined) continue;
    const current = entry.extras?.[field];
    if (current === undefined || current === null) return { ok: false, error: "field_unknown" };
  }
  if (requested.comments !== undefined) {
    const comments = requested.comments.trim();
    if (comments.length > COMMENTS_MAX) return { ok: false, error: "comments_too_long" };
    if (!sameValue(comments, entry.extras?.comments)) change.comments = comments;
  }
  if (requested.tags !== undefined) {
    const tags = cleanTags(requested.tags);
    if (tags.length > TAGS_MAX) return { ok: false, error: "too_many_tags" };
    if (tags.some((tag) => tag.length > TAG_MAX)) return { ok: false, error: "tag_too_long" };
    if (!sameValue(tags, entry.extras?.tags)) change.tags = tags;
  }
  if (requested.priority !== undefined) {
    const { priority } = requested;
    if (!Number.isInteger(priority) || priority < 0 || priority > 2) {
      return { ok: false, error: "priority_out_of_range" };
    }
    if (priority !== entry.extras?.priority) change.priority = priority;
  }
  if (requested.timesRewatched !== undefined) {
    const times = requested.timesRewatched;
    if (!Number.isInteger(times) || times < 0 || times > TIMES_REWATCHED_MAX) {
      return { ok: false, error: "rewatch_count_out_of_range" };
    }
    if (times !== entry.extras?.timesRewatched) change.timesRewatched = times;
  }
  return { ok: true, change };
}

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

  const extras = extrasChange(entry, requested);
  if (!extras.ok) return extras;

  const change: ListChange = {};
  if (status !== entry.status) change.status = status;
  if (episodes !== entry.episodesWatched) change.episodesWatched = episodes;
  if (score !== entry.score) change.score = score;
  if (isRewatching !== entry.isRewatching) change.isRewatching = isRewatching;
  return { ok: true, change: { ...change, ...extras.change } };
}
