import {
  ADD_ERRORS,
  EDIT_ERRORS,
  listAddRequestSchema,
  listEditRequestSchema,
  listRemoveRequestSchema,
  type AddError,
  type EditError,
} from "@kurisu/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { airingView } from "../anilist/cache.js";
import { anilistMedia, anime, listEntries } from "../db/schema.js";
import { latestSyncRun, MANUAL_SYNC_COOLDOWN_MS, type ListSync } from "../sync/listSync.js";
import { toLastSync } from "../sync/summary.js";
import { loadChange } from "../chat/service.js";
import type { WriteDeps } from "../writes/commit.js";
import { writeError } from "../writes/httpErrors.js";
import { addEntry, editEntry, removeEntry, type ManualResult } from "../writes/manual.js";
import { altTitles } from "./altTitles.js";

export interface ListRouteDeps {
  config: Config;
  db: Db;
  listSync: ListSync;
  /** The single write path, for edits made on the List screen. */
  writes: WriteDeps;
}

const animeParams = z.object({ animeId: z.coerce.number().int().positive() });

function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

export function registerListRoutes(app: FastifyInstance, deps: ListRouteDeps): void {
  const { config, db, listSync, writes } = deps;
  const guards = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };

  /** Sends what a manual edit or removal did, as History shows it, or why it didn't happen. */
  async function sendResult(reply: FastifyReply, userId: string, result: ManualResult) {
    if (result.status === "committed") {
      return { change: await loadChange(db, userId, result.change.id) };
    }
    if (result.status === "invalid") {
      if ((ADD_ERRORS as readonly string[]).includes(result.error)) {
        const error = result.error as AddError;
        return reply.code(error === "already_on_list" ? 409 : 404).send({ error });
      }
      const error: EditError = (EDIT_ERRORS as readonly string[]).includes(result.error)
        ? (result.error as EditError)
        : "invalid_edit";
      return reply.code(400).send({ error });
    }
    return writeError(reply, result.status === "failed" ? result.error : result.status);
  }

  /** The user changes an entry themselves; written through the same proposal and commit path. */
  app.post("/list/:animeId/edit", guards, async (request, reply) => {
    const params = animeParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const body = listEditRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_edit" });
    const { requestId, ...edit } = body.data;
    const userId = userIdOf(request);
    return sendResult(
      reply,
      userId,
      await editEntry(writes, userId, params.data.animeId, edit, requestId),
    );
  });

  /** Puts a show the user found (Search, a show's page) on the list; History can take it off. */
  app.post("/list/add", guards, async (request, reply) => {
    const body = listAddRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_edit" });
    const { animeId, requestId, ...requested } = body.data;
    const userId = userIdOf(request);
    return sendResult(reply, userId, await addEntry(writes, userId, animeId, requested, requestId));
  });

  /** Takes a show off the list; History can put it back. */
  app.post("/list/:animeId/remove", guards, async (request, reply) => {
    const params = animeParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const body = listRemoveRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_edit" });
    const userId = userIdOf(request);
    return sendResult(
      reply,
      userId,
      await removeEntry(writes, userId, params.data.animeId, body.data.requestId),
    );
  });

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
        airing: anilistMedia,
      })
      .from(listEntries)
      .innerJoin(anime, eq(listEntries.animeId, anime.malId))
      .leftJoin(anilistMedia, eq(anilistMedia.malId, listEntries.animeId))
      .where(eq(listEntries.userId, user.id))
      .orderBy(desc(listEntries.malUpdatedAt), listEntries.animeId);

    const now = new Date();
    return {
      entries: rows.map(({ titleEn, synonyms, airing, ...row }) => ({
        ...row,
        altTitles: altTitles(row.title, titleEn, synonyms),
        updatedAt: row.updatedAt.toISOString(),
        airing: airingView(airing ?? undefined, now),
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
