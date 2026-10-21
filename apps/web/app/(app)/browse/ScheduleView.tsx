"use client";

import type { ScheduleEpisode, ScheduleResponse } from "@kurisu/shared";
import Link from "next/link";
import { useState } from "react";

import { AddSheet } from "@/components/AddSheet";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { StatusBadge } from "@/components/StatusBadge";
import { showHref } from "@/lib/airing";
import {
  airTime,
  episodeLabel,
  isMine,
  SCHEDULE_SORT_LABELS,
  SCHEDULE_SORTS,
  scheduleDays,
  scheduleGenres,
  sortDay,
  type ScheduleSort,
} from "@/lib/browse";
import { mediaTypeLabel } from "@/lib/format";

type Scope = "mine" | "all";

/**
 * The week's airing schedule (Browse's Schedule), day by day in the user's time zone: their own
 * shows, or everything airing, narrowed by genre and ordered by time or popularity. Their
 * Watching shows stand out; anything not on the list can be added from here.
 */
export function ScheduleView({ data }: { data: ScheduleResponse }) {
  const hasMine = data.episodes.some(isMine);
  const [scope, setScope] = useState<Scope>(hasMine ? "mine" : "all");
  const [genre, setGenre] = useState<string | null>(null);
  const [sort, setSort] = useState<ScheduleSort>("time");
  const [adding, setAdding] = useState<ScheduleEpisode | null>(null);
  // Shows added from this screen, until the page reloads.
  const [added, setAdded] = useState<Set<number>>(new Set());
  const now = new Date();
  const scoped = scope === "mine" ? data.episodes.filter(isMine) : data.episodes;
  const genres = scheduleGenres(scoped);
  const shown = genre === null ? scoped : scoped.filter((e) => e.genres.includes(genre));
  const days = scheduleDays(shown, data.timeZone, now);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
        <div className="k-chips" role="group" aria-label="Whose shows">
          {(
            [
              ["mine", "My shows"],
              ["all", "Everything airing"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="k-chip"
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="k-filterbar__menus">
          <label className={genre === null ? "k-menu" : "k-menu is-set"}>
            <span className="k-visually-hidden">Genre</span>
            <select
              value={genre ?? ""}
              onChange={(event) => {
                setGenre(event.target.value || null);
              }}
            >
              <option value="">All genres</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </label>
          <label className="k-menu">
            <span className="k-visually-hidden">Order</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(SCHEDULE_SORTS.find((s) => s === event.target.value) ?? "time");
              }}
            >
              {SCHEDULE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </label>
        </div>
      </div>
      <p className="k-field__hint pt-2">Times in {data.timeZone.replace(/_/g, " ")}</p>

      {data.updatedAt === null ? (
        <div className="k-empty mt-6">
          <p className="k-empty__title">The schedule is on its way</p>
          <p className="k-empty__text">
            kurisu fetches the week&apos;s airing times from AniList in the background. Check back
            in a few minutes.
          </p>
        </div>
      ) : days.length === 0 && genre !== null ? (
        <div className="k-empty mt-6">
          <p className="k-empty__title">Nothing in {genre} this week</p>
          <button
            type="button"
            className="k-btn"
            onClick={() => {
              setGenre(null);
            }}
          >
            All genres
          </button>
        </div>
      ) : days.length === 0 ? (
        <div className="k-empty mt-6">
          <p className="k-empty__title">
            {scope === "mine" ? "None of your shows air this week" : "Nothing airing this week"}
          </p>
          {scope === "mine" && (
            <>
              <p className="k-empty__text">
                See everything airing, and add what looks good to your Plan to Watch.
              </p>
              <button
                type="button"
                className="k-btn"
                onClick={() => {
                  setScope("all");
                }}
              >
                Everything airing
              </button>
            </>
          )}
        </div>
      ) : (
        days.map((day) => (
          <section key={day.date} className="pt-6" aria-labelledby={`day-${day.date}`}>
            <h2 id={`day-${day.date}`} className="k-caps pb-2">
              {day.label}
            </h2>
            <ul className="k-rows">
              {sortDay(day.episodes, sort).map((episode) => {
                const aired = new Date(episode.airingAt).getTime() <= now.getTime();
                const watching = episode.entry?.status === "watching";
                const onList = episode.entry !== null || added.has(episode.animeId);
                return (
                  <li
                    key={`${String(episode.animeId)}-${String(episode.episode)}`}
                    className={aired ? "k-row opacity-60" : "k-row"}
                  >
                    <Link
                      prefetch={false}
                      href={showHref(episode.animeId)}
                      className="block"
                      tabIndex={-1}
                      aria-hidden="true"
                    >
                      <Poster url={episode.pictureUrl} title={episode.title} />
                    </Link>
                    <div className="k-row__main">
                      <Link
                        className="k-row__title"
                        prefetch={false}
                        href={showHref(episode.animeId)}
                      >
                        {episode.title}
                      </Link>
                      <p className="k-row__meta">
                        <span className="k-mono">{airTime(episode.airingAt, data.timeZone)}</span>
                        <span className={watching ? "k-airing k-airing--today" : "k-airing"}>
                          {episodeLabel(episode)}
                          {aired ? (episode.lastEpisode > episode.episode ? " out" : " aired") : ""}
                        </span>
                        {episode.episode === 1 && <span className="k-airing__flag">Premiere</span>}
                        {mediaTypeLabel(episode.mediaType) && (
                          <span>{mediaTypeLabel(episode.mediaType)}</span>
                        )}
                        {episode.watchOn.length > 0 && (
                          <span>on {episode.watchOn.map((w) => w.service).join(", ")}</span>
                        )}
                      </p>
                    </div>
                    {episode.entry ? (
                      <StatusBadge status={episode.entry.status} />
                    ) : onList ? (
                      <span className="k-field__hint whitespace-nowrap">Added</span>
                    ) : (
                      <button
                        type="button"
                        className="k-btn k-btn--sm"
                        aria-label={`Add ${episode.title}`}
                        onClick={() => {
                          setAdding(episode);
                        }}
                      >
                        <Icon name="plus" />
                        Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <p className="k-field__hint pt-6">Airing times from AniList, refreshed every few hours.</p>

      {adding && (
        <AddSheet
          show={adding}
          onClose={() => {
            setAdding(null);
          }}
          onAdded={() => {
            setAdded((current) => new Set(current).add(adding.animeId));
          }}
        />
      )}
    </>
  );
}
