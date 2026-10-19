import type { FastifyInstance } from "fastify";

import { requireUser } from "../auth/guards.js";
import type { Db } from "../db/client.js";
import type { Limits } from "./limits.js";
import type { PlanView } from "./plans.js";

/** A plan as the API sends it. */
export function planJson(plan: PlanView) {
  return { ...plan, until: plan.until?.toISOString() ?? null };
}

/** GET /plan: the user's plan and this month's use of its allowances (the Plan screen). */
export function registerPlanRoutes(app: FastifyInstance, deps: { db: Db; limits: Limits }): void {
  app.get("/plan", { preHandler: requireUser(deps.db) }, async (request) => {
    if (!request.user) throw new Error("requireUser did not set request.user");
    return deps.limits.view(request.user.id);
  });
}
