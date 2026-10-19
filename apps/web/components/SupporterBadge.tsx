import type { PlanId } from "@kurisu/shared";

import { planName } from "@/lib/plans";

/** "Premium" or "Pro" beside the name of someone who pays for kurisu. */
export function SupporterBadge({ plan }: { plan: PlanId | null }) {
  if (plan === null) return null;
  const name = planName(plan);
  return (
    <span className="k-tag k-tag--word" title={`Supports kurisu with ${name}`}>
      {name}
    </span>
  );
}
