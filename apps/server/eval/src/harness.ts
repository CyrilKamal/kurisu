import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";

import { createDb, type Db } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { anilistMedia, anime, listEntries, users } from "../../src/db/schema.js";
import type { ListWriter } from "../../src/writes/commit.js";
import type { ListChange } from "../../src/writes/normalize.js";
import { airingRowsFor, type AiringFreeze } from "./airing.js";
import type { Snapshot } from "./snapshot.js";

// Same image as docker-compose.yml and the integration tests.
const POSTGRES_IMAGE =
  "postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722";

export interface EvalDatabase {
  db: Db;
  close: () => Promise<void>;
}

/** A throwaway Postgres with the real migrations, so the agent's real SQL runs in the eval. */
export async function startEvalDatabase(): Promise<EvalDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const handle = createDb(url);
  return {
    db: handle.db,
    close: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

/**
 * Resets the database to exactly the snapshot, as one user's list, with the frozen AniList airing
 * data for its shows. Returns that user's id.
 */
export async function loadSnapshotIntoDb(
  db: Db,
  snapshot: Snapshot,
  airing: AiringFreeze | null = null,
): Promise<string> {
  await db.execute(sql`
    TRUNCATE users, sessions, mal_tokens, oauth_states, anime, list_entries, sync_runs,
      proposals, changes, agent_runs, agent_run_steps, conversations, chat_messages CASCADE
  `);
  const [user] = await db
    .insert(users)
    .values({ malUserId: 1, malUsername: "eval" })
    .returning({ id: users.id });
  if (!user) throw new Error("eval user insert failed");

  const syncedAt = new Date("2026-01-01T00:00:00Z");
  for (let i = 0; i < snapshot.entries.length; i += 500) {
    const chunk = snapshot.entries.slice(i, i + 500);
    await db.insert(anime).values(
      chunk.map((e) => ({
        malId: e.id,
        title: e.title,
        titleEn: e.titleEn,
        titleJa: e.titleJa,
        synonyms: e.synonyms,
        mediaType: e.mediaType,
        numEpisodes: e.numEpisodes,
        airingStatus: e.airingStatus,
      })),
    );
    await db.insert(listEntries).values(
      chunk.map((e) => ({
        userId: user.id,
        animeId: e.id,
        status: e.status,
        // The snapshot is sanitized: no scores.
        score: 0,
        numEpisodesWatched: e.episodesWatched,
        isRewatching: e.isRewatching,
        malUpdatedAt: syncedAt,
        syncedAt,
      })),
    );
  }
  if (airing) {
    const rows = airingRowsFor(airing, new Set(snapshot.entries.map((e) => e.id)), new Date());
    if (rows.length > 0) await db.insert(anilistMedia).values(rows);
  }
  return user.id;
}

/**
 * The fake MAL client for evals: accepts every write, applies it to the entry and records it.
 * It sits behind the same commit path as production, so everything up to the PATCH is real.
 */
export function createFakeWriter(db: Db): {
  writer: ListWriter;
  writes: { animeId: number; change: ListChange }[];
} {
  const writes: { animeId: number; change: ListChange }[] = [];
  const writer: ListWriter = async (userId, animeId, change) => {
    writes.push({ animeId, change });
    const [row] = await db
      .select()
      .from(listEntries)
      .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)));
    if (!row) throw new Error(`fake MAL: ${String(animeId)} is not on the list`);
    return {
      status: change.status ?? row.status,
      score: change.score ?? row.score,
      episodesWatched: change.episodesWatched ?? row.numEpisodesWatched,
      isRewatching: change.isRewatching ?? row.isRewatching,
      updatedAt: new Date(),
    };
  };
  return { writer, writes };
}
