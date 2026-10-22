"use client";

import { changeResponseSchema } from "@kurisu/shared";
import { useState } from "react";

import { Poster, progressOf } from "@/components/Poster";
import { ShowLink } from "@/components/ShowLink";
import { sendApi } from "@/lib/clientApi";
import { useWriteToast } from "@/lib/useWriteToast";

export interface EpisodeRowItem {
  animeId: number;
  title: string;
  pictureUrl: string | null;
  numEpisodes: number | null;
  episodesWatched: number;
  /** The last episode a tap can reach: the newest aired one, or the show's total. */
  lastEpisode: number | null;
  /** The meta line: "ep 9 out", "ep 7 of 24 · 24 min". */
  meta: string;
  /** The meta line is the new-episode signal (crimson). */
  out: boolean;
  /** Where it streams on the user's services ("Crunchyroll, Netflix"), when AniList says. */
  watchOn?: string | null;
}

/**
 * Shows with a next episode to watch, each marked watched in one tap (the design system's
 * EpisodeRow). The tap writes through the same path as the List screen's "+1 ep", and a Toast
 * says what changed with Undo. The count moves at the tap and goes back if the write fails;
 * only that row waits for the write, then offers the next episode.
 */
export function EpisodeRows({ items }: { items: EpisodeRowItem[] }) {
  const toast = useWriteToast();
  const [saving, setSaving] = useState<Set<number>>(new Set());
  // Episodes watched per show, ahead of the server while its refresh is on the way.
  const [watched, setWatched] = useState<Map<number, number>>(new Map());
  // Fresh rows from the server (after the refresh a write starts) replace the local counts.
  const [shown, setShown] = useState(items);
  if (shown !== items) {
    setShown(items);
    setWatched(new Map());
  }

  async function markWatched(item: EpisodeRowItem, from: number) {
    const next = from + 1;
    setWatched((current) => new Map(current).set(item.animeId, next));
    setSaving((current) => new Set(current).add(item.animeId));
    const result = await sendApi(
      "POST",
      `/list/${String(item.animeId)}/edit`,
      changeResponseSchema,
      { episodesWatched: next, requestId: crypto.randomUUID() },
    );
    setSaving((current) => {
      const rest = new Set(current);
      rest.delete(item.animeId);
      return rest;
    });
    if (result.ok && result.data) {
      toast.written(result.data.change);
    } else {
      setWatched((current) => new Map(current).set(item.animeId, from));
      if (!result.ok) toast.failed(result.error);
    }
  }

  return (
    <ul className="k-rows">
      {items.map((item) => {
        const count = watched.get(item.animeId) ?? item.episodesWatched;
        const caughtUp = item.lastEpisode !== null && count >= item.lastEpisode;
        const next = count + 1;
        const busy = saving.has(item.animeId);
        return (
          <li key={item.animeId} className={caughtUp ? "k-row is-done" : "k-row"}>
            <Poster
              url={item.pictureUrl}
              title={item.title}
              progress={progressOf(count, item.numEpisodes)}
            />
            <div className="k-row__main">
              <ShowLink animeId={item.animeId}>
                <span className="k-row__title">{item.title}</span>
              </ShowLink>
              <p className="k-row__meta">
                <span className={item.out ? "k-airing k-airing--today" : "k-airing"}>
                  {item.meta}
                </span>
                {item.watchOn && <span>on {item.watchOn}</span>}
              </p>
            </div>
            {caughtUp ? (
              <span className="k-data-sm text-ink-faint">Caught up</span>
            ) : (
              <button
                type="button"
                className="k-btn k-btn--sm"
                disabled={busy}
                aria-busy={busy}
                aria-label={`Watched episode ${String(next)} of ${item.title}`}
                onClick={() => void markWatched(item, count)}
              >
                Watched ep {next}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
