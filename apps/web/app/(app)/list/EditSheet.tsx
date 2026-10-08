"use client";

import {
  changeResponseSchema,
  LIST_STATUSES,
  type ChangeView,
  type ListEntry,
} from "@kurisu/shared";
import { useEffect, useRef, useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { editErrorMessage, editPayload, formFrom } from "@/lib/editEntry";
import { STATUS_LABELS } from "@/lib/format";

const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const field =
  "h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/**
 * Edits one entry: status, episodes, score and rewatching, or takes it off the list. Saving goes
 * through the same write path as Chat, so it shows in History and can be undone.
 */
export function EditSheet({
  entry,
  onClose,
  onSaved,
}: {
  entry: ListEntry;
  onClose: () => void;
  onSaved: (change: ChangeView) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(() => formFrom(entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Opened as a modal, so focus stays inside and Escape closes it.
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const payload = editPayload(entry, form);
  const total = entry.numEpisodes;

  async function send(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await sendApi("POST", path, changeResponseSchema, {
      ...body,
      // One per tap: a retry of this same request writes once.
      requestId: crypto.randomUUID(),
    });
    setBusy(false);
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

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="edit-title"
      className="m-auto w-[min(26rem,calc(100%-2rem))] rounded-xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (payload) void send(`/list/${String(entry.animeId)}/edit`, payload);
        }}
        className="flex flex-col gap-4 p-4"
      >
        <h2 id="edit-title" className="pr-6 font-semibold leading-snug">
          {entry.title}
        </h2>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Status</span>
          <select
            value={form.status}
            onChange={(event) => {
              const status = LIST_STATUSES.find((s) => s === event.target.value);
              if (status) setForm((f) => ({ ...f, status }));
            }}
            className={field}
          >
            {LIST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3 text-sm">
          <span id="episodes-label">Episodes</span>
          <div className="flex items-center gap-1" role="group" aria-labelledby="episodes-label">
            <button
              type="button"
              aria-label="One episode less"
              onClick={() => {
                setEpisodes(form.episodesWatched - 1);
              }}
              className={`${field} w-9`}
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
              className={`${field} w-16 text-center tabular-nums`}
            />
            <button
              type="button"
              aria-label="One episode more"
              onClick={() => {
                setEpisodes(form.episodesWatched + 1);
              }}
              className={`${field} w-9`}
            >
              +
            </button>
            <span className="w-12 text-zinc-500 tabular-nums">
              of {total === null ? "?" : String(total)}
            </span>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Score</span>
          <select
            value={form.score}
            onChange={(event) => {
              setForm((f) => ({ ...f, score: Number(event.target.value) }));
            }}
            className={field}
          >
            <option value={0}>No score</option>
            {SCORES.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        </label>

        {(form.status === "completed" || entry.isRewatching) && (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Rewatching</span>
            <input
              type="checkbox"
              checked={form.isRewatching}
              onChange={(event) => {
                setForm((f) => ({ ...f, isRewatching: event.target.checked }));
              }}
              className="size-4"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const question = `Remove ${entry.title} from your list? You can put it back from History.`;
              if (window.confirm(question)) {
                void send(`/list/${String(entry.animeId)}/remove`, {});
              }
            }}
            className="h-9 rounded-lg px-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950"
          >
            Remove
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="h-9 rounded-lg px-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!payload || busy}
            className="h-9 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
