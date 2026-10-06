import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { briefAllows, type BriefRule } from "../agent/briefReply.js";
import type { DropCategory } from "../taste/dropReasons.js";
import type { Db } from "../db/client.js";
import { anime, listEntries, proposals } from "../db/schema.js";
import { NOT_YET_AIRED } from "../mal/client.js";
import {
  normalizeChange,
  type ListChange,
  type ListState,
  type ListStatus,
  type NormalizeResult,
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
  /**
   * Set when the user said "the newest episode" without a number (decided by the caller from
   * their message), with the show's latest aired episode if AniList's schedule says. Progress
   * is held for them to confirm unless it lands exactly on that episode.
   */
  newestEpisode?: { latestAired: number | null };
  /**
   * Set when the message replies to a morning brief (decided by the caller), with the episodes
   * the brief listed for this show (empty if it wasn't listed) and which of the user's rules the
   * message follows. Progress the rule doesn't allow is held (see agent/briefReply.ts).
   */
  briefReply?: { listed: number[]; rule: BriefRule };
  /** Why the user is dropping the show, when they said (see taste/dropReasons.ts). */
  dropReason?: { category: DropCategory; said: string };
  /**
   * The user's message has no number in it (decided by the caller), so a score in this change
   * wasn't given by them. It's held for them to confirm.
   */
  noNumberGiven?: boolean;
}

export type ProposeError =
  | "unknown_anime"
  | "no_change_requested"
  | "both_episode_forms"
  | "no_change"
  | "episodes_exceed_total"
  | "negative_episodes"
  | "score_out_of_range"
  | "rewatch_not_completed";

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; error: ProposeError };

/** Why every add waits for the user: they asked, never to be second-guessed by the model. */
export const ADDS_TO_LIST = "adds_to_list";

/**
 * Stages a change for one list entry, or an add for a show not on the list. Nothing is written
 * to MAL here: only commitProposal does that, and only for a proposal created by this function.
 */
export async function proposeUpdate(db: Db, input: ProposeInput): Promise<ProposeResult> {
  if (input.episodesWatched !== undefined && input.episodesDelta !== undefined) {
    return { ok: false, error: "both_episode_forms" };
  }
  const [entry] = await db
    .select({
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      score: listEntries.score,
      isRewatching: listEntries.isRewatching,
      numEpisodes: anime.numEpisodes,
      airingStatus: anime.airingStatus,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(and(eq(listEntries.userId, input.userId), eq(listEntries.animeId, input.animeId)))
    .limit(1);
  // For a show not on the list, the add itself is the change ("add X").
  if (!entry) return proposeAdd(db, input);
  if (
    input.status === undefined &&
    input.episodesWatched === undefined &&
    input.episodesDelta === undefined &&
    input.score === undefined &&
    input.isRewatching === undefined
  ) {
    return { ok: false, error: "no_change_requested" };
  }

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
      : isProgressBeforeAiring(entry, change)
        ? "not_yet_aired"
        : input.newestEpisode &&
            isProgress(entry, change) &&
            change.episodesWatched !== input.newestEpisode.latestAired
          ? "newest_episode_unknown"
          : input.briefReply &&
              isProgress(entry, change) &&
              !briefAllows(
                input.briefReply.rule,
                input.briefReply.listed,
                entry.episodesWatched,
                change.episodesWatched,
              )
            ? input.briefReply.rule.kind === "unnamed"
              ? "not_named"
              : "not_in_brief"
            : input.noNumberGiven && change.score !== undefined
              ? "score_not_given"
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
      ...(input.dropReason && change.status === "dropped"
        ? { dropReason: input.dropReason.category, dropSaid: input.dropReason.said }
        : {}),
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

/**
 * Stages putting a show on the list, with the status and progress the user said (Plan to Watch
 * when they gave none). The same rules apply as for an entry at Plan to Watch with nothing
 * watched: "watched ep 3" makes it Watching, finishing it makes it Completed. Every add waits for
 * the user to confirm it, however clear the match: adding is never the model's call to finish.
 */
async function proposeAdd(db: Db, input: ProposeInput): Promise<ProposeResult> {
  const [show] = await db
    .select({ numEpisodes: anime.numEpisodes })
    .from(anime)
    .where(eq(anime.malId, input.animeId))
    .limit(1);
  if (!show) return { ok: false, error: "unknown_anime" };
  // A rewatch is of a show already completed on the list.
  if (input.isRewatching !== undefined) return { ok: false, error: "rewatch_not_completed" };

  const normalized = addChange(show.numEpisodes, {
    ...(input.status !== undefined && { status: input.status }),
    ...(input.episodesWatched !== undefined && { episodesWatched: input.episodesWatched }),
    ...(input.episodesDelta !== undefined && { episodesWatched: input.episodesDelta }),
    ...(input.score !== undefined && { score: input.score }),
  });
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const change = normalized.change;

  const idempotencyKey = keyFor(input.runId, input.animeId, change, "add");
  await db
    .insert(proposals)
    .values({
      userId: input.userId,
      animeId: input.animeId,
      source: "agent",
      kind: "add",
      runId: input.runId,
      idempotencyKey,
      before: null,
      change,
      requiresConfirmation: true,
      confirmationReason: ADDS_TO_LIST,
    })
    .onConflictDoNothing({ target: [proposals.userId, proposals.idempotencyKey] });
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.userId, input.userId), eq(proposals.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!proposal) throw new Error("proposal insert returned no row");
  return { ok: true, proposal };
}

/**
 * The change an add makes: the update rules applied to an empty entry at Plan to Watch, always
 * with a status, since MAL needs one to create the entry. The eval uses it for expected adds.
 */
export function addChange(numEpisodes: number | null, requested: RequestedChange): NormalizeResult {
  const empty = {
    status: "plan_to_watch" as const,
    episodesWatched: 0,
    score: 0,
    isRewatching: false,
    numEpisodes,
  };
  const normalized = normalizeChange(empty, requested);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    change: { ...normalized.change, status: normalized.change.status ?? "plan_to_watch" },
  };
}

/**
 * Progress on a show MAL says hasn't aired (more episodes, or completing it). Unlikely to be
 * right, but the mirror's airing status is only as fresh as the last sync, so such a change is
 * held for confirmation rather than refused. Status changes like dropping it are fine.
 */
export function isProgressBeforeAiring(
  entry: { airingStatus: string | null; episodesWatched: number },
  change: ListChange,
): boolean {
  return entry.airingStatus === NOT_YET_AIRED && isProgress(entry, change);
}

/** More episodes, or completing the show. */
export function isProgress(entry: { episodesWatched: number }, change: ListChange): boolean {
  return (
    (change.episodesWatched !== undefined && change.episodesWatched > entry.episodesWatched) ||
    change.status === "completed"
  );
}

/** Same run, same anime, same kind of write, same resulting values: the same proposal. */
export function keyFor(
  runId: string,
  animeId: number,
  change: ListChange,
  kind: "update" | "add" = "update",
): string {
  const canonical = JSON.stringify(Object.entries(change).sort(([a], [b]) => a.localeCompare(b)));
  // Updates keep the key they always had.
  const prefix = kind === "update" ? "" : `${kind}|`;
  return createHash("sha256")
    .update(`${prefix}${runId}|${String(animeId)}|${canonical}`)
    .digest("hex");
}
