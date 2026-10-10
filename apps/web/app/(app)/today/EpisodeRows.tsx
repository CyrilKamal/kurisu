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
  /** The meta line: "ep 9 out", "ep 7 of 24 · 24 min". */
  meta: string;
  /** The meta line is the new-episode signal (crimson). */
  out: boolean;
}

/**
 * Shows with a next episode to watch, each marked watched in one tap (the design system's
 * EpisodeRow). The tap writes through the same path as the List screen's "+1 ep", and a Toast
 * says what changed with Undo.
 */
export function EpisodeRows({ items }: { items: EpisodeRowItem[] }) {
  const toast = useWriteToast();
  const [saving, setSaving] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  // Fresh rows from the server (after the refresh a write starts) replace the marked ones.
  const [shown, setShown] = useState(items);
  if (shown !== items) {
    setShown(items);
    setDone(new Set());
  }

  async function watched(item: EpisodeRowItem) {
    setSaving(item.animeId);
    const result = await sendApi(
      "POST",
      `/list/${String(item.animeId)}/edit`,
      changeResponseSchema,
      { episodesWatched: item.episodesWatched + 1, requestId: crypto.randomUUID() },
    );
    setSaving(null);
    if (result.ok && result.data) {
      setDone((current) => new Set(current).add(item.animeId));
      toast.written(result.data.change);
    } else if (!result.ok) {
      toast.failed(result.error);
    }
  }

  return (
    <ul className="k-rows">
      {items.map((item) => {
        const isDone = done.has(item.animeId);
        const next = item.episodesWatched + 1;
        return (
          <li key={item.animeId} className={isDone ? "k-row is-done" : "k-row"}>
            <Poster
              url={item.pictureUrl}
              title={item.title}
              progress={progressOf(item.episodesWatched, item.numEpisodes)}
            />
            <div className="k-row__main">
              <ShowLink animeId={item.animeId}>
                <span className="k-row__title">{item.title}</span>
              </ShowLink>
              <p className="k-row__meta">
                <span className={item.out ? "k-airing k-airing--today" : "k-airing"}>
                  {item.meta}
                </span>
              </p>
            </div>
            {isDone ? (
              <span className="k-mono text-ink-faint">Watched</span>
            ) : (
              <button
                type="button"
                className="k-btn k-btn--sm"
                disabled={saving !== null}
                aria-busy={saving === item.animeId}
                aria-label={`Watched episode ${String(next)} of ${item.title}`}
                onClick={() => void watched(item)}
              >
                {saving === item.animeId ? "Saving…" : `Watched ep ${String(next)}`}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
