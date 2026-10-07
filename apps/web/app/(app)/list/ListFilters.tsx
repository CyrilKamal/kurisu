import type { ListEntry } from "@kurisu/shared";
import type { ReactNode } from "react";

import { mediaTypeLabel } from "@/lib/format";
import {
  AIRING_FILTERS,
  AIRING_LABELS,
  clearFilters,
  facetOptions,
  isFiltered,
  LIST_SORTS,
  SORT_LABELS,
  type AiringFilter,
  type FacetOption,
  type ListSort,
  type ListView,
} from "@/lib/listFilters";

/** A title search, then type, genre and airing filters and the sort order, as compact menus. */
export function ListFilters({
  entries,
  view,
  onChange,
}: {
  entries: ListEntry[];
  view: ListView;
  onChange: (view: ListView) => void;
}) {
  const types = facetOptions(entries, view, "type");
  const genres = facetOptions(entries, view, "genre");
  const airing = facetOptions(entries, view, "airing");

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <div className="relative min-w-48 flex-1">
        <SearchIcon />
        <input
          type="search"
          value={view.query}
          onChange={(event) => {
            onChange({ ...view, query: event.target.value });
          }}
          placeholder="Filter by title"
          aria-label="Filter by title"
          autoComplete="off"
          enterKeyHint="search"
          className="h-9 w-full rounded-lg border border-zinc-300 bg-white pl-8 pr-8 text-sm placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-blue-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {view.query && (
          <button
            type="button"
            onClick={() => {
              onChange({ ...view, query: "" });
            }}
            aria-label="Clear the title filter"
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      <div className="-mx-4 flex max-w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0">
        <Menu
          label="Type"
          value={view.type ?? ""}
          onChange={(value) => {
            onChange({ ...view, type: value || null });
          }}
        >
          <option value="">All types</option>
          {optionsFor(types, (value) => mediaTypeLabel(value) ?? value)}
        </Menu>
        <Menu
          label="Genre"
          value={view.genre ?? ""}
          onChange={(value) => {
            onChange({ ...view, genre: value || null });
          }}
        >
          <option value="">All genres</option>
          {optionsFor(genres, (value) => value)}
        </Menu>
        <Menu
          label="Airing"
          value={view.airing ?? ""}
          onChange={(value) => {
            onChange({ ...view, airing: AIRING_FILTERS.find((a) => a === value) ?? null });
          }}
        >
          <option value="">Any airing</option>
          {optionsFor(airing, (value) => AIRING_LABELS[value as AiringFilter])}
        </Menu>
        <Menu
          label="Sort by"
          value={view.sort}
          active={false}
          onChange={(value) => {
            onChange({ ...view, sort: LIST_SORTS.find((s) => s === value) ?? "updated" });
          }}
        >
          {LIST_SORTS.map((sort: ListSort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </Menu>
        {isFiltered(view) && (
          <button
            type="button"
            onClick={() => {
              onChange(clearFilters(view));
            }}
            className="h-8 shrink-0 rounded-full px-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function optionsFor(options: FacetOption[], label: (value: string) => string) {
  return options.map((option) => (
    <option key={option.value} value={option.value}>
      {label(option.value)} ({option.count})
    </option>
  ));
}

/** A native menu (the phone's own picker) styled as a chip; tinted while it filters. */
function Menu({
  label,
  value,
  active = value !== "",
  onChange,
  children,
}: {
  label: string;
  value: string;
  active?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={`h-8 appearance-none rounded-full border pl-3 pr-7 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
          active
            ? "border-blue-300 bg-blue-50 font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
            : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        }`}
      >
        {children}
      </select>
      <ChevronIcon />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      className="size-4"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
