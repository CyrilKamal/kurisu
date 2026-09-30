import { LIST_STATUSES, type ListStatus } from "@kurisu/shared";
import Link from "next/link";

import { STATUS_LABELS } from "@/lib/format";

export function StatusTabs({
  selected,
  counts,
}: {
  selected: ListStatus;
  counts: Record<ListStatus, number>;
}) {
  return (
    <nav aria-label="List status" className="-mx-4 mt-2 overflow-x-auto px-4">
      <ul className="flex gap-1 whitespace-nowrap">
        {LIST_STATUSES.map((status) => {
          const active = status === selected;
          return (
            <li key={status}>
              <Link
                href={{ pathname: "/list", query: { status } }}
                aria-current={active ? "page" : undefined}
                replace
                scroll={false}
                className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm ${
                  active
                    ? "border-blue-700 font-medium text-zinc-900 dark:border-blue-400 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {STATUS_LABELS[status]}
                <span className="rounded-full bg-zinc-100 px-1.5 text-xs tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {counts[status]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
