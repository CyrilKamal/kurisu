import { PLAN_CATALOG, type PlanId } from "@kurisu/shared";
import { describe, expect, it } from "vitest";

import { importLines } from "../../src/billing/limits.js";
import { loadPlansFile } from "../../src/billing/plans.js";

/** A plan's features as the landing page lists them, as one string. */
function shown(id: PlanId): string {
  return PLAN_CATALOG.find((plan) => plan.id === id)?.features.join(" · ") ?? "";
}
const n = (value: number | null) => (value ?? 0).toLocaleString("en-US");

describe("the plans", () => {
  it("limit what the landing page says they do", () => {
    const { plans, trial } = loadPlansFile();
    expect(shown("free")).toContain(`${n(plans.free.chat)} chat updates a month`);
    expect(shown("free")).toContain(`${n(plans.free.recommendations)} recommendations a month`);
    expect(shown("free")).toContain(`${n(plans.free.imports)} import from your notes a month`);
    expect(shown("premium")).toContain(`${n(plans.premium.chat)} chat updates a month`);
    expect(shown("premium")).toContain(
      `${n(plans.premium.recommendations)} recommendations a month`,
    );
    expect(plans.premium.imports).toBeNull();
    expect(shown("pro")).toContain(
      `${n(plans.pro.chat)} chat updates and ${n(plans.pro.recommendations)} recommendations a month`,
    );
    expect(trial).toEqual({ days: 14, plan: "premium" });
  });

  it("enforce the limits the shared catalog shows", () => {
    const { plans } = loadPlansFile();
    for (const plan of PLAN_CATALOG) {
      const enforced = plans[plan.id];
      expect(plan.limits).toEqual({
        chat: enforced.chat,
        recommendations: enforced.recommendations,
        imports: enforced.imports,
      });
    }
  });

  it("include the features the landing page lists for them", () => {
    const { plans } = loadPlansFile();
    const none = {
      supporterBadge: false,
      episodeAlerts: false,
      calendar: false,
      fullYear: false,
      lab: false,
    };
    expect(plans.free.features).toEqual(none);
    expect(shown("premium")).toContain("A supporter badge");
    expect(shown("premium")).toContain("An alert as each episode airs");
    expect(plans.premium.features).toEqual({ ...none, supporterBadge: true, episodeAlerts: true });
    expect(shown("pro")).toContain("Everything in Premium");
    expect(shown("pro")).toContain("A calendar feed of upcoming episodes");
    expect(shown("pro")).toContain("Your full year in review");
    expect(shown("pro")).toContain("Early access to AI lab features");
    expect(plans.pro.features).toEqual({
      supporterBadge: true,
      episodeAlerts: true,
      calendar: true,
      fullYear: true,
      lab: true,
    });
  });

  it("only grow from plan to plan", () => {
    const { plans } = loadPlansFile();
    for (const key of ["chat", "recommendations"] as const) {
      expect(plans.free[key] ?? Infinity).toBeLessThan(plans.premium[key] ?? Infinity);
      expect(plans.premium[key] ?? Infinity).toBeLessThan(plans.pro[key] ?? Infinity);
    }
  });

  it("count an import's lines without the blank ones", () => {
    expect(importLines("frieren done\n\n  \njjk ep 5\n")).toBe(2);
  });
});
