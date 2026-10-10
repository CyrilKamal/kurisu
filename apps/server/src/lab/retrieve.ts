import { and, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { embeddings } from "../db/schema.js";
import type { Embedder } from "../llm/modelClient.js";
import { nearest, queryVector } from "./embeddings.js";

/** Documents handed to the answering model. */
export const RETRIEVE_K = 8;
/** Closest documents by meaning looked at. */
const MEANING_K = 20;
/** Shows whose names appear in the question looked at, and how well a name must appear. */
const NAMES_K = 10;
const NAME_MIN = 0.6;
/** Reciprocal rank fusion's damping, as in list search. */
const RRF_K = 60;

export interface Retrieved {
  malId: number;
  text: string;
  /** Cosine similarity to the question, when the meaning channel found it. */
  similarity: number | null;
  /** How well one of its names appears in the question, when the name channel found it. */
  nameScore: number | null;
}

export interface Retrieval {
  /** The fused top k, best first. */
  documents: Retrieved[];
  /** Each channel's own order, for measuring them apart. */
  byMeaning: number[];
  byName: number[];
}

/**
 * The user's list documents most likely to answer a question (Milestone 7's RAG): the nearest by
 * meaning, and the shows whose names appear in it (trigram), fused by reciprocal rank. Documents
 * come from ensureListDocuments.
 */
export async function retrieve(
  deps: { db: Db; embedder: Embedder },
  userId: string,
  question: string,
  k: number = RETRIEVE_K,
): Promise<Retrieval> {
  const near = await nearest(deps, "history", await queryVector(deps.embedder, question), {
    k: MEANING_K,
    userId,
  });
  const named = await namesIn(deps.db, userId, question);

  const byMeaning = near.map((n) => Number(n.ref));
  const byName = named.map((n) => n.malId);
  const rank = (order: number[]) => new Map(order.map((id, i) => [id, i] as const));
  const meaningRank = rank(byMeaning);
  const nameRank = rank(byName);
  const fused = (id: number) =>
    (meaningRank.has(id) ? 1 / (RRF_K + (meaningRank.get(id) ?? 0)) : 0) +
    (nameRank.has(id) ? 1 / (RRF_K + (nameRank.get(id) ?? 0)) : 0);
  const top = [...new Set([...byMeaning, ...byName])]
    .sort((a, b) => fused(b) - fused(a) || a - b)
    .slice(0, k);

  // The name channel's documents weren't fetched with the nearest ones.
  const texts = new Map(near.map((n) => [Number(n.ref), n.text] as const));
  const missing = top.filter((id) => !texts.has(id));
  if (missing.length > 0) {
    const rows = await deps.db
      .select({ ref: embeddings.ref, text: embeddings.text })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.kind, "history"),
          eq(embeddings.model, deps.embedder.model),
          eq(embeddings.userId, userId),
          inArray(embeddings.ref, missing.map(String)),
        ),
      );
    for (const row of rows) texts.set(Number(row.ref), row.text);
  }
  const similarity = new Map(near.map((n) => [Number(n.ref), n.similarity] as const));
  const nameScore = new Map(named.map((n) => [n.malId, n.score] as const));
  return {
    documents: top.flatMap((id) => {
      const text = texts.get(id);
      return text === undefined
        ? []
        : [
            {
              malId: id,
              text,
              similarity: similarity.get(id) ?? null,
              nameScore: nameScore.get(id) ?? null,
            },
          ];
    }),
    byMeaning,
    byName,
  };
}

/** Shows on the user's list one of whose names appears in the question, best first. */
async function namesIn(
  db: Db,
  userId: string,
  question: string,
): Promise<{ malId: number; score: number }[]> {
  const rows = await db.execute<{ mal_id: number; score: number }>(sql`
    SELECT a.mal_id, MAX(word_similarity(lower(n.name), lower(${question})))::float8 AS score
    FROM list_entries le
    JOIN anime a ON a.mal_id = le.anime_id
    CROSS JOIN unnest(array_remove(ARRAY[a.title, a.title_en] || a.synonyms, NULL)) AS n(name)
    WHERE le.user_id = ${userId} AND length(n.name) > 2
    GROUP BY a.mal_id
    HAVING MAX(word_similarity(lower(n.name), lower(${question}))) >= ${NAME_MIN}
    ORDER BY score DESC, a.mal_id
    LIMIT ${NAMES_K}
  `);
  return rows.rows.map((row) => ({ malId: row.mal_id, score: row.score }));
}
