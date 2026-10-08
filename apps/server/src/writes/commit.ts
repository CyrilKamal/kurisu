import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";

import { ReauthRequiredError, withMalAccessToken, type TokenStore } from "../auth/tokenStore.js";
import type { Db } from "../db/client.js";
import { changes, diaryNotes, dropReasons, listEntries, proposals } from "../db/schema.js";
import { DEFAULT_RETRY, MalApiError, type RetryOptions } from "../mal/client.js";
import { MalOAuthError } from "../mal/oauth.js";
import { deleteListStatus, patchListStatus, type MalListStatus } from "../mal/writeClient.js";
import type { ListChange, ListState } from "./normalize.js";
import type { Proposal } from "./propose.js";

/**
 * The single path from a proposal to a MAL write (CLAUDE.md hard rule). Guarantees:
 * - Only proposals from propose_update or undo are ever written; nothing takes raw arguments.
 * - A row lock plus a pending → committing → committed state machine means one PATCH per
 *   proposal, however many times commit is called or retried concurrently.
 * - Values are absolute, so even a re-sent PATCH can't double-count progress.
 * - If the mirror moved since the proposal was made, the commit is refused as stale.
 * - Every commit lands in the change log with prior values, so it can be undone.
 * - An add only commits once the user confirms it (see propose.ts), and only if the show still
 *   isn't on the list. A remove only undoes an add.
 */

/** Writes one list entry to MAL and returns MAL's resulting state. */
export type ListWriter = (
  userId: string,
  animeId: number,
  change: ListChange,
) => Promise<MalListStatus>;

/** The production writer: real MAL, with a fresh token (refreshed once on a 401). */
export function createMalListWriter(deps: {
  tokenStore: TokenStore;
  apiBaseUrl: string;
  retry?: RetryOptions;
}): ListWriter {
  return (userId, animeId, change) =>
    withMalAccessToken(deps.tokenStore, userId, (token) =>
      patchListStatus(deps.apiBaseUrl, token, animeId, change, deps.retry ?? DEFAULT_RETRY),
    );
}

/** Takes a show off the user's MAL list. */
export type ListRemover = (userId: string, animeId: number) => Promise<void>;

export function createMalListRemover(deps: {
  tokenStore: TokenStore;
  apiBaseUrl: string;
  retry?: RetryOptions;
}): ListRemover {
  return (userId, animeId) =>
    withMalAccessToken(deps.tokenStore, userId, (token) =>
      deleteListStatus(deps.apiBaseUrl, token, animeId, deps.retry ?? DEFAULT_RETRY),
    );
}

/**
 * Fills in MAL's own details for a show just added to the list, replacing what search found on
 * AniList. Best effort: if it fails, the next list sync fills them in.
 */
export type AnimeRefresher = (userId: string, animeId: number) => Promise<void>;

export interface WriteDeps {
  db: Db;
  writeListStatus: ListWriter;
  /** Needed to undo an add. */
  removeListStatus?: ListRemover;
  refreshAnime?: AnimeRefresher;
}

export type Change = typeof changes.$inferSelect;

export type CommitErrorCode =
  | "stale"
  | "not_on_list"
  | "reauth_required"
  | "mal_rejected"
  | "mal_unavailable"
  | "invalid_response"
  | "internal_error";

export type CommitResult =
  | { status: "committed"; change: Change; alreadyCommitted: boolean }
  | { status: "needs_confirmation"; proposal: Proposal }
  | { status: "in_progress" }
  | { status: "cancelled" }
  | { status: "not_found" }
  | { status: "failed"; error: CommitErrorCode };

/** A commit left "committing" this long ago is assumed crashed and may be retried. */
const STUCK_AFTER_MS = 2 * 60 * 1000;

const FIELDS = ["status", "episodesWatched", "score", "isRewatching"] as const;

export async function commitProposal(
  deps: WriteDeps,
  userId: string,
  proposalId: string,
  options: { confirmed?: boolean } = {},
): Promise<CommitResult> {
  const { db } = deps;

  const claim = await db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .for("update");
    if (!proposal) return { kind: "not_found" as const };

    if (proposal.status === "committed") {
      const [change] = await tx.select().from(changes).where(eq(changes.proposalId, proposal.id));
      if (!change) throw new Error("committed proposal without a change row");
      return { kind: "already" as const, change };
    }
    if (proposal.status === "cancelled") return { kind: "cancelled" as const };
    if (
      proposal.status === "committing" &&
      Date.now() - proposal.updatedAt.getTime() < STUCK_AFTER_MS
    ) {
      return { kind: "in_progress" as const };
    }
    if (proposal.requiresConfirmation && options.confirmed !== true) {
      return { kind: "needs_confirmation" as const, proposal };
    }

    const [entry] = await tx
      .select({
        status: listEntries.status,
        episodesWatched: listEntries.numEpisodesWatched,
        score: listEntries.score,
        isRewatching: listEntries.isRewatching,
      })
      .from(listEntries)
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, proposal.animeId)));
    // An add needs the show still off the list; an update or remove needs the entry as it was.
    const refusal: CommitErrorCode | null =
      proposal.kind === "add"
        ? entry
          ? "stale"
          : null
        : !entry
          ? "not_on_list"
          : changedSince(proposal, entry)
            ? "stale"
            : null;
    if (refusal) {
      await tx
        .update(proposals)
        .set({ status: "failed", error: refusal, updatedAt: new Date() })
        .where(eq(proposals.id, proposal.id));
      return { kind: "refused" as const, error: refusal };
    }

    await tx
      .update(proposals)
      .set({ status: "committing", error: null, updatedAt: new Date() })
      .where(eq(proposals.id, proposal.id));
    return { kind: "claimed" as const, proposal };
  });

  switch (claim.kind) {
    case "not_found":
    case "cancelled":
    case "in_progress":
      return { status: claim.kind };
    case "already":
      return { status: "committed", change: claim.change, alreadyCommitted: true };
    case "needs_confirmation":
      return { status: "needs_confirmation", proposal: claim.proposal };
    case "refused":
      return { status: "failed", error: claim.error };
    case "claimed":
      break;
  }
  const proposal = claim.proposal;

  let result: MalListStatus | null = null;
  try {
    if (proposal.kind === "remove") {
      if (!deps.removeListStatus) throw new Error("no list remover configured");
      await deps.removeListStatus(userId, proposal.animeId);
    } else {
      result = await deps.writeListStatus(userId, proposal.animeId, proposal.change);
    }
  } catch (err) {
    const error = classify(err);
    await db
      .update(proposals)
      .set({ status: "failed", error, updatedAt: new Date() })
      .where(eq(proposals.id, proposal.id));
    return { status: "failed", error };
  }

  const change = await db.transaction(async (tx) => {
    const now = new Date();
    const where = and(eq(listEntries.userId, userId), eq(listEntries.animeId, proposal.animeId));
    // Sync after write: the mirror takes MAL's own view of the entry.
    let before: ListChange;
    let after: ListChange;
    if (result === null) {
      await tx.delete(listEntries).where(where);
      before = proposal.before ?? {};
      after = {};
    } else {
      const state = {
        status: result.status,
        score: result.score,
        numEpisodesWatched: result.episodesWatched,
        isRewatching: result.isRewatching,
        malUpdatedAt: result.updatedAt,
        syncedAt: now,
      };
      if (proposal.kind === "add") {
        await tx
          .insert(listEntries)
          .values({ userId, animeId: proposal.animeId, ...state })
          .onConflictDoUpdate({ target: [listEntries.userId, listEntries.animeId], set: state });
      } else {
        await tx.update(listEntries).set(state).where(where);
      }
      const keys = FIELDS.filter((field) => proposal.change[field] !== undefined);
      before = proposal.before ? pick(proposal.before, keys) : {};
      after = pick(stateOf(result), keys);
    }

    const [row] = await tx
      .insert(changes)
      .values({
        userId,
        animeId: proposal.animeId,
        proposalId: proposal.id,
        kind: proposal.kind,
        before,
        after,
        committedAt: now,
      })
      .returning();
    if (!row) throw new Error("change insert returned no row");

    await tx
      .update(proposals)
      .set({ status: "committed", committedAt: now, updatedAt: now })
      .where(eq(proposals.id, proposal.id));
    if (proposal.undoOfChangeId) {
      await tx
        .update(changes)
        .set({ undoneByChangeId: row.id })
        .where(eq(changes.id, proposal.undoOfChangeId));
      // Undoing a drop takes back the reason given for it, and any change its diary note.
      await tx.delete(dropReasons).where(eq(dropReasons.changeId, proposal.undoOfChangeId));
      await tx.delete(diaryNotes).where(eq(diaryNotes.changeId, proposal.undoOfChangeId));
    }
    if (proposal.dropReason && proposal.dropSaid && result?.status === "dropped") {
      await tx.insert(dropReasons).values({
        userId,
        animeId: proposal.animeId,
        category: proposal.dropReason,
        said: proposal.dropSaid,
        changeId: row.id,
      });
    }
    return row;
  });

  if (proposal.kind === "add" && deps.refreshAnime) {
    // The list sync fills the details in later if this fails.
    await deps.refreshAnime(userId, proposal.animeId).catch(() => undefined);
  }
  return { status: "committed", change, alreadyCommitted: false };
}

/**
 * True if any field this proposal changes no longer holds the value it was proposed against. A
 * remove checks every field: the entry must be just as it was.
 */
function changedSince(proposal: Proposal, current: ListState): boolean {
  const before = proposal.before;
  if (!before) return false;
  return FIELDS.some(
    (field) =>
      (proposal.kind === "remove" || proposal.change[field] !== undefined) &&
      current[field] !== before[field],
  );
}

function stateOf(status: MalListStatus): ListState {
  return {
    status: status.status,
    episodesWatched: status.episodesWatched,
    score: status.score,
    isRewatching: status.isRewatching,
  };
}

function pick(state: ListState, keys: readonly (typeof FIELDS)[number][]): ListChange {
  const out: ListChange = {};
  for (const key of keys) {
    (out as Record<string, unknown>)[key] = state[key];
  }
  return out;
}

function classify(err: unknown): CommitErrorCode {
  if (err instanceof ReauthRequiredError) return "reauth_required";
  if (err instanceof MalApiError) {
    return err.status === 429 || err.status >= 500 ? "mal_unavailable" : "mal_rejected";
  }
  if (err instanceof MalOAuthError) return "mal_unavailable";
  if (err instanceof ZodError) return "invalid_response";
  if (err instanceof TypeError || (err instanceof DOMException && err.name === "TimeoutError")) {
    return "mal_unavailable";
  }
  return "internal_error";
}
