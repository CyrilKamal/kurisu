"use client";

import type { ChartShow, SeasonChartResponse } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { AddSheet } from "@/components/AddSheet";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { StatusBadge } from "@/components/StatusBadge";
import { showHref } from "@/lib/airing";
import {
  CHART_FORMATS,
  CHART_SORT_LABELS,
  CHART_SORTS,
  chartGenres,
  chartMeta,
  chartShows,
  NO_CHART_FILTERS,
  type ChartFilters,
  type ChartSort,
} from "@/lib/browse";
import { mediaTypeLabel } from "@/lib/format";

/**
 * A season's chart (Browse's Seasons): last, this or next season's most popular shows, filtered
 * by kind and genre and sorted three ways, each with where it stands on the list, or Add.
 */
export function SeasonsView({ data }: { data: SeasonChartResponse }) {
  const [filters, setFilters] = useState<ChartFilters>(NO_CHART_FILTERS);
  const [adding, setAdding] = useState<ChartShow | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const shown = chartShows(data.shows, filters);
  const formats = CHART_FORMATS.filter((format) => data.shows.some((s) => s.mediaType === format));
  const genres = chartGenres(data.shows);

  return (
    <>
      <nav aria-label="Seasons" className="pt-4">
        <div className="k-chips">
          {data.seasons.map((season) => (
            <Link
              key={season.season}
              href={`/browse?tab=seasons&season=${season.season}`}
              className="k-chip no-underline"
              aria-pressed={season.season === data.season}
              aria-current={season.season === data.season ? "page" : undefined}
              replace
            >
              {season.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="k-filterbar">
        <div className="k-chips" role="group" aria-label="Kind of show">
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              className="k-chip"
              aria-pressed={filters.format === format}
              onClick={() => {
                setFilters({ ...filters, format: filters.format === format ? null : format });
              }}
            >
              {mediaTypeLabel(format) ?? format}
            </button>
          ))}
          <button
            type="button"
            className="k-chip"
            aria-pressed={filters.hideMine}
            onClick={() => {
              setFilters({ ...filters, hideMine: !filters.hideMine });
            }}
          >
            Not on my list
          </button>
        </div>
        <div className="k-filterbar__menus">
          <label className={filters.genre === null ? "k-menu" : "k-menu is-set"}>
            <span className="k-visually-hidden">Genre</span>
            <select
              value={filters.genre ?? ""}
              onChange={(event) => {
                setFilters({ ...filters, genre: event.target.value || null });
              }}
            >
              <option value="">All genres</option>
              {genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </label>
          <label className="k-menu">
            <span className="k-visually-hidden">Sort</span>
            <select
              value={filters.sort}
              onChange={(event) => {
                const sort = CHART_SORTS.find((s) => s === event.target.value);
                setFilters({ ...filters, sort: sort ?? "popularity" });
              }}
            >
              {CHART_SORTS.map((sort: ChartSort) => (
                <option key={sort} value={sort}>
                  {CHART_SORT_LABELS[sort]}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </label>
        </div>
      </div>

      {data.updatedAt === null ? (
        <div className="k-empty mt-4">
          <p className="k-empty__title">{data.label} is on its way</p>
          <p className="k-empty__text">
            kurisu fetches each season&apos;s chart from AniList in the background. Check back in a
            few minutes.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="k-field__hint pt-4">Nothing in {data.label} matches those filters.</p>
      ) : (
        <ul className="k-rows pt-2">
          {shown.map((show) => (
            <li key={show.animeId} className="k-row">
              <Link
                href={showHref(show.animeId)}
                className="block"
                tabIndex={-1}
                aria-hidden="true"
              >
                <Poster url={show.pictureUrl} title={show.title} />
              </Link>
              <div className="k-row__main">
                <Link className="k-row__title" href={showHref(show.animeId)}>
                  {show.title}
                </Link>
                <p className="k-row__meta">
                  <span>{chartMeta(show)}</span>
                  {show.score !== null && <span className="k-mono">{show.score.toFixed(1)}</span>}
                  {show.genres.length > 0 && <span>{show.genres.slice(0, 3).join(", ")}</span>}
                </p>
              </div>
              {show.entry ? (
                <StatusBadge status={show.entry.status} />
              ) : added.has(show.animeId) ? (
                <span className="k-field__hint whitespace-nowrap">Added</span>
              ) : (
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  aria-label={`Add ${show.title}`}
                  onClick={() => {
                    setAdding(show);
                  }}
                >
                  <Icon name="plus" />
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="k-field__hint pt-6">
        The most popular shows of each season on AniList. Scores are AniList&apos;s, out of 10.
      </p>

      {adding && (
        <AddSheet
          show={adding}
          onClose={() => {
            setAdding(null);
          }}
          onAdded={() => {
            setAdded((current) => new Set(current).add(adding.animeId));
          }}
        />
      )}
    </>
  );
}
