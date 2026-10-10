import type { ChangeView } from "@kurisu/shared";

/**
 * Whether a change finished a show just now: it moved it to Completed. Not an undo, not a change
 * that was undone, and not the end of a rewatch (the show was already completed).
 */
export function finishes(
  change: Pick<ChangeView, "kind" | "before" | "after" | "isUndo" | "undone">,
): boolean {
  return (
    !change.isUndo &&
    !change.undone &&
    change.kind !== "remove" &&
    change.after.status === "completed" &&
    change.before.status !== "completed"
  );
}
