"use client";

import { statsResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { goalProgress } from "@/lib/stats";

/**
 * This year's goal: shows to complete. A meter shows how far along it is (the track a lighter
 * step of the fill's blue), and the goal can be set, changed or cleared.
 */
export function YearGoal({
  year,
  completed,
  initialGoal,
}: {
  year: number;
  completed: number;
  initialGoal: number | null;
}) {
  const [goal, setGoal] = useState(initialGoal);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initialGoal ?? 20));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(target: number | null) {
    setBusy(true);
    setNotice(null);
    const result = await sendApi("PUT", "/stats/goal", statsResponseSchema, { target });
    setBusy(false);
    if (result.ok && result.data) {
      setGoal(result.data.year.goal);
      setEditing(false);
    } else {
      setNotice("Couldn't save the goal. Use a whole number from 1 to 1000.");
    }
  }

  const progress = goal === null ? null : goalProgress(completed, goal);
  const target = Number(draft);
  const valid = Number.isInteger(target) && target >= 1 && target <= 1000;

  return (
    <div className="mt-3">
      {progress && (
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span>{progress.label}</span>
            <span className="tabular-nums text-zinc-500">{progress.percent}%</span>
          </div>
          <div
            role="meter"
            aria-label={`${String(year)} goal`}
            aria-valuemin={0}
            aria-valuemax={goal ?? 0}
            aria-valuenow={Math.min(completed, goal ?? 0)}
            aria-valuetext={progress.label}
            className="mt-1 h-2 overflow-hidden rounded bg-blue-100 dark:bg-blue-950"
          >
            <div
              className="h-full rounded bg-blue-600 dark:bg-blue-500"
              style={{ width: `${String(progress.percent)}%` }}
            />
          </div>
        </div>
      )}
      {editing ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void save(target);
          }}
        >
          <label className="flex items-center gap-2">
            Complete
            <input
              type="number"
              min={1}
              max={1000}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              className="h-9 w-20 rounded-md border border-zinc-300 bg-white px-2 tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
            />
            shows in {year}
          </label>
          <button
            type="submit"
            disabled={busy || !valid}
            className="h-9 rounded-md bg-blue-700 px-3 font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
          {goal !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="h-9 rounded-md px-3 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Clear goal
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(false);
            }}
            className="h-9 rounded-md px-3 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(String(goal ?? 20));
            setEditing(true);
          }}
          className="mt-2 text-sm text-blue-700 hover:underline dark:text-blue-400"
        >
          {goal === null ? `Set a goal for ${String(year)}` : "Change goal"}
        </button>
      )}
      {notice && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{notice}</p>}
    </div>
  );
}
