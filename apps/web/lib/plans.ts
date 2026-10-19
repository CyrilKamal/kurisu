import {
  PLAN_CATALOG,
  planLimitErrorSchema,
  type PlanId,
  type PlanLimit,
  type PlanView,
} from "@kurisu/shared";

export type Plan = (typeof PLAN_CATALOG)[number];
export type BillingInterval = "month" | "year";

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * What a plan costs, as the pricing table shows it: "$24.99" "a year", with "$2.08 a month" under
 * it, or "$2.99" "a month". Free is "$0" "forever".
 */
export function priceLabel(
  plan: Plan,
  interval: BillingInterval,
): { price: string; per: string; note: string | null } {
  if (plan.monthlyUsd === 0) return { price: "$0", per: "forever", note: null };
  if (interval === "month") return { price: usd(plan.monthlyUsd), per: "a month", note: null };
  const monthly = Math.floor((plan.yearlyUsd / 12) * 100) / 100;
  return { price: usd(plan.yearlyUsd), per: "a year", note: `${usd(monthly)} a month` };
}

/** How much a year costs less than twelve months, as a whole percentage: 30 for Premium. */
export function yearlySaving(plan: Plan): number {
  if (plan.monthlyUsd === 0) return 0;
  return Math.round((1 - plan.yearlyUsd / (plan.monthlyUsd * 12)) * 100);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function planName(id: PlanId): string {
  return PLAN_CATALOG.find((plan) => plan.id === id)?.name ?? id;
}

const n = (value: number) => value.toLocaleString("en-US");

/** The `plan_limit` in a failed request's body, if that's why it failed. */
export function planLimitOf(body: unknown): PlanLimit | null {
  const parsed = planLimitErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.limit : null;
}

/** A limit's sheet title: "Chat updates used up". */
export function limitTitle(limit: PlanLimit): string {
  switch (limit.kind) {
    case "chat":
      return "Chat updates used up";
    case "recommendations":
      return "Recommendations used up";
    case "imports":
      return "Imports used up";
    case "import_lines":
      return "Too many lines for one import";
  }
}

/** What happened, in a sentence: "You've used this month's 30 chat updates on Free. …" */
export function limitText(limit: PlanLimit): string {
  const plan = planName(limit.plan);
  switch (limit.kind) {
    case "chat":
      return `You've used this month's ${n(limit.allowance)} chat updates on ${plan}. They come back on the 1st.`;
    case "recommendations":
      return `You've used this month's ${n(limit.allowance)} recommendations on ${plan}. They come back on the 1st.`;
    case "imports":
      return limit.allowance === 1
        ? `You've used this month's import on ${plan}. It comes back on the 1st.`
        : `You've used this month's ${n(limit.allowance)} imports on ${plan}. They come back on the 1st.`;
    case "import_lines":
      return `These notes have ${n(limit.used)} lines, and an import on ${plan} takes up to ${n(limit.allowance)}. Import part of them now, or split them.`;
  }
}

/** What the next plan up gives instead, or null on the top plan. */
export function nextPlanLine(limit: PlanLimit): string | null {
  const index = PLAN_CATALOG.findIndex((plan) => plan.id === limit.plan);
  const next = PLAN_CATALOG[index + 1];
  if (!next) return null;
  switch (limit.kind) {
    case "chat":
      return `${next.name} has ${n(next.limits.chat)} a month.`;
    case "recommendations":
      return `${next.name} has ${n(next.limits.recommendations)} a month.`;
    case "imports":
    case "import_lines":
      return next.limits.imports === null
        ? `${next.name} imports whenever you like, with no limit on lines.`
        : `${next.name} has ${n(next.limits.imports)} a month.`;
  }
}

/** Whole days left in a trial, counting today's part as one; null when it isn't a trial. */
export function trialDaysLeft(plan: PlanView, now = new Date()): number | null {
  if (plan.source !== "trial" || !plan.until) return null;
  return Math.max(1, Math.ceil((Date.parse(plan.until) - now.getTime()) / DAY_MS));
}

const daysWord = (days: number) => `${String(days)} ${days === 1 ? "day" : "days"}`;

/** One line on why someone is on their plan, and until when. */
export function planSourceLine(plan: PlanView, now = new Date()): string {
  const until = plan.until ? plan.until.slice(0, 10) : null;
  switch (plan.source) {
    case "owner":
      return "Pro, as kurisu's owner, with no limits.";
    case "open":
      return "Limits are off on this server.";
    case "trial":
      return `${planName(plan.id)} trial, ${daysWord(trialDaysLeft(plan, now) ?? 0)} left. Then Free, unless you subscribe.`;
    case "subscription":
      if (!until) return `${planName(plan.id)}, with no end date.`;
      return plan.cancelAtPeriodEnd
        ? `${planName(plan.id)} until ${until}; it won't renew.`
        : `${planName(plan.id)}, renewing ${until}.`;
    case "free":
      return "Free, with a monthly allowance of chat updates, recommendations and imports.";
  }
}

/** The plan in a few words, for the You screen's row: "Premium trial · 9 days left". */
export function planShortLine(plan: PlanView, now = new Date()): string {
  switch (plan.source) {
    case "owner":
      return "Pro · kurisu's owner";
    case "open":
      return "No limits on this server";
    case "trial":
      return `${planName(plan.id)} trial · ${daysWord(trialDaysLeft(plan, now) ?? 0)} left`;
    case "subscription":
      return plan.until
        ? `${planName(plan.id)} · ${plan.cancelAtPeriodEnd ? "ends" : "renews"} ${plan.until.slice(0, 10)}`
        : planName(plan.id);
    case "free":
      return "Free · this month's allowances";
  }
}

/** The paid plan someone supports kurisu with, for the badge: a subscription only, never a trial. */
export function supporterOf(plan: PlanView): PlanId | null {
  return plan.source === "subscription" && plan.features.supporterBadge ? plan.id : null;
}

/** Google Calendar's "add by URL" page for a webcal:// feed. */
export function googleCalendarUrl(webcalUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;
}
