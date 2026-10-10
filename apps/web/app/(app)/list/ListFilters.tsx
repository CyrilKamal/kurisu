"use client";

import type { ListEntry } from "@kurisu/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
 * FilterBar). A menu that's filtering gets a crimson edge. On a phone the menus fold into one
 * Filters button, which opens them in a sheet, so nothing scrolls sideways.
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const menus = filterMenus(entries, view, onChange);
  const active = [view.type, view.genre, view.airing].filter((value) => value !== null).length;

  return (
    <div className="k-filterbar max-sm:flex-nowrap">
      <div className="k-search max-sm:min-w-0 max-sm:flex-1">
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

      {/* Phones: one button, the menus in a sheet. */}
      <button
        type="button"
        className={`k-btn flex-none sm:hidden ${active > 0 ? "border-accent bg-accent-soft" : ""}`}
        aria-haspopup="dialog"
        onClick={() => {
          setSheetOpen(true);
        }}
      >
        Filters
        {active > 0 && <span className="k-tab__count">{active}</span>}
      </button>

      {/* Wider screens: the menus in the bar. */}
      <div className="k-filterbar__menus max-sm:hidden">
        {menus.map((menu) => (
          <Menu key={menu.label} {...menu} />
        ))}
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

      {sheetOpen && (
        <FilterSheet
          menus={menus}
          canClear={active > 0}
          onClear={() => {
            onChange({ ...view, type: null, genre: null, airing: null });
          }}
          onClose={() => {
            setSheetOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface MenuProps {
  label: string;
  value: string;
  /** Whether it's narrowing the list (the sort never is). */
  active: boolean;
  onChange: (value: string) => void;
  options: ReactNode;
}

/** Type, genre and airing, which narrow the list, then the sort order. */
function filterMenus(
  entries: ListEntry[],
  view: ListView,
  onChange: (view: ListView) => void,
): MenuProps[] {
  return [
    {
      label: "Type",
      value: view.type ?? "",
      active: view.type !== null,
      onChange: (value) => {
        onChange({ ...view, type: value || null });
      },
      options: (
        <>
          <option value="">All types</option>
          {optionsFor(facetOptions(entries, view, "type"), (v) => mediaTypeLabel(v) ?? v)}
        </>
      ),
    },
    {
      label: "Genre",
      value: view.genre ?? "",
      active: view.genre !== null,
      onChange: (value) => {
        onChange({ ...view, genre: value || null });
      },
      options: (
        <>
          <option value="">All genres</option>
          {optionsFor(facetOptions(entries, view, "genre"), (v) => v)}
        </>
      ),
    },
    {
      label: "Airing",
      value: view.airing ?? "",
      active: view.airing !== null,
      onChange: (value) => {
        onChange({ ...view, airing: AIRING_FILTERS.find((a) => a === value) ?? null });
      },
      options: (
        <>
          <option value="">Any airing</option>
          {optionsFor(
            facetOptions(entries, view, "airing"),
            (v) => AIRING_LABELS[v as AiringFilter],
          )}
        </>
      ),
    },
    {
      label: "Sort by",
      value: view.sort,
      active: false,
      onChange: (value) => {
        onChange({ ...view, sort: LIST_SORTS.find((s) => s === value) ?? "updated" });
      },
      options: LIST_SORTS.map((sort: ListSort) => (
        <option key={sort} value={sort}>
          {SORT_LABELS[sort]}
        </option>
      )),
    },
  ];
}

function optionsFor(options: FacetOption[], label: (value: string) => string) {
  return options.map((option) => (
    <option key={option.value} value={option.value}>
      {label(option.value)} ({option.count})
    </option>
  ));
}

/** A native menu (the phone's own picker); crimson-edged while it filters. */
function Menu({ label, value, active, onChange, options }: MenuProps) {
  return (
    <label className={active ? "k-menu is-set" : "k-menu"}>
      <span className="k-visually-hidden">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options}
      </select>
      <Icon name="chevron-down" />
    </label>
  );
}

/**
 * The same menus in a sheet, for phones: each with its label, changing the list as you pick, a
 * Clear for the filters, and Done.
 */
function FilterSheet({
  menus,
  canClear,
  onClear,
  onClose,
}: {
  menus: MenuProps[];
  canClear: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="filters-title"
      className="k-panel m-auto w-[min(26rem,calc(100%-2rem))] p-0 text-ink backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-4 p-4">
        <h2 id="filters-title" className="k-header__title">
          Filters
        </h2>
        {menus.map((menu) => {
          const id = `filter-${menu.label.toLowerCase().replace(/\s+/g, "-")}`;
          return (
            <div key={menu.label} className="k-field">
              <label className="k-field__label" htmlFor={id}>
                {menu.label}
              </label>
              <select
                id={id}
                className={`k-input ${menu.active ? "border-accent bg-accent-soft" : ""}`}
                value={menu.value}
                onChange={(event) => {
                  menu.onChange(event.target.value);
                }}
              >
                {menu.options}
              </select>
            </div>
          );
        })}
        <div className="flex justify-end gap-2">
          {canClear && (
            <button type="button" className="k-btn k-btn--ghost" onClick={onClear}>
              Clear filters
            </button>
          )}
          <button
            type="button"
            className="k-btn k-btn--primary"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
