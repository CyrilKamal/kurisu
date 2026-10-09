import { desc, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, dropReasons, tasteGenres } from "../db/schema.js";

/**
 * How many scored shows a genre needs before its average counts in full. With fewer, its
 * affinity is pulled toward 0: one 10/10 isekai shouldn't make isekai a favorite.
 */
export const AFFINITY_PRIOR = 5;

export interface TasteProfile {
  /** The user's average score over everything they scored; null if they scored nothing. */
  overallMean: number | null;
  scoredCount: number;
  genres: {
    genre: string;
    scored: number;
    meanScore: number | null;
    dropped: number;
    affinity: number;
  }[];
  dropReasons: {
    id: string;
    animeId: number;
    title: string;
    pictureUrl: string | null;
    category: string;
    said: string;
    createdAt: Date;
  }[];
}

/**
 * Recomputes the user's rating patterns from the mirror: per genre, their average score, how
 * many they scored and dropped, and the affinity (their genre average minus their overall
 * average, shrunk by AFFINITY_PRIOR).
 */
export async function refreshTaste(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // One refresh per user at a time: a refresh after a sync and one at the start of a
    // recommendation can overlap, and both would insert the same rows.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`taste:${userId}`}))`);
    await tx.delete(tasteGenres).where(eq(tasteGenres.userId, userId));
    await tx.execute(sql`
      WITH overall AS (
        SELECT avg(score)::real AS mean
        FROM list_entries
        WHERE user_id = ${userId} AND score > 0
      ),
      per_genre AS (
        SELECT g.genre,
               count(*) FILTER (WHERE e.score > 0)::int AS scored,
               avg(e.score) FILTER (WHERE e.score > 0)::real AS mean_score,
               count(*) FILTER (WHERE e.status = 'dropped')::int AS dropped
        FROM list_entries e
        JOIN anime a ON a.mal_id = e.anime_id
        CROSS JOIN LATERAL unnest(a.genres) AS g(genre)
        WHERE e.user_id = ${userId}
        GROUP BY g.genre
      )
      INSERT INTO taste_genres (user_id, genre, scored, mean_score, dropped, affinity, updated_at)
      SELECT ${userId}, p.genre, p.scored, p.mean_score, p.dropped,
             CASE WHEN p.scored = 0 OR o.mean IS NULL THEN 0
                  ELSE ((p.mean_score - o.mean) * p.scored / (p.scored + ${AFFINITY_PRIOR}))::real
             END,
             now()
      FROM per_genre p CROSS JOIN overall o
    `);
  });
}

/** The user's taste memory: rating patterns by genre (best first) and drop reasons (newest first). */
export async function loadTaste(db: Db, userId: string): Promise<TasteProfile> {
  const [overall] = await db
    .execute<{ mean: number | null; scored: number }>(
      sql`
    SELECT avg(score)::real AS mean, count(*)::int AS scored
    FROM list_entries WHERE user_id = ${userId} AND score > 0
  `,
    )
    .then((r) => r.rows);
  const genres = await db
    .select({
      genre: tasteGenres.genre,
      scored: tasteGenres.scored,
      meanScore: tasteGenres.meanScore,
      dropped: tasteGenres.dropped,
      affinity: tasteGenres.affinity,
    })
    .from(tasteGenres)
    .where(eq(tasteGenres.userId, userId))
    .orderBy(desc(tasteGenres.affinity), desc(tasteGenres.scored));
  const reasons = await db
    .select({
      id: dropReasons.id,
      animeId: dropReasons.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      category: dropReasons.category,
      said: dropReasons.said,
      createdAt: dropReasons.createdAt,
    })
    .from(dropReasons)
    .innerJoin(anime, eq(anime.malId, dropReasons.animeId))
    .where(eq(dropReasons.userId, userId))
    .orderBy(desc(dropReasons.createdAt));
  return {
    overallMean: overall?.mean ?? null,
    scoredCount: overall?.scored ?? 0,
    genres,
    dropReasons: reasons,
  };
}
