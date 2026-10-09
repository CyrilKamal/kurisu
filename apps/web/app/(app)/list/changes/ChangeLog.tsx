"use client";

import { changeResponseSchema, changesResponseSchema, type ChangeView } from "@kurisu/shared";
import { Fragment, useState } from "react";

import { Banner } from "@/components/Banner";
import { Diff } from "@/components/Diff";
import { Poster } from "@/components/Poster";
import { getApi, postApi } from "@/lib/clientApi";
import { sourceLabel, writeErrorMessage } from "@/lib/describeChange";
import { byLocalDay, hourMinute } from "@/lib/runMeta";
import { useIsBrowser } from "@/lib/useIsBrowser";

/**
 * Every write, by day (the design system's ChangeLog): a mono day row, then each change as a log
 * line with its time, poster, diff and Undo, or "undone" with the row struck through.
 */
export function ChangeLog({ initialChanges }: { initialChanges: ChangeView[] }) {
  const [changes, setChanges] = useState(initialChanges);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  // Days and times follow the viewer's time zone, so they're only shown in the browser.
  const inBrowser = useIsBrowser();

  async function undo(id: string) {
    setNotice(null);
    setUndoing(id);
    const result = await postApi(`/changes/${id}/undo`, changeResponseSchema);
    if (!result.ok) setNotice(writeErrorMessage(result.error));
    const fresh = await getApi("/changes", changesResponseSchema);
    if (fresh.ok) setChanges(fresh.data.changes);
    setUndoing(null);
  }

  if (changes.length === 0) {
    return (
      <div className="k-empty mt-6">
        <p className="k-empty__title">No changes yet</p>
        <p className="k-empty__text">
          Updates you make in Chat or on the List screen show up here, each one undoable.
        </p>
      </div>
    );
  }

  const days = inBrowser
    ? byLocalDay(changes, (c) => c.committedAt)
    : [{ key: "all", label: null, items: changes }];

  return (
    <>
      {notice && (
        <Banner level="error" className="mt-4">
          {notice}
        </Banner>
      )}
      <ol className="k-changes -mx-4">
        {days.map((day) => (
          <Fragment key={day.key}>
            {day.label && (
              <li className="k-changes__day">
                <span>{day.label}</span>
                <span>
                  {day.items.length} write{day.items.length === 1 ? "" : "s"}
                </span>
              </li>
            )}
            {day.items.map((change) => (
              <li
                key={change.id}
                className={`k-changes__entry${change.undone ? " is-undone" : ""}`}
              >
                <time className="k-changes__time" dateTime={change.committedAt}>
                  {inBrowser ? hourMinute(change.committedAt) : ""}
                </time>
                <Poster url={change.pictureUrl} title={change.title} />
                <div className="min-w-0">
                  <p className="k-write__title">{change.title}</p>
                  <Diff
                    kind={change.kind}
                    before={change.before}
                    after={change.after}
                    numEpisodes={change.numEpisodes}
                    prefix={sourceLabel(change.source)}
                  />
                </div>
                {change.undone ? (
                  <span className="k-write__undone">undone</span>
                ) : (
                  <button
                    type="button"
                    className="k-link"
                    disabled={undoing !== null}
                    aria-busy={undoing === change.id}
                    onClick={() => void undo(change.id)}
                  >
                    {undoing === change.id ? "Undoing…" : "Undo"}
                  </button>
                )}
              </li>
            ))}
          </Fragment>
        ))}
      </ol>
    </>
  );
}
