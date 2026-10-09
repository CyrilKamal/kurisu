import { and, eq, gte, sql } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { agentRuns, users } from "../db/schema.js";
import { costUsd, parseModelRef, type ModelsFile } from "../llm/modelConfig.js";

/**
 * Why a request that would call a model is turned away: the user's runs in the last 24 hours,
 * or everyone else's spend this month. Mirrored by BUDGET_ERRORS in @kurisu/shared.
 */
export type BudgetLimit = "daily_limit" | "monthly_limit";

export interface Budget {
  /** Model runs (agent, recommender, diary, import) one account may start in 24 hours. */
  dailyRuns: number;
  /** Estimated model spend, in US dollars, of all accounts but the owner's in a calendar month. */
  monthlyUsd: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this account may start model work now. The owner always may, and so may everyone
 * while sign-up is open (local development): budgets protect the owner's credit from friends.
 * The monthly estimate uses list prices (config/models.json), which run higher than the bill,
 * so it errs on the side of stopping early.
 */
export async function checkBudget(
  db: Db,
  models: ModelsFile,
  budget: Budget | null,
  user: { id: string; isOwner: boolean },
  now = new Date(),
): Promise<BudgetLimit | null> {
  if (budget === null || user.isOwner) return null;

  const [today] = await db
    .select({ runs: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, user.id),
        gte(agentRuns.startedAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  if ((today?.runs ?? 0) >= budget.dailyRuns) return "daily_limit";

  if ((await friendsSpendThisMonth(db, models, now)) >= budget.monthlyUsd) return "monthly_limit";
  return null;
}

/** Estimated model spend this calendar month (UTC) of every account but the owner's. */
export async function friendsSpendThisMonth(
  db: Db,
  models: ModelsFile,
  now = new Date(),
): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const byModel = await db
    .select({
      model: agentRuns.model,
      // float8, which node-postgres returns as a number (a bigint would come back as a string).
      inputTokens: sql<number>`coalesce(sum(${agentRuns.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${agentRuns.outputTokens}), 0)::float8`,
    })
    .from(agentRuns)
    .innerJoin(users, eq(agentRuns.userId, users.id))
    .where(and(eq(users.isOwner, false), gte(agentRuns.startedAt, monthStart)))
    .groupBy(agentRuns.model);

  let total = 0;
  for (const row of byModel) {
    total += priceOf(models, row.model, row);
  }
  return total;
}

/** A run's cost at list prices; a model models.json doesn't price counts as free. */
function priceOf(
  models: ModelsFile,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  try {
    return costUsd(models, parseModelRef(model), usage) ?? 0;
  } catch {
    return 0;
  }
}
