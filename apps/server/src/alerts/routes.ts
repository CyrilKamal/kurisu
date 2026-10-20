import { alertMuteRequestSchema, alertsRequestSchema, type AlertsResponse } from "@kurisu/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Limits } from "../billing/limits.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import { alertSettings, setAlerts, setShowMuted } from "./service.js";

export interface AlertRouteDeps {
  config: Config;
  db: Db;
  limits: Limits;
}

const showParams = z.object({ animeId: z.coerce.number().int().positive() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/**
 * Episode alerts (Premium and Pro): Settings turns them on or off, and a Watching show's page
 * mutes that show. Turning them on needs the plan; turning them off or muting a show never does.
 */
export function registerAlertRoutes(app: FastifyInstance, deps: AlertRouteDeps): void {
  const { config, db, limits } = deps;
  const read = { preHandler: requireUser(db) };
  const write = { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] };

  const view = async (userId: string): Promise<AlertsResponse> => ({
    included: await limits.has(userId, "episodeAlerts"),
    ...(await alertSettings(db, userId)),
  });

  app.get("/alerts", read, (request) => view(userOf(request)));

  app.put("/alerts", write, async (request, reply) => {
    const userId = userOf(request);
    const body = alertsRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (body.data.on && !(await limits.has(userId, "episodeAlerts"))) {
      return reply
        .code(403)
        .send({ error: "needs_plan", feature: "episodeAlerts", plan: "premium" });
    }
    await setAlerts(db, userId, body.data.on);
    return view(userId);
  });

  app.put("/alerts/shows/:animeId", write, async (request, reply) => {
    const userId = userOf(request);
    const params = showParams.safeParse(request.params);
    const body = alertMuteRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { animeId } = params.data;
    const [show] = await db
      .select({ malId: anime.malId })
      .from(anime)
      .where(eq(anime.malId, animeId))
      .limit(1);
    if (!show) return reply.code(404).send({ error: "not_found" });
    await setShowMuted(db, userId, animeId, body.data.muted);
    return { animeId, muted: body.data.muted };
  });
}
