"use client";

import type { DiaryEntry, DiaryResponse } from "@kurisu/shared";
import { useState } from "react";

import { sendApi } from "@/lib/clientApi";
import { describeWrite } from "@/lib/describeChange";
import { groupByDay } from "@/lib/diary";

/** The diary by day: each update, where it was made, and the user's note, which can be deleted. */
export function DiaryTimeline({ initial }: { initial: DiaryResponse }) {
  const [entries, setEntries] = useState(initial.entries);
  const [notice, setNotice] = useState<string | null>(null);

  function setNote(entryId: string, note: DiaryEntry["note"]) {
    setEntries((current) => current.map((e) => (e.id === entryId ? { ...e, note } : e)));
  }

  async function removeNote(entry: DiaryEntry) {
    if (!entry.note) return;
    const note = entry.note;
    if (!window.confirm(`Delete this note about ${entry.title}? The update stays.`)) return;
    setNotice(null);
    setNote(entry.id, null);
    const result = await sendApi("DELETE", `/diary/notes/${note.id}`, null);
    // A 404 means it's already gone.
    if (!result.ok && result.status !== 404) {
      setNote(entry.id, note);
      setNotice("Couldn't delete that note. Please try again.");
    }
  }

  if (entries.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Nothing yet. Updates you make in Chat or on the List screen show up here, with anything you
        said about the show.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {notice && <p className="mb-3 text-sm text-red-700 dark:text-red-400">{notice}</p>}
      {groupByDay(entries, initial.timeZone).map((day) => (
        <section key={day.date} className="mt-5">
          <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">{day.label}</h2>
          <ul className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-900">
            {day.entries.map((entry) => (
              <li key={entry.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <a
                    href={`https://myanimelist.net/anime/${String(entry.animeId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {entry.title}
                  </a>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {describeWrite(entry.kind, entry.before, entry.after)}
                  </span>
                  {entry.origin === "mal" && (
                    <span className="text-xs text-zinc-500">on MyAnimeList</span>
                  )}
                </div>
                {entry.note && (
                  <div className="mt-1 flex items-start gap-2">
                    <blockquote className="flex-1 border-l-2 border-zinc-300 pl-2 italic text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                      {entry.note.text}
                    </blockquote>
                    <button
                      type="button"
                      onClick={() => void removeNote(entry)}
                      aria-label={`Delete the note about ${entry.title}`}
                      className="h-7 shrink-0 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
