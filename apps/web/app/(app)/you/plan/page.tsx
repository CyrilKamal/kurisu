import { planResponseSchema, type PlanResponse } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Pricing } from "@/components/Pricing";
import { ScreenHeader } from "@/components/ScreenHeader";
import { apiGet } from "@/lib/api";
import { planName, planSourceLine } from "@/lib/plans";

export const metadata: Metadata = { title: "Plan · kurisu" };

type UsageItem = PlanResponse["usage"]["chat"];

/** One allowance: a meter with its readout, or just the count when the plan has no cap. */
function UsageRow({ label, item, note }: { label: string; item: UsageItem; note?: string | null }) {
  const percent =
    item.allowance === null || item.allowance === 0
      ? 0
      : Math.min(100, Math.round((item.used / item.allowance) * 100));
  return (
    <li className="flex flex-col gap-2 border-b border-line py-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-ink">{label}</span>
        <span className="k-meter__label">
          <b>{item.used.toLocaleString("en-US")}</b>
          {item.allowance === null
            ? " · no monthly limit"
            : ` / ${item.allowance.toLocaleString("en-US")}`}
        </span>
      </div>
      {item.allowance !== null && (
        <div className="k-meter" aria-hidden="true">
          <div className="k-meter__track">
            <div
              className="k-meter__fill"
              style={{ "--p": `${String(percent)}%` } as React.CSSProperties}
            />
          </div>
        </div>
      )}
      {note && <p className="k-field__hint">{note}</p>}
    </li>
  );
}

/** Plan: which plan you're on and why, this month's use of its allowances, and the plans. */
export default async function PlanPage() {
  const data = await apiGet("/plan", planResponseSchema);
  if (!data) redirect("/");
  const { plan, usage, importLines, resetsAt } = data;

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title="Plan" back="/you" />

      <section className="pt-6">
        <p className="font-serif text-2xl/8 font-semibold text-ink">{planName(plan.id)}</p>
        <p className="text-ink-muted">{planSourceLine(plan)}</p>
      </section>

      <section className="pt-6">
        <h2 className="k-caps pb-2">This month</h2>
        <ul className="k-rows">
          <UsageRow label="Chat updates" item={usage.chat} />
          <UsageRow label="Recommendations" item={usage.recommendations} />
          <UsageRow
            label="Imports from notes"
            item={usage.imports}
            note={importLines === null ? null : `Up to ${String(importLines)} lines each.`}
          />
        </ul>
        <p className="k-field__hint pt-2">
          Allowances come back on {resetsAt.slice(0, 10)}. Editing, +1 ep, the List, the brief and
          friends never run out.
        </p>
      </section>

      <section className="pt-6">
        <h2 className="k-caps pb-2">Plans</h2>
        {/* With limits off, nobody is on a plan. */}
        <Pricing current={plan.source === "open" ? undefined : plan.id} />
      </section>
    </main>
  );
}
