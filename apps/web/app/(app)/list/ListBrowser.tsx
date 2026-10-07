"use client";

import type { ListEntry } from "@kurisu/shared";
import { useMemo, useState, type ReactNode } from "react";

import { STATUS_LABELS } from "@/lib/format";
import {
  clearFilters,
  countMatches,
  isFiltered,
  listHref,
  visibleEntries,
  type ListView,
} from "@/lib/listFilters";

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
            <EntryRow key={entry.animeId} entry={entry} />
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
    </>
  );
}
