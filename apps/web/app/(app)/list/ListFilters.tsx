import type { ListEntry } from "@kurisu/shared";
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
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

/**
 * A title filter, then type, genre and airing menus and the sort order (the design system's
 * FilterBar). A menu that's filtering gets a crimson edge.
 */
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
    <div className="k-filterbar">
      <div className="k-search">
        <Icon name="search" />
        <input
          type="search"
          className="k-input pr-8"
          value={view.query}
          onChange={(event) => {
            onChange({ ...view, query: event.target.value });
          }}
          placeholder="Filter by title"
          aria-label="Filter by title"
          autoComplete="off"
          enterKeyHint="search"
        />
        {view.query && (
          <button
            type="button"
            onClick={() => {
              onChange({ ...view, query: "" });
            }}
            aria-label="Clear the title filter"
            className="k-btn k-btn--ghost k-btn--icon k-btn--sm absolute right-1 top-1"
          >
            <Icon name="clear" />
          </button>
        )}
      </div>

      <div className="k-filterbar__menus">
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
            className="k-btn k-btn--ghost k-btn--sm"
            onClick={() => {
              onChange(clearFilters(view));
            }}
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

/** A native menu (the phone's own picker); crimson-edged while it filters. */
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
    <label className={active ? "k-menu is-set" : "k-menu"}>
      <span className="k-visually-hidden">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {children}
      </select>
      <Icon name="chevron-down" />
    </label>
  );
}
