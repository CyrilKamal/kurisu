import { withMalAccessToken, type TokenStore } from "../auth/tokenStore.js";
import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import { DEFAULT_RETRY, fetchAnime, type RetryOptions } from "../mal/client.js";
import type { AnimeRefresher } from "../writes/commit.js";
import { animeRowFrom } from "./mirrorRows.js";

/**
 * Replaces a show's row with MAL's own details: sync after a write, for a show just added to the
 * list, whose row came from an AniList search.
 */
export function createAnimeRefresher(deps: {
  db: Db;
  tokenStore: TokenStore;
  apiBaseUrl: string;
  retry?: RetryOptions;
}): AnimeRefresher {
  return async (userId, animeId) => {
    const node = await withMalAccessToken(deps.tokenStore, userId, (token) =>
      fetchAnime(deps.apiBaseUrl, animeId, token, deps.retry ?? DEFAULT_RETRY),
    );
    const row = animeRowFrom(node, new Date());
    await deps.db.insert(anime).values(row).onConflictDoUpdate({ target: anime.malId, set: row });
  };
}
