import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, discovery, listEntries } from "../db/schema.js";
import { ensureEmbeddings, similarities } from "../lab/embeddings.js";
import type { Embedder } from "../llm/modelClient.js";

/**
 * Milestone 7's lab: recommendations also ranked by how close each show's synopsis is to what the
 * user asked for ("something dark", "make me cry"). Behind RECOMMEND_SEMANTIC_WEIGHT; at 0 the
 * ranking is as before.
 */
export interface SemanticRanking {
  embedder: Embedder;
  /** How much the fit counts in the ranking: 0 is off, 1 the full SEMANTIC_SCALE. */
  weight: number;
  /** Called when the embedder fails; the ranking then goes without it. */
  onError?: (err: unknown) => void;
}

/**
 * Requests that ask for nothing in particular, in a few wordings. Some synopses are close to any
 * casual request (hubs); a show's mean closeness to these is its baseline, taken off its
 * closeness to the real request. Several wordings, because one left the hubs on top of every
 * request worded differently from it (the calibration in the decision log).
 */
export const NEUTRAL_REQUESTS = [
  "recommend me an anime to watch",
  "what should I watch",
  "rec me anything",
  "can you recommend me a show",
  "idk what to watch tonight",
  "any recs for me?",
] as const;

/**
 * Each show's fit: its synopsis' similarity to the request minus its mean similarity to the
 * NEUTRAL_REQUESTS, so a request that names no mood or subject leaves every show near 0. Shows
 * without a synopsis vector are left out (no fit).
 */
export async function semanticFit(
  deps: { db: Db; embedder: Embedder },
  message: string,
  animeIds: number[],
): Promise<Map<number, number>> {
  const { vectors } = await deps.embedder.embed([message, ...NEUTRAL_REQUESTS], "query");
  const [asked, ...neutrals] = vectors;
  if (!asked || neutrals.length !== NEUTRAL_REQUESTS.length) {
    throw new Error("the embedder returned too few vectors");
  }
  const refs = animeIds.map(String);
  const toAsked = await similarities(deps, "synopsis", asked, refs);
  const baseline = new Map<string, number>();
  for (const neutral of neutrals) {
    for (const [ref, similarity] of await similarities(deps, "synopsis", neutral, refs)) {
      baseline.set(ref, (baseline.get(ref) ?? 0) + similarity / neutrals.length);
    }
  }
  const fit = new Map<number, number>();
  for (const [ref, similarity] of toAsked) {
    fit.set(Number(ref), similarity - (baseline.get(ref) ?? similarity));
  }
  return fit;
}

/** Makes sure these shows' synopses have current vectors; shows without one are skipped. */
export async function ensureSynopsisEmbeddings(
  deps: { db: Db; embedder: Embedder },
  shows: { malId: number; synopsis: string | null }[],
): Promise<{ embedded: number }> {
  const { embedded } = await ensureEmbeddings(
    deps,
    "synopsis",
    shows.flatMap((show) =>
      show.synopsis?.trim() ? [{ ref: String(show.malId), text: show.synopsis.trim() }] : [],
    ),
  );
  return { embedded };
}

/**
 * The synopses kurisu holds for the shows a user's recommendations draw on: their list and their
 * discovery pool (`pnpm lab:synopses` fills them in).
 */
export async function listedSynopses(
  db: Db,
  userId: string,
): Promise<{ malId: number; synopsis: string | null }[]> {
  const listed = db
    .select({ id: listEntries.animeId })
    .from(listEntries)
    .where(eq(listEntries.userId, userId));
  const pooled = db
    .select({ id: discovery.malId })
    .from(discovery)
    .where(eq(discovery.userId, userId));
  return db
    .select({ malId: anime.malId, synopsis: anime.synopsis })
    .from(anime)
    .where(
      and(
        isNotNull(anime.synopsis),
        or(inArray(anime.malId, listed), inArray(anime.malId, pooled)),
      ),
    );
}
