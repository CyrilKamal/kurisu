import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries } from "../db/schema.js";
import type { ListStatus } from "../writes/normalize.js";

/** Below this, a name isn't considered a match at all. */
export const MIN_MATCH = 0.35;
/** A clear match needs at least this score... */
export const CLEAR_MATCH = 0.6;
/** ...and must beat every other candidate by this much. */
export const CLEAR_MARGIN = 0.15;

export interface ListEntryView {
  animeId: number;
  title: string;
  titleEn: string | null;
  mediaType: string | null;
  numEpisodes: number | null;
  status: ListStatus;
  episodesWatched: number;
  score: number;
  isRewatching: boolean;
}

export interface SearchCandidate extends ListEntryView {
  /** 0–1: best trigram similarity between any query and any of the show's names. */
  matchScore: number;
  /** The name that matched best (title, English, Japanese or a synonym). */
  matchedName: string;
  /** True if the words point at this show clearly enough for some change (see clearBy). */
  clear: boolean;
  /**
   * Why it's clear:
   * - "unique": the top match, ahead of every other by a margin. Clear for any change.
   * - "only_in_progress": tied with other matches, but the only one being watched or on hold
   *   (e.g. "frieren ep 5" with season 1 completed and season 2 watching). Clear only for
   *   forward progress; dropping or scoring "the isekai one" among several must still ask.
   */
  clearBy: "unique" | "only_in_progress" | null;
}

/**
 * Fuzzy search over the user's mirrored list (never live MAL). Scores every name a show has
 * against every query variant (e.g. "JJK" and "Jujutsu Kaisen") with pg_trgm and keeps the best.
 */
export async function searchMyList(
  db: Db,
  userId: string,
  queries: string[],
  limit = 5,
): Promise<SearchCandidate[]> {
  const cleaned = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter((q) => q))];
  if (cleaned.length === 0) return [];
  // Drizzle spreads a JS array into separate parameters, so build the Postgres array explicitly.
  const queryArray = sql`ARRAY[${sql.join(
    cleaned.map((q) => sql`${q}`),
    sql`, `,
  )}]::text[]`;

  const rows = await db.execute<{
    anime_id: number;
    title: string;
    title_en: string | null;
    media_type: string | null;
    num_episodes: number | null;
    status: ListStatus;
    episodes_watched: number;
    score: number;
    is_rewatching: boolean;
    match_score: number;
    matched_name: string;
  }>(sql`
    SELECT a.mal_id AS anime_id, a.title, a.title_en, a.media_type, a.num_episodes,
           le.status, le.num_episodes_watched AS episodes_watched, le.score, le.is_rewatching,
           m.score AS match_score, m.name AS matched_name
    FROM ${listEntries} le
    JOIN ${anime} a ON a.mal_id = le.anime_id
    CROSS JOIN LATERAL (
      SELECT n.name,
             GREATEST(similarity(lower(n.name), q.q), word_similarity(q.q, lower(n.name)))::float8
               AS score
      FROM unnest(ARRAY[a.title, a.title_en, a.title_ja] || a.synonyms) AS n(name)
      CROSS JOIN unnest(${queryArray}) AS q(q)
      WHERE n.name IS NOT NULL
      ORDER BY score DESC
      LIMIT 1
    ) m
    WHERE le.user_id = ${userId} AND m.score >= ${MIN_MATCH}
    ORDER BY m.score DESC, a.mal_id
    LIMIT ${limit}
  `);

  const candidates = rows.rows.map((row): Omit<SearchCandidate, "clear" | "clearBy"> => ({
    animeId: row.anime_id,
    title: row.title,
    titleEn: row.title_en,
    mediaType: row.media_type,
    numEpisodes: row.num_episodes,
    status: row.status,
    episodesWatched: row.episodes_watched,
    score: row.score,
    isRewatching: row.is_rewatching,
    matchScore: Math.round(row.match_score * 1000) / 1000,
    matchedName: row.matched_name,
  }));
  return markClear(candidates);
}

/** Applies the clear-match rule to candidates sorted best first. */
export function markClear(
  candidates: Omit<SearchCandidate, "clear" | "clearBy">[],
): SearchCandidate[] {
  const top = candidates[0];
  if (!top) return [];
  const contenders = candidates.filter((c) => top.matchScore - c.matchScore < CLEAR_MARGIN);
  const active = contenders.filter((c) => c.status === "watching" || c.status === "on_hold");
  const strongEnough = top.matchScore >= CLEAR_MATCH;

  return candidates.map((candidate) => {
    let clearBy: SearchCandidate["clearBy"] = null;
    if (strongEnough && contenders.includes(candidate)) {
      if (contenders.length === 1) clearBy = "unique";
      else if (active.length === 1 && active[0] === candidate) clearBy = "only_in_progress";
    }
    return { ...candidate, clear: clearBy !== null, clearBy };
  });
}

/** One entry of the user's list, from the mirror. */
export async function getEntry(
  db: Db,
  userId: string,
  animeId: number,
): Promise<ListEntryView | null> {
  const [row] = await db
    .select({
      animeId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      score: listEntries.score,
      isRewatching: listEntries.isRewatching,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)))
    .limit(1);
  return row ?? null;
}
