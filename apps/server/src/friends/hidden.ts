import { and, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, friendHidden } from "../db/schema.js";

/**
 * SQL: whether `userId` keeps show `malId` from their friends. Their own choice when they made
 * one (`friend_hidden`); otherwise whether MAL lists the show as Hentai or Erotica.
 */
export function hiddenFromFriends(userId: string | SQLWrapper, malId: number | SQLWrapper): SQL {
  // Aliased tables, so a query that passes the outer anime or friend_hidden column still works.
  return sql`coalesce(
    (select fh.hidden from friend_hidden fh where fh.user_id = ${userId} and fh.mal_id = ${malId}),
    exists (select 1 from anime ha where ha.mal_id = ${malId} and ha.genres && array['Hentai', 'Erotica'])
  )`;
}

/** Which of these shows `userId` keeps from their friends. */
export async function hiddenAmong(db: Db, userId: string, malIds: number[]): Promise<Set<number>> {
  if (malIds.length === 0) return new Set();
  const rows = await db
    .select({ malId: anime.malId })
    .from(anime)
    .where(and(inArray(anime.malId, [...new Set(malIds)]), hiddenFromFriends(userId, anime.malId)));
  return new Set(rows.map((row) => row.malId));
}

/** Keeps a show from friends, or shows it to them; either way it overrides the genre default. */
export async function setHiddenFromFriends(
  db: Db,
  userId: string,
  malId: number,
  hidden: boolean,
): Promise<void> {
  await db
    .insert(friendHidden)
    .values({ userId, malId, hidden })
    .onConflictDoUpdate({
      target: [friendHidden.userId, friendHidden.malId],
      set: { hidden, updatedAt: new Date() },
    });
}
