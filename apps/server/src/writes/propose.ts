import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries, proposals } from "../db/schema.js";
import {
  normalizeChange,
  type ListChange,
  type ListState,
  type ListStatus,
  type RequestedChange,
} from "./normalize.js";

export type Proposal = typeof proposals.$inferSelect;

export interface ProposeInput {
  userId: string;
  /** The agent run proposing this; part of the idempotency key. */
  runId: string;
  animeId: number;
  status?: ListStatus;
  /** Absolute episode count after the update. */
  episodesWatched?: number;
  /** Relative progress ("two more"), resolved against the mirror now, never stored as a delta. */
  episodesDelta?: number;
  score?: number;
  isRewatching?: boolean;
  /**
   * Whether the user's words clearly identify this anime (decided by the caller from search
   * results). An unclear match is held for the user to confirm instead of being committed.
   */
  clearMatch: boolean;
}

export type ProposeError =
  | "not_on_list"
  | "no_change_requested"
  | "both_episode_forms"
  | "no_change"
  | "episodes_exceed_total"
  | "negative_episodes"
  | "score_out_of_range";

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; error: ProposeError };

/**
 * Stages a change for one list entry. Nothing is written to MAL here: only commitProposal does
 * that, and only for a proposal created by this function.
 */
export async function proposeUpdate(db: Db, input: ProposeInput): Promise<ProposeResult> {
  if (input.episodesWatched !== undefined && input.episodesDelta !== undefined) {
    return { ok: false, error: "both_episode_forms" };
  }
  if (
    input.status === undefined &&
    input.episodesWatched === undefined &&
    input.episodesDelta === undefined &&
    input.score === undefined &&
    input.isRewatching === undefined
  ) {
    return { ok: false, error: "no_change_requested" };
  }

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
    .where(and(eq(listEntries.userId, input.userId), eq(listEntries.animeId, input.animeId)))
    .limit(1);
  if (!entry) return { ok: false, error: "not_on_list" };

  const requested: RequestedChange = {
    ...(input.status !== undefined && { status: input.status }),
    ...(input.episodesWatched !== undefined && { episodesWatched: input.episodesWatched }),
    ...(input.episodesDelta !== undefined && {
      episodesWatched: entry.episodesWatched + input.episodesDelta,
    }),
    ...(input.score !== undefined && { score: input.score }),
    ...(input.isRewatching !== undefined && { isRewatching: input.isRewatching }),
  };
  const normalized = normalizeChange(entry, requested);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const change = normalized.change;
  if (Object.keys(change).length === 0) return { ok: false, error: "no_change" };

  const before: ListState = {
    status: entry.status,
    episodesWatched: entry.episodesWatched,
    score: entry.score,
    isRewatching: entry.isRewatching,
  };
  const goesBackwards =
    change.episodesWatched !== undefined && change.episodesWatched < entry.episodesWatched;
  const confirmationReason = !input.clearMatch
    ? "ambiguous_match"
    : goesBackwards
      ? "progress_backwards"
      : null;

  const idempotencyKey = keyFor(input.runId, input.animeId, change);
  await db
    .insert(proposals)
    .values({
      userId: input.userId,
      animeId: input.animeId,
      source: "agent",
      runId: input.runId,
      idempotencyKey,
      before,
      change,
      requiresConfirmation: confirmationReason !== null,
      confirmationReason,
    })
    .onConflictDoNothing({ target: [proposals.userId, proposals.idempotencyKey] });

  // Either the row just inserted or the identical proposal from an earlier call in this run.
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.userId, input.userId), eq(proposals.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!proposal) throw new Error("proposal insert returned no row");
  return { ok: true, proposal };
}

/** Same run, same anime, same resulting values: the same proposal. */
export function keyFor(runId: string, animeId: number, change: ListChange): string {
  const canonical = JSON.stringify(Object.entries(change).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256")
    .update(`${runId}|${String(animeId)}|${canonical}`)
    .digest("hex");
}
