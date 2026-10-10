import { showResponseSchema, type JournalItem } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";

import { BackButton } from "@/components/BackButton";
import { Diff } from "@/components/Diff";
import { Icon } from "@/components/Icon";
import { Poster, progressOf } from "@/components/Poster";
import { ProgressMeter } from "@/components/ProgressMeter";
import { Score } from "@/components/Score";
import { StatusBadge } from "@/components/StatusBadge";
import { untilLabel } from "@/lib/airing";
import { apiGet } from "@/lib/api";
import { sourceLabel } from "@/lib/describeChange";
import { mediaTypeLabel } from "@/lib/format";

import { ShowActions } from "./ShowActions";

/** One fetch per request, shared by the page and its title. */
const loadShow = cache((id: string) =>
  /^\d+$/.test(id) ? apiGet(`/shows/${id}`, showResponseSchema) : Promise.resolve(null),
);

export async function generateMetadata(props: PageProps<"/shows/[id]">): Promise<Metadata> {
  const page = await loadShow((await props.params).id);
  return { title: page ? `${page.show.title} · kurisu` : "Show · kurisu" };
}

/** "TV · 12 × 24 min · 2026". */
function kindLine(show: {
  mediaType: string | null;
  numEpisodes: number | null;
  episodeMinutes: number | null;
  startDate: string | null;
}): string | null {
  const episodes =
    show.numEpisodes === null
      ? null
      : show.episodeMinutes === null
        ? `${String(show.numEpisodes)} eps`
        : `${String(show.numEpisodes)} × ${String(show.episodeMinutes)} min`;
  const parts = [mediaTypeLabel(show.mediaType), episodes, show.startDate?.slice(0, 4) ?? null];
  const shown = parts.filter((part) => part !== null);
  return shown.length > 0 ? shown.join(" · ") : null;
}

/** "Oct 9" in the server's render; the journal's lines are dated, not timed. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

/**
 * One show (the design system's ShowHero, then its sections): what it is, where you are with it,
 * what it's about, where to watch it on your services, your updates of it, and friends who have
 * it. The only way out to another site is MyAnimeList's page, and the services AniList lists.
 */
export default async function ShowPage(props: PageProps<"/shows/[id]">) {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) redirect("/today");
  const page = await loadShow(id);
  if (!page) redirect("/");
  const { show, entry, airing, watchOn, journal, friends } = page;
  const kind = kindLine(show);
  const underway =
    entry !== null &&
    (entry.isRewatching || (entry.episodesWatched > 0 && entry.status !== "completed"));
  const behind =
    entry?.status === "watching" &&
    airing?.latestAired != null &&
    airing.latestAired > entry.episodesWatched;

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <div className="flex items-center pt-2">
        <BackButton fallback="/today" />
      </div>

      <section className="k-show">
        <Poster
          url={show.pictureUrl}
          title={show.title}
          size="lg"
          progress={underway ? progressOf(entry.episodesWatched, show.numEpisodes) : null}
        />
        <div className="min-w-0">
          <h1 className="k-show__title">{show.title}</h1>
          {show.altTitles[0] && <p className="k-show__alt">{show.altTitles[0]}</p>}
          <p className="k-show__meta">
            {kind && <span>{kind}</span>}
            {behind && airing.latestAired !== null && (
              <span className="k-airing k-airing--today">ep {airing.latestAired} out</span>
            )}
            {!behind && airing?.nextEpisode != null && airing.nextAiringAt !== null && (
              <span className="k-airing">
                ep {airing.nextEpisode} in {untilLabel(new Date(airing.nextAiringAt), new Date())}
              </span>
            )}
            {show.malMean !== null && <span>MAL {show.malMean.toFixed(2)}</span>}
          </p>
          {entry && (
            <div className="k-show__entry">
              <StatusBadge status={entry.status} />
              <div className="flex items-center gap-4">
                <ProgressMeter
                  watched={entry.episodesWatched}
                  total={show.numEpisodes}
                  bar={entry.status !== "completed" || entry.isRewatching}
                  className="w-40"
                />
                <Score score={entry.score} />
              </div>
            </div>
          )}
          <ShowActions
            show={{ animeId: show.animeId, title: show.title, numEpisodes: show.numEpisodes }}
            entry={
              entry && {
                status: entry.status,
                score: entry.score,
                episodesWatched: entry.episodesWatched,
                isRewatching: entry.isRewatching,
              }
            }
          />
        </div>
      </section>

      {show.synopsis && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Synopsis</h2>
          <p className="k-show__synopsis">{show.synopsis}</p>
        </section>
      )}

      <section className="pt-6">
        <h2 className="k-caps pb-2">Where to watch</h2>
        {watchOn.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {watchOn.map((place) => (
              <li key={place.service}>
                {place.url ? (
                  <a
                    href={place.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="k-btn k-btn--sm"
                  >
                    {place.service}
                    <Icon name="external" />
                  </a>
                ) : (
                  <span className="k-tag k-tag--word">{place.service}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="k-field__hint">
            Not on any of your services, as far as AniList knows. Your services are in Settings.
          </p>
        )}
      </section>

      {journal.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Your updates</h2>
          <ol className="k-changes">
            {journal.map((item) => (
              <JournalLine key={item.id} item={item} numEpisodes={show.numEpisodes} />
            ))}
          </ol>
        </section>
      )}

      {friends.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Friends</h2>
          <ul className="k-rows">
            {friends.map((friend) => (
              <li
                key={friend.friendId}
                className="flex items-center justify-between gap-4 border-b border-line py-2"
              >
                <span className="min-w-0 truncate text-ink">{friend.malUsername}</span>
                <span className="flex items-center gap-4">
                  <StatusBadge status={friend.status} />
                  <Score score={friend.score} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pt-8">
        <a
          href={`https://myanimelist.net/anime/${String(show.animeId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="k-link inline-flex items-center gap-2"
        >
          Open on MyAnimeList
          <Icon name="external" />
        </a>
      </p>
    </main>
  );
}

/** One update of this show: its date, the change, and the note the user wrote with it. */
function JournalLine({ item, numEpisodes }: { item: JournalItem; numEpisodes: number | null }) {
  if (item.type === "import") return null;
  return (
    <li className={`k-changes__entry${item.type === "change" && item.undone ? " is-undone" : ""}`}>
      <time className="k-changes__time" dateTime={item.at}>
        {shortDate(item.at)}
      </time>
      <span />
      <div className="min-w-0">
        <Diff
          kind={item.kind}
          before={item.before}
          after={item.after}
          numEpisodes={numEpisodes}
          prefix={item.type === "mal" ? "On MyAnimeList" : sourceLabel(item.source)}
        />
        {item.type === "change" && item.note && (
          <p className="k-field__hint pt-1">&ldquo;{item.note.text}&rdquo;</p>
        )}
      </div>
      {item.type === "change" && item.undone ? (
        <span className="k-write__undone">undone</span>
      ) : (
        <span />
      )}
    </li>
  );
}
