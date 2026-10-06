import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, listEntries, tasteGenres } from "../db/schema.js";
import { NOT_YET_AIRED } from "../mal/client.js";

/** MAL's media types, for "a movie" or "something short like an OVA". */
export const MEDIA_TYPES = ["tv", "movie", "ova", "ona", "special", "tv_special", "music"] as const;

export type Pool = "plan_to_watch" | "in_progress";

/** What the user asked for, as the recommendation agent read it from their message. */
export interface Constraints {
  /** Minutes they have: each episode (or the movie) must fit. */
  availableMinutes?: number;
  /** At most this many episodes left to watch: "something short". */
  maxEpisodesLeft?: number;
  /** At least one of these genres: a mood mapped to MAL's genres. */
  genresAny?: string[];
  /** None of these genres. */
  genresNone?: string[];
  mediaTypes?: string[];
  /** Where to look; both by default. "Continue something" is in_progress only. */
  from?: Pool[];
}

/** A list entry with the details the ranking needs. */
export interface CandidateRow {
  animeId: number;
  title: string;
  titleEn: string | null;
  status: "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";
  isRewatching: boolean;
  episodesWatched: number;
  numEpisodes: number | null;
  episodeMinutes: number | null;
  genres: string[];
  malMean: number | null;
  mediaType: string | null;
  airingStatus: string | null;
}

export interface Candidate extends CandidateRow {
  pool: Pool;
  /** Episodes left, when MAL knows the total. */
  episodesLeft: number | null;
  /** How many episodes fit in the available minutes, when given. */
  episodesThatFit: number | null;
  score: number;
  /** Plain facts behind the ranking, for the model to explain picks with. */
  facts: string[];
}

export interface TasteSignals {
  /** Affinity per genre (see taste/profile.ts), and how many shows of it they dropped. */
  genres: Map<string, { affinity: number; dropped: number }>;
  /** Drop reasons by category, e.g. "too_long" → 2. */
  dropCategories: Map<string, number>;
}

/** Which pool an entry is in: Plan to Watch, or in progress (watching, on hold, rewatching). */
export function poolOf(row: CandidateRow): Pool | null {
  if (row.airingStatus === NOT_YET_AIRED) return null;
  if (row.status === "plan_to_watch") return "plan_to_watch";
  if (row.status === "watching" || row.status === "on_hold") return "in_progress";
  if (row.status === "completed" && row.isRewatching) return "in_progress";
  return null;
}

/** A show this long is "long" for someone who drops shows for being too long. */
const LONG_SHOW_EPISODES = 26;

/**
 * Filters the user's entries to the ones that meet every constraint and ranks them: taste fit
 * (their genre affinities), MAL's score, a nudge for shows already under way or airing, and
 * penalties for genres they drop and, if they've dropped shows for being too long, long shows.
 * Pure, so the ranking is unit-tested apart from the database.
 */
export function rankCandidates(
  rows: CandidateRow[],
  taste: TasteSignals,
  constraints: Constraints,
): Candidate[] {
  const wanted = lowerSet(constraints.genresAny);
  const unwanted = lowerSet(constraints.genresNone);
  const types = lowerSet(constraints.mediaTypes);
  const pools = new Set(
    constraints.from?.length ? constraints.from : ["plan_to_watch", "in_progress"],
  );
  const tooLongDrops = taste.dropCategories.get("too_long") ?? 0;

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const pool = poolOf(row);
    if (!pool || !pools.has(pool)) continue;
    const genres = row.genres.map((g) => g.toLowerCase());
    if (wanted.size > 0 && !genres.some((g) => wanted.has(g))) continue;
    if (genres.some((g) => unwanted.has(g))) continue;
    if (types.size > 0 && !types.has((row.mediaType ?? "").toLowerCase())) continue;

    const episodesLeft =
      row.numEpisodes === null ? null : Math.max(0, row.numEpisodes - row.episodesWatched);
    if (constraints.maxEpisodesLeft !== undefined) {
      if (episodesLeft === null || episodesLeft > constraints.maxEpisodesLeft) continue;
    }
    let episodesThatFit: number | null = null;
    if (constraints.availableMinutes !== undefined) {
      if (row.episodeMinutes === null || row.episodeMinutes > constraints.availableMinutes)
        continue;
      episodesThatFit = Math.floor(constraints.availableMinutes / row.episodeMinutes);
      if (episodesLeft !== null) episodesThatFit = Math.min(episodesThatFit, episodesLeft);
    }

    const facts: string[] = [];
    const known = row.genres.flatMap((g) => {
      const t = taste.genres.get(g);
      return t ? [{ genre: g, ...t }] : [];
    });
    const tasteFit = known.length
      ? known.reduce((sum, g) => sum + g.affinity, 0) / known.length
      : 0;
    const best = [...known].sort((a, b) => b.affinity - a.affinity)[0];
    if (best && best.affinity >= 0.15) {
      facts.push(`you rate ${best.genre} above your average`);
    }
    const dropped = known.reduce((sum, g) => sum + g.dropped, 0);
    const quality = row.malMean === null ? 0 : (row.malMean - 7.5) * 0.5;
    if (row.malMean !== null) facts.push(`MAL score ${row.malMean.toFixed(2)}`);

    let progressBoost = 0;
    if (pool === "in_progress") {
      progressBoost = row.status === "watching" && row.episodesWatched > 0 ? 0.6 : 0.3;
      facts.push(
        row.numEpisodes
          ? `you're on ep ${String(row.episodesWatched)} of ${String(row.numEpisodes)}`
          : `you're on ep ${String(row.episodesWatched)}`,
      );
    }
    if (row.airingStatus === "currently_airing") {
      progressBoost += 0.2;
      facts.push("airing now");
    }
    const dropPenalty = -0.15 * Math.min(dropped, 3);
    const lengthPenalty =
      tooLongDrops > 0 && episodesLeft !== null && episodesLeft > LONG_SHOW_EPISODES ? -0.5 : 0;
    if (episodesLeft !== null && row.episodeMinutes !== null) {
      facts.push(`${String(episodesLeft)} eps left × ${String(row.episodeMinutes)} min`);
    }
    if (episodesThatFit !== null) {
      facts.push(
        episodesThatFit === 1
          ? "1 ep fits in your time"
          : `${String(episodesThatFit)} eps fit in your time`,
      );
    }

    candidates.push({
      ...row,
      pool,
      episodesLeft,
      episodesThatFit,
      score: round(tasteFit + quality + progressBoost + dropPenalty + lengthPenalty),
      facts,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/** The user's Plan to Watch and in-progress entries with their details. */
export async function candidateRows(db: Db, userId: string): Promise<CandidateRow[]> {
  return db
    .select({
      animeId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      status: listEntries.status,
      isRewatching: listEntries.isRewatching,
      episodesWatched: listEntries.numEpisodesWatched,
      numEpisodes: anime.numEpisodes,
      episodeMinutes: anime.episodeMinutes,
      genres: anime.genres,
      malMean: anime.malMean,
      mediaType: anime.mediaType,
      airingStatus: anime.airingStatus,
    })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .where(
      and(
        eq(listEntries.userId, userId),
        sql`(${listEntries.status} in ('plan_to_watch', 'watching', 'on_hold') or ${listEntries.isRewatching})`,
      ),
    );
}

/** Taste memory as ranking signals. */
export async function tasteSignals(db: Db, userId: string): Promise<TasteSignals> {
  const genres = await db
    .select({
      genre: tasteGenres.genre,
      affinity: tasteGenres.affinity,
      dropped: tasteGenres.dropped,
    })
    .from(tasteGenres)
    .where(eq(tasteGenres.userId, userId));
  const categories = await db.execute<{ category: string; n: number }>(sql`
    SELECT category, count(*)::int AS n FROM drop_reasons WHERE user_id = ${userId} GROUP BY category
  `);
  return {
    genres: new Map(genres.map((g) => [g.genre, { affinity: g.affinity, dropped: g.dropped }])),
    dropCategories: new Map(categories.rows.map((r) => [r.category, r.n])),
  };
}

/** Every genre name on the user's list, for checking the names the model asks for. */
export async function knownGenres(db: Db, userId: string): Promise<string[]> {
  const result = await db.execute<{ genre: string }>(sql`
    SELECT DISTINCT g AS genre
    FROM list_entries e JOIN anime a ON a.mal_id = e.anime_id
    CROSS JOIN LATERAL unnest(a.genres) AS g
    WHERE e.user_id = ${userId}
    ORDER BY 1
  `);
  return result.rows.map((r) => r.genre);
}

function lowerSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((v) => v.toLowerCase()));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
