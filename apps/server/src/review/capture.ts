import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";

import { airingRows, latestAiredEpisode } from "../anilist/cache.js";
import type { Db } from "../db/client.js";
import {
  agentRuns,
  anime,
  changes,
  chatMessages,
  listEntries,
  proposals,
  reviewItems,
} from "../db/schema.js";

/** Earlier turns kept with a review item, as the eval's `history`. */
const HISTORY_TURNS = 4;

/** Model service failures (quota, outage, key): nothing an eval case could teach. */
const SERVICE_ERRORS = new Set(["model_rate_limited", "model_unavailable", "model_auth"]);

/** Why a reply that failed goes to the queue, or null when it isn't worth a look. */
export function failureNote(errors: (string | null)[], claimedNothing: boolean): string | null {
  const error = errors.find((e) => e !== null && !SERVICE_ERRORS.has(e));
  if (error) return error;
  return claimedNothing ? "claimed a change that didn't happen" : null;
}

/** An undo this soon after a chat write suggests the write was wrong. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The chat run behind a change, when the agent made it within the undo window. */
export async function chatRunOfChange(
  db: Db,
  userId: string,
  changeId: string,
  now = new Date(),
): Promise<string | null> {
  const [row] = await db
    .select({
      runId: proposals.runId,
      source: proposals.source,
      committedAt: changes.committedAt,
    })
    .from(changes)
    .innerJoin(proposals, eq(proposals.id, changes.proposalId))
    .where(and(eq(changes.id, changeId), eq(changes.userId, userId)));
  if (row?.source !== "agent" || row.runId === null) return null;
  if (now.getTime() - row.committedAt.getTime() > UNDO_WINDOW_MS) return null;
  return row.runId;
}

/** The final run of the reply the escalation chain led to, by the earlier run's id. */
export async function replyRunOf(db: Db, runId: string): Promise<string> {
  const [later] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .innerJoin(chatMessages, eq(chatMessages.runId, agentRuns.id))
    .where(eq(agentRuns.escalatedFromRunId, runId));
  return later?.id ?? runId;
}

export type ReviewKind = "error" | "undone" | "report";

/** One list entry as the eval snapshot holds it (eval/src/snapshot.ts): no scores or dates. */
export interface ReviewEntry {
  id: number;
  title: string;
  titleEn: string | null;
  titleJa: string | null;
  synonyms: string[];
  mediaType: string | null;
  numEpisodes: number | null;
  status: string;
  episodesWatched: number;
  isRewatching: boolean;
  airingStatus: string | null;
}

/** A show's newest aired episode when the item was captured, in the eval airing freeze's shape. */
export interface ReviewAiring {
  malId: number;
  anilistId: number;
  status: string | null;
  latestAired: number | null;
}

/**
 * Puts a reply in the review queue, with what replaying it needs: the user's message and the
 * turns before it, the reply, and the list as it was before the run. Returns false when there's
 * no such reply, or it's already queued for this reason.
 *
 * The list is today's mirror with this run's writes rolled back (adds removed, updates set back
 * to their `before`), so it matches the moment of the message for the shows the run touched.
 * Shows changed since by something else are as they are now.
 */
export async function captureReview(
  db: Db,
  input: { userId: string; runId: string; kind: ReviewKind; note: string | null },
  now = new Date(),
): Promise<boolean> {
  const { userId, runId } = input;
  const [reply] = await db
    .select({
      conversationId: chatMessages.conversationId,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .innerJoin(agentRuns, eq(agentRuns.id, chatMessages.runId))
    .where(and(eq(chatMessages.runId, runId), eq(agentRuns.userId, userId)));
  if (!reply) return false;

  const before = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, reply.conversationId),
        lt(chatMessages.createdAt, reply.createdAt),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_TURNS + 1);
  const [message, ...earlier] = before;
  if (message?.role !== "user") return false;

  const entries = await listBeforeRun(db, userId, await runChain(db, runId));
  const inserted = await db
    .insert(reviewItems)
    .values({
      userId,
      runId,
      kind: input.kind,
      note: input.note,
      message: message.content,
      history: earlier.reverse().map((turn) => ({
        role: turn.role === "user" ? "user" : "assistant",
        content: turn.content,
      })),
      reply: reply.content,
      listSnapshot: entries,
      airing: await airingNow(db, entries, now),
    })
    .onConflictDoNothing()
    .returning({ id: reviewItems.id });
  return inserted.length > 0;
}

/** The reply's run and the one it escalated from, whose writes the reply also stands for. */
async function runChain(db: Db, runId: string): Promise<string[]> {
  const [run] = await db
    .select({ escalatedFrom: agentRuns.escalatedFromRunId })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  return run?.escalatedFrom ? [runId, run.escalatedFrom] : [runId];
}

async function listBeforeRun(db: Db, userId: string, runIds: string[]): Promise<ReviewEntry[]> {
  const rows = await db
    .select({
      id: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      titleJa: anime.titleJa,
      synonyms: anime.synonyms,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      isRewatching: listEntries.isRewatching,
      airingStatus: anime.airingStatus,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(eq(listEntries.userId, userId))
    .orderBy(asc(anime.malId));
  const entries = new Map<number, ReviewEntry>(rows.map((row) => [row.id, row]));

  const written = await db
    .select({ animeId: changes.animeId, kind: changes.kind, before: changes.before })
    .from(changes)
    .innerJoin(proposals, eq(proposals.id, changes.proposalId))
    .where(and(eq(changes.userId, userId), inArray(proposals.runId, runIds)));
  for (const change of written) {
    if (change.kind === "add") {
      entries.delete(change.animeId);
      continue;
    }
    const entry = entries.get(change.animeId);
    if (!entry) continue;
    entries.set(change.animeId, {
      ...entry,
      ...(change.before.status !== undefined && { status: change.before.status }),
      ...(change.before.episodesWatched !== undefined && {
        episodesWatched: change.before.episodesWatched,
      }),
      ...(change.before.isRewatching !== undefined && {
        isRewatching: change.before.isRewatching,
      }),
    });
  }
  return [...entries.values()];
}

/** The newest aired episode of each show that's airing, as the app knew it at capture. */
async function airingNow(db: Db, entries: ReviewEntry[], now: Date): Promise<ReviewAiring[]> {
  const airing = await airingRows(
    db,
    entries.filter((e) => e.airingStatus !== "finished_airing").map((e) => e.id),
  );
  return [...airing.values()].flatMap((row) =>
    row.anilistId === null
      ? []
      : [
          {
            malId: row.malId,
            anilistId: row.anilistId,
            status: row.status,
            latestAired: latestAiredEpisode(row, now),
          },
        ],
  );
}
