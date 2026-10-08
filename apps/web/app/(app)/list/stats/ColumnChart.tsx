"use client";

import { useState } from "react";

export interface Column {
  key: string;
  /** Under the column: "8", "Mar". */
  axis: string;
  value: number;
  /** For the tooltip and the table: "Score 8", "March". */
  name: string;
}

const PLOT_HEIGHT = 96;

/**
 * A single-series column chart: one hue, columns at most 24px wide with rounded tops on a
 * hairline baseline, the tallest one labeled. Each column is a hover and focus target that
 * shows its value, and a table under the chart lists every value without hovering.
 */
export function ColumnChart({
  title,
  columns,
  unit,
}: {
  title: string;
  columns: Column[];
  /** "show" → "1 show", "3 shows". */
  unit: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...columns.map((c) => c.value));
  const tallest = columns.reduce<Column | null>(
    (best, c) => (c.value > 0 && (best === null || c.value > best.value) ? c : best),
    null,
  );
  const amount = (n: number) => `${String(n)} ${n === 1 ? unit : `${unit}s`}`;

  return (
    <figure className="mt-3">
      <div
        className="flex items-end border-b border-zinc-200 dark:border-zinc-800"
        style={{ height: PLOT_HEIGHT + 20 }}
      >
        {columns.map((column) => {
          const height = column.value === 0 ? 0 : Math.max(2, (column.value / max) * PLOT_HEIGHT);
          const isActive = active === column.key;
          return (
            <div
              key={column.key}
              tabIndex={0}
              aria-label={`${column.name}: ${amount(column.value)}`}
              onPointerEnter={() => {
                setActive(column.key);
              }}
              onPointerLeave={() => {
                setActive(null);
              }}
              onFocus={() => {
                setActive(column.key);
              }}
              onBlur={() => {
                setActive(null);
              }}
              className="relative flex h-full flex-1 flex-col items-center justify-end outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-900"
            >
              {isActive && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {amount(column.value)}
                  </span>{" "}
                  <span className="text-zinc-500">{column.name}</span>
                </div>
              )}
              {tallest?.key === column.key && !isActive && (
                <span className="mb-0.5 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  {column.value}
                </span>
              )}
              <div
                className={`w-full max-w-6 rounded-t bg-blue-600 dark:bg-blue-500 ${isActive ? "brightness-110" : ""}`}
                style={{ height }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex">
        {columns.map((column) => (
          <span
            key={column.key}
            aria-hidden
            className="flex-1 pt-1 text-center text-xs tabular-nums text-zinc-500"
          >
            {column.axis}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{title}</figcaption>
      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-1 tabular-nums">
          <tbody>
            {columns.map((column) => (
              <tr key={column.key}>
                <td className="pr-4">{column.name}</td>
                <td className="text-right text-zinc-700 dark:text-zinc-300">{column.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
