"use client";

import { changeResponseSchema, type ChangeView, type ListEntry } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { postApi, sendApi } from "@/lib/clientApi";
import { describeWrite } from "@/lib/describeChange";
import { canAddEpisode, editErrorMessage } from "@/lib/editEntry";
import { STATUS_LABELS } from "@/lib/format";
import {
  clearFilters,
  countMatches,
  isFiltered,
  listHref,
  visibleEntries,
  type ListView,
} from "@/lib/listFilters";

import { EditSheet } from "./EditSheet";
import { EntryRow } from "./EntryRow";
import { ListFilters } from "./ListFilters";
import { StatusTabs } from "./StatusTabs";

/**
 * The status tabs, the filters and the entries. Everything is filtered here in the browser, so
 * switching tabs or typing is instant; the URL follows along (without a server round trip) so a
 * reload keeps the view.
 */
export function ListBrowser({
  entries,
  initialView,
  header,
  banner,
}: {
  entries: ListEntry[];
  /** The view in the URL the server rendered. */
  initialView: ListView;
  /** The title row, above the tabs. */
  header: ReactNode;
  /** Sync notices, between the header and the entries. */
  banner: ReactNode;
}) {
  const [view, setView] = useState(initialView);
  // A new server render (a link to the List screen, or a refresh after a re-sync) brings its
  // own view from the URL; take it.
  const [renderedView, setRenderedView] = useState(initialView);
  if (initialView !== renderedView) {
    setRenderedView(initialView);
    setView(initialView);
  }

  function update(next: ListView) {
    setView(next);
    window.history.replaceState(null, "", listHref(next));
  }

  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; undoId: string | null } | null>(null);
  const editing = entries.find((e) => e.animeId === editingId) ?? null;

  /** After a write: say what changed, offer Undo, and reload the list from the server. */
  function written(change: ChangeView, undoable = true) {
    setEditingId(null);
    setNotice({
      text: `${change.title}: ${describeWrite(change.kind, change.before, change.after)}`,
      undoId: undoable ? change.id : null,
    });
    startRefresh(() => {
      router.refresh();
    });
  }

  async function addEpisode(entry: ListEntry) {
    setSavingId(entry.animeId);
    const result = await sendApi(
      "POST",
      `/list/${String(entry.animeId)}/edit`,
      changeResponseSchema,
      { episodesWatched: entry.episodesWatched + 1, requestId: crypto.randomUUID() },
    );
    setSavingId(null);
    if (result.ok && result.data) written(result.data.change);
    else if (!result.ok) setNotice({ text: editErrorMessage(result.error), undoId: null });
  }

  async function undo(changeId: string) {
    const result = await postApi(`/changes/${changeId}/undo`, changeResponseSchema);
    if (result.ok && result.data) written(result.data.change, false);
    else if (!result.ok) setNotice({ text: editErrorMessage(result.error), undoId: null });
  }

  const filtered = isFiltered(view);
  const counts = useMemo(() => countMatches(entries, view), [entries, view]);
  const visible = useMemo(() => visibleEntries(entries, view), [entries, view]);

  return (
    <>
      <header className="pt-3">{header}</header>
      {/* Only the tabs and filters stay pinned, so they don't fill a phone's screen. */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <StatusTabs
          selected={view.status}
          counts={counts}
          hrefFor={(status) => listHref({ ...view, status })}
          onSelect={(status) => {
            update({ ...view, status });
          }}
        />
        {entries.length > 0 && <ListFilters entries={entries} view={view} onChange={update} />}
      </div>

      {banner}

      {visible.length > 0 ? (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {visible.map((entry) => (
            <EntryRow
              key={entry.animeId}
              entry={entry}
              onEdit={() => {
                setEditingId(entry.animeId);
              }}
              {...(canAddEpisode(entry) && {
                onNextEpisode: () => void addEpisode(entry),
              })}
              busy={savingId === entry.animeId}
            />
          ))}
        </ul>
      ) : (
        <div className="py-12 text-center text-sm text-zinc-500">
          <p>
            {entries.length === 0
              ? "Your MyAnimeList anime list is empty."
              : filtered
                ? `Nothing in ${STATUS_LABELS[view.status]} matches these filters.`
                : `Nothing in ${STATUS_LABELS[view.status]}.`}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                update(clearFilters(view));
              }}
              className="mt-3 h-9 rounded-lg border border-zinc-300 px-3 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {editing && (
        <EditSheet
          key={editing.animeId}
          entry={editing}
          onClose={() => {
            setEditingId(null);
          }}
          onSaved={written}
        />
      )}

      {notice && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          {notice.undoId && (
            <button
              type="button"
              onClick={() => {
                if (notice.undoId) void undo(notice.undoId);
              }}
              className="shrink-0 font-medium underline"
            >
              Undo
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setNotice(null);
            }}
            className="shrink-0 px-1"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
