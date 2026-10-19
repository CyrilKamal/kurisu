import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PlanId } from "@kurisu/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../db/client.js";
import { subscriptions, users } from "../db/schema.js";

/** A monthly allowance; null is no monthly cap. */
const allowance = z.number().int().nonnegative().nullable();
const limitsSchema = z
  .object({
    chat: allowance,
    recommendations: allowance,
    imports: allowance,
    /** The most lines one import may have. */
    importLines: allowance,
  })
  .strict();
export type PlanLimits = z.infer<typeof limitsSchema>;

const plansFileSchema = z.object({
  note: z.string().optional(),
  trial: z.object({ days: z.number().int().positive(), plan: z.enum(["premium", "pro"]) }),
  plans: z.object({ free: limitsSchema, premium: limitsSchema, pro: limitsSchema }).strict(),
});
export type PlansFile = z.infer<typeof plansFileSchema>;

export const PLANS_FILE = fileURLToPath(new URL("../../config/plans.json", import.meta.url));

export function loadPlansFile(path: string = PLANS_FILE): PlansFile {
  return plansFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Why someone is on their plan: the owner is always Pro; a subscription (paid, or granted by
 * hand); a new account's trial; or nothing, Free. While sign-up is open with no owner
 * (development, tests), limits are off: "open".
 */
export type PlanSource = "owner" | "subscription" | "trial" | "free" | "open";

export interface PlanView {
  id: PlanId;
  source: PlanSource;
  /** When it ends: the trial's end or the paid period's; null for none. */
  until: Date | null;
  /** A subscription that won't renew. */
  cancelAtPeriodEnd: boolean;
}

/** Subscription states whose plan still counts (past due: the provider is retrying payment). */
const COUNTING = new Set(["active", "trialing", "past_due"]);

/** The plan a user is on now. */
export async function planOf(
  db: Db,
  userId: string,
  options: { limitsOn: boolean; trialPlan: PlanId },
  now = new Date(),
): Promise<PlanView> {
  const [row] = await db
    .select({
      isOwner: users.isOwner,
      plan: subscriptions.plan,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      trialEndsAt: users.trialEndsAt,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, userId));
  if (row?.isOwner) return { id: "pro", source: "owner", until: null, cancelAtPeriodEnd: false };
  if (!options.limitsOn) {
    return { id: "pro", source: "open", until: null, cancelAtPeriodEnd: false };
  }
  if (
    row?.plan &&
    row.status &&
    COUNTING.has(row.status) &&
    (row.currentPeriodEnd === null || row.currentPeriodEnd > now)
  ) {
    return {
      id: row.plan,
      source: "subscription",
      until: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
    };
  }
  if (row?.trialEndsAt && row.trialEndsAt > now) {
    return {
      id: options.trialPlan,
      source: "trial",
      until: row.trialEndsAt,
      cancelAtPeriodEnd: false,
    };
  }
  return { id: "free", source: "free", until: null, cancelAtPeriodEnd: false };
}

/** Whether a plan is paid for (so the monthly cap on everyone else's model spend skips it). */
export function isPaying(plan: PlanView): boolean {
  return plan.source === "subscription" || plan.source === "owner";
}
