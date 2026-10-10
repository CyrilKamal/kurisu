import { meResponseSchema, todayResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Poster } from "@/components/Poster";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ShowLink } from "@/components/ShowLink";
import { outLabel, untilLabel } from "@/lib/airing";
import { apiGet } from "@/lib/api";

import { ActivityFeed } from "../you/friends/ActivityFeed";
import { EpisodeRows } from "./EpisodeRows";

export const metadata: Metadata = { title: "Today · kurisu" };

/** "Friday, October 10 · 3 episodes out". */
function headerLine(timeZone: string, now: Date, outCount: number): string {
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);
  if (outCount === 0) return `${date} · nothing new`;
  return `${date} · ${String(outCount)} ${outCount === 1 ? "episode" : "episodes"} out`;
}

/**
 * The home screen: episodes out that you haven't watched, each a tap from watched; what airs this
 * week; shows you're in the middle of; the latest brief; and what friends watched. Then a way
 * into Chat, at the bottom where a thumb is.
 */
export default async function TodayPage() {
  const [me, today] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/today", todayResponseSchema),
  ]);
  if (!me || !today) redirect("/");
  // A new account goes through the welcome steps once (they can skip them).
  if (!me.welcomed) redirect("/welcome");

  const now = new Date();
  const outCount = today.outNow.reduce((n, s) => n + s.latestAired - s.episodesWatched, 0);
  const nothing =
    today.outNow.length === 0 && today.comingUp.length === 0 && today.continueWatching.length === 0;
  const streaming = today.outNow.filter((show) => show.watchOn.length > 0);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title="Today" sub={headerLine(today.timeZone, now, outCount)} />

      {nothing && (
        <div className="k-empty mt-6">
          <p className="k-empty__count">0 episodes out · 0 shows in progress</p>
          <p className="k-empty__title">Nothing on today</p>
          <p className="k-empty__text">
            When a show you&apos;re watching has a new episode, it shows up here, one tap from
            watched.
          </p>
          <Link href="/chat/new?draft=what%20should%20I%20watch%3F" className="k-btn">
            Ask kurisu what to watch
          </Link>
        </div>
      )}

      {today.outNow.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Out for you</h2>
          <EpisodeRows
            items={today.outNow.map((show) => ({
              ...show,
              meta: outLabel(show.episodesWatched, show.latestAired),
              out: true,
            }))}
          />
          {streaming.length > 0 && (
            <p className="k-field__hint pt-2">
              {streaming
                .map((show) => `${show.title} on ${show.watchOn.map((w) => w.service).join(", ")}`)
                .join(" · ")}
            </p>
          )}
        </section>
      )}

      {today.comingUp.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Coming up</h2>
          <ul className="k-rows">
            {today.comingUp.map((show) => (
              <li key={show.animeId} className="k-row">
                <Poster url={show.pictureUrl} title={show.title} />
                <div className="k-row__main">
                  <ShowLink animeId={show.animeId}>
                    <span className="k-row__title">{show.title}</span>
                  </ShowLink>
                  <p className="k-row__meta">
                    <span className="k-airing">
                      ep {show.episode} in{" "}
                      {untilLabel(new Date(show.airingAt), now, today.timeZone)}
                    </span>
                    {show.episode === 1 && <span className="k-airing__flag">Premiere</span>}
                  </p>
                </div>
                <span />
              </li>
            ))}
          </ul>
        </section>
      )}

      {today.continueWatching.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Continue</h2>
          <EpisodeRows
            items={today.continueWatching.map((show) => ({
              ...show,
              meta: [
                `ep ${String(show.episodesWatched)}${show.numEpisodes === null ? "" : ` of ${String(show.numEpisodes)}`}`,
                show.episodeMinutes === null ? null : `${String(show.episodeMinutes)} min`,
              ]
                .filter((part) => part !== null)
                .join(" · "),
              out: false,
            }))}
          />
        </section>
      )}

      {today.brief && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Latest brief</h2>
          <Link
            href={`/chat/${today.brief.conversationId}`}
            className="k-panel block p-4 text-ink no-underline hover:bg-surface-raised"
          >
            <span className="k-field__hint block">
              {today.brief.localDate ?? "Brief"}
              {today.brief.episodes > 0 &&
                ` · ${String(today.brief.episodes)} new ${today.brief.episodes === 1 ? "episode" : "episodes"}`}
              {today.brief.premieres > 0 &&
                ` · ${String(today.brief.premieres)} ${today.brief.premieres === 1 ? "premiere" : "premieres"}`}
            </span>
            {today.brief.summary && <span className="block pt-1">{today.brief.summary}</span>}
          </Link>
        </section>
      )}

      {today.friends.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Friends lately</h2>
          <ActivityFeed items={today.friends} timeZone={today.timeZone} />
          <Link href="/you/friends" className="k-link mt-2 inline-block">
            See your friends
          </Link>
        </section>
      )}

      <section className="pt-8">
        {/* Opens Chat with its command line ready; nothing is sent from here. */}
        <Link href="/chat/new" className="k-cmd no-underline">
          <span className="k-cmd__prompt" aria-hidden="true">
            &gt;
          </span>
          <span className="flex-1 self-center text-ink-faint">Tell kurisu what you watched</span>
        </Link>
      </section>
    </main>
  );
}
