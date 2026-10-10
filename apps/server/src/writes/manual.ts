import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries } from "../db/schema.js";
import { commitProposal, type CommitResult, type WriteDeps } from "./commit.js";
import { normalizeChange, type ListState, type RequestedChange } from "./normalize.js";
import { addChange, type ProposeError } from "./propose.js";
import { findProposal, stageProposal } from "./stage.js";

/**
 * Edits the user makes themselves on the List screen. They take the same path as the agent's
 * writes: a proposal, normalized by the same rules (completing fills in the episodes, and so
 * on), committed only by commitProposal, logged with the prior values and undoable. The user's
 * own tap is the confirmation, so nothing is held.
 */
export type ManualEdit = RequestedChange;

export type ManualResult =
  CommitResult | { status: "invalid"; error: ProposeError | "already_on_list" };

/** One request id per tap: the same tap retried (a double tap, a lost response) writes once. */
function keyFor(requestId: string): string {
  return `user:${requestId}`;
}

async function entryOf(db: Db, userId: string, animeId: number) {
  const [entry] = await db
    .select({
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      score: listEntries.score,
      isRewatching: listEntries.isRewatching,
      numEpisodes: anime.numEpisodes,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)))
    .limit(1);
  return entry ?? null;
}

function stateOf(entry: ListState): ListState {
  return {
    status: entry.status,
    episodesWatched: entry.episodesWatched,
    score: entry.score,
    isRewatching: entry.isRewatching,
  };
}

/** Changes an entry's status, episodes, score or rewatching, as the user set them. */
export async function editEntry(
  deps: WriteDeps,
  userId: string,
  animeId: number,
  edit: ManualEdit,
  requestId: string,
): Promise<ManualResult> {
  // A retry reports how the first try went, rather than comparing against what it already did.
  const earlier = await findProposal(deps.db, userId, keyFor(requestId));
  if (earlier) return commitProposal(deps, userId, earlier.id, { confirmed: true });
  const entry = await entryOf(deps.db, userId, animeId);
  if (!entry) return { status: "failed", error: "not_on_list" };
  const normalized = normalizeChange(entry, edit);
  if (!normalized.ok) return { status: "invalid", error: normalized.error };
  if (Object.keys(normalized.change).length === 0) return { status: "invalid", error: "no_change" };

  const proposal = await stageProposal(deps.db, {
    userId,
    animeId,
    source: "user",
    kind: "update",
    idempotencyKey: keyFor(requestId),
    before: stateOf(entry),
    change: normalized.change,
  });
  return commitProposal(deps, userId, proposal.id, { confirmed: true });
}

/** Takes a show off the list. Undoing it puts the show back as it was. */
export async function removeEntry(
  deps: WriteDeps,
  userId: string,
  animeId: number,
  requestId: string,
): Promise<ManualResult> {
  const earlier = await findProposal(deps.db, userId, keyFor(requestId));
  if (earlier) return commitProposal(deps, userId, earlier.id, { confirmed: true });
  const entry = await entryOf(deps.db, userId, animeId);
  if (!entry) return { status: "failed", error: "not_on_list" };
  const proposal = await stageProposal(deps.db, {
    userId,
    animeId,
    source: "user",
    kind: "remove",
    idempotencyKey: keyFor(requestId),
    before: stateOf(entry),
    change: {},
  });
  return commitProposal(deps, userId, proposal.id, { confirmed: true });
}

/**
 * Puts a show on the list, at Plan to Watch unless the user picked another status, by the same
 * rules as an add from Chat (finishing it completes it, and so on). The show must be one kurisu
 * has seen, from the list or a search. The user's tap on Add is the confirmation, so nothing is
 * held; undoing it takes the show off MAL again.
 */
export async function addEntry(
  deps: WriteDeps,
  userId: string,
  animeId: number,
  requested: Omit<RequestedChange, "isRewatching">,
  requestId: string,
): Promise<ManualResult> {
  const earlier = await findProposal(deps.db, userId, keyFor(requestId));
  if (earlier) return commitProposal(deps, userId, earlier.id, { confirmed: true });
  const [show] = await deps.db
    .select({ numEpisodes: anime.numEpisodes })
    .from(anime)
    .where(eq(anime.malId, animeId))
    .limit(1);
  if (!show) return { status: "invalid", error: "unknown_anime" };
  if (await entryOf(deps.db, userId, animeId))
    return { status: "invalid", error: "already_on_list" };
  const normalized = addChange(show.numEpisodes, requested);
  if (!normalized.ok) return { status: "invalid", error: normalized.error };

  const proposal = await stageProposal(deps.db, {
    userId,
    animeId,
    source: "user",
    kind: "add",
    idempotencyKey: keyFor(requestId),
    before: null,
    change: normalized.change,
  });
  return commitProposal(deps, userId, proposal.id, { confirmed: true });
}
