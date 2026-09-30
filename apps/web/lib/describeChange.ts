import type { ListChange } from "@kurisu/shared";

import { STATUS_LABELS } from "./format";

/**
 * One line describing a change, e.g. "ep 7 → 8 · Watching → Completed". `before` holds the
 * prior values of the same fields.
 */
export function describeChange(before: ListChange, after: ListChange): string {
  const parts: string[] = [];
  if (after.episodesWatched !== undefined) {
    parts.push(`ep ${String(before.episodesWatched ?? "?")} → ${String(after.episodesWatched)}`);
  }
  if (after.status !== undefined) {
    const from = before.status ? STATUS_LABELS[before.status] : "?";
    parts.push(`${from} → ${STATUS_LABELS[after.status]}`);
  }
  if (after.score !== undefined) {
    parts.push(`score ${scoreLabel(before.score)} → ${scoreLabel(after.score)}`);
  }
  if (after.isRewatching !== undefined) {
    parts.push(after.isRewatching ? "rewatching" : "rewatch finished");
  }
  return parts.join(" · ");
}

function scoreLabel(score: number | undefined): string {
  return score === undefined || score === 0 ? "–" : String(score);
}

/** Why a held change needs the user's go-ahead. */
export function confirmationReasonLabel(reason: string | null): string {
  switch (reason) {
    case "ambiguous_match":
      return "Not sure this is the show you meant.";
    case "progress_backwards":
      return "This moves your progress backwards.";
    default:
      return "Needs your confirmation.";
  }
}

/** Why a confirm, cancel or undo didn't go through. */
export function writeErrorMessage(error: string): string {
  switch (error) {
    case "stale":
      return "Your list changed since this was proposed. Ask again to get a fresh change.";
    case "changed_since":
      return "This show changed again since, so undoing would overwrite the newer change.";
    case "already_undone":
      return "Already undone.";
    case "cancelled":
    case "not_cancellable":
      return "This change was already dealt with.";
    case "in_progress":
      return "Still saving. Try again in a moment.";
    case "reauth_required":
      return "MyAnimeList needs you to log in again.";
    case "mal_unavailable":
      return "Couldn't reach MyAnimeList. Try again in a minute.";
    case "mal_rejected":
      return "MyAnimeList didn't accept the change.";
    case "not_found":
      return "That change no longer exists.";
    default:
      return "Something went wrong. Please try again.";
  }
}
