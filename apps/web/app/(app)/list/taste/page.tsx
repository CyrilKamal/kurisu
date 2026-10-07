import { tasteResponseSchema, type TasteGenre } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";
import { formatAffinity, formatScore, tasteSections } from "@/lib/taste";

import { DropReasons } from "./DropReasons";

export const metadata: Metadata = { title: "Taste · kurisu" };

/** What kurisu has learned from the list: how each genre rates, and why shows were dropped. */
export default async function TastePage() {
  const taste = await apiGet("/taste", tasteResponseSchema);
  if (!taste) redirect("/");
  const { higher, lower, all, maxAffinity } = tasteSections(taste.genres);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Taste</h1>
        <Link href="/list" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to list
        </Link>
      </header>

      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        What kurisu has learned from your list. Recommendations lean toward the genres you rate
        higher, and away from the reasons you dropped shows.
      </p>

      {taste.overallMean === null ? (
        <p className="mt-6 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No scores yet. Once you score shows on MyAnimeList and re-sync, your patterns show up
          here.
        </p>
      ) : (
        <>
          <section className="mt-5 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">
              {formatScore(taste.overallMean)}
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              your average score, across {taste.scoredCount} scored{" "}
              {taste.scoredCount === 1 ? "show" : "shows"}
            </span>
          </section>

          <GenreSection
            title="Genres you rate higher"
            empty="No genre stands out above your average yet."
            genres={higher}
            maxAffinity={maxAffinity}
          />
          <GenreSection
            title="Genres you rate lower"
            empty="No genre falls below your average yet."
            genres={lower}
            maxAffinity={maxAffinity}
          />
          <p className="mt-3 text-xs text-zinc-500">
            The bars compare each genre with your average. Genres with only a few scored shows count
            for less.
          </p>

          {all.length > 0 && (
            <details className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                All genres ({all.length})
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr className="border-t border-zinc-200 dark:border-zinc-800">
                      <th className="px-3 py-2 font-medium">Genre</th>
                      <th className="px-2 py-2 text-right font-medium">Avg</th>
                      <th className="px-2 py-2 text-right font-medium">Scored</th>
                      <th className="px-2 py-2 text-right font-medium">Dropped</th>
                      <th className="px-3 py-2 text-right font-medium">vs avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((genre) => (
                      <tr
                        key={genre.genre}
                        className="border-t border-zinc-100 dark:border-zinc-900"
                      >
                        <td className="px-3 py-1.5">{genre.genre}</td>
                        <td className="px-2 py-1.5 text-right">{formatScore(genre.meanScore)}</td>
                        <td className="px-2 py-1.5 text-right">{genre.scored}</td>
                        <td className="px-2 py-1.5 text-right">{genre.dropped}</td>
                        <td className="px-3 py-1.5 text-right">{formatAffinity(genre.affinity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold">Why you dropped shows</h2>
        <DropReasons initialReasons={taste.dropReasons} />
      </section>
    </main>
  );
}

function GenreSection({
  title,
  empty,
  genres,
  maxAffinity,
}: {
  title: string;
  empty: string;
  genres: TasteGenre[];
  maxAffinity: number;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {genres.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-900">
          {genres.map((genre) => (
            <GenreBar key={genre.genre} genre={genre} maxAffinity={maxAffinity} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GenreBar({ genre, maxAffinity }: { genre: TasteGenre; maxAffinity: number }) {
  const positive = genre.affinity > 0;
  const width = maxAffinity > 0 ? Math.max(4, (Math.abs(genre.affinity) / maxAffinity) * 100) : 0;
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{genre.genre}</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {formatScore(genre.meanScore)} avg · {genre.scored} scored
          {genre.dropped > 0 ? ` · ${String(genre.dropped)} dropped` : ""}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
            style={{ width: `${String(width)}%` }}
          />
        </div>
        <span
          className={`w-9 text-right text-xs font-medium tabular-nums ${
            positive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
          }`}
        >
          {formatAffinity(genre.affinity)}
        </span>
      </div>
    </li>
  );
}
