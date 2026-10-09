import { and, desc, eq, gt, gte, inArray, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "../db/client.js";
import { anime, listEntries, tasteGenres } from "../db/schema.js";

/** Shows both scored, before the scores count as much as genre taste. */
const SCORE_WEIGHT_HALF = 10;
/** Below both of these, there's too little in common to say anything. */
const MIN_SHARED_SCORED = 5;
const MIN_SHARED_GENRES = 3;
/** A score this high or higher is "loved". */
const LOVED = 8;
/** Raw points apart before two scores count as a disagreement. */
const DISAGREE_POINTS = 3;
const LIST_LENGTH = 5;

export interface ScoredShow {
  animeId: number;
  title: string;
  pictureUrl: string | null;
}

export interface TasteMatch {
  /** 0–100, or null when there's too little in common. */
  percent: number | null;
  /** Shows both scored. */
  sharedScored: number;
  bothLoved: (ScoredShow & { mine: number; theirs: number })[];
  disagreements: (ScoredShow & { mine: number; theirs: number })[];
  /** Shows they scored highly that aren't on my list at all. */
  theyLoved: (ScoredShow & { theirs: number })[];
}

/**
 * How alike two users' tastes are:
 * - the correlation of their scores on shows both scored, each centred on that user's own
 *   average (as MAL's affinity does);
 * - blended with the cosine of their genre affinities (taste_genres), which carries the match
 *   while they share few scored shows. The scores' weight is n / (n + 10).
 * Shown as 0–100, where 50 is no relation.
 */
export async function tasteMatch(db: Db, me: string, them: string): Promise<TasteMatch> {
  const mine = alias(listEntries, "mine");
  const theirs = alias(listEntries, "theirs");
  const shared = await db
    .select({
      animeId: mine.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      mine: mine.score,
      theirs: theirs.score,
    })
    .from(mine)
    .innerJoin(theirs, and(eq(theirs.animeId, mine.animeId), eq(theirs.userId, them)))
    .innerJoin(anime, eq(anime.malId, mine.animeId))
    .where(and(eq(mine.userId, me), gt(mine.score, 0), gt(theirs.score, 0)));

  const [myMean, theirMean] = await Promise.all([meanScore(db, me), meanScore(db, them)]);
  const scoreCorrelation = cosine(
    shared.map((s) => s.mine - myMean),
    shared.map((s) => s.theirs - theirMean),
  );

  const genres = await db
    .select({
      userId: tasteGenres.userId,
      genre: tasteGenres.genre,
      affinity: tasteGenres.affinity,
    })
    .from(tasteGenres)
    .where(inArray(tasteGenres.userId, [me, them]));
  const myGenres = new Map(genres.filter((g) => g.userId === me).map((g) => [g.genre, g.affinity]));
  const theirGenres = new Map(
    genres.filter((g) => g.userId === them).map((g) => [g.genre, g.affinity]),
  );
  const sharedGenres = [...myGenres.keys()].filter((genre) => theirGenres.has(genre));
  const genreCosine = cosine(
    sharedGenres.map((g) => myGenres.get(g) ?? 0),
    sharedGenres.map((g) => theirGenres.get(g) ?? 0),
  );

  const n = shared.length;
  const enough = n >= MIN_SHARED_SCORED || sharedGenres.length >= MIN_SHARED_GENRES;
  const weight = n / (n + SCORE_WEIGHT_HALF);
  const blended = weight * scoreCorrelation + (1 - weight) * genreCosine;

  return {
    percent: enough ? Math.round(((blended + 1) / 2) * 100) : null,
    sharedScored: n,
    bothLoved: shared
      .filter((s) => s.mine >= LOVED && s.theirs >= LOVED)
      .sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs))
      .slice(0, LIST_LENGTH),
    disagreements: shared
      .filter((s) => Math.abs(s.mine - s.theirs) >= DISAGREE_POINTS)
      .sort((a, b) => Math.abs(b.mine - b.theirs) - Math.abs(a.mine - a.theirs))
      .slice(0, LIST_LENGTH),
    theyLoved: await lovedNotOnList(db, me, them),
  };
}

async function meanScore(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ mean: sql<number | null>`avg(${listEntries.score})::float8` })
    .from(listEntries)
    .where(and(eq(listEntries.userId, userId), gt(listEntries.score, 0)));
  return row?.mean ?? 0;
}

/** What they scored highly that isn't anywhere on my list, best first. */
async function lovedNotOnList(db: Db, me: string, them: string) {
  const onMine = alias(listEntries, "on_mine");
  return db
    .select({
      animeId: listEntries.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      theirs: listEntries.score,
    })
    .from(listEntries)
    .innerJoin(anime, eq(anime.malId, listEntries.animeId))
    .where(
      and(
        eq(listEntries.userId, them),
        gte(listEntries.score, LOVED),
        ne(listEntries.status, "dropped"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(onMine)
            .where(and(eq(onMine.userId, me), eq(onMine.animeId, listEntries.animeId))),
        ),
      ),
    )
    .orderBy(desc(listEntries.score), sql`${anime.malMean} desc nulls last`)
    .limit(LIST_LENGTH);
}

/** The cosine of two vectors; 0 when either is all zeros (nothing to compare). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}
