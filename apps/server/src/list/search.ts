import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries } from "../db/schema.js";
import { NOT_YET_AIRED } from "../mal/client.js";
import type { ListStatus } from "../writes/normalize.js";
import { matchesSeason, normalizeName, seasonRef, type SeasonRef } from "./seasons.js";

/** Below this, a name isn't considered a match at all. */
export const MIN_MATCH = 0.35;
/** A clear match needs at least this score... */
export const CLEAR_MATCH = 0.6;
/** ...and must beat every other candidate by this much. */
export const CLEAR_MARGIN = 0.15;
/**
 * The best a name can score without being the query exactly. "Another" inside "...in Another
 * World" is a full word match, but it mustn't tie with the show called "Another".
 */
export const PARTIAL_MATCH_CAP = 0.95;
/** How many entries the clear-match rule looks at, so a hidden rival can't make one look unique. */
const POOL_SIZE = 20;

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
  /** MAL's airing status: finished_airing, currently_airing or not_yet_aired. */
  airingStatus: string | null;
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
   * - "unique": the only show the words point at. Clear for any change.
   * - "only_in_progress": tied with other seasons, but the only one being watched or on hold
   *   (e.g. "frieren ep 5" with season 1 completed and season 2 watching). Clear only for
   *   forward progress; dropping or scoring "the isekai one" among several must still ask.
   *   A show that hasn't aired yet isn't in progress, even if the list says watching.
   */
  clearBy: ClearBy | null;
}

export type ClearBy = "unique" | "only_in_progress";

/** An entry with its score against each query, as the clear-match rule needs it. */
export interface ScoredEntry extends Omit<SearchCandidate, "clear" | "clearBy"> {
  /** Every name the show has: title, English, Japanese and synonyms. */
  names: string[];
  /** Best score per query, in query order. */
  scores: number[];
  /** Whether one of the show's names is exactly the query, per query. */
  exact: boolean[];
}

/**
 * Fuzzy search over the user's mirrored list (never live MAL). Scores every name a show has
 * against every query with pg_trgm. Each query is judged on its own, so one search can carry
 * title variants ("jjk", "Jujutsu Kaisen") or several shows ("World Trigger", "One Piece").
 */
export async function searchMyList(
  db: Db,
  userId: string,
  queries: string[],
  limit = 5,
): Promise<SearchCandidate[]> {
  const cleaned = [...new Set(queries.map(normalizeName).filter((q) => q))];
  if (cleaned.length === 0) return [];
  // Drizzle spreads a JS array into separate parameters, so build the Postgres array explicitly.
  const queryArray = sql`ARRAY[${sql.join(
    cleaned.map((q) => sql`${q}`),
    sql`, `,
  )}]::text[]`;
  // Exact (after dropping case and punctuation, as normalizeName does) scores 1; anything else is
  // capped just below it.
  const score = sql`CASE
      WHEN trim(regexp_replace(lower(n.name), '[^[:alnum:]]+', ' ', 'g')) = q.q THEN 1.0
      ELSE LEAST(${PARTIAL_MATCH_CAP},
                 GREATEST(similarity(lower(n.name), q.q), word_similarity(q.q, lower(n.name))))
    END::float8`;
  const names = sql`array_remove(ARRAY[a.title, a.title_en, a.title_ja] || a.synonyms, NULL)`;

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
    airing_status: string | null;
    names: string[];
    scores: number[];
    exact: boolean[];
    match_score: number;
    matched_name: string;
  }>(sql`
    SELECT a.mal_id AS anime_id, a.title, a.title_en, a.media_type, a.num_episodes,
           le.status, le.num_episodes_watched AS episodes_watched, le.score, le.is_rewatching,
           a.airing_status, ${names} AS names, per.scores, per.exact,
           best.score AS match_score, best.name AS matched_name
    FROM ${listEntries} le
    JOIN ${anime} a ON a.mal_id = le.anime_id
    CROSS JOIN LATERAL (
      SELECT n.name, ${score} AS score
      FROM unnest(${names}) AS n(name)
      CROSS JOIN unnest(${queryArray}) AS q(q)
      ORDER BY score DESC
      LIMIT 1
    ) best
    CROSS JOIN LATERAL (
      SELECT array_agg(s.score ORDER BY s.qi) AS scores, array_agg(s.exact ORDER BY s.qi) AS exact
      FROM (
        SELECT q.qi, MAX(${score}) AS score,
               BOOL_OR(trim(regexp_replace(lower(n.name), '[^[:alnum:]]+', ' ', 'g')) = q.q) AS exact
        FROM unnest(${names}) AS n(name)
        CROSS JOIN unnest(${queryArray}) WITH ORDINALITY AS q(q, qi)
        GROUP BY q.qi
      ) s
    ) per
    WHERE le.user_id = ${userId} AND best.score >= ${MIN_MATCH}
    ORDER BY best.score DESC, a.mal_id
    LIMIT ${POOL_SIZE}
  `);

  const pool = rows.rows.map((row): ScoredEntry => ({
    animeId: row.anime_id,
    title: row.title,
    titleEn: row.title_en,
    mediaType: row.media_type,
    numEpisodes: row.num_episodes,
    status: row.status,
    episodesWatched: row.episodes_watched,
    score: row.score,
    isRewatching: row.is_rewatching,
    airingStatus: row.airing_status,
    matchScore: Math.round(row.match_score * 1000) / 1000,
    matchedName: row.matched_name,
    names: row.names,
    scores: row.scores.map(Number),
    exact: row.exact,
  }));
  const marked = markClear(pool, cleaned);
  // Clear matches first, so the model always sees them, then the best of the rest.
  return [...marked.filter((c) => c.clear), ...marked.filter((c) => !c.clear)].slice(0, limit);
}

/**
 * The clear-match rule, applied to each query on its own. For one query, among the entries
 * within CLEAR_MARGIN of the best (which must reach CLEAR_MATCH):
 * 1. A single entry with exactly that name is clear, unless other seasons start with it
 *    ("Bungou Stray Dogs" is also the start of "Bungou Stray Dogs 4th Season").
 * 2. A season or part number in the query ("danmachi 4th season", "tog s2") keeps only the
 *    entries that are that season. If none is, and the franchise numbers its seasons, the
 *    season isn't on the list, so nothing is clear. Franchises that name seasons after arcs
 *    ("Imperial Wrath of the Gods") can't be checked this way, so the number is ignored.
 * 3. If one entry is left, it's clear. If several seasons of one franchise are left, the only
 *    one in progress is clear for forward progress. Different shows that share a word ("blue"
 *    in Blue Lock and Grand Blue, "the isekai one") stay unclear.
 * An entry is clear if any query makes it clear; "unique" beats "only_in_progress".
 */
export function markClear(pool: ScoredEntry[], queries: string[]): SearchCandidate[] {
  const clearBy = new Map<number, ClearBy>();
  queries.forEach((query, qi) => {
    const found = clearForQuery(pool, qi, query);
    if (found && (found.by === "unique" || !clearBy.has(found.id))) {
      clearBy.set(found.id, found.by);
    }
  });
  return pool.map((e) => {
    const by = clearBy.get(e.animeId) ?? null;
    return {
      animeId: e.animeId,
      title: e.title,
      titleEn: e.titleEn,
      mediaType: e.mediaType,
      numEpisodes: e.numEpisodes,
      status: e.status,
      episodesWatched: e.episodesWatched,
      score: e.score,
      isRewatching: e.isRewatching,
      airingStatus: e.airingStatus,
      matchScore: e.matchScore,
      matchedName: e.matchedName,
      clear: by !== null,
      clearBy: by,
    };
  });
}

function clearForQuery(
  pool: ScoredEntry[],
  qi: number,
  query: string,
): { id: number; by: ClearBy } | null {
  const scoreOf = (e: ScoredEntry) => e.scores[qi] ?? 0;
  const ranked = pool
    .filter((e) => scoreOf(e) >= MIN_MATCH)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const top = ranked[0];
  if (!top || scoreOf(top) < CLEAR_MATCH) return null;
  let contenders = ranked.filter((e) => scoreOf(top) - scoreOf(e) < CLEAR_MARGIN);

  const exact = contenders.filter((e) => e.exact[qi]);
  const siblings = contenders.filter(
    (e) => !e.exact[qi] && e.names.some((n) => normalizeName(n).startsWith(`${query} `)),
  );
  if (exact.length === 1 && exact[0] && siblings.length === 0)
    return { id: exact[0].animeId, by: "unique" };

  const wanted = seasonRef(query);
  if (wanted.season !== null || wanted.part !== null) {
    const narrowed = contenders.filter((e) => matchesSeason(e.names, wanted));
    if (narrowed.length > 0) contenders = narrowed;
    else if (numbersItsSeasons(contenders, wanted)) return null;
  }
  if (contenders.length === 1 && contenders[0]) return { id: contenders[0].animeId, by: "unique" };
  if (!sameFranchise(contenders)) return null;

  const active = contenders.filter(
    (e) => (e.status === "watching" || e.status === "on_hold") && e.airingStatus !== NOT_YET_AIRED,
  );
  return active.length === 1 && active[0]
    ? { id: active[0].animeId, by: "only_in_progress" }
    : null;
}

/** Whether any of the entries has a number of the kind the query asks for in its names. */
function numbersItsSeasons(entries: ScoredEntry[], wanted: SeasonRef): boolean {
  return entries.some((e) =>
    e.names.some((n) => {
      const ref = seasonRef(n);
      return (
        (wanted.season !== null && ref.season !== null) ||
        (wanted.part !== null && ref.part !== null)
      );
    }),
  );
}

/**
 * Whether the entries look like seasons of one franchise: each has a name starting with the
 * same words ("Mushoku Tensei", "Nanatsu no Taizai"). Unrelated shows rarely do.
 */
function sameFranchise(entries: ScoredEntry[]): boolean {
  const [first, ...rest] = entries;
  if (!first) return false;
  for (const name of first.names) {
    const words = normalizeName(name).split(" ");
    for (let k = words.length; k > 0; k--) {
      const prefix = words.slice(0, k).join(" ");
      // "the", "a" and the like are too short to mean anything.
      if (prefix.length < 4) break;
      const shared = rest.every((e) =>
        e.names.some((n) => {
          const other = normalizeName(n);
          return other === prefix || other.startsWith(`${prefix} `);
        }),
      );
      if (shared) return true;
    }
  }
  return false;
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
      airingStatus: anime.airingStatus,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)))
    .limit(1);
  return row ?? null;
}
