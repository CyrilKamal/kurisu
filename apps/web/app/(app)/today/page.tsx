import { todayResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Banner } from "@/components/Banner";
import { Poster } from "@/components/Poster";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ShowLink } from "@/components/ShowLink";
import { outLabel, untilLabel } from "@/lib/airing";
import { apiGet, getMe } from "@/lib/api";
import { planName, trialDaysLeft } from "@/lib/plans";
import { splitOut } from "@/lib/today";

import { ActivityFeed } from "../you/friends/ActivityFeed";
import { EpisodeRows } from "./EpisodeRows";

export const metadata: Metadata = { title: "Today · kurisu" };

/** "Friday, October 10 · 3 shows with new episodes". */
function headerLine(timeZone: string, now: Date, outCount: number): string {
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);
  if (outCount === 0) return `${date} · nothing new`;
  return `${date} · ${String(outCount)} ${outCount === 1 ? "show" : "shows"} with new episodes`;
}

/**
 * The home screen: new episodes of the shows you keep up with, each a tap from watched; what airs
 * this week; backlogs you're catching up on; shows you're in the middle of; the latest brief;
 * and what friends watched. Then a way into Chat, at the bottom where a thumb is.
 */
export default async function TodayPage() {
  const [me, today] = await Promise.all([getMe(), apiGet("/today", todayResponseSchema)]);
  if (!me || !today) redirect("/");
  // A new account goes through the welcome steps once (they can skip them).
  if (!me.welcomed) redirect("/welcome");

  const now = new Date();
  const { keepingUp, catchingUp } = splitOut(today.outNow);
  const nothing =
    today.outNow.length === 0 && today.comingUp.length === 0 && today.continueWatching.length === 0;
  const outRow = (show: (typeof today.outNow)[number], out: boolean) => ({
    ...show,
    lastEpisode: show.latestAired,
    meta: outLabel(show.episodesWatched, show.latestAired),
    out,
    watchOn: show.watchOn.map((w) => w.service).join(", ") || null,
  });
  const trialDays = trialDaysLeft(me.plan, now);

  return (
    <main className="mx-auto max-w-(--content-max) px-4 pb-nav">
      <ScreenHeader title="Today" sub={headerLine(today.timeZone, now, keepingUp.length)} />

      {/* A quiet line through the trial, so its end isn't a surprise. */}
      {trialDays !== null && (
        <Banner
          level={trialDays <= 3 ? "warn" : "info"}
          className="mt-4"
          action={
            <Link href="/you/plan" className="k-btn k-btn--sm">
              See plans
            </Link>
          }
        >
          {planName(me.plan.id)} trial: {trialDays} {trialDays === 1 ? "day" : "days"} left. Then
          Free, which keeps your list, the brief and friends.
        </Banner>
      )}

      {nothing && (
        <div className="k-empty mt-6">
          <p className="k-empty__count">0 new episodes · 0 shows in progress</p>
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

      {keepingUp.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Out for you</h2>
          <EpisodeRows items={keepingUp.map((show) => outRow(show, true))} />
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
          <Link href="/browse" className="k-link mt-2 inline-block">
            Full schedule
          </Link>
        </section>
      )}

      {catchingUp.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Catching up</h2>
          {/* Backlogs aren't news: no crimson flag, and they don't count in the badge. */}
          <EpisodeRows items={catchingUp.map((show) => outRow(show, false))} />
        </section>
      )}

      {today.continueWatching.length > 0 && (
        <section className="pt-6">
          <h2 className="k-caps pb-2">Continue</h2>
          <EpisodeRows
            items={today.continueWatching.map((show) => ({
              ...show,
              lastEpisode: show.numEpisodes,
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
            ›
          </span>
          <span className="flex-1 self-center text-ink-faint">Tell kurisu what you watched</span>
        </Link>
      </section>
    </main>
  );
}
