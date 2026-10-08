import { goalRequestSchema } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { loadStats, setYearlyGoal, type Stats } from "./compute.js";

export interface StatsRouteDeps {
  config: Config;
  db: Db;
}

function userOf(request: FastifyRequest): string {
  if (!request.user) throw new Error("requireUser did not set request.user");
  return request.user.id;
}

function view(stats: Stats) {
  return {
    ...stats,
    week: { ...stats.week, from: stats.week.from.toISOString(), to: stats.week.to.toISOString() },
  };
}

export function registerStatsRoutes(app: FastifyInstance, deps: StatsRouteDeps): void {
  const { config, db } = deps;

  /** What the user watched, for the Stats page. Reads Postgres only. */
  app.get("/stats", { preHandler: requireUser(db) }, async (request) =>
    view(await loadStats(db, userOf(request))),
  );

  /** Sets or clears this year's goal, and returns the stats with it. */
  app.put(
    "/stats/goal",
    { preHandler: [requireSameOrigin(config.webOrigin), requireUser(db)] },
    async (request, reply) => {
      const body = goalRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_goal" });
      const userId = userOf(request);
      await setYearlyGoal(db, userId, body.data.target);
      return view(await loadStats(db, userId));
    },
  );
}
