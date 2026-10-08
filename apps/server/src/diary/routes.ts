import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { diaryNotes } from "../db/schema.js";
import { loadDiary } from "./load.js";

export interface DiaryRouteDeps {
  config: Config;
  db: Db;
}

const idParams = z.object({ id: z.uuid() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

export function registerDiaryRoutes(app: FastifyInstance, deps: DiaryRouteDeps): void {
  const { config, db } = deps;

  /** The latest updates with the user's reactions, for the Diary page. Reads Postgres only. */
  app.get("/diary", { preHandler: requireUser(db) }, async (request) => {
    const diary = await loadDiary(db, userOf(request));
    return {
      timeZone: diary.timeZone,
      entries: diary.entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
    };
  });

  /** Deletes one diary note. The update it came with stays. */
  app.delete(
    "/diary/notes/:id",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const params = idParams.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "not_found" });
      const deleted = await db
        .delete(diaryNotes)
        .where(and(eq(diaryNotes.id, params.data.id), eq(diaryNotes.userId, userOf(request))))
        .returning({ id: diaryNotes.id });
      if (deleted.length === 0) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );
}
