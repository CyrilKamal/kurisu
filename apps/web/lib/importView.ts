import type { ImportGroup, ImportItemView, ImportView, ListChange } from "@kurisu/shared";

import { addButtonLabel, describeChange } from "./describeChange";
import { STATUS_LABELS } from "./format";

/** The review screen's sections, in order: the rows that need a tap first. */
export const SECTIONS: { group: ImportGroup; title: string; hint: string }[] = [
  { group: "which_one", title: "Which one?", hint: "Tap the show you meant, or leave it." },
  {
    group: "disagree",
    title: "Your notes and MAL disagree",
    hint: "MAL stays as it is unless you choose your notes.",
  },
  { group: "add", title: "Add to your list", hint: "" },
  { group: "update", title: "Update", hint: "" },
  { group: "up_to_date", title: "Already up to date", hint: "" },
  { group: "not_found", title: "Couldn't find", hint: "" },
  { group: "not_a_show", title: "Not shows", hint: "" },
];

/** Sections shown folded, since nothing in them needs a look. */
export const FOLDED: ImportGroup[] = ["up_to_date", "not_found", "not_a_show"];

export function rowsIn(view: ImportView, group: ImportGroup): ImportItemView[] {
  return view.items.filter((item) => item.group === group);
}

/** Whether Import would write this row. */
export function willWrite(item: ImportItemView): boolean {
  return (
    item.checked &&
    item.change !== null &&
    (item.group === "add" || item.group === "update" || item.group === "disagree")
  );
}

/** "Which one?" rows nobody answered: Import skips them. */
export function unanswered(view: ImportView): number {
  return view.items.filter((item) => item.group === "which_one").length;
}

export interface Progress {
  /** Rows the run writes (or wrote). */
  total: number;
  written: number;
  failed: number;
  undone: number;
  undoFailed: number;
}

export function progress(view: ImportView): Progress {
  const count = (status: ImportItemView["status"]) =>
    view.items.filter((item) => item.status === status).length;
  const running = view.status !== "review";
  return {
    total: running
      ? view.items.filter((item) => item.status !== "skipped").length
      : view.items.filter(willWrite).length,
    written: count("committed") + count("undone") + count("undo_failed"),
    failed: count("failed"),
    undone: count("undone"),
    undoFailed: count("undo_failed"),
  };
}

function stateText(state: ListChange): string {
  const parts: string[] = [];
  if (state.status) parts.push(STATUS_LABELS[state.status]);
  if (state.episodesWatched !== undefined) parts.push(`ep ${String(state.episodesWatched)}`);
  if (state.score) parts.push(`${String(state.score)}/10`);
  if (state.isRewatching) parts.push("rewatching");
  return parts.join(", ");
}

/** What a row does, or would do: "Add as Completed, 10/10", "ep 7 → 9". */
export function rowAction(item: ImportItemView): string | null {
  if (!item.change) return null;
  if (item.group === "add") return addButtonLabel(item.change);
  if (item.group === "update" && item.malState) return describeChange(item.malState, item.change);
  return null;
}

/** For a disagreement: what MAL has, and what the notes say, in the fields they differ on. */
export function disagreement(item: ImportItemView): { mal: string; notes: string } | null {
  if (!item.malState || !item.change) return null;
  const keys = Object.keys(item.change) as (keyof ListChange)[];
  const mal: ListChange = {};
  for (const key of keys) Object.assign(mal, { [key]: item.malState[key] });
  return { mal: stateText(mal), notes: stateText(item.change) };
}

/** Why a row failed or couldn't be undone, in words. */
export function rowError(error: string | null): string | null {
  switch (error) {
    case null:
      return null;
    case "changed_since_review":
      return "Changed on your list since you reviewed it, so it was left alone.";
    case "changed_since":
      return "Changed again since the import, so it wasn't undone.";
    case "stale":
      return "Your list changed while importing, so it was left alone.";
    case "mal_unavailable":
      return "Couldn't reach MyAnimeList.";
    case "mal_rejected":
      return "MyAnimeList didn't accept it.";
    case "reauth_required":
      return "MyAnimeList needs you to log in again.";
    default:
      return "Something went wrong with this one.";
  }
}
