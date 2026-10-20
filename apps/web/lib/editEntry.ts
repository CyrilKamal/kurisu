import type { ListEntry, ListStatus } from "@kurisu/shared";

import { writeErrorMessage } from "./describeChange";

/** An entry as the edit sheet needs it: from the List screen or a show's page. */
export type EditableEntry = Pick<
  ListEntry,
  | "animeId"
  | "title"
  | "numEpisodes"
  | "status"
  | "score"
  | "episodesWatched"
  | "isRewatching"
  | "comments"
  | "tags"
  | "priority"
  | "timesRewatched"
>;

/**
 * The fields the edit sheet shows, as they stand. MAL's other fields are null when MAL hasn't
 * sent them, and then the sheet doesn't offer them.
 */
export interface EditForm {
  status: ListStatus;
  episodesWatched: number;
  score: number;
  isRewatching: boolean;
  comments: string | null;
  tags: string[] | null;
  priority: number | null;
  timesRewatched: number | null;
}

/** What an edit sends: only what changed, and never a field MAL hasn't sent. */
export type EditPayload = Partial<{
  status: ListStatus;
  episodesWatched: number;
  score: number;
  isRewatching: boolean;
  comments: string;
  tags: string[];
  priority: number;
  timesRewatched: number;
}>;

export function formFrom(entry: EditableEntry): EditForm {
  return {
    status: entry.status,
    episodesWatched: entry.episodesWatched,
    score: entry.score,
    isRewatching: entry.isRewatching,
    comments: entry.comments,
    tags: entry.tags,
    priority: entry.priority,
    timesRewatched: entry.timesRewatched,
  };
}

/** The same tags, in any order. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

/** Only the fields the user changed, or null when nothing did. */
export function editPayload(entry: EditableEntry, form: EditForm): EditPayload | null {
  const before = formFrom(entry);
  const changed: EditPayload = {};
  if (form.status !== before.status) changed.status = form.status;
  if (form.episodesWatched !== before.episodesWatched) {
    changed.episodesWatched = form.episodesWatched;
  }
  if (form.score !== before.score) changed.score = form.score;
  if (form.isRewatching !== before.isRewatching) changed.isRewatching = form.isRewatching;
  if (form.comments !== null && before.comments !== null) {
    const comments = form.comments.trim();
    if (comments !== before.comments.trim()) changed.comments = comments;
  }
  if (form.tags !== null && before.tags !== null && !sameTags(form.tags, before.tags)) {
    changed.tags = form.tags;
  }
  if (form.priority !== null && before.priority !== null && form.priority !== before.priority) {
    changed.priority = form.priority;
  }
  if (
    form.timesRewatched !== null &&
    before.timesRewatched !== null &&
    form.timesRewatched !== before.timesRewatched
  ) {
    changed.timesRewatched = form.timesRewatched;
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/**
 * Adds what was typed to the tags: commas split it (MAL's separator), spaces are tidied, and a tag
 * already there (in any case) isn't added twice.
 */
export function addTags(tags: readonly string[], typed: string): string[] {
  const out = [...tags];
  for (const raw of typed.split(",")) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (tag !== "" && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** Whether a show is under way with episodes left, so "+1 ep" makes sense. */
export function canAddEpisode(entry: EditableEntry): boolean {
  const underWay =
    entry.status === "watching" ||
    entry.status === "on_hold" ||
    (entry.status === "completed" && entry.isRewatching);
  return underWay && (entry.numEpisodes === null || entry.episodesWatched < entry.numEpisodes);
}

/** Why an edit or removal didn't go through, in words. */
export function editErrorMessage(error: string): string {
  switch (error) {
    case "episodes_exceed_total":
      return "That's more episodes than the show has.";
    case "negative_episodes":
      return "Episodes can't go below 0.";
    case "score_out_of_range":
      return "Scores go from 1 to 10.";
    case "rewatch_not_completed":
      return "Only a completed show can be rewatched.";
    case "field_unknown":
      return "MyAnimeList hasn't sent that field yet. Re-sync, then try again.";
    case "comments_too_long":
      return "Comments can be up to 2,000 characters.";
    case "too_many_tags":
      return "Up to 20 tags.";
    case "tag_too_long":
      return "A tag can be up to 50 characters.";
    case "priority_out_of_range":
      return "Priority is Low, Medium or High.";
    case "rewatch_count_out_of_range":
      return "Times rewatched goes from 0 to 999.";
    case "no_change":
      return "Nothing changed.";
    case "invalid_edit":
      return "That edit isn't valid.";
    case "not_on_list":
      return "This show isn't on your list anymore. Re-sync to refresh.";
    default:
      return writeErrorMessage(error);
  }
}

/** Why an add didn't go through, in words. */
export function addErrorMessage(error: string): string {
  switch (error) {
    case "already_on_list":
      return "It's already on your list.";
    case "unknown_anime":
      return "kurisu doesn't know this show. Search for it again.";
    case "stale":
      return "It's already on your list. Re-sync to see it.";
    case "network":
      return "You're offline. Adding needs a connection.";
    default:
      return editErrorMessage(error);
  }
}
