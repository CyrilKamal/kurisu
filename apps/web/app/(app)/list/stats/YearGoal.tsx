"use client";

import { statsResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { goalProgress } from "@/lib/stats";

/**
 * This year's goal: shows to complete, as a crimson meter with its mono readout (every meter
 * carries one). The goal can be set, changed or cleared.
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
    <div className="flex flex-col gap-2 py-4">
      {progress && goal !== null && (
        <div className="k-field">
          <span className="k-field__label">Goal for {year}</span>
          <div
            className="k-meter"
            role="meter"
            aria-label={`${String(year)} goal`}
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuenow={Math.min(completed, goal)}
            aria-valuetext={progress.label}
          >
            <div className="k-meter__track">
              <div
                className="k-meter__fill"
                style={{ "--p": `${String(progress.percent)}%` } as React.CSSProperties}
              />
            </div>
            <span className="k-meter__label">
              <b>{completed}</b>/{goal} · {progress.percent}%
            </span>
          </div>
        </div>
      )}
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void save(target);
          }}
        >
          <label className="k-check" htmlFor="goal-target">
            Complete
          </label>
          <input
            id="goal-target"
            type="number"
            min={1}
            max={1000}
            value={draft}
            aria-invalid={!valid}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            className="k-input k-input--mono w-24"
          />
          <span className="k-field__hint">shows in {year}</span>
          <button
            type="submit"
            className="k-btn k-btn--primary"
            disabled={busy || !valid}
            aria-busy={busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {goal !== null && (
            <button
              type="button"
              className="k-btn k-btn--ghost"
              disabled={busy}
              onClick={() => void save(null)}
            >
              Clear goal
            </button>
          )}
          <button
            type="button"
            className="k-link"
            onClick={() => {
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div>
          <button
            type="button"
            className="k-link"
            onClick={() => {
              setDraft(String(goal ?? 20));
              setEditing(true);
            }}
          >
            {goal === null ? `Set a goal for ${String(year)}` : "Change goal"}
          </button>
        </div>
      )}
      {notice && (
        <p className="k-cmd__notice" role="alert">
          <span className="k-tag k-tag--word text-accent-text">Err</span>
          {notice}
        </p>
      )}
    </div>
  );
}
