import type { ListEntry, ListStatus } from "@kurisu/shared";

import { writeErrorMessage } from "./describeChange";

/** An entry as the edit sheet needs it: from the List screen or a show's page. */
export type EditableEntry = Pick<
  ListEntry,
  "animeId" | "title" | "numEpisodes" | "status" | "score" | "episodesWatched" | "isRewatching"
>;

/** The fields the edit sheet shows, as they stand. */
export interface EditForm {
  status: ListStatus;
  episodesWatched: number;
  score: number;
  isRewatching: boolean;
}

export function formFrom(entry: EditableEntry): EditForm {
  return {
    status: entry.status,
    episodesWatched: entry.episodesWatched,
    score: entry.score,
    isRewatching: entry.isRewatching,
  };
}

/** Only the fields the user changed, or null when nothing did. */
export function editPayload(entry: EditableEntry, form: EditForm): Partial<EditForm> | null {
  const before = formFrom(entry);
  const changed: Partial<EditForm> = {};
  if (form.status !== before.status) changed.status = form.status;
  if (form.episodesWatched !== before.episodesWatched) {
    changed.episodesWatched = form.episodesWatched;
  }
  if (form.score !== before.score) changed.score = form.score;
  if (form.isRewatching !== before.isRewatching) changed.isRewatching = form.isRewatching;
  return Object.keys(changed).length > 0 ? changed : null;
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
