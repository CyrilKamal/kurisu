import { FAVORITES_MAX, type FavoriteShow } from "@kurisu/shared";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, favorites } from "../db/schema.js";

/** A user's favorites, in their order. */
export async function listFavorites(db: Db, userId: string): Promise<FavoriteShow[]> {
  return db
    .select({
      animeId: anime.malId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      mediaType: anime.mediaType,
      startDate: anime.startDate,
    })
    .from(favorites)
    .innerJoin(anime, eq(anime.malId, favorites.animeId))
    .where(eq(favorites.userId, userId))
    .orderBy(asc(favorites.position), asc(favorites.createdAt));
}

export type FavoriteResult = "ok" | "unknown_anime" | "favorites_full";

/**
 * Adds a show to the end of the user's favorites (a show kurisu has seen, on a list or found by
 * a search), at most FAVORITES_MAX. Adding one already there changes nothing.
 */
export async function addFavorite(
  db: Db,
  userId: string,
  animeId: number,
): Promise<FavoriteResult> {
  return db.transaction(async (tx) => {
    // One change to a user's favorites at a time, so two taps can't both take the last place.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`favorites:${userId}`}))`);
    const [show] = await tx
      .select({ malId: anime.malId })
      .from(anime)
      .where(eq(anime.malId, animeId))
      .limit(1);
    if (!show) return "unknown_anime";
    const current = await tx
      .select({ animeId: favorites.animeId, position: favorites.position })
      .from(favorites)
      .where(eq(favorites.userId, userId));
    if (current.some((row) => row.animeId === animeId)) return "ok";
    if (current.length >= FAVORITES_MAX) return "favorites_full";
    const last = Math.max(-1, ...current.map((row) => row.position));
    await tx.insert(favorites).values({ userId, animeId, position: last + 1 });
    return "ok";
  });
}

export async function removeFavorite(db: Db, userId: string, animeId: number): Promise<void> {
  await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.animeId, animeId)));
}

/**
 * Puts the user's favorites in a new order. The ids must be exactly the favorites they have;
 * anything else (a show added or removed meanwhile) is refused, so nothing is lost.
 */
export async function reorderFavorites(
  db: Db,
  userId: string,
  animeIds: number[],
): Promise<"ok" | "not_the_same"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`favorites:${userId}`}))`);
    const current = await tx
      .select({ animeId: favorites.animeId })
      .from(favorites)
      .where(eq(favorites.userId, userId));
    const have = new Set(current.map((row) => row.animeId));
    if (
      animeIds.length !== have.size ||
      new Set(animeIds).size !== animeIds.length ||
      animeIds.some((id) => !have.has(id))
    ) {
      return "not_the_same";
    }
    for (const [position, animeId] of animeIds.entries()) {
      await tx
        .update(favorites)
        .set({ position })
        .where(and(eq(favorites.userId, userId), eq(favorites.animeId, animeId)));
    }
    return "ok";
  });
}
