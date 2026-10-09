import type { ListStatus } from "@kurisu/shared";

import { STATUS_LABELS } from "@/lib/format";

import { Icon, type IconName } from "./Icon";

/** The design system's status keys: its class suffix and glyph for each list status. */
export const STATUS_KEYS: Record<
  ListStatus,
  "watching" | "completed" | "on-hold" | "dropped" | "planned"
> = {
  watching: "watching",
  completed: "completed",
  on_hold: "on-hold",
  dropped: "dropped",
  plan_to_watch: "planned",
};

/**
 * One of the five statuses as mark, colour and word together, never colour alone. The badge
 * (with its glyph) is for where the status is news; `plain` is the inline form in meta lines.
 */
export function StatusBadge({ status, plain = false }: { status: ListStatus; plain?: boolean }) {
  const key = STATUS_KEYS[status];
  if (plain) {
    return (
      <span className={`k-status k-status--${key} k-status--plain`}>
        <span className="k-sq" />
        {STATUS_LABELS[status]}
      </span>
    );
  }
  return (
    <span className={`k-status k-status--${key}`}>
      <Icon name={`status-${key}` as IconName} />
      {STATUS_LABELS[status]}
    </span>
  );
}
