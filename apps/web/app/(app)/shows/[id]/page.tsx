import {
  alertsResponseSchema,
  favoritesResponseSchema,
  priorityLabel,
  showResponseSchema,
  type JournalItem,
} from "@kurisu/shared";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";

import { BackButton } from "@/components/BackButton";
import { Diff } from "@/components/Diff";
import { Histogram, modeOf } from "@/components/Histogram";
import { Icon } from "@/components/Icon";
import { Poster, progressOf } from "@/components/Poster";
import { ProgressMeter } from "@/components/ProgressMeter";
import { Score } from "@/components/Score";
import { StatusBadge } from "@/components/StatusBadge";
import { untilLabel } from "@/lib/airing";
import { apiGet } from "@/lib/api";
import { showHref } from "@/lib/airing";
import { sourceLabel } from "@/lib/describeChange";
import { mediaTypeLabel, STATUS_LABELS } from "@/lib/format";
import { rankingLabel, relationLabel, sourceLine } from "@/lib/showExtras";

import { BroadcastLine } from "./BroadcastLine";
import { ShowActions } from "./ShowActions";
import { Tags } from "./Tags";

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

/** AniList's score spread as percentages, 10 to 100, the most common in crimson. */
function ScoreSpread({ spread }: { spread: { score: number; share: number }[] }) {
  const columns = spread.map((column) => ({
    label: String(column.score),
    value: Math.round(column.share * 100),
    name: `${String(column.score)} out of 100 (percent of scores)`,
  }));
  const mode = modeOf(columns.map((column) => column.value));
  return (
    <Histogram
      columns={columns}
      modeIndex={mode}
      summary={`How AniList's users score it${
        mode === null ? "" : `; most often ${columns[mode]?.label ?? ""} out of 100`
      }`}
    />
  );
}

/** Your own MAL fields for the show, when you've set any: priority, rewatches, tags, comments. */
function EntryExtras({
  entry,
}: {
  entry: {
    priority: number | null;
    timesRewatched: number | null;
    tags: string[] | null;
    comments: string | null;
  };
}) {
  const priority = entry.priority ?? 0;
  const rewatched = entry.timesRewatched ?? 0;
  const tags = entry.tags ?? [];
  const comments = entry.comments?.trim() ?? "";
  if (priority === 0 && rewatched === 0 && tags.length === 0 && comments === "") return null;
  return (
    <>
      {(priority > 0 || rewatched > 0 || tags.length > 0) && (
        <p className="k-show__meta">
          {priority > 0 && <span>{priorityLabel(priority)} priority</span>}
          {rewatched > 0 && <span>Rewatched {rewatched}×</span>}
          {tags.map((tag) => (
            <span key={tag} className="k-tag">
              {tag}
            </span>
          ))}
        </p>
      )}
      {comments !== "" && <p className="k-show__synopsis">{comments}</p>}
    </>
  );
}

/** "2026-10-09", as the system dates data columns; the journal's lines are dated, not timed. */
function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * One show (the design system's ShowHero, then its sections): what it is, where you are with it,
 * what it's about, its trailer, where to watch it on your services (down to each episode), the
 * order to watch its franchise in, your updates of it, friends who have it, its characters, tags
 * and what its fans recommend. The only ways out to another site are MyAnimeList's page, the
 * trailer, and the services AniList lists.
 */
export default async function ShowPage(props: PageProps<"/shows/[id]">) {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) redirect("/today");
  const [page, alerts, favorites] = await Promise.all([
    loadShow(id),
    apiGet("/alerts", alertsResponseSchema),
    apiGet("/favorites", favoritesResponseSchema),
  ]);
  if (!page) redirect("/");
  const { show, entry, airing, watchOn, journal, friends, extras } = page;
  // A Watching show's bell, when episode alerts are on: mute this one, or hear about it again.
  const alert =
    alerts?.included && alerts.on && entry?.status === "watching"
      ? { muted: alerts.muted.includes(show.animeId) }
      : null;
  const source = extras ? sourceLine(extras.source) : null;
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
            {show.broadcast &&
              (show.airingStatus === "currently_airing" ||
                show.airingStatus === "not_yet_aired") && (
                <BroadcastLine day={show.broadcast.day} time={show.broadcast.time} />
              )}
            {show.malMean !== null && <span>MAL {show.malMean.toFixed(2)}</span>}
            {extras?.score != null && <span>AniList {extras.score.toFixed(1)}</span>}
          </p>
          {extras && (extras.studios.length > 0 || extras.season !== null || source !== null) && (
            <p className="k-show__meta">
              {extras.studios.length > 0 && <span>{extras.studios.join(", ")}</span>}
              {extras.season && <span>{extras.season}</span>}
              {source && <span>{source}</span>}
            </p>
          )}
          {extras && extras.rankings.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0 pt-2">
              {extras.rankings.map((ranking) => (
                <li key={`${ranking.kind} ${ranking.scope}`}>
                  <span className="k-tag">{rankingLabel(ranking)}</span>
                </li>
              ))}
            </ul>
          )}
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
              <EntryExtras entry={entry} />
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
                comments: entry.comments,
                tags: entry.tags,
                priority: entry.priority,
                timesRewatched: entry.timesRewatched,
              }
            }
            alert={alert}
            hidden={page.hiddenFromFriends}
            favorite={
              favorites ? favorites.favorites.some((f) => f.animeId === show.animeId) : null
            }
          />
        </div>
      </section>

      {show.synopsis && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Synopsis</h2>
          <p className="k-show__synopsis">{show.synopsis}</p>
        </section>
      )}

      {extras?.trailer && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Trailer</h2>
          <a
            href={extras.trailer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="k-panel flex items-center gap-4 p-2 text-ink no-underline hover:bg-surface-raised"
          >
            {extras.trailer.thumbnail && (
              <span className="relative block aspect-video w-40 flex-none overflow-hidden">
                <Image src={extras.trailer.thumbnail} alt="" fill sizes="160px" />
              </span>
            )}
            <span className="flex items-center gap-2">
              Watch the trailer
              <Icon name="external" />
            </span>
          </a>
        </section>
      )}

      <section className="pt-6">
        <h2 className="k-title pb-2">Where to watch</h2>
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
            {page.servicesChosen ? (
              "Not on any of your services, as far as AniList knows. Your services are in Settings."
            ) : (
              <>
                Pick your streaming services in{" "}
                <Link href="/you/settings" className="k-link">
                  Settings
                </Link>{" "}
                to see where this streams.
              </>
            )}
          </p>
        )}
        {extras && extras.episodes.length > 0 && (
          <details className="pt-2">
            <summary className="k-link cursor-pointer">
              {extras.episodes.length} {extras.episodes.length === 1 ? "episode" : "episodes"} on{" "}
              {[...new Set(extras.episodes.map((e) => e.service))].join(", ")}
            </summary>
            <ol className="k-rows pt-2">
              {extras.episodes.map((episode) => (
                <li key={episode.url} className="border-b border-line py-2">
                  <a
                    href={episode.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="k-link inline-flex items-center gap-2"
                  >
                    {episode.title}
                    <Icon name="external" />
                  </a>
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {extras && extras.relations.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Watch order</h2>
          <ul className="k-rows">
            {extras.relations.map((related) => (
              <li key={related.animeId} className="k-row">
                <Link
                  prefetch={false}
                  href={showHref(related.animeId)}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  <Poster url={related.pictureUrl} title={related.title} />
                </Link>
                <div className="k-row__main">
                  <Link className="k-row__title" prefetch={false} href={showHref(related.animeId)}>
                    {related.title}
                  </Link>
                  <p className="k-row__meta">
                    <span>{relationLabel(related.relation)}</span>
                    {mediaTypeLabel(related.mediaType) && (
                      <span>{mediaTypeLabel(related.mediaType)}</span>
                    )}
                    {related.startDate && <span>{related.startDate.slice(0, 4)}</span>}
                  </p>
                </div>
                {related.status ? <StatusBadge status={related.status} /> : <span />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {journal.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Your updates</h2>
          <ol className="k-changes">
            {journal.map((item) => (
              <JournalLine key={item.id} item={item} numEpisodes={show.numEpisodes} />
            ))}
          </ol>
        </section>
      )}

      {friends.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Friends</h2>
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

      {extras && extras.characters.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Characters and their Japanese voices</h2>
          <ul className="m-0 grid list-none gap-x-8 p-0 sm:grid-cols-2">
            {extras.characters.map((character) => (
              // The character and the voice share the row evenly, so neither name loses out.
              <li
                key={character.name}
                className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-2"
              >
                <Poster url={character.pictureUrl} title={character.name} />
                <span className="min-w-0">
                  <span className="block truncate text-ink" title={character.name}>
                    {character.name}
                  </span>
                  <span className="k-field__hint capitalize">{character.role}</span>
                </span>
                {character.voiceActor && (
                  <>
                    <span
                      className="block min-w-0 truncate text-right text-ink-muted"
                      title={character.voiceActor.name}
                    >
                      {character.voiceActor.name}
                    </span>
                    <Poster
                      url={character.voiceActor.pictureUrl}
                      title={character.voiceActor.name}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {extras && extras.staff.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Staff</h2>
          <ul className="m-0 grid list-none gap-x-8 p-0 sm:grid-cols-2">
            {extras.staff.map((member) => (
              <li
                key={`${member.name} ${member.role}`}
                className="flex items-center gap-2 border-b border-line py-2"
              >
                <Poster url={member.pictureUrl} title={member.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{member.name}</span>
                  <span className="k-field__hint">{member.role}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extras?.scoreDistribution && (
        <section className="pt-6">
          <h2 className="k-title pb-2">How AniList scores it</h2>
          <ScoreSpread spread={extras.scoreDistribution} />
          <p className="k-field__hint pt-2">
            The percent of AniList&apos;s users who gave each score, out of 100.
          </p>
        </section>
      )}

      {extras && extras.tags.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Tags</h2>
          <Tags tags={extras.tags} />
        </section>
      )}

      {extras && extras.recommendations.length > 0 && (
        <section className="pt-6">
          <h2 className="k-title pb-2">Fans also like</h2>
          <ul className="k-grid">
            {extras.recommendations.map((pick) => (
              <li key={pick.animeId} className="k-grid__item">
                <Link
                  prefetch={false}
                  href={showHref(pick.animeId)}
                  className="block text-ink no-underline"
                >
                  <Poster url={pick.pictureUrl} title={pick.title} size="fill" />
                  <p className="k-grid__cap">{pick.title}</p>
                  <p className="k-grid__sub">
                    <span>{mediaTypeLabel(pick.mediaType) ?? ""}</span>
                    <span>{pick.status ? STATUS_LABELS[pick.status] : ""}</span>
                  </p>
                </Link>
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
