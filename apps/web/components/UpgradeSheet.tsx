"use client";

import type { PlanLimit } from "@kurisu/shared";
import Link from "next/link";

import { Sheet } from "@/components/Sheet";
import { limitText, limitTitle, nextPlanLine } from "@/lib/plans";

/**
 * When a plan's allowance runs out (a 429 `plan_limit`): what ran out and when it comes back,
 * that the list itself never locks, and what the next plan up gives. Paid plans aren't on sale
 * yet, so it points to the Plan screen rather than a checkout.
 */
export function UpgradeSheet({ limit, onClose }: { limit: PlanLimit; onClose: () => void }) {
  const next = nextPlanLine(limit);
  return (
    <Sheet title={limitTitle(limit)} onClose={onClose}>
      <div className="k-sheet__body flex flex-col gap-2">
        <p className="text-ink">{limitText(limit)}</p>
        {(limit.kind === "chat" || limit.kind === "recommendations") && (
          <p className="text-ink-muted">
            Your list never locks: editing a show and +1 ep keep working on the List, and so does
            the morning brief.
          </p>
        )}
        {next && <p className="text-ink-muted">{next} Paid plans aren&apos;t on sale yet.</p>}
      </div>
      <div className="k-sheet__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>
          Close
        </button>
        {limit.kind === "chat" && (
          <Link href="/list" className="k-btn">
            Open your List
          </Link>
        )}
        <Link href="/you/plan" className="k-btn k-btn--primary">
          See plans
        </Link>
      </div>
    </Sheet>
  );
}
