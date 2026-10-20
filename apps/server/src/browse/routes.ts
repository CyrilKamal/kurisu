import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireUser } from "../auth/guards.js";
import type { Db } from "../db/client.js";
import { loadSchedule, loadSeasonChart } from "./load.js";
import { chartedSeasons, parseSeasonParam } from "./seasons.js";

export interface BrowseRouteDeps {
  db: Db;
  /** Rebuilds the shared schedule and charts in the background when they're stale. */
  refresh: () => void;
}

const seasonQuery = z.object({ season: z.string().max(16).optional() });

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

/**
 * Browse (Milestone 8's interlude): the week's airing schedule and the season charts. Both read
 * shared tables that background jobs fill from AniList; opening Browse on stale data starts a
 * rebuild for the next visit, never one the page waits on.
 */
export function registerBrowseRoutes(app: FastifyInstance, deps: BrowseRouteDeps): void {
  const { db } = deps;
  const read = { preHandler: requireUser(db) };

  app.get("/browse/schedule", read, async (request) => {
    deps.refresh();
    return loadSchedule(db, userOf(request));
  });

  app.get("/browse/seasons", read, async (request, reply) => {
    deps.refresh();
    const query = seasonQuery.safeParse(request.query);
    const asked = query.success && query.data.season ? parseSeasonParam(query.data.season) : null;
    if (query.success && query.data.season && !asked) {
      return reply.code(400).send({ error: "invalid_season" });
    }
    const season = asked ?? chartedSeasons(new Date())[1];
    if (!season) throw new Error("no current season");
    const chart = await loadSeasonChart(db, userOf(request), season);
    if (!chart) return reply.code(404).send({ error: "not_charted" });
    return chart;
  });
}
