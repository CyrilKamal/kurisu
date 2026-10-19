"use client";

import { PLAN_CATALOG, type PlanId } from "@kurisu/shared";
import { useState } from "react";

import { priceLabel, yearlySaving, type BillingInterval } from "@/lib/plans";

/**
 * Free, Premium and Pro side by side (stacked on phones), billed yearly unless the reader picks
 * monthly. The prices are what kurisu will charge at launch; nothing is on sale yet. In the app,
 * `current` marks the reader's own plan; on the landing page Premium stands out instead.
 */
export function Pricing({ current }: { current?: PlanId }) {
  const highlighted = current ?? "premium";
  const [interval, setBilling] = useState<BillingInterval>("year");
  const saving = yearlySaving(PLAN_CATALOG[1]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="k-segmented" role="group" aria-label="Billing">
          {(
            [
              ["year", "Yearly"],
              ["month", "Monthly"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="w-auto px-4"
              aria-pressed={interval === value}
              onClick={() => {
                setBilling(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="k-field__hint">Yearly saves {saving}%.</p>
      </div>

      <ul className="grid gap-4 md:grid-cols-3">
        {PLAN_CATALOG.map((plan) => {
          const { price, per, note } = priceLabel(plan, interval);
          return (
            <li
              key={plan.id}
              className={`k-panel flex flex-col gap-4 p-4 ${plan.id === highlighted ? "border-line-strong" : ""}`}
            >
              <div>
                <h3 className="flex items-center gap-2 font-serif text-base/6 font-semibold text-ink">
                  {plan.name}
                  {plan.id === current && <span className="k-tag k-tag--word">Your plan</span>}
                </h3>
                <p className="k-field__hint">{plan.tagline}</p>
              </div>
              <div>
                <p>
                  <span className="text-2xl/8 font-semibold text-ink tabular-nums">{price}</span>{" "}
                  <span className="text-ink-muted">{per}</span>
                </p>
                {/* A blank line keeps the plans' prices level when only yearly ones have a note. */}
                <p className="k-field__hint tabular-nums">{note ?? "\u00a0"}</p>
              </div>
              <ul className="flex flex-col gap-2 text-ink-muted">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="text-ink-faint">
                      ›
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="k-field__hint">
        Prices at launch, in US dollars. Paid plans aren&apos;t on sale yet; new accounts get 14
        days of Premium.
      </p>
    </div>
  );
}
