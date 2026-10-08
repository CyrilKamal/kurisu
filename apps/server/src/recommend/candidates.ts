import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anilistCatalog, anime, discovery, listEntries, tasteGenres } from "../db/schema.js";
import { NOT_YET_AIRED } from "../mal/client.js";

/** MAL's media types, for "a movie" or "something short like an OVA". */
export const MEDIA_TYPES = ["tv", "movie", "ova", "ona", "special", "tv_special", "music"] as const;

/**
 * The user's Plan to Watch, shows they've started, shows queued on Watching (or On hold) but not
 * started, or shows new to them (from AniList). The user queues shows on Watching at episode 0,
 * so those aren't "in progress" (their rule).
 */
export type Pool = "plan_to_watch" | "in_progress" | "queued" | "new";
export const POOLS = ["plan_to_watch", "in_progress", "queued", "new"] as const;

/**
 * When fewer shows than a full set of picks fit the time given, shows whose episodes run up to
 * this many minutes over are offered too, after the ones that fit (the user's rule: intros and
 * outros make a few minutes' difference).
 */
export const TIME_GRACE_MINUTES = 5;
const FULL_SET_OF_PICKS = 3;

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
  /** Where to look; all four by default. "Continue something" is in_progress only. */
  from?: Pool[];
}

/** A list entry, or a show new to the user, with the details the ranking needs. */
export interface CandidateRow {
  animeId: number;
  title: string;
  titleEn: string | null;
  /** Null for a show that isn't on the user's list. */
  status: "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch" | null;
  isRewatching: boolean;
  episodesWatched: number;
  numEpisodes: number | null;
  episodeMinutes: number | null;
  genres: string[];
  malMean: number | null;
  mediaType: string | null;
  airingStatus: string | null;
  /** For a new show: how strongly AniList points at it for this user (see discovery.ts). */
  strength?: number;
  /** For a new show: the user's favorites whose fans like it. */
  because?: string[];
  /** For a new show: AniList's score, on MAL's 10-point scale. */
  anilistScore?: number | null;
  /**
   * For a new show: false if it follows a show the user hasn't completed (a sequel to something
   * they haven't seen), so it isn't recommended.
   */
  prequelsDone?: boolean;
}

export interface Candidate extends CandidateRow {
  pool: Pool;
  /** Episodes left, when MAL knows the total. */
  episodesLeft: number | null;
  /** How many episodes fit in the available minutes, when given. */
  episodesThatFit: number | null;
  /** How far each episode runs over the available minutes, for a show offered in the grace. */
  minutesOver: number | null;
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

/**
 * Which pool a show is in: Plan to Watch, in progress (started: watching or on hold past episode
 * 0, or rewatching), queued (watching or on hold at episode 0), or new to the user. Never
 * completed, dropped, unaired, or a sequel to a show they haven't completed.
 */
export function poolOf(row: CandidateRow): Pool | null {
  if (row.airingStatus === NOT_YET_AIRED) return null;
  if (row.status === null) return row.prequelsDone === false ? null : "new";
  if (row.status === "plan_to_watch") return "plan_to_watch";
  if (row.status === "watching" || row.status === "on_hold") {
    return row.episodesWatched > 0 ? "in_progress" : "queued";
  }
  if (row.status === "completed" && row.isRewatching) return "in_progress";
  return null;
}

/** A show this long is "long" for someone who drops shows for being too long. */
const LONG_SHOW_EPISODES = 26;
/**
 * Shows the user put on their list come first (their choice): a new show needs a clearly better
 * fit to their taste to rank above one of theirs, since new shows tend to be well rated.
 */
const LIST_BOOST = 1;
/** A new show's pull from AniList (its discovery strength) counts this much, up to a cap. */
const DISCOVERY_WEIGHT = 0.25;
const MAX_DISCOVERY_STRENGTH = 2;

/**
 * Filters the user's entries and the shows new to them to the ones that meet every constraint and
 * ranks them: taste fit (their genre affinities), the community score, a boost for their own
 * list, a nudge for shows already under way, queued or airing, how strongly AniList points at a
 * new show, and penalties for genres they drop and, if they've dropped shows for being too long,
 * long shows. Shows that fit the time come first; when fewer than a full set of picks fit, shows
 * up to TIME_GRACE_MINUTES over follow them. Pure, so the ranking is unit-tested apart from the
 * database.
 */
export function rankCandidates(
  rows: CandidateRow[],
  taste: TasteSignals,
  constraints: Constraints,
): Candidate[] {
  const wanted = lowerSet(constraints.genresAny);
  const unwanted = lowerSet(constraints.genresNone);
  const types = lowerSet(constraints.mediaTypes);
  const pools = new Set<Pool>(constraints.from?.length ? constraints.from : POOLS);
  const tooLongDrops = taste.dropCategories.get("too_long") ?? 0;

  const candidates: Candidate[] = [];
  const overTime: Candidate[] = [];
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
    let minutesOver: number | null = null;
    if (constraints.availableMinutes !== undefined) {
      if (row.episodeMinutes === null) continue;
      if (row.episodeMinutes > constraints.availableMinutes + TIME_GRACE_MINUTES) continue;
      if (row.episodeMinutes > constraints.availableMinutes) {
        minutesOver = row.episodeMinutes - constraints.availableMinutes;
      } else {
        episodesThatFit = Math.floor(constraints.availableMinutes / row.episodeMinutes);
        if (episodesLeft !== null) episodesThatFit = Math.min(episodesThatFit, episodesLeft);
      }
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
    const community = row.malMean ?? row.anilistScore ?? null;
    const quality = community === null ? 0 : (community - 7.5) * 0.5;
    if (row.malMean !== null) facts.push(`MAL score ${row.malMean.toFixed(2)}`);
    else if (row.anilistScore != null) facts.push(`AniList score ${row.anilistScore.toFixed(1)}`);

    let progressBoost = pool === "new" ? 0 : LIST_BOOST;
    if (pool === "new") {
      progressBoost += DISCOVERY_WEIGHT * Math.min(row.strength ?? 0, MAX_DISCOVERY_STRENGTH);
      facts.push("new to you: not on your list");
      const because = row.because ?? [];
      if (because.length > 0) {
        facts.push(`fans of ${because.slice(0, 2).join(" and ")} also like it`);
      }
    } else if (pool === "plan_to_watch") {
      facts.push("on your Plan to Watch");
    } else if (pool === "queued") {
      progressBoost += 0.3;
      const list = row.status === "on_hold" ? "On hold" : "Watching";
      facts.push(`queued on your ${list} list, not started yet`);
    }
    if (pool === "in_progress") {
      progressBoost += row.status === "watching" ? 0.6 : 0.3;
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

    if (minutesOver !== null) {
      const unit = row.mediaType === "movie" ? "min" : "min episodes";
      facts.push(
        `runs ${String(minutesOver)} min over your time (${String(row.episodeMinutes)} ${unit})`,
      );
    }

    (minutesOver === null ? candidates : overTime).push({
      ...row,
      pool,
      episodesLeft,
      episodesThatFit,
      minutesOver,
      score: round(tasteFit + quality + progressBoost + dropPenalty + lengthPenalty),
      facts,
    });
  }
  const best = (a: Candidate, b: Candidate) => b.score - a.score || a.title.localeCompare(b.title);
  candidates.sort(best);
  // Shows that run over the time only fill in when too few fit.
  if (candidates.length >= FULL_SET_OF_PICKS) return candidates;
  return [...candidates, ...overTime.sort(best)];
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

/**
 * Shows new to the user from their discovery pool: anything already on their list (in any
 * status) is left out, and so is a sequel to a show they haven't completed.
 */
export async function discoveryRows(db: Db, userId: string): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      animeId: anilistCatalog.malId,
      title: anilistCatalog.title,
      titleEn: anilistCatalog.titleEn,
      numEpisodes: anilistCatalog.numEpisodes,
      episodeMinutes: anilistCatalog.episodeMinutes,
      genres: anilistCatalog.genres,
      anilistScore: anilistCatalog.score,
      mediaType: anilistCatalog.mediaType,
      airingStatus: anilistCatalog.airingStatus,
      strength: discovery.strength,
      because: discovery.because,
      prequelsDone: sql<boolean>`NOT EXISTS (
        SELECT 1 FROM unnest(${anilistCatalog.prequelMalIds}) AS p(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM list_entries done
          WHERE done.user_id = ${userId} AND done.anime_id = p.id AND done.status = 'completed'
        )
      )`,
    })
    .from(discovery)
    .innerJoin(anilistCatalog, eq(anilistCatalog.malId, discovery.malId))
    .leftJoin(
      listEntries,
      and(eq(listEntries.userId, userId), eq(listEntries.animeId, discovery.malId)),
    )
    .where(and(eq(discovery.userId, userId), sql`${listEntries.animeId} IS NULL`));
  return rows.map((r) => ({
    ...r,
    status: null,
    isRewatching: false,
    episodesWatched: 0,
    malMean: null,
  }));
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
