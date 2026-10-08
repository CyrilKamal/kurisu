"use client";

import {
  importItemResponseSchema,
  importResponseSchema,
  MAX_IMPORT_CHARS,
  type ImportItemView,
  type ImportView,
} from "@kurisu/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getApi, postApi, sendApi } from "@/lib/clientApi";
import { FOLDED, progress, rowError, rowsIn, SECTIONS, unanswered } from "@/lib/importView";

import { ImportRow } from "./ImportRow";

const WORKING = ["parsing", "running", "undoing"];
const POLL_MS = 1200;

/**
 * The whole import, step by step: paste, wait while the notes are read, review every row, tap
 * Import once, watch it write, and undo it if needed.
 */
export function ImportFlow({ initial }: { initial: ImportView | null }) {
  const [view, setView] = useState(initial);
  // The paste box shows when there's no import, or the last one is over.
  const [pasting, setPasting] = useState(
    initial === null || initial.status === "undone" || initial.status === "failed",
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const id = view?.id ?? null;
  const working = view !== null && WORKING.includes(view.status);
  useEffect(() => {
    if (!id || !working) return;
    const timer = setInterval(() => {
      void getApi(`/imports/${id}`, importResponseSchema).then((result) => {
        if (result.ok) setView(result.data.import);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [id, working]);

  async function read() {
    setBusy(true);
    setNotice(null);
    const result = await postApi("/imports", importResponseSchema, { text });
    setBusy(false);
    if (result.ok && result.data) {
      setView(result.data.import);
      setPasting(false);
    } else if (!result.ok) {
      setNotice(
        result.error === "busy"
          ? "Another import is still going. Wait for it to finish."
          : "Couldn't start the import. Please try again.",
      );
    }
  }

  async function patch(item: ImportItemView, body: Record<string, unknown>) {
    if (!view) return;
    const result = await sendApi(
      "PATCH",
      `/imports/${view.id}/items/${item.id}`,
      importItemResponseSchema,
      body,
    );
    if (result.ok && result.data) {
      const updated = result.data.item;
      setView((v) =>
        v ? { ...v, items: v.items.map((i) => (i.id === updated.id ? updated : i)) } : v,
      );
    } else {
      setNotice("Couldn't save that choice. Please try again.");
    }
  }

  async function act(path: "run" | "undo") {
    if (!view) return;
    if (
      path === "undo" &&
      !window.confirm("Undo this import? Everything it wrote goes back to how it was.")
    ) {
      return;
    }
    setBusy(true);
    const result = await postApi(`/imports/${view.id}/${path}`, importResponseSchema);
    setBusy(false);
    if (result.ok && result.data) setView(result.data.import);
    else setNotice("That didn't go through. Please try again.");
  }

  async function startOver() {
    if (view?.status === "review") await sendApi("DELETE", `/imports/${view.id}`, null);
    setView(null);
    setText("");
    setNotice(null);
    setPasting(true);
  }

  if (pasting || !view) {
    return (
      <section className="mt-4 flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Paste a list from your notes: one show per line, or several on a line, written however you
          wrote them (&ldquo;finished frieren 10/10, dropped csm at ep 5&rdquo;). Nothing is saved
          until you&rsquo;ve reviewed every line and tapped Import.
        </p>
        {view?.status === "failed" && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            The last import couldn&rsquo;t be finished. Try again.
          </p>
        )}
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          rows={12}
          maxLength={MAX_IMPORT_CHARS}
          aria-label="Your notes"
          placeholder={"frieren 10/10\nwatching jjk s2 ep 5\nwant to watch monster"}
          className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {notice && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {notice}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500 tabular-nums">
            {text.length} / {MAX_IMPORT_CHARS}
          </span>
          <button
            type="button"
            disabled={busy || text.trim().length === 0}
            onClick={() => void read()}
            className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {busy ? "Starting…" : "Read my notes"}
          </button>
        </div>
      </section>
    );
  }

  const counts = progress(view);

  if (view.status === "parsing") {
    return (
      <p role="status" className="mt-8 text-center text-sm text-zinc-500">
        Reading your notes and finding each show… This can take a minute for a long list.
      </p>
    );
  }

  if (view.status === "running" || view.status === "undoing") {
    const done =
      view.status === "running"
        ? counts.written + counts.failed
        : counts.undone + counts.undoFailed;
    const total = view.status === "running" ? counts.total : counts.written;
    return (
      <section role="status" className="mt-8 flex flex-col gap-2">
        <p className="text-sm">
          {view.status === "running" ? "Importing" : "Undoing"}: {done} of {total}
        </p>
        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${String(total === 0 ? 100 : Math.round((done / total) * 100))}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500">
          You can leave this page; it keeps going, about one show a second.
        </p>
      </section>
    );
  }

  if (view.status === "done" || view.status === "undone") {
    const failures = view.items.filter((i) => i.status === "failed" || i.status === "undo_failed");
    return (
      <section className="mt-6 flex flex-col gap-3">
        <p className="text-base font-medium">
          {view.status === "done"
            ? `Imported ${String(counts.written)} ${counts.written === 1 ? "show" : "shows"}.`
            : counts.undone === 1
              ? "Undone: 1 show is back as it was."
              : `Undone: ${String(counts.undone)} shows are back as they were.`}
        </p>
        {failures.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {failures.map((item) => (
              <li key={item.id} className="text-amber-800 dark:text-amber-300">
                {item.show?.title ?? item.said}: {rowError(item.error)}
              </li>
            ))}
          </ul>
        )}
        {notice && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/list"
            className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium leading-10 text-white hover:bg-blue-800 dark:bg-blue-600"
          >
            See your list
          </Link>
          {view.status === "done" && counts.written > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("undo")}
              className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Undo this import
            </button>
          )}
          <button
            type="button"
            onClick={() => void startOver()}
            className="h-10 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            New import
          </button>
        </div>
      </section>
    );
  }

  // Review.
  const skipped = unanswered(view);
  return (
    <>
      {SECTIONS.map(({ group, title, hint }) => {
        const rows = rowsIn(view, group);
        if (rows.length === 0) return null;
        const list = (
          <ul className="mt-2 flex flex-col gap-2">
            {rows.map((item) => (
              <ImportRow key={item.id} item={item} onPatch={(body) => patch(item, body)} />
            ))}
          </ul>
        );
        return FOLDED.includes(group) ? (
          <details key={group} className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold">
              {title} ({rows.length})
            </summary>
            {list}
          </details>
        ) : (
          <section key={group} className="mt-6">
            <h2 className="text-sm font-semibold">
              {title} ({rows.length})
            </h2>
            {hint && <p className="text-xs text-zinc-500">{hint}</p>}
            {list}
          </section>
        );
      })}

      <div className="fixed inset-x-0 bottom-14 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <div className="min-w-0 flex-1 text-xs text-zinc-500">
            {notice ? (
              <span role="alert" className="text-red-700 dark:text-red-400">
                {notice}
              </span>
            ) : skipped > 0 ? (
              `${String(skipped)} unanswered will be skipped.`
            ) : (
              "Nothing is saved until you tap Import."
            )}
          </div>
          <button
            type="button"
            onClick={() => void startOver()}
            className="h-10 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Start over
          </button>
          <button
            type="button"
            disabled={busy || counts.total === 0}
            onClick={() => void act("run")}
            className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {counts.total === 0
              ? "Nothing to import"
              : `Import ${String(counts.total)} ${counts.total === 1 ? "change" : "changes"}`}
          </button>
        </div>
      </div>
    </>
  );
}
