import { goalRequestSchema } from "@kurisu/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireSameOrigin, requireUser } from "../auth/guards.js";
import type { Limits } from "../billing/limits.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { loadStats, localYear, setYearlyGoal, userTimeZone, type Stats } from "./compute.js";
import { loadYearReview } from "./year.js";

export interface StatsRouteDeps {
  config: Config;
  db: Db;
  limits: Limits;
}

/** The earliest year a review goes back to. */
const FIRST_YEAR = 1960;
const yearQuery = z.object({ year: z.coerce.number().int().min(FIRST_YEAR).optional() });

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
  const { config, db, limits } = deps;

  /** What the user watched, for the Stats page. Reads Postgres only. */
  app.get("/stats", { preHandler: requireUser(db) }, async (request) =>
    view(await loadStats(db, userOf(request))),
  );

  /**
   * A year in review (this year by default, on the user's clock): the basics for everyone, and
   * the full review when the plan includes it. No later than this year.
   */
  app.get("/year", { preHandler: requireUser(db) }, async (request, reply) => {
    const userId = userOf(request);
    const query = yearQuery.safeParse(request.query);
    const thisYear = localYear(new Date(), await userTimeZone(db, userId));
    const year = query.success ? (query.data.year ?? thisYear) : null;
    if (year === null || year > thisYear) return reply.code(400).send({ error: "invalid_year" });
    return loadYearReview(db, userId, year, { full: await limits.has(userId, "fullYear") });
  });

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
