import { yearReviewSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Histogram } from "@/components/Histogram";
import { Metric, Metrics } from "@/components/Metrics";
import { Poster } from "@/components/Poster";
import { Score } from "@/components/Score";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ShowLink } from "@/components/ShowLink";
import { apiGet, getMe } from "@/lib/api";
import { mediaTypeLabel } from "@/lib/format";
import { meanText } from "@/lib/score";
import { goalProgress, hoursWatched, monthLabel, shortDate, showCount } from "@/lib/stats";
import { MONTH_NAMES, yearShareText } from "@/lib/year";

import { ShareYear } from "./ShareYear";

export const metadata: Metadata = { title: "Year in review · kurisu" };

/** One of the year's milestones: what it is, the show, and a line about it. */
function MilestoneRow({
  label,
  show,
  meta,
}: {
  label: string;
  show: { animeId: number; title: string; pictureUrl: string | null };
  meta: string;
}) {
  return (
    <li className="k-row">
      <Poster url={show.pictureUrl} title={show.title} />
      <div className="k-row__main">
        <p className="k-caps">{label}</p>
        <ShowLink animeId={show.animeId}>
          <span className="k-row__title">{show.title}</span>
        </ShowLink>
        <p className="k-row__meta">{meta}</p>
      </div>
      <span />
    </li>
  );
}

/** The earliest year the server reviews. */
const FIRST_YEAR = 1960;

/** "?year=2025" when it's a year that can be reviewed, else null for this year. */
function askedYear(param: string | string[] | undefined): number | null {
  if (typeof param !== "string" || !/^\d{4}$/.test(param)) return null;
  const year = Number(param);
  return year >= FIRST_YEAR && year <= new Date().getFullYear() ? year : null;
}

/**
 * A year in review: the year's finishes, episodes, top genre and favorite for everyone, to share;
 * and with Pro, the full year: month by month, top rated, genres, seasonal against backlog, the
 * longest finish, the first and last, and the user's own words from the diary.
 */
export default async function YearPage(props: PageProps<"/you/year">) {
  const asked = askedYear((await props.searchParams).year);
  const [review, me] = await Promise.all([
    apiGet(asked === null ? "/year" : `/year?year=${String(asked)}`, yearReviewSchema),
    getMe(),
  ]);
  if (!review || !me) redirect("/");
  const { year, currentYear, basic, full } = review;
  const goal = basic.goal === null ? null : goalProgress(basic.completed, basic.goal);
  const yearLink = (y: number) => (y === currentYear ? "/you/year" : `/you/year?year=${String(y)}`);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader
        title={`Your ${String(year)}`}
        sub={year === currentYear ? "in anime, so far" : "in anime"}
        back="/you"
        actions={
          <>
            {year > FIRST_YEAR && (
              <Link href={yearLink(year - 1)} className="k-btn k-btn--ghost k-btn--sm">
                {year - 1}
              </Link>
            )}
            {year < currentYear && (
              <Link href={yearLink(year + 1)} className="k-btn k-btn--ghost k-btn--sm">
                {year + 1}
              </Link>
            )}
          </>
        }
      />

      <section className="flex flex-col gap-4 pt-6">
        <Metrics>
          <Metric
            hero
            label="Finished"
            value={String(basic.completed)}
            basis={`${basic.completed === 1 ? "show" : "shows"} in ${String(year)}${
              goal ? ` · ${goal.label}` : ""
            }`}
          />
        </Metrics>
        <Metrics>
          <Metric label="Episodes" value={basic.episodes.toLocaleString("en-US")} />
          <Metric label="Watched" value={hoursWatched(basic.minutes)} unit="h" />
          <Metric label="Top genre" value={basic.topGenre ?? "–"} />
        </Metrics>
        {basic.favorite && (
          <div className="k-row">
            <Poster url={basic.favorite.pictureUrl} title={basic.favorite.title} eager />
            <div className="k-row__main">
              <p className="k-caps">Favorite</p>
              <ShowLink animeId={basic.favorite.animeId}>
                <span className="k-row__title">{basic.favorite.title}</span>
              </ShowLink>
            </div>
            <Score score={basic.favorite.score} />
          </div>
        )}
        {review.countingSince && (
          <p className="k-field__hint">
            {review.countingSince.startsWith(String(year))
              ? `Episodes count from ${shortDate(review.countingSince)}, when you joined kurisu.`
              : `You joined kurisu after ${String(year)}, so only shows you finished count here.`}{" "}
            Finished shows count by their finish date on MyAnimeList.
          </p>
        )}
        {basic.completed > 0 && <ShareYear text={yearShareText(review)} />}
      </section>

      {full ? (
        <>
          <section className="pt-8">
            <h2 className="k-caps pb-2">Month by month</h2>
            <Histogram
              summary={`Shows finished each month of ${String(year)}`}
              columns={full.completedByMonth.map((value, i) => ({
                label: monthLabel(i + 1).slice(0, 1),
                value,
                name: MONTH_NAMES[i] ?? "",
              }))}
            />
            {full.episodesByMonth.some((n) => n > 0) && (
              <div className="pt-4">
                <h3 className="k-caps pb-2">Episodes</h3>
                <Histogram
                  summary={`Episodes watched each month of ${String(year)}`}
                  columns={full.episodesByMonth.map((value, i) => ({
                    label: monthLabel(i + 1).slice(0, 1),
                    value,
                    name: MONTH_NAMES[i] ?? "",
                  }))}
                />
              </div>
            )}
          </section>

          {full.topRated.length > 0 && (
            <section className="pt-8">
              <h2 className="k-caps pb-2">Top rated</h2>
              <ul className="k-rows">
                {full.topRated.map((show) => (
                  <li key={show.animeId} className="k-row">
                    <Poster url={show.pictureUrl} title={show.title} />
                    <div className="k-row__main">
                      <ShowLink animeId={show.animeId}>
                        <span className="k-row__title">{show.title}</span>
                      </ShowLink>
                      <p className="k-row__meta">finished {shortDate(show.on)}</p>
                    </div>
                    <Score score={show.score} />
                  </li>
                ))}
              </ul>
              {full.meanScore !== null && (
                <p className="k-field__hint pt-2">
                  Average {meanText(full.meanScore, me.scoreStyle)} across {showCount(full.scored)}{" "}
                  you scored.
                </p>
              )}
            </section>
          )}

          <section className="pt-8">
            <h2 className="k-caps pb-2">What you watched</h2>
            <Metrics>
              <Metric
                label="Seasonal"
                value={String(full.seasonal)}
                basis={`started airing in ${String(year)}`}
              />
              <Metric label="Backlog" value={String(full.backlog)} basis="from earlier years" />
              <Metric label="Started" value={String(full.started)} />
              <Metric label="Dropped" value={String(full.dropped)} />
            </Metrics>
            {full.formats.length > 0 && (
              <p className="k-field__hint pt-2">
                {full.formats
                  .map((f) => `${String(f.shows)} ${mediaTypeLabel(f.mediaType) ?? "other"}`)
                  .join(" · ")}
              </p>
            )}
          </section>

          {full.topGenres.length > 0 && (
            <section className="pt-8">
              <h2 className="k-caps pb-2">Genres</h2>
              <ul className="k-rows">
                {full.topGenres.map((genre) => (
                  <li
                    key={genre.genre}
                    className="flex justify-between gap-4 border-b border-line py-2 text-ink"
                  >
                    <span>{genre.genre}</span>
                    <span className="k-mono">{showCount(genre.shows)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(full.longest ?? full.first) && (
            <section className="pt-8">
              <h2 className="k-caps pb-2">Milestones</h2>
              <ul className="k-rows">
                {full.longest && (
                  <MilestoneRow
                    label="Longest finish"
                    show={full.longest}
                    meta={`${String(full.longest.episodes)} ${
                      full.longest.episodes === 1 ? "episode" : "episodes"
                    } · ${hoursWatched(full.longest.minutes)} hours`}
                  />
                )}
                {full.first && (
                  <MilestoneRow
                    label="First finish"
                    show={full.first}
                    meta={shortDate(full.first.on)}
                  />
                )}
                {full.last && full.last.animeId !== full.first?.animeId && (
                  <MilestoneRow
                    label="Latest finish"
                    show={full.last}
                    meta={shortDate(full.last.on)}
                  />
                )}
              </ul>
            </section>
          )}

          {full.notes.length > 0 && (
            <section className="pt-8">
              <h2 className="k-caps pb-2">In your words</h2>
              <ul className="flex flex-col gap-4">
                {full.notes.map((note) => (
                  <li key={`${String(note.animeId)}-${note.on}-${note.text}`}>
                    <blockquote className="m-0 border-l-2 border-line-strong pl-4 text-ink">
                      &ldquo;{note.text}&rdquo;
                    </blockquote>
                    <p className="k-field__hint pl-4 pt-1">
                      {note.title} · {shortDate(note.on)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <section className="pt-8">
          <div className="k-panel flex flex-col gap-2 p-4">
            <h2 className="k-empty__title">The full year comes with Pro</h2>
            <p className="text-ink-muted">
              Month by month, your top rated, your genres, seasonal against backlog, your longest
              finish, and your own words from the diary.
            </p>
            <div>
              <Link href="/you/plan" className="k-btn">
                See plans
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
