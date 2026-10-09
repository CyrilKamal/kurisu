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

import { Banner } from "@/components/Banner";
import { Icon } from "@/components/Icon";
import { ProgressMeter } from "@/components/ProgressMeter";
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
      setNotice(startErrorMessage(result.error));
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
      <section className="flex flex-col gap-4 pt-4">
        <p className="k-field__hint">
          Paste a list from your notes: one show per line, or several on a line, written however you
          wrote them (&ldquo;finished frieren 10/10, dropped csm at ep 5&rdquo;). Nothing is saved
          until you&rsquo;ve reviewed every line and tapped Import.
        </p>
        {view?.status === "failed" && (
          <Banner level="warn">The last import couldn&rsquo;t be finished. Try again.</Banner>
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
          className="k-input h-auto py-2"
        />
        {notice && <Banner level="error">{notice}</Banner>}
        <div className="flex items-center justify-between gap-4">
          <span className="k-mono">
            {text.length} / {MAX_IMPORT_CHARS}
          </span>
          <button
            type="button"
            className="k-btn k-btn--primary"
            disabled={busy || text.trim().length === 0}
            aria-busy={busy}
            onClick={() => void read()}
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
      <p role="status" className="k-log__working pt-8">
        <span className="k-cursor" aria-hidden="true" />
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
      <section role="status" className="flex flex-col gap-2 pt-8">
        <p className="k-caps">{view.status === "running" ? "Importing" : "Undoing"}</p>
        <ProgressMeter watched={done} total={Math.max(total, 1)} />
        <p className="k-field__hint">
          You can leave this page; it keeps going, about one show a second.
        </p>
      </section>
    );
  }

  if (view.status === "done" || view.status === "undone") {
    const failures = view.items.filter((i) => i.status === "failed" || i.status === "undo_failed");
    return (
      <section className="flex flex-col gap-4 pt-6">
        <p className="k-empty__title">
          {view.status === "done"
            ? `Imported ${String(counts.written)} ${counts.written === 1 ? "show" : "shows"}.`
            : counts.undone === 1
              ? "Undone: 1 show is back as it was."
              : `Undone: ${String(counts.undone)} shows are back as they were.`}
        </p>
        {failures.length > 0 && (
          <ul className="flex flex-col gap-2">
            {failures.map((item) => (
              <li key={item.id} className="text-warn">
                {item.show?.title ?? item.said}: {rowError(item.error)}
              </li>
            ))}
          </ul>
        )}
        {notice && <Banner level="error">{notice}</Banner>}
        <div className="flex flex-wrap gap-2">
          <Link href="/list" className="k-btn k-btn--primary">
            See your list
          </Link>
          {view.status === "done" && counts.written > 0 && (
            <button
              type="button"
              className="k-btn"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void act("undo")}
            >
              <Icon name="undo" />
              Undo this import
            </button>
          )}
          <button type="button" className="k-btn k-btn--ghost" onClick={() => void startOver()}>
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
          <ul className="k-panel mt-2 list-none p-0">
            {rows.map((item) => (
              <ImportRow key={item.id} item={item} onPatch={(body) => patch(item, body)} />
            ))}
          </ul>
        );
        return FOLDED.includes(group) ? (
          <details key={group} className="pt-6">
            <summary className="k-caps cursor-pointer">
              {title} ({rows.length})
            </summary>
            {list}
          </details>
        ) : (
          <section key={group} className="pt-6">
            <h2 className="k-caps">
              {title} ({rows.length})
            </h2>
            {hint && <p className="k-field__hint">{hint}</p>}
            {list}
          </section>
        );
      })}

      <div className="fixed inset-x-0 bottom-(--nav-height) z-20 border-t border-line bg-surface">
        <div className="mx-auto flex max-w-(--content-max) flex-wrap items-center gap-2 px-4 py-2">
          <div className="k-field__hint min-w-0 flex-1">
            {notice ? (
              <span role="alert" className="text-danger">
                {notice}
              </span>
            ) : skipped > 0 ? (
              `${String(skipped)} unanswered will be skipped.`
            ) : (
              "Nothing is saved until you tap Import."
            )}
          </div>
          <button type="button" className="k-btn k-btn--ghost" onClick={() => void startOver()}>
            Start over
          </button>
          <button
            type="button"
            className="k-btn k-btn--primary"
            disabled={busy || counts.total === 0}
            aria-busy={busy}
            onClick={() => void act("run")}
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

function startErrorMessage(error: string): string {
  switch (error) {
    case "busy":
      return "Another import is still going. Wait for it to finish.";
    case "daily_limit":
      return "You've reached today's limit for kurisu. It frees up over the next day.";
    case "monthly_limit":
      return "kurisu is resting until the 1st: this month's budget for the beta is used up.";
    default:
      return "Couldn't start the import. Please try again.";
  }
}
