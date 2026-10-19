import { PLAN_CATALOG } from "@kurisu/shared";

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
