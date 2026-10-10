import { LIST_STATUSES, type ListStatus } from "@kurisu/shared";
import Link from "next/link";

import { STATUS_KEYS } from "@/components/StatusBadge";
import { STATUS_LABELS } from "@/lib/format";

/**
 * One tab per list status with its square mark and a mono count (the design system's
 * StatusTabs). They wrap rather than scroll, so a phone shows all five at once, in two rows. The
 * tabs are real links (so they open in a new tab too), but a plain click switches in place
 * without asking the server.
 */
export function StatusTabs({
  selected,
  counts,
  hrefFor,
  onSelect,
}: {
  selected: ListStatus;
  counts: Record<ListStatus, number>;
  hrefFor: (status: ListStatus) => string;
  onSelect: (status: ListStatus) => void;
}) {
  return (
    <nav aria-label="List status">
      <ul className="k-tabs flex-wrap">
        {LIST_STATUSES.map((status) => (
          <li key={status}>
            <Link
              href={hrefFor(status)}
              aria-current={status === selected ? "page" : undefined}
              replace
              scroll={false}
              onNavigate={(event) => {
                event.preventDefault();
                onSelect(status);
              }}
              className={`k-tab k-tab--${STATUS_KEYS[status]} max-sm:px-2`}
            >
              <span className="k-sq" />
              {STATUS_LABELS[status]}
              <span className="k-tab__count">{counts[status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
