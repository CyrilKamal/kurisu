import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { anime, listEntries } from "../db/schema.js";
import { latestSyncRun, MANUAL_SYNC_COOLDOWN_MS, type ListSync } from "../sync/listSync.js";
import { toLastSync } from "../sync/summary.js";

export interface ListRouteDeps {
  config: Config;
  db: Db;
  listSync: ListSync;
}

export function registerListRoutes(app: FastifyInstance, deps: ListRouteDeps): void {
  const { config, db, listSync } = deps;

  /** The user's mirrored list. Reads Postgres only; never calls MAL. */
  app.get("/list", { preHandler: requireUser(db) }, async (request) => {
    const user = request.user;
    if (!user) throw new Error("requireUser did not set request.user");

    const rows = await db
      .select({
        animeId: listEntries.animeId,
        title: anime.title,
        pictureUrl: anime.mainPictureUrl,
        mediaType: anime.mediaType,
        numEpisodes: anime.numEpisodes,
        airingStatus: anime.airingStatus,
        titleEn: anime.titleEn,
        synonyms: anime.synonyms,
        genres: anime.genres,
        episodeMinutes: anime.episodeMinutes,
        malMean: anime.malMean,
        status: listEntries.status,
        score: listEntries.score,
        episodesWatched: listEntries.numEpisodesWatched,
        isRewatching: listEntries.isRewatching,
        updatedAt: listEntries.malUpdatedAt,
      })
      .from(listEntries)
      .innerJoin(anime, eq(listEntries.animeId, anime.malId))
      .where(eq(listEntries.userId, user.id))
      .orderBy(desc(listEntries.malUpdatedAt), listEntries.animeId);

    return {
      entries: rows.map(({ titleEn, synonyms, ...row }) => ({
        ...row,
        altTitles: altTitles(row.title, titleEn, synonyms),
        updatedAt: row.updatedAt.toISOString(),
      })),
      lastSync: toLastSync(await latestSyncRun(db, user.id)),
    };
  });

  /** Manual re-sync, rate-limited per user to protect MAL's undocumented limits. */
  app.post(
    "/sync",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new Error("requireUser did not set request.user");

      const last = await latestSyncRun(db, user.id);
      const waitMs = last ? last.startedAt.getTime() + MANUAL_SYNC_COOLDOWN_MS - Date.now() : 0;
      if (waitMs > 0) {
        const retryAfterSeconds = Math.ceil(waitMs / 1000);
        return reply
          .code(429)
          .header("retry-after", String(retryAfterSeconds))
          .send({ error: "cooldown", retryAfterSeconds, lastSync: toLastSync(last) });
      }

      const run = await listSync.run(user.id, "manual");
      const lastSync = toLastSync(run);
      if (run.status === "succeeded") return { lastSync };
      if (run.error === "reauth_required") {
        return reply.code(409).send({ error: "reauth_required", lastSync });
      }
      return reply.code(502).send({ error: "sync_failed", lastSync });
    },
  );
}

/** The English title and synonyms, without blanks or repeats of the main title. */
function altTitles(title: string, titleEn: string | null, synonyms: string[]): string[] {
  const seen = new Set([title.toLowerCase()]);
  const result: string[] = [];
  for (const name of [titleEn ?? "", ...synonyms]) {
    const key = name.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(name.trim());
    }
  }
  return result;
}
