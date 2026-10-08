/**
 * Freezes what the recommendation eval needs from the dev database. Run once, after a re-sync
 * has built the discovery pool:
 *
 *   pnpm eval:recommend-data [--user <mal username>]
 *
 * Writes eval/snapshots/details.json (MAL's genres, episode length and community score for the
 * my-list snapshot's shows) and eval/snapshots/discovery.json (the discovery pool's AniList data
 * and strengths). No scores the user gave, and not which favorites led to each pool show.
 *
 * It refuses to overwrite either file: recommendation cases are labeled against them. Pass
 * --force only if no case depends on them yet. `--fill-start-dates` only adds each show's start
 * date to an existing details.json, leaving everything else as frozen.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { asc, eq, inArray } from "drizzle-orm";

import { createDb } from "../../../src/db/client.js";
import { anilistCatalog, anime, discovery, users } from "../../../src/db/schema.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import {
  DETAILS_FILE,
  detailsFreezeSchema,
  DISCOVERY_FILE,
  discoveryFreezeSchema,
} from "../recommendData.js";
import { loadSnapshot } from "../snapshot.js";

const SNAPSHOT = "my-list";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    force: { type: "boolean", default: false },
    "fill-start-dates": { type: "boolean", default: false },
  },
});
const fillOnly = values["fill-start-dates"];
for (const file of fillOnly ? [] : [DETAILS_FILE, DISCOVERY_FILE]) {
  if (existsSync(file) && !values.force) {
    console.error(`${file} already exists, and eval cases may depend on it. Not overwriting.`);
    process.exit(1);
  }
}

loadLocalEnvFile();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const { db, close } = createDb(databaseUrl);
try {
  if (fillOnly) {
    const frozen = detailsFreezeSchema.parse(JSON.parse(readFileSync(DETAILS_FILE, "utf8")));
    const dates = new Map(
      (
        await db
          .select({ malId: anime.malId, startDate: anime.startDate })
          .from(anime)
          .where(
            inArray(
              anime.malId,
              frozen.shows.map((s) => s.malId),
            ),
          )
      ).map((r) => [r.malId, r.startDate]),
    );
    const shows = frozen.shows.map((show) => ({
      ...show,
      startDate: show.startDate ?? dates.get(show.malId) ?? null,
    }));
    writeFileSync(DETAILS_FILE, `${JSON.stringify({ ...frozen, shows }, null, 2)}\n`);
    const known = shows.filter((s) => s.startDate !== null).length;
    console.log(`Added start dates: ${String(known)} of ${String(shows.length)} shows have one.`);
    process.exit(0);
  }

  const allUsers = await db.select().from(users);
  const user = values.user
    ? allUsers.find((u) => u.malUsername === values.user)
    : allUsers.length === 1
      ? allUsers[0]
      : undefined;
  if (!user) {
    throw new Error(
      allUsers.length === 1 ? "No such user." : "Several users: pass --user <mal username>.",
    );
  }

  const snapshot = loadSnapshot(SNAPSHOT);
  const now = new Date().toISOString();
  const details = await db
    .select({
      malId: anime.malId,
      genres: anime.genres,
      episodeMinutes: anime.episodeMinutes,
      malMean: anime.malMean,
      startDate: anime.startDate,
    })
    .from(anime)
    .where(
      inArray(
        anime.malId,
        snapshot.entries.map((e) => e.id),
      ),
    )
    .orderBy(asc(anime.malId));
  const detailsFreeze = detailsFreezeSchema.parse({
    description:
      "MAL's genres, episode length and community score for the my-list snapshot's shows, frozen for the recommendation eval. Public show data only.",
    source: "mal",
    snapshot: SNAPSHOT,
    frozenAt: now,
    shows: details,
  });

  const pool = await db
    .select({
      malId: anilistCatalog.malId,
      anilistId: anilistCatalog.anilistId,
      title: anilistCatalog.title,
      titleEn: anilistCatalog.titleEn,
      titleJa: anilistCatalog.titleJa,
      synonyms: anilistCatalog.synonyms,
      mediaType: anilistCatalog.mediaType,
      airingStatus: anilistCatalog.airingStatus,
      numEpisodes: anilistCatalog.numEpisodes,
      episodeMinutes: anilistCatalog.episodeMinutes,
      genres: anilistCatalog.genres,
      score: anilistCatalog.score,
      popularity: anilistCatalog.popularity,
      coverUrl: anilistCatalog.coverUrl,
      startDate: anilistCatalog.startDate,
      prequelMalIds: anilistCatalog.prequelMalIds,
      strength: discovery.strength,
    })
    .from(discovery)
    .innerJoin(anilistCatalog, eq(anilistCatalog.malId, discovery.malId))
    .where(eq(discovery.userId, user.id))
    .orderBy(asc(anilistCatalog.malId));
  if (pool.length === 0) throw new Error("The discovery pool is empty: re-sync first.");
  const discoveryFreeze = discoveryFreezeSchema.parse({
    description:
      "The discovery pool (shows new to the user, from AniList's 'fans also liked' and top-rated lists), frozen for the recommendation eval. Public show data and pool strengths only.",
    source: "anilist",
    frozenAt: now,
    shows: pool.map((show) => ({ ...show, strength: Math.round(show.strength * 1000) / 1000 })),
  });

  writeFileSync(DETAILS_FILE, `${JSON.stringify(detailsFreeze, null, 2)}\n`);
  writeFileSync(DISCOVERY_FILE, `${JSON.stringify(discoveryFreeze, null, 2)}\n`);
  console.log(
    `Froze details for ${String(details.length)} of ${String(snapshot.entries.length)} snapshot shows, and ${String(pool.length)} pool shows.`,
  );
} finally {
  await close();
}
