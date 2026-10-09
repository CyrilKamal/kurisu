"use client";

import { changeResponseSchema, type ChangeView, type ListEntry } from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { Banner } from "@/components/Banner";
import { Icon } from "@/components/Icon";
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
  const [notice, setNotice] = useState<{
    level: "info" | "error";
    text: string;
    undoId: string | null;
  } | null>(null);
  const editing = entries.find((e) => e.animeId === editingId) ?? null;

  /** After a write: say what changed, offer Undo, and reload the list from the server. */
  function written(change: ChangeView, undoable = true) {
    setEditingId(null);
    setNotice({
      level: "info",
      text: `${change.title}: ${describeWrite(change.kind, change.before, change.after)}`,
      undoId: undoable ? change.id : null,
    });
    startRefresh(() => {
      router.refresh();
    });
  }

  function failed(error: string) {
    setNotice({ level: "error", text: editErrorMessage(error), undoId: null });
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
    else if (!result.ok) failed(result.error);
  }

  async function undo(changeId: string) {
    const result = await postApi(`/changes/${changeId}/undo`, changeResponseSchema);
    if (result.ok && result.data) written(result.data.change, false);
    else if (!result.ok) failed(result.error);
  }

  const filtered = isFiltered(view);
  const counts = useMemo(() => countMatches(entries, view), [entries, view]);
  const visible = useMemo(() => visibleEntries(entries, view), [entries, view]);

  return (
    <>
      {header}
      {/* Only the tabs and filters stay pinned, so they don't fill a phone's screen. */}
      <div className="sticky top-0 z-10 -mx-4 bg-bg px-4">
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
        <ul className="k-rows -mx-2">
          {visible.map((entry) => (
            <EntryRow
              key={entry.animeId}
              entry={entry}
              onEdit={() => {
                setEditingId(entry.animeId);
              }}
              onNextEpisode={canAddEpisode(entry) ? () => void addEpisode(entry) : undefined}
              busy={savingId === entry.animeId}
            />
          ))}
        </ul>
      ) : (
        <div className="k-empty mt-4">
          <p className="k-empty__count">0 entries</p>
          <p className="k-empty__title">
            {entries.length === 0
              ? "Your MyAnimeList anime list is empty"
              : filtered
                ? `Nothing in ${STATUS_LABELS[view.status]} matches these filters`
                : `Nothing in ${STATUS_LABELS[view.status]}`}
          </p>
          {filtered && (
            <button
              type="button"
              className="k-btn"
              onClick={() => {
                update(clearFilters(view));
              }}
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
        <Banner
          level={notice.level}
          className="fixed inset-x-4 bottom-[calc(var(--nav-height)+var(--space-16))] z-20 mx-auto max-w-(--content-max)"
          action={
            <span className="flex items-center gap-2">
              {notice.undoId && (
                <button
                  type="button"
                  className="k-link"
                  onClick={() => {
                    if (notice.undoId) void undo(notice.undoId);
                  }}
                >
                  Undo
                </button>
              )}
              <button
                type="button"
                className="k-btn k-btn--ghost k-btn--icon k-btn--sm"
                aria-label="Dismiss"
                onClick={() => {
                  setNotice(null);
                }}
              >
                <Icon name="clear" />
              </button>
            </span>
          }
        >
          {notice.text}
        </Banner>
      )}
    </>
  );
}
