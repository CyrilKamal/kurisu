import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { changes, listEntries, proposals } from "../db/schema.js";
import { commitProposal, type CommitResult, type WriteDeps } from "./commit.js";
import type { ListChange, ListState } from "./normalize.js";

export type UndoResult =
  | CommitResult
  | { status: "already_undone"; undoneByChangeId: string }
  | { status: "changed_since" };

const FIELDS = ["status", "episodesWatched", "score", "isRewatching"] as const;

/**
 * Reverts one committed change by proposing its prior values and committing that proposal
 * through the same single write path. Refuses if the entry changed since (undoing would
 * silently clobber the newer change). Undoing an add takes the show off the list again, and
 * undoing that puts it back as it was.
 */
export async function undoChange(
  deps: WriteDeps,
  userId: string,
  changeId: string,
): Promise<UndoResult> {
  const { db } = deps;
  const [change] = await db
    .select()
    .from(changes)
    .where(and(eq(changes.id, changeId), eq(changes.userId, userId)));
  if (!change) return { status: "not_found" };
  if (change.undoneByChangeId) {
    return { status: "already_undone", undoneByChangeId: change.undoneByChangeId };
  }

  const [entry] = await db
    .select({
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      score: listEntries.score,
      isRewatching: listEntries.isRewatching,
    })
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, change.animeId)));

  let undo: { kind: "update" | "add" | "remove"; before: ListState | null; change: ListChange };
  if (change.kind === "remove") {
    if (entry) return { status: "changed_since" };
    undo = { kind: "add", before: null, change: change.before };
  } else {
    if (!entry) return { status: "failed", error: "not_on_list" };
    // After an add, everything it didn't set is at MAL's defaults; any later change blocks
    // removing the show, since that would lose it.
    const expected: ListChange =
      change.kind === "add"
        ? { episodesWatched: 0, score: 0, isRewatching: false, ...change.after }
        : change.after;
    const keys = FIELDS.filter((field) => expected[field] !== undefined);
    if (keys.some((field) => entry[field] !== expected[field])) {
      return { status: "changed_since" };
    }
    undo =
      change.kind === "add"
        ? { kind: "remove", before: entry, change: {} }
        : { kind: "update", before: entry, change: change.before };
  }

  // One undo proposal per change, however many times Undo is pressed.
  const idempotencyKey = `undo:${change.id}`;
  await db
    .insert(proposals)
    .values({
      userId,
      animeId: change.animeId,
      source: "undo",
      kind: undo.kind,
      idempotencyKey,
      before: undo.before,
      change: undo.change,
      undoOfChangeId: change.id,
    })
    .onConflictDoNothing({ target: [proposals.userId, proposals.idempotencyKey] });
  const [proposal] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.userId, userId), eq(proposals.idempotencyKey, idempotencyKey)));
  if (!proposal) throw new Error("undo proposal insert returned no row");

  return commitProposal(deps, userId, proposal.id, { confirmed: true });
}

/** Drops a proposal that was waiting for confirmation (the user tapped Cancel). */
export async function cancelProposal(
  db: Db,
  userId: string,
  proposalId: string,
): Promise<"cancelled" | "not_found" | "not_cancellable"> {
  const [row] = await db
    .update(proposals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.userId, userId),
        inArray(proposals.status, ["pending", "failed"]),
      ),
    )
    .returning({ id: proposals.id });
  if (row) return "cancelled";
  const [exists] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)));
  return exists ? "not_cancellable" : "not_found";
}
