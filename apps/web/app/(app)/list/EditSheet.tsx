"use client";

import { changeResponseSchema, LIST_STATUSES, type ChangeView } from "@kurisu/shared";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { sendApi } from "@/lib/clientApi";
import { editErrorMessage, editPayload, formFrom, type EditableEntry } from "@/lib/editEntry";
import { STATUS_LABELS } from "@/lib/format";

const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Edits one entry: status, episodes, score and rewatching, or takes it off the list. Saving goes
 * through the same write path as Chat, so it shows in History and can be undone. A Sheet of the
 * design system's Field controls; Remove asks in the same sheet, never a second one.
 */
export function EditSheet({
  entry,
  onClose,
  onSaved,
}: {
  entry: EditableEntry;
  onClose: () => void;
  onSaved: (change: ChangeView) => void;
}) {
  const [form, setForm] = useState(() => formFrom(entry));
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const payload = editPayload(entry, form);
  const total = entry.numEpisodes;

  async function send(which: "save" | "remove", path: string, body: Record<string, unknown>) {
    setBusy(which);
    setError(null);
    const result = await sendApi("POST", path, changeResponseSchema, {
      ...body,
      // One per tap: a retry of this same request writes once.
      requestId: crypto.randomUUID(),
    });
    setBusy(null);
    if (result.ok) {
      if (result.data) onSaved(result.data.change);
    } else {
      setError(editErrorMessage(result.error));
    }
  }

  function setEpisodes(value: number) {
    const capped = Math.max(0, total === null ? value : Math.min(value, total));
    setForm((f) => ({ ...f, episodesWatched: capped }));
  }

  const errorLine = error && (
    <p className="k-cmd__notice" role="alert">
      <span className="k-tag k-tag--word text-accent-text">Err</span>
      {error}
    </p>
  );

  if (removing) {
    return (
      <Sheet title={entry.title} onClose={onClose}>
        <div className="k-sheet__body">
          <p className="text-ink-muted">
            Take it off your list, on MyAnimeList too? You can put it back from your Journal.
          </p>
          {errorLine}
        </div>
        <div className="k-sheet__actions">
          <button
            type="button"
            className="k-btn k-btn--ghost"
            disabled={busy !== null}
            onClick={() => {
              setRemoving(false);
              setError(null);
            }}
          >
            Keep it
          </button>
          <button
            type="button"
            className="k-btn k-btn--danger"
            disabled={busy !== null}
            aria-busy={busy === "remove"}
            onClick={() => void send("remove", `/list/${String(entry.animeId)}/remove`, {})}
          >
            <Icon name="trash" />
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={entry.title}
      onClose={onClose}
      onSubmit={() => {
        if (payload) void send("save", `/list/${String(entry.animeId)}/edit`, payload);
      }}
    >
      <div className="k-sheet__body">
        <div className="k-field">
          <label className="k-field__label" htmlFor="edit-status">
            Status
          </label>
          <select
            id="edit-status"
            className="k-input"
            value={form.status}
            onChange={(event) => {
              const status = LIST_STATUSES.find((s) => s === event.target.value);
              if (status) setForm((f) => ({ ...f, status }));
            }}
          >
            {LIST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="k-field">
          <span className="k-field__label" id="episodes-label">
            Episodes
          </span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="episodes-label">
            <button
              type="button"
              className="k-btn k-btn--icon"
              aria-label="One episode less"
              onClick={() => {
                setEpisodes(form.episodesWatched - 1);
              }}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={total ?? undefined}
              value={form.episodesWatched}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) setEpisodes(Math.floor(value));
              }}
              aria-label="Episodes watched"
              className="k-input k-input--mono w-16 text-center"
            />
            <button
              type="button"
              className="k-btn k-btn--icon"
              aria-label="One episode more"
              onClick={() => {
                setEpisodes(form.episodesWatched + 1);
              }}
            >
              <Icon name="plus" />
            </button>
            <span className="k-meter__label">of {total === null ? "?" : String(total)}</span>
          </div>
        </div>

        <div className="k-field">
          <label className="k-field__label" htmlFor="edit-score">
            Score
          </label>
          <select
            id="edit-score"
            className="k-input k-input--mono"
            value={form.score}
            onChange={(event) => {
              setForm((f) => ({ ...f, score: Number(event.target.value) }));
            }}
          >
            <option value={0}>No score</option>
            {SCORES.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        </div>

        {(form.status === "completed" || entry.isRewatching) && (
          <label className="k-check">
            <input
              type="checkbox"
              checked={form.isRewatching}
              onChange={(event) => {
                setForm((f) => ({ ...f, isRewatching: event.target.checked }));
              }}
            />
            Rewatching
          </label>
        )}

        {errorLine}
      </div>
      <div className="k-sheet__actions">
        <button
          type="button"
          className="k-btn k-btn--danger"
          disabled={busy !== null}
          onClick={() => {
            setError(null);
            setRemoving(true);
          }}
        >
          <Icon name="trash" />
          Remove
        </button>
        <span className="flex-1" />
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="k-btn k-btn--primary"
          disabled={!payload || busy !== null}
          aria-busy={busy === "save"}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
