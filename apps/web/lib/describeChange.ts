import type { ChangeSource, ListChange, WriteKind } from "@kurisu/shared";

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

/** What a write did: an add or a removal in words, an update as describeChange says it. */
export function describeWrite(kind: WriteKind, before: ListChange, after: ListChange): string {
  if (kind === "remove") return "Removed from your list";
  if (kind === "add") return `Added ${addedAs(after)}`;
  return describeChange(before, after);
}

/** Who made a change, when it wasn't the agent in Chat: "Edited by you", "From import". */
export function sourceLabel(source: ChangeSource): string | null {
  switch (source) {
    case "user":
      return "Edited by you";
    case "import":
      return "From import";
    case "undo":
      return "Undo";
    case "agent":
      return null;
  }
}

/** The button that confirms an add: "Add to Plan to Watch", "Add as Watching, ep 3". */
export function addButtonLabel(change: ListChange): string {
  return `Add ${addedAs(change)}`;
}

/** "to Plan to Watch", "as Watching, ep 3", "as Completed, 8/10". */
function addedAs(change: ListChange): string {
  const status = change.status ?? "plan_to_watch";
  if (status === "plan_to_watch" && !change.score) return "to Plan to Watch";
  const details = [
    status === "watching" || status === "on_hold" || status === "dropped"
      ? change.episodesWatched
        ? `ep ${String(change.episodesWatched)}`
        : null
      : null,
    change.score ? `${String(change.score)}/10` : null,
  ].filter((part) => part !== null);
  return [`as ${STATUS_LABELS[status]}`, ...details].join(", ");
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
    case "not_yet_aired":
      return "MyAnimeList says this show hasn't aired yet.";
    case "newest_episode_unknown":
      return "I can't look up the newest episode yet, so check the episode number.";
    case "score_not_given":
      return "You didn't give a score, so check this one.";
    case "not_in_brief":
      return "Your brief didn't list this episode, so check it.";
    case "not_named":
      return "You didn't mention this show, so check it.";
    case "adds_to_list":
      return "This isn't on your list yet. Adding a show always waits for you.";
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
