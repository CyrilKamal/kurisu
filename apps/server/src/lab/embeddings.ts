import { createHash } from "node:crypto";

import {
  and,
  asc,
  cosineDistance,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";

import type { Db } from "../db/client.js";
import { embeddings } from "../db/schema.js";
import type { Embedder } from "../llm/modelClient.js";

export type EmbeddingKind = (typeof embeddings.$inferSelect)["kind"];

/** One text to keep as a vector: a show's names or synopsis, or a history document. */
export interface EmbedItem {
  ref: string;
  text: string;
}

/** Rows written per statement, to stay well under Postgres' parameter limit. */
const UPSERT_CHUNK = 100;

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** The owner filter: shared show text has no owner, a user's history has one. */
function ownedBy(userId: string | null): SQL {
  return userId === null ? isNull(embeddings.userId) : eq(embeddings.userId, userId);
}

/**
 * Makes sure each text has a current vector from this embedder: only new or changed texts (by
 * hash) are embedded, so running it again costs nothing. Returns how many were embedded.
 */
export async function ensureEmbeddings(
  deps: { db: Db; embedder: Embedder },
  kind: EmbeddingKind,
  items: EmbedItem[],
  options: { userId?: string | null } = {},
): Promise<{ embedded: number; kept: number; inputTokens: number }> {
  const { db, embedder } = deps;
  const userId = options.userId ?? null;
  const unique = [...new Map(items.map((item) => [item.ref, item])).values()];
  if (unique.length === 0) return { embedded: 0, kept: 0, inputTokens: 0 };

  const existing = await db
    .select({ ref: embeddings.ref, textHash: embeddings.textHash })
    .from(embeddings)
    .where(
      and(
        eq(embeddings.kind, kind),
        eq(embeddings.model, embedder.model),
        ownedBy(userId),
        inArray(
          embeddings.ref,
          unique.map((item) => item.ref),
        ),
      ),
    );
  const current = new Map(existing.map((row) => [row.ref, row.textHash]));
  const due = unique.filter((item) => current.get(item.ref) !== textHash(item.text));
  if (due.length === 0) return { embedded: 0, kept: unique.length, inputTokens: 0 };

  const { vectors, inputTokens } = await embedder.embed(
    due.map((item) => item.text),
    "document",
  );
  const now = new Date();
  const rows = due.map((item, i) => ({
    kind,
    ref: item.ref,
    userId,
    model: embedder.model,
    textHash: textHash(item.text),
    text: item.text,
    embedding: vectors[i] ?? [],
    updatedAt: now,
  }));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await db
      .insert(embeddings)
      .values(rows.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [embeddings.kind, embeddings.model, embeddings.ref, embeddings.userId],
        set: {
          textHash: sql`excluded.text_hash`,
          text: sql`excluded.text`,
          embedding: sql`excluded.embedding`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return { embedded: due.length, kept: unique.length - due.length, inputTokens };
}

/**
 * Removes this embedder's vectors of one kind and owner whose refs aren't in `keep`: a show that
 * left the list takes its document with it.
 */
export async function pruneEmbeddings(
  deps: { db: Db; embedder: Embedder },
  kind: EmbeddingKind,
  keep: string[],
  options: { userId?: string | null } = {},
): Promise<number> {
  const removed = await deps.db
    .delete(embeddings)
    .where(
      and(
        eq(embeddings.kind, kind),
        eq(embeddings.model, deps.embedder.model),
        ownedBy(options.userId ?? null),
        keep.length > 0 ? notInArray(embeddings.ref, keep) : undefined,
      ),
    )
    .returning({ id: embeddings.id });
  return removed.length;
}

export interface Neighbor {
  ref: string;
  text: string;
  /** Cosine similarity, -1 to 1; vectors are unit length, so 1 is the same direction. */
  similarity: number;
}

/**
 * The `k` stored texts closest to a vector, among this embedder's vectors of one kind and owner,
 * optionally only among `refs`.
 */
export async function nearest(
  deps: { db: Db; embedder: Embedder },
  kind: EmbeddingKind,
  vector: number[],
  options: { k: number; userId?: string | null; refs?: string[] },
): Promise<Neighbor[]> {
  const { db, embedder } = deps;
  if (options.refs?.length === 0) return [];
  const distance = cosineDistance(embeddings.embedding, vector);
  const rows = await db.transaction(async (tx) => {
    // An HNSW scan takes the nearest vectors of every kind and owner first and filters after, so
    // a narrow filter (one user's history among everyone's) could come back short. pgvector's
    // iterative scan keeps going, in order, until it has k.
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
    return tx
      .select({ ref: embeddings.ref, text: embeddings.text, distance })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.kind, kind),
          eq(embeddings.model, embedder.model),
          ownedBy(options.userId ?? null),
          options.refs ? inArray(embeddings.ref, options.refs) : undefined,
        ),
      )
      .orderBy(asc(distance))
      .limit(options.k);
  });
  return rows.map((row) => ({
    ref: row.ref,
    text: row.text,
    similarity: 1 - Number(row.distance),
  }));
}

/**
 * How close each of these refs' vectors is to a vector (cosine similarity), for scoring a known
 * set of shows. Exact: every listed vector is compared, without the index. Refs without a vector
 * from this embedder are left out.
 */
export async function similarities(
  deps: { db: Db; embedder: Embedder },
  kind: EmbeddingKind,
  vector: number[],
  refs: string[],
  options: { userId?: string | null } = {},
): Promise<Map<string, number>> {
  if (refs.length === 0) return new Map();
  const rows = await deps.db
    .select({ ref: embeddings.ref, distance: cosineDistance(embeddings.embedding, vector) })
    .from(embeddings)
    .where(
      and(
        eq(embeddings.kind, kind),
        eq(embeddings.model, deps.embedder.model),
        ownedBy(options.userId ?? null),
        inArray(embeddings.ref, [...new Set(refs)]),
      ),
    );
  return new Map(rows.map((row) => [row.ref, 1 - Number(row.distance)]));
}

/** A search's words as a vector, embedded as a query (some models embed queries differently). */
export async function queryVector(embedder: Embedder, text: string): Promise<number[]> {
  const { vectors } = await embedder.embed([text], "query");
  const [vector] = vectors;
  if (!vector) throw new Error("the embedder returned no vector");
  return vector;
}
