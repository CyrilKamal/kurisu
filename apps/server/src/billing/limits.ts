import type { BudgetLimit, PlanLimit, PlanResponse } from "@kurisu/shared";

import { checkBudget, type Budget } from "../budget/budget.js";
import type { Db } from "../db/client.js";
import type { ModelsFile } from "../llm/modelConfig.js";
import { isPaying, planOf, type PlansFile, type PlanView } from "./plans.js";
import { usageOf } from "./usage.js";

/** Why a request that would call a model is turned away. */
export type Refusal = { error: BudgetLimit } | { error: "plan_limit"; limit: PlanLimit };

export interface Limits {
  /** The plan a user is on now. */
  plan(userId: string): Promise<PlanView>;
  /**
   * Before Chat or an import calls a model: the daily cap, the monthly cap on everyone's
   * unpaid spend, and the plan's allowance (for an import, its count and its size in lines).
   */
  check(userId: string, kind: "chat" | "imports", lines?: number): Promise<Refusal | null>;
  /** At Chat's handoff to the recommender: whether the plan's recommendations are used up. */
  recommendation(userId: string): Promise<PlanLimit | null>;
  /** GET /plan: the plan and this month's use. */
  view(userId: string): Promise<PlanResponse>;
}

/** The lines an import's notes have, not counting blank ones. */
export function importLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * Plan limits (Milestone 8), on top of the model budgets. They apply while there's an owner
 * (`limitsOn`); with sign-up open and no owner, as in development, nothing is limited.
 */
export function createLimits(deps: {
  db: Db;
  models: ModelsFile;
  plans: PlansFile;
  budget: Budget | null;
  limitsOn: boolean;
}): Limits {
  const { db, plans } = deps;
  const options = { limitsOn: deps.limitsOn, trialPlan: plans.trial.plan };
  const plan = (userId: string, now = new Date()) => planOf(db, userId, options, now);

  function exceeded(
    planView: PlanView,
    kind: PlanLimit["kind"],
    allowance: number | null,
    used: number,
    resetsAt: Date,
  ): PlanLimit | null {
    if (allowance === null || used < allowance) return null;
    return { kind, plan: planView.id, allowance, used, resetsAt: resetsAt.toISOString() };
  }

  return {
    plan,

    async check(userId, kind, lines) {
      const now = new Date();
      const current = await plan(userId, now);
      const budget = await checkBudget(
        db,
        deps.models,
        deps.budget,
        { id: userId, isOwner: current.source === "owner" },
        now,
        isPaying(current),
      );
      if (budget) return { error: budget };
      if (current.source === "owner" || current.source === "open") return null;

      const limits = plans.plans[current.id];
      const usage = await usageOf(db, userId, now);
      const limit =
        kind === "chat"
          ? exceeded(current, "chat", limits.chat, usage.chat, usage.resetsAt)
          : (exceeded(current, "imports", limits.imports, usage.imports, usage.resetsAt) ??
            (lines !== undefined && limits.importLines !== null && lines > limits.importLines
              ? {
                  kind: "import_lines" as const,
                  plan: current.id,
                  allowance: limits.importLines,
                  used: lines,
                  resetsAt: usage.resetsAt.toISOString(),
                }
              : null));
      return limit ? { error: "plan_limit", limit } : null;
    },

    async recommendation(userId) {
      const now = new Date();
      const current = await plan(userId, now);
      if (current.source === "owner" || current.source === "open") return null;
      const usage = await usageOf(db, userId, now);
      return exceeded(
        current,
        "recommendations",
        plans.plans[current.id].recommendations,
        usage.recommendations,
        usage.resetsAt,
      );
    },

    async view(userId) {
      const now = new Date();
      const current = await plan(userId, now);
      const usage = await usageOf(db, userId, now);
      const unlimited = current.source === "owner" || current.source === "open";
      const limits = plans.plans[current.id];
      const item = (used: number, allowance: number | null) => ({
        used,
        allowance: unlimited ? null : allowance,
      });
      return {
        plan: {
          ...current,
          until: current.until?.toISOString() ?? null,
        },
        usage: {
          chat: item(usage.chat, limits.chat),
          recommendations: item(usage.recommendations, limits.recommendations),
          imports: item(usage.imports, limits.imports),
        },
        importLines: unlimited ? null : limits.importLines,
        resetsAt: usage.resetsAt.toISOString(),
      };
    },
  };
}
