"use client";

import { LIST_STATUSES, type ListEntry } from "@kurisu/shared";
import { useEffect, useState } from "react";

import { STATUS_LABELS } from "@/lib/format";
import { readList } from "@/lib/offline";

/**
 * The list as this device last saw it, read-only: what you're watching first. Saved by the List
 * screen; there's none when the List screen hasn't been opened here.
 */
export function OfflineList() {
  const [list, setList] = useState<{ entries: ListEntry[]; savedAt: string } | null | "loading">(
    "loading",
  );

  useEffect(() => {
    void readList().then(setList);
  }, []);

  if (list === "loading") return <p className="k-field__hint pt-6">Looking for your list…</p>;
  if (list === null) {
    return (
      <p className="k-field__hint pt-6">
        No copy of your list on this device yet. Open the List screen once while you&apos;re online,
        and it&apos;ll be here next time.
      </p>
    );
  }

  const saved = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(list.savedAt));

  return (
    <>
      <p className="k-field__hint pt-4">Your list as of {saved}.</p>
      {LIST_STATUSES.map((status) => {
        const entries = list.entries.filter((entry) => entry.status === status);
        if (entries.length === 0) return null;
        return (
          <section key={status} className="pt-6">
            <h2 className="k-caps pb-2">
              {STATUS_LABELS[status]} · {entries.length}
            </h2>
            <ul className="k-rows">
              {entries.map((entry) => (
                <li
                  key={entry.animeId}
                  className="flex items-center justify-between gap-4 border-b border-line py-2"
                >
                  <span className="min-w-0 truncate font-serif font-semibold text-ink">
                    {entry.title}
                  </span>
                  <span className="k-meter__label whitespace-nowrap">
                    <b>{entry.episodesWatched}</b>/{entry.numEpisodes ?? "?"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
