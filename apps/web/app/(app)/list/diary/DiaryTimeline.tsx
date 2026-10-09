"use client";

import type { DiaryEntry, DiaryResponse } from "@kurisu/shared";
import { Fragment, useState } from "react";

import { Banner } from "@/components/Banner";
import { Diff } from "@/components/Diff";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { sendApi } from "@/lib/clientApi";
import { groupByDay } from "@/lib/diary";

/**
 * The diary by day on the user's clock, laid out like the ChangeLog: each update with its time,
 * poster and diff, where it was made, and the user's own words under it, which can be deleted.
 */
export function DiaryTimeline({ initial }: { initial: DiaryResponse }) {
  const [entries, setEntries] = useState(initial.entries);
  const [notice, setNotice] = useState<string | null>(null);
  // The user's own time zone, from the server, so the server's render and the browser's agree.
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: initial.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

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

  async function toggleShare(entry: DiaryEntry) {
    if (!entry.note) return;
    const note = entry.note;
    setNotice(null);
    setNote(entry.id, { ...note, shared: !note.shared });
    const result = await sendApi("PATCH", `/diary/notes/${note.id}`, null, {
      shared: !note.shared,
    });
    if (!result.ok) {
      setNote(entry.id, note);
      setNotice("Couldn't change who sees that note. Please try again.");
    }
  }

  if (entries.length === 0) {
    return (
      <div className="k-empty mt-6">
        <p className="k-empty__title">Nothing yet</p>
        <p className="k-empty__text">
          Updates you make in Chat or on the List screen show up here, with anything you said about
          the show.
        </p>
      </div>
    );
  }

  return (
    <>
      {notice && (
        <Banner level="error" className="mt-4">
          {notice}
        </Banner>
      )}
      <ol className="k-changes -mx-4">
        {groupByDay(entries, initial.timeZone).map((day) => (
          <Fragment key={day.date}>
            <li className="k-changes__day">
              <span>
                {day.date} · {day.label}
              </span>
              <span>
                {day.entries.length} update{day.entries.length === 1 ? "" : "s"}
              </span>
            </li>
            {day.entries.map((entry) => (
              <li key={entry.id} className="k-changes__entry">
                <time className="k-changes__time" dateTime={entry.at}>
                  {time.format(new Date(entry.at))}
                </time>
                <Poster url={entry.pictureUrl} title={entry.title} />
                <div className="min-w-0">
                  <a
                    className="k-write__title block hover:underline"
                    href={`https://myanimelist.net/anime/${String(entry.animeId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {entry.title}
                  </a>
                  <Diff
                    kind={entry.kind}
                    before={entry.before}
                    after={entry.after}
                    prefix={entry.origin === "mal" ? "On MyAnimeList" : null}
                  />
                  {entry.note && (
                    <>
                      <p className="k-drop__said">{entry.note.text}</p>
                      <button
                        type="button"
                        className="k-link k-field__hint"
                        onClick={() => void toggleShare(entry)}
                        aria-pressed={entry.note.shared}
                      >
                        {entry.note.shared
                          ? "Shared with friends · Stop sharing"
                          : "Share with friends"}
                      </button>
                    </>
                  )}
                </div>
                {entry.note ? (
                  <button
                    type="button"
                    className="k-btn k-btn--danger k-btn--icon k-btn--sm"
                    onClick={() => void removeNote(entry)}
                    aria-label={`Delete the note about ${entry.title}`}
                  >
                    <Icon name="trash" />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </Fragment>
        ))}
      </ol>
    </>
  );
}
