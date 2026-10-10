"use client";

import {
  changeResponseSchema,
  LIST_STATUSES,
  type ChangeView,
  type ListStatus,
} from "@kurisu/shared";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { addErrorMessage } from "@/lib/editEntry";
import { STATUS_LABELS } from "@/lib/format";
import { useWriteToast } from "@/lib/useWriteToast";

import { Sheet } from "./Sheet";

const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Puts a show on the list: Plan to Watch unless the user picks another status, and a score if
 * they give one. The tap on Add is the confirmation; it writes through the same path as Chat's
 * adds, so a Toast offers Undo and History keeps it.
 */
export function AddSheet({
  show,
  onClose,
  onAdded,
}: {
  show: { animeId: number; title: string };
  onClose: () => void;
  onAdded?: (change: ChangeView) => void;
}) {
  const toast = useWriteToast();
  const [status, setStatus] = useState<ListStatus>("plan_to_watch");
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const result = await sendApi("POST", "/list/add", changeResponseSchema, {
      animeId: show.animeId,
      status,
      ...(score > 0 && { score }),
      // One per tap, like the List screen's edits; the button is disabled while one is out.
      requestId: crypto.randomUUID(),
    });
    setBusy(false);
    if (result.ok && result.data) {
      toast.written(result.data.change);
      onAdded?.(result.data.change);
      onClose();
    } else if (!result.ok) {
      setError(addErrorMessage(result.error));
    }
  }

  return (
    <Sheet title={`Add ${show.title}`} onClose={onClose} onSubmit={() => void add()}>
      <div className="k-sheet__body">
        <div className="k-field">
          <label className="k-field__label" htmlFor="add-status">
            Status
          </label>
          <select
            id="add-status"
            className="k-input"
            value={status}
            onChange={(event) => {
              const next = LIST_STATUSES.find((s) => s === event.target.value);
              if (next) setStatus(next);
            }}
          >
            {LIST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {status === "completed" && (
            <p className="k-field__hint">Completed counts every episode as watched.</p>
          )}
        </div>
        <div className="k-field">
          <label className="k-field__label" htmlFor="add-score">
            Score
          </label>
          <select
            id="add-score"
            className="k-input k-input--mono"
            value={score}
            onChange={(event) => {
              setScore(Number(event.target.value));
            }}
          >
            <option value={0}>No score</option>
            {SCORES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="k-cmd__notice" role="alert">
            <span className="k-tag k-tag--word text-accent-text">Err</span>
            {error}
          </p>
        )}
      </div>
      <div className="k-sheet__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="k-btn k-btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </Sheet>
  );
}
