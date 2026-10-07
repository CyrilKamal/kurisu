import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { dropReasons } from "../db/schema.js";
import { loadTaste } from "./profile.js";

export interface TasteRouteDeps {
  config: Config;
  db: Db;
}

const idParams = z.object({ id: z.uuid() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

export function registerTasteRoutes(app: FastifyInstance, deps: TasteRouteDeps): void {
  const { config, db } = deps;

  /** The user's taste memory, for the Taste page. Reads Postgres only. */
  app.get("/taste", { preHandler: requireUser(db) }, async (request) => {
    const taste = await loadTaste(db, userOf(request));
    return {
      ...taste,
      dropReasons: taste.dropReasons.map((reason) => ({
        ...reason,
        createdAt: reason.createdAt.toISOString(),
      })),
    };
  });

  /** Forgets one drop reason, so recommendations stop counting it. The list itself is untouched. */
  app.delete(
    "/taste/drop-reasons/:id",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const params = idParams.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "not_found" });
      const deleted = await db
        .delete(dropReasons)
        .where(and(eq(dropReasons.id, params.data.id), eq(dropReasons.userId, userOf(request))))
        .returning({ id: dropReasons.id });
      if (deleted.length === 0) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );
}
