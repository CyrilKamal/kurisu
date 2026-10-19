import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PlanFeatures, PlanId } from "@kurisu/shared";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
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

const featuresSchema = z
  .object({
    supporterBadge: z.boolean(),
    calendar: z.boolean(),
    fullYear: z.boolean(),
    lab: z.boolean(),
  })
  .strict();
const planSchema = limitsSchema.extend({ features: featuresSchema }).strict();

const plansFileSchema = z.object({
  note: z.string().optional(),
  trial: z.object({ days: z.number().int().positive(), plan: z.enum(["premium", "pro"]) }),
  plans: z.object({ free: planSchema, premium: planSchema, pro: planSchema }).strict(),
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

/** Which plan someone is on and why, before its features are looked up. */
export interface PlanStanding {
  id: PlanId;
  source: PlanSource;
  /** When it ends: the trial's end or the paid period's; null for none. */
  until: Date | null;
  /** A subscription that won't renew. */
  cancelAtPeriodEnd: boolean;
}

export interface PlanView extends PlanStanding {
  features: PlanFeatures;
}

/** Subscription states whose plan still counts (past due: the provider is retrying payment). */
const COUNTING_STATUSES = ["active", "trialing", "past_due"] as const;
const COUNTING = new Set<string>(COUNTING_STATUSES);

/** The plan a user is on now. */
export async function planOf(
  db: Db,
  userId: string,
  options: { limitsOn: boolean; trialPlan: PlanId },
  now = new Date(),
): Promise<PlanStanding> {
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
export function isPaying(plan: PlanStanding): boolean {
  return plan.source === "subscription" || plan.source === "owner";
}

/**
 * The paid plans of these users whose plan comes with a supporter badge, keyed by user id. A
 * badge is for paying: not for a trial, the owner, or a server with limits off.
 */
export async function supportersOf(
  db: Db,
  plans: PlansFile,
  userIds: string[],
  now = new Date(),
): Promise<Map<string, PlanId>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: subscriptions.userId, plan: subscriptions.plan })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.userId, userIds),
        inArray(subscriptions.status, [...COUNTING_STATUSES]),
        or(isNull(subscriptions.currentPeriodEnd), gt(subscriptions.currentPeriodEnd, now)),
      ),
    );
  return new Map(
    rows
      .filter((row) => plans.plans[row.plan].features.supporterBadge)
      .map((row) => [row.userId, row.plan]),
  );
}
