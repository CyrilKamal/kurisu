import { statsResponseSchema, type ListStatus } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/format";
import { daysWatched, hoursWatched, monthLabel, shortDate, showCount } from "@/lib/stats";

import { ColumnChart } from "./ColumnChart";
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

/**
 * What the user watched: the whole list, this year's completions with a goal, and the last 7
 * days, including changes made on MAL's site that a sync found.
 */
export default async function StatsPage() {
  const stats = await apiGet("/stats", statsResponseSchema);
  if (!stats) redirect("/");
  const { allTime, year, week } = stats;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Stats</h1>
        <Link href="/list" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to list
        </Link>
      </header>

      <section className="mt-5">
        <h2 className="text-base font-semibold">Last 7 days</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Tile label="Episodes" value={String(week.episodes)} />
          <Tile label="Hours" value={hoursWatched(week.minutes)} />
          <Tile label="Shows" value={String(week.shows)} />
        </div>
        {week.finished.length > 0 && (
          <p className="mt-2 text-sm">
            <span className="text-zinc-500">Finished: </span>
            {week.finished.map((show) => show.title).join(", ")}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          From your updates in kurisu, and changes made on MyAnimeList&apos;s site once a sync has
          seen them.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">{year.year}</h2>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-semibold">{year.completed}</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {year.completed === 1 ? "show" : "shows"} completed
          </span>
        </p>
        <YearGoal year={year.year} completed={year.completed} initialGoal={year.goal} />
        {year.completed > 0 && (
          <ColumnChart
            title={`Shows completed each month of ${String(year.year)}`}
            unit="show"
            columns={year.byMonth.map((value, i) => ({
              key: String(i + 1),
              axis: monthLabel(i + 1).slice(0, 1),
              value,
              name: MONTH_NAMES[i] ?? "",
            }))}
          />
        )}
        {year.recent.length > 0 && (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {year.recent.map((show) => (
              <li key={show.animeId} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{show.title}</span>
                <span className="shrink-0 text-zinc-500">{shortDate(show.on)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Counted by the finish date on MyAnimeList, or the day kurisu saw the show completed.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">All time</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Days watched" value={daysWatched(allTime.minutes)} />
          <Tile label="Episodes" value={allTime.episodes.toLocaleString("en-US")} />
          <Tile label="Completed" value={String(allTime.byStatus.completed)} />
          <Tile
            label="Mean score"
            value={allTime.meanScore === null ? "–" : allTime.meanScore.toFixed(2)}
          />
        </div>
        {allTime.unknownLength > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Days watched leaves out {showCount(allTime.unknownLength)} whose episode length
            MyAnimeList doesn&apos;t list.
          </p>
        )}
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {STATUS_ORDER.map(
            (status) => `${STATUS_LABELS[status]} ${String(allTime.byStatus[status])}`,
          ).join(" · ")}
        </p>

        {allTime.scored > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold">Your scores</h3>
            <ColumnChart
              title={`How many shows got each score, across ${showCount(allTime.scored)}`}
              unit="show"
              columns={allTime.scores.map((value, i) => ({
                key: String(i + 1),
                axis: String(i + 1),
                value,
                name: `Score ${String(i + 1)}`,
              }))}
            />
          </div>
        )}

        {allTime.topGenres.length > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Most completed genres</h3>
              <Link
                href="/list/taste"
                className="text-sm text-blue-700 hover:underline dark:text-blue-400"
              >
                Taste
              </Link>
            </div>
            <ul className="mt-1 divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
              {allTime.topGenres.map((genre) => (
                <li key={genre.genre} className="flex justify-between py-1.5">
                  <span>{genre.genre}</span>
                  <span className="tabular-nums text-zinc-500">{showCount(genre.shows)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
