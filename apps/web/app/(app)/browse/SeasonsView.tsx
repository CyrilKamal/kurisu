"use client";

import type { SeasonChartResponse } from "@kurisu/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import {
  CHART_FORMATS,
  CHART_SORT_LABELS,
  CHART_SORTS,
  chartGenres,
  chartShows,
  NO_CHART_FILTERS,
  seasonYears,
  type ChartFilters,
  type ChartSort,
} from "@/lib/browse";
import { mediaTypeLabel } from "@/lib/format";

import { ChartList } from "./ChartList";

/** How often a season being fetched is checked, and for how long. */
const POLL_MS = 5000;
const POLL_TRIES = 24;

const seasonHref = (season: string) => `/browse?tab=seasons&season=${season}`;

/**
 * A season's chart (Browse's Seasons): last, this or next season at a tap, or any season back to
 * 1960 with the arrows and the year. An earlier season is fetched from AniList in the background
 * the first time someone asks, and the page checks back until it's there. Filtered by kind and
 * genre and sorted three ways, each show with where it stands on the list, or Add.
 */
export function SeasonsView({ data }: { data: SeasonChartResponse }) {
  const router = useRouter();
  const [filters, setFilters] = useState<ChartFilters>(NO_CHART_FILTERS);
  const [tries, setTries] = useState(0);
  const shown = chartShows(data.shows, filters);
  const formats = CHART_FORMATS.filter((format) => data.shows.some((s) => s.mediaType === format));
  const genres = chartGenres(data.shows);
  const [year = "", seasonName = "WINTER"] = data.season.split("-");
  const latest = data.seasons.at(-1)?.season ?? data.season;
  const waiting = data.pending && tries < POLL_TRIES;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [waiting, tries, router]);

  return (
    <>
      <nav aria-label="Seasons" className="flex flex-wrap items-center gap-2 pt-4">
        <div className="k-chips">
          {data.seasons.map((season) => (
            <Link
              key={season.season}
              href={seasonHref(season.season)}
              className="k-chip no-underline"
              aria-pressed={season.season === data.season}
              aria-current={season.season === data.season ? "page" : undefined}
              replace
            >
              {season.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {data.previous && (
            <Link
              href={seasonHref(data.previous)}
              className="k-btn k-btn--icon k-btn--ghost"
              aria-label="The season before"
              replace
            >
              <Icon name="chevron-left" />
            </Link>
          )}
          <label className="k-menu">
            <span className="k-visually-hidden">Year</span>
            <select
              value={year}
              onChange={(event) => {
                router.replace(seasonHref(`${event.target.value}-${seasonName}`));
              }}
            >
              {seasonYears(seasonName, latest).map((y) => (
                <option key={y} value={String(y)}>
                  {data.label.split(" ")[0]} {y}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </label>
          {data.next && (
            <Link
              href={seasonHref(data.next)}
              className="k-btn k-btn--icon k-btn--ghost"
              aria-label="The season after"
              replace
            >
              <Icon name="chevron-right" />
            </Link>
          )}
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
        <div className="k-empty mt-4" role="status" aria-live="polite">
          <p className="k-empty__title">
            {waiting ? `Getting ${data.label} from AniList…` : `${data.label} is on its way`}
          </p>
          <p className="k-empty__text">
            {waiting
              ? "kurisu fetches a season the first time someone asks for it. It takes a few seconds."
              : "AniList hasn't answered yet. Check back in a few minutes."}
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="k-field__hint pt-4">Nothing in {data.label} matches those filters.</p>
      ) : (
        <ChartList shows={shown} />
      )}

      <p className="k-field__hint pt-6">
        The most popular shows of each season on AniList. Scores are AniList&apos;s, out of 10.
      </p>
    </>
  );
}
