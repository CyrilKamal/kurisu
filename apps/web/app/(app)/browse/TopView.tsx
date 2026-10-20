"use client";

import { TOP_CHART_LABELS, TOP_CHARTS, type TopChartResponse } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { ChartList } from "./ChartList";

/** What each chart is, in a line. */
const ABOUT: Record<TopChartResponse["chart"], string> = {
  trending: "What's being watched and talked about on AniList right now.",
  airing: "The best-scored shows airing now.",
  upcoming: "The most anticipated shows that haven't started yet.",
  popular: "The shows the most people have on their AniList lists.",
  top: "AniList's best-scored anime of all time.",
};

/**
 * Browse's Top charts: trending, top airing, upcoming, most popular and best ever, 100 shows each
 * in AniList's order and numbered, each with where it stands on the list, or Add.
 */
export function TopView({ data }: { data: TopChartResponse }) {
  const [hideMine, setHideMine] = useState(false);
  const ranks = new Map(data.shows.map((show, i) => [show.animeId, i + 1]));
  const shown = hideMine ? data.shows.filter((show) => show.entry === null) : data.shows;

  return (
    <>
      <nav aria-label="Charts" className="pt-4">
        <div className="k-chips">
          {TOP_CHARTS.map((chart) => (
            <Link
              key={chart}
              href={`/browse?tab=top&chart=${chart}`}
              className="k-chip no-underline"
              aria-pressed={chart === data.chart}
              aria-current={chart === data.chart ? "page" : undefined}
              replace
            >
              {TOP_CHART_LABELS[chart]}
            </Link>
          ))}
        </div>
      </nav>

      <div className="k-filterbar">
        <p className="k-field__hint flex-1">{ABOUT[data.chart]}</p>
        <button
          type="button"
          className="k-chip"
          aria-pressed={hideMine}
          onClick={() => {
            setHideMine(!hideMine);
          }}
        >
          Not on my list
        </button>
      </div>

      {data.updatedAt === null ? (
        <div className="k-empty mt-4">
          <p className="k-empty__title">{TOP_CHART_LABELS[data.chart]} is on its way</p>
          <p className="k-empty__text">
            kurisu fetches the charts from AniList in the background. Check back in a few minutes.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="k-field__hint pt-4">Everything on this chart is already on your list.</p>
      ) : (
        <ChartList shows={shown} ranks={ranks} />
      )}

      <p className="k-field__hint pt-6">
        From AniList, refreshed daily. Scores are AniList&apos;s, out of 10.
      </p>
    </>
  );
}
