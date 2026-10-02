/**
 * Exports the developer's mirrored MAL list as a sanitized eval snapshot.
 *
 *   pnpm eval:snapshot [--name my-list] [--user <mal username>]
 *
 * Keeps only what the eval needs (ids, titles, alternative titles, media type, airing status,
 * list status, episode progress and counts). Drops scores, dates, tags, comments and the username.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { asc, eq } from "drizzle-orm";

import { createDb } from "../../../src/db/client.js";
import { anime, listEntries, users } from "../../../src/db/schema.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { SNAPSHOTS_DIR, snapshotSchema, type Snapshot } from "../snapshot.js";

const { values } = parseArgs({
  options: { name: { type: "string", default: "my-list" }, user: { type: "string" } },
});

loadLocalEnvFile();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const { db, close } = createDb(databaseUrl);
try {
  const allUsers = await db.select().from(users);
  const user = values.user
    ? allUsers.find((u) => u.malUsername === values.user)
    : allUsers.length === 1
      ? allUsers[0]
      : undefined;
  if (!user) {
    throw new Error(
      allUsers.length === 0
        ? "No users in the database. Log in with MAL first."
        : "Several users in the database; pass --user <mal username>.",
    );
  }

  const rows = await db
    .select({
      id: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      titleJa: anime.titleJa,
      synonyms: anime.synonyms,
      mediaType: anime.mediaType,
      numEpisodes: anime.numEpisodes,
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      isRewatching: listEntries.isRewatching,
      airingStatus: anime.airingStatus,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(eq(listEntries.userId, user.id))
    .orderBy(asc(anime.malId));

  const snapshot: Snapshot = snapshotSchema.parse({
    name: values.name,
    description:
      `Sanitized export of a real MAL anime list (${String(rows.length)} entries). ` +
      "Scores, dates, tags, comments and the username are removed.",
    source: "mal-mirror",
    exportedAt: new Date().toISOString(),
    entries: rows,
  });

  const path = `${SNAPSHOTS_DIR}${values.name}.json`;
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${String(rows.length)} entries to ${path}`);
} finally {
  await close();
}
