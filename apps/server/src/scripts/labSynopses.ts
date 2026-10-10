/**
 * Fills `anime.synopsis` for every show on anyone's list and in the discovery and season pools,
 * so Milestone 7's lab can embed them. Shows already done are skipped; a show AniList doesn't
 * know stays empty for next time. Reads DATABASE_URL from .env.local:
 *
 *   pnpm lab:synopses
 */
import { inArray, isNull, and } from "drizzle-orm";

import { createAniListClient } from "../anilist/client.js";
import { plainSynopsis } from "../anilist/synopsis.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { anilistCatalog, anime, listEntries } from "../db/schema.js";
import { loadLocalEnvFile } from "../env.js";
import { rememberDiscovered } from "../recommend/discovery.js";

loadLocalEnvFile();
const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
try {
  const listed = await db.selectDistinct({ id: listEntries.animeId }).from(listEntries);
  const pooled = await db.select({ id: anilistCatalog.malId }).from(anilistCatalog);
  // Pool shows need `anime` rows to hold their synopsis, as discovery's picks already get.
  await rememberDiscovered(
    db,
    pooled.map((row) => row.id),
  );
  const ids = [...new Set([...listed, ...pooled].map((row) => row.id))];
  const missing =
    ids.length === 0
      ? []
      : await db
          .select({ id: anime.malId })
          .from(anime)
          .where(and(inArray(anime.malId, ids), isNull(anime.synopsis)));
  console.log(
    `${String(ids.length)} shows, ${String(missing.length)} without a synopsis yet. Asking AniList (about 3 s per 50)…`,
  );

  const anilist = createAniListClient({ apiUrl: config.anilist.apiUrl });
  const found = await anilist.descriptions(missing.map((row) => row.id));
  let filled = 0;
  for (const { id } of missing) {
    // AniList doesn't know the show: leave it for next time.
    if (!found.has(id)) continue;
    const raw = found.get(id) ?? null;
    await db
      .update(anime)
      .set({ synopsis: raw === null ? "" : plainSynopsis(raw) })
      .where(inArray(anime.malId, [id]));
    filled += 1;
  }
  console.log(`Filled ${String(filled)}; ${String(missing.length - filled)} unknown to AniList.`);
} finally {
  await close();
}
