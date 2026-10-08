import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries, proposals } from "../db/schema.js";
import { commitProposal, type CommitResult, type WriteDeps } from "./commit.js";
import {
  normalizeChange,
  type ListChange,
  type ListState,
  type RequestedChange,
} from "./normalize.js";
import type { Proposal, ProposeError } from "./propose.js";

/**
 * Edits the user makes themselves on the List screen. They take the same path as the agent's
 * writes: a proposal, normalized by the same rules (completing fills in the episodes, and so
 * on), committed only by commitProposal, logged with the prior values and undoable. The user's
 * own tap is the confirmation, so nothing is held.
 */
export type ManualEdit = RequestedChange;

export type ManualResult = CommitResult | { status: "invalid"; error: ProposeError };

/** One request id per tap: the same tap retried (a double tap, a lost response) writes once. */
function keyFor(requestId: string): string {
  return `user:${requestId}`;
}

/** The proposal an earlier try of this same tap made, if any. */
async function earlierTry(db: Db, userId: string, requestId: string): Promise<string | null> {
  const [earlier] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.userId, userId), eq(proposals.idempotencyKey, keyFor(requestId))));
  return earlier?.id ?? null;
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

async function stage(
  db: Db,
  values: {
    userId: string;
    animeId: number;
    kind: "update" | "remove";
    requestId: string;
    before: ListState;
    change: ListChange;
  },
): Promise<Proposal> {
  const idempotencyKey = keyFor(values.requestId);
  await db
    .insert(proposals)
    .values({
      userId: values.userId,
      animeId: values.animeId,
      source: "user",
      kind: values.kind,
      idempotencyKey,
      before: values.before,
      change: values.change,
    })
    .onConflictDoNothing({ target: [proposals.userId, proposals.idempotencyKey] });
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.userId, values.userId), eq(proposals.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!proposal) throw new Error("manual proposal insert returned no row");
  return proposal;
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
  const earlier = await earlierTry(deps.db, userId, requestId);
  if (earlier) return commitProposal(deps, userId, earlier, { confirmed: true });
  const entry = await entryOf(deps.db, userId, animeId);
  if (!entry) return { status: "failed", error: "not_on_list" };
  const normalized = normalizeChange(entry, edit);
  if (!normalized.ok) return { status: "invalid", error: normalized.error };
  if (Object.keys(normalized.change).length === 0) return { status: "invalid", error: "no_change" };

  const proposal = await stage(deps.db, {
    userId,
    animeId,
    kind: "update",
    requestId,
    before: {
      status: entry.status,
      episodesWatched: entry.episodesWatched,
      score: entry.score,
      isRewatching: entry.isRewatching,
    },
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
  const earlier = await earlierTry(deps.db, userId, requestId);
  if (earlier) return commitProposal(deps, userId, earlier, { confirmed: true });
  const entry = await entryOf(deps.db, userId, animeId);
  if (!entry) return { status: "failed", error: "not_on_list" };
  const proposal = await stage(deps.db, {
    userId,
    animeId,
    kind: "remove",
    requestId,
    before: {
      status: entry.status,
      episodesWatched: entry.episodesWatched,
      score: entry.score,
      isRewatching: entry.isRewatching,
    },
    change: {},
  });
  return commitProposal(deps, userId, proposal.id, { confirmed: true });
}
