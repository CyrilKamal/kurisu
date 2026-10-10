import { statsResponseSchema, type ListStatus } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Histogram, modeOf } from "@/components/Histogram";
import { Metric, Metrics } from "@/components/Metrics";
import { ScreenHeader } from "@/components/ScreenHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { apiGet } from "@/lib/api";
import { daysWatched, hoursWatched, monthLabel, shortDate, showCount } from "@/lib/stats";

import { YearGoal } from "./YearGoal";

export const metadata: Metadata = { title: "Stats · kurisu" };

const STATUS_ORDER: ListStatus[] = ["watching", "completed", "on_hold", "dropped", "plan_to_watch"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A score histogram reads as noise below this many scored shows (the design system's rule). */
const MIN_SCORED_FOR_HISTOGRAM = 10;

/**
 * What the user watched: the last 7 days, this year's completions with a goal, and the whole
 * list, including changes made on MAL's site that a sync found.
 */
export default async function StatsPage() {
  const stats = await apiGet("/stats", statsResponseSchema);
  if (!stats) redirect("/");
  const { allTime, year, week } = stats;
  const scoreMode = modeOf(allTime.scores);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader
        title="Stats"
        sub="from your list, your updates and MyAnimeList's site"
        back="/you"
      />

      <section className="pt-6">
        <h2 className="k-empty__title pb-2">Last 7 days</h2>
        <Metrics>
          <Metric label="Episodes" value={String(week.episodes)} />
          <Metric label="Watched" value={hoursWatched(week.minutes)} unit="h" />
          <Metric label="Shows" value={String(week.shows)} />
        </Metrics>
        {week.finished.length > 0 && (
          <p className="k-row__meta pt-2">
            <span className="k-caps">Finished</span>
            {week.finished.map((show) => show.title).join(", ")}
          </p>
        )}
        <p className="k-field__hint pt-2">
          From your updates in kurisu, and changes made on MyAnimeList&apos;s site once a sync has
          seen them.
        </p>
      </section>

      <section className="pt-8">
        <h2 className="k-empty__title pb-2">{year.year}</h2>
        <Metrics>
          <Metric
            hero
            label="Completed"
            value={String(year.completed)}
            basis={`${year.completed === 1 ? "show" : "shows"} finished in ${String(year.year)}`}
          />
        </Metrics>
        <YearGoal year={year.year} completed={year.completed} initialGoal={year.goal} />
        {year.completed > 0 && (
          <Histogram
            summary={`Shows completed each month of ${String(year.year)}`}
            columns={year.byMonth.map((value, i) => ({
              label: monthLabel(i + 1).slice(0, 1),
              value,
              name: MONTH_NAMES[i] ?? "",
            }))}
          />
        )}
        {year.recent.length > 0 && (
          <ul className="k-rows">
            {year.recent.map((show) => (
              <li
                key={show.animeId}
                className="flex justify-between gap-4 border-b border-line py-2 text-ink"
              >
                <span className="min-w-0 truncate">{show.title}</span>
                <span className="k-mono">{shortDate(show.on)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="k-field__hint pt-2">
          Counted by the finish date on MyAnimeList, or the day kurisu saw the show completed.
        </p>
      </section>

      <section className="pt-8">
        <h2 className="k-empty__title pb-2">All time</h2>
        <Metrics>
          <Metric label="Days watched" value={daysWatched(allTime.minutes)} unit="d" />
          <Metric label="Episodes" value={allTime.episodes.toLocaleString("en-US")} />
          <Metric label="Completed" value={String(allTime.byStatus.completed)} />
          <Metric
            label="Mean score"
            value={allTime.meanScore === null ? "–" : allTime.meanScore.toFixed(2)}
            basis={allTime.scored > 0 ? `across ${showCount(allTime.scored)}` : "nothing scored"}
          />
        </Metrics>
        {allTime.unknownLength > 0 && (
          <p className="k-field__hint pt-2">
            Days watched leaves out {showCount(allTime.unknownLength)} whose episode length
            MyAnimeList doesn&apos;t list.
          </p>
        )}
        <p className="k-row__meta gap-4 pt-4">
          {STATUS_ORDER.map((status) => (
            <span key={status} className="inline-flex items-center gap-2">
              <StatusBadge status={status} plain />
              <span className="k-num">{allTime.byStatus[status]}</span>
            </span>
          ))}
        </p>

        {allTime.scored >= MIN_SCORED_FOR_HISTOGRAM && (
          <div className="pt-6">
            <h3 className="k-caps">Your scores</h3>
            <Histogram
              summary={`How you spread your scores across ${showCount(allTime.scored)}${
                scoreMode === null ? "" : `; most often ${String(scoreMode + 1)}`
              }${allTime.meanScore === null ? "" : `, average ${allTime.meanScore.toFixed(1)}`}`}
              modeIndex={scoreMode}
              mean={allTime.meanScore}
              columns={allTime.scores.map((value, i) => ({
                label: String(i + 1),
                value,
                name: `Score ${String(i + 1)}`,
              }))}
            />
          </div>
        )}

        {allTime.topGenres.length > 0 && (
          <div className="pt-6">
            <div className="flex items-baseline justify-between">
              <h3 className="k-caps">Most completed genres</h3>
              <Link href="/you/taste" className="k-link">
                Taste
              </Link>
            </div>
            <ul className="k-rows">
              {allTime.topGenres.map((genre) => (
                <li
                  key={genre.genre}
                  className="flex justify-between gap-4 border-b border-line py-2 text-ink"
                >
                  <span>{genre.genre}</span>
                  <span className="k-mono">{showCount(genre.shows)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
