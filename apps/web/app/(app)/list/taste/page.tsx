import { tasteResponseSchema, type TasteGenre } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Metric, Metrics } from "@/components/Metrics";
import { ScreenHeader } from "@/components/ScreenHeader";
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
    <main className="mx-auto max-w-(--content-max) px-4 pb-16">
      <ScreenHeader
        title="Taste"
        sub="what kurisu has learned from your list"
        actions={
          <Link href="/list" className="k-btn k-btn--ghost">
            Back to list
          </Link>
        }
      />
      <p className="k-field__hint py-4">
        Recommendations lean toward the genres you rate higher, and away from the reasons you
        dropped shows.
      </p>

      {taste.overallMean === null ? (
        <div className="k-empty">
          <p className="k-empty__title">No scores yet</p>
          <p className="k-empty__text">
            Once you score shows on MyAnimeList and re-sync, your patterns show up here.
          </p>
        </div>
      ) : (
        <>
          <Metrics>
            <Metric
              hero
              label="Average score"
              value={formatScore(taste.overallMean)}
              basis={`across ${String(taste.scoredCount)} scored ${taste.scoredCount === 1 ? "show" : "shows"}`}
            />
          </Metrics>

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
          <p className="k-field__hint pt-2">
            The bars compare each genre with your average. Genres with only a few scored shows count
            for less.
          </p>

          {all.length > 0 && (
            <details className="k-trace pt-6">
              <summary>All genres ({all.length})</summary>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 pr-4 font-medium">Genre</th>
                      <th className="px-2 py-2 text-right font-medium">Avg</th>
                      <th className="px-2 py-2 text-right font-medium">Scored</th>
                      <th className="px-2 py-2 text-right font-medium">Dropped</th>
                      <th className="py-2 pl-2 text-right font-medium">vs avg</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink-muted">
                    {all.map((genre) => (
                      <tr key={genre.genre} className="border-t border-line">
                        <td className="py-2 pr-4 font-sans text-ink">{genre.genre}</td>
                        <td className="px-2 py-2 text-right">{formatScore(genre.meanScore)}</td>
                        <td className="px-2 py-2 text-right">{genre.scored}</td>
                        <td className="px-2 py-2 text-right">{genre.dropped}</td>
                        <td className="py-2 pl-2 text-right">{formatAffinity(genre.affinity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      <section className="pt-8">
        <h2 className="k-empty__title">Why you dropped shows</h2>
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
    <section className="pt-6">
      <h2 className="k-empty__title pb-2">{title}</h2>
      {genres.length === 0 ? (
        <p className="k-field__hint">{empty}</p>
      ) : (
        <ul className="k-affinity">
          {genres.map((genre) => (
            <li
              key={genre.genre}
              className={genre.affinity > 0 ? "k-aff k-aff--up" : "k-aff k-aff--down"}
            >
              <span className="k-aff__name">
                {genre.genre}
                <small>
                  {formatScore(genre.meanScore)} avg · {genre.scored} scored
                  {genre.dropped > 0 ? ` · ${String(genre.dropped)} dropped` : ""}
                </small>
              </span>
              <span className="k-aff__track" aria-hidden="true">
                <span
                  className="k-aff__bar"
                  style={
                    {
                      "--v": maxAffinity > 0 ? Math.abs(genre.affinity) / maxAffinity : 0,
                    } as React.CSSProperties
                  }
                />
              </span>
              <span className="k-aff__value">{formatAffinity(genre.affinity)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
