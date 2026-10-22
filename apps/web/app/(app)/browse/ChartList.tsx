"use client";

import type { ChartShow } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { AddSheet } from "@/components/AddSheet";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { StatusBadge } from "@/components/StatusBadge";
import { showHref } from "@/lib/airing";
import { chartMeta } from "@/lib/browse";

/**
 * A chart's rows (Seasons and Top): poster, title, kind, episodes and start, AniList's score and
 * genres, and where each show stands on the list, or Add. `ranks` numbers the rows by their place
 * on the chart.
 */
export function ChartList({
  shows,
  ranks = null,
}: {
  shows: ChartShow[];
  ranks?: ReadonlyMap<number, number> | null;
}) {
  const [adding, setAdding] = useState<ChartShow | null>(null);
  // Shows added from this screen, until the page reloads.
  const [added, setAdded] = useState<Set<number>>(new Set());

  return (
    <>
      <ul className="k-rows pt-2">
        {shows.map((show) => {
          const rank = ranks?.get(show.animeId);
          return (
            <li key={show.animeId} className="k-row">
              <Link
                prefetch={false}
                href={showHref(show.animeId)}
                className="block"
                tabIndex={-1}
                aria-hidden="true"
              >
                <Poster url={show.pictureUrl} title={show.title} />
              </Link>
              <div className="k-row__main">
                <Link className="k-row__title" prefetch={false} href={showHref(show.animeId)}>
                  {rank !== undefined && <span className="k-data-sm text-ink-muted">{rank} </span>}
                  {show.title}
                </Link>
                <p className="k-row__meta">
                  <span>{chartMeta(show)}</span>
                  {show.score !== null && (
                    <span className="k-data-sm">{show.score.toFixed(1)}</span>
                  )}
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
          );
        })}
      </ul>

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
