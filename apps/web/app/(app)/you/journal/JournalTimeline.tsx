"use client";

import {
  changeResponseSchema,
  importResponseSchema,
  type JournalItem,
  type JournalResponse,
} from "@kurisu/shared";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { Banner } from "@/components/Banner";
import { Diff } from "@/components/Diff";
import { Icon } from "@/components/Icon";
import { Poster } from "@/components/Poster";
import { useConfirm } from "@/components/Sheet";
import { ShowLink } from "@/components/ShowLink";
import { postApi, sendApi } from "@/lib/clientApi";
import { sourceLabel, writeErrorMessage } from "@/lib/describeChange";
import { groupByDay } from "@/lib/diary";
import { notifyListChanged } from "@/lib/listChanged";

type Note = NonNullable<Extract<JournalItem, { type: "change" }>["note"]>;

/**
 * Every update by day on the user's clock (the design system's ChangeLog), History and the diary
 * in one: kurisu's changes with Undo until they're undone, changes found on MyAnimeList's site,
 * each import as one line that undoes as one, and what the user said with an update, which they
 * can share with friends or delete.
 */
export function JournalTimeline({ initial }: { initial: JournalResponse }) {
  const router = useRouter();
  const { confirm, sheet } = useConfirm();
  const [items, setItems] = useState(initial.items);
  // A fresh server render (after an undo) replaces what's shown.
  const [rendered, setRendered] = useState(initial);
  if (rendered !== initial) {
    setRendered(initial);
    setItems(initial.items);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: initial.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  function refresh() {
    router.refresh();
    notifyListChanged();
  }

  async function undoChange(id: string) {
    setBusy(id);
    setNotice(null);
    const result = await postApi(`/changes/${id}/undo`, changeResponseSchema);
    setBusy(null);
    if (result.ok) refresh();
    else setNotice(writeErrorMessage(result.error));
  }

  async function undoImport(id: string, count: number) {
    const yes = await confirm({
      title: "Undo this import?",
      body: `All ${String(count)} of its changes go back to how they were, on MyAnimeList too.`,
      action: "Undo import",
      danger: true,
    });
    if (!yes) return;
    setBusy(id);
    setNotice(null);
    const result = await postApi(`/imports/${id}/undo`, importResponseSchema);
    setBusy(null);
    if (result.ok) refresh();
    else setNotice("Couldn't undo that import. Try again in a moment.");
  }

  function setNote(itemId: string, note: Note | null) {
    setItems((current) =>
      current.map((item) =>
        item.type === "change" && item.id === itemId ? { ...item, note } : item,
      ),
    );
  }

  async function toggleShare(itemId: string, note: Note) {
    setNotice(null);
    setNote(itemId, { ...note, shared: !note.shared });
    const result = await sendApi("PATCH", `/diary/notes/${note.id}`, null, {
      shared: !note.shared,
    });
    if (!result.ok) {
      setNote(itemId, note);
      setNotice("Couldn't change who sees that note. Please try again.");
    }
  }

  async function removeNote(itemId: string, title: string, note: Note) {
    const yes = await confirm({
      title: "Delete this note?",
      body: `Your note about ${title} goes. The update stays.`,
      action: "Delete note",
      danger: true,
    });
    if (!yes) return;
    setNotice(null);
    setNote(itemId, null);
    const result = await sendApi("DELETE", `/diary/notes/${note.id}`, null);
    // A 404 means it's already gone.
    if (!result.ok && result.status !== 404) {
      setNote(itemId, note);
      setNotice("Couldn't delete that note. Please try again.");
    }
  }

  if (items.length === 0) {
    return (
      <div className="k-empty mt-6">
        <p className="k-empty__count">0 updates</p>
        <p className="k-empty__title">Nothing yet</p>
        <p className="k-empty__text">
          Updates you make in Chat, on Today or on the List screen show up here, with anything you
          said about the show, and each one can be undone.
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
        {groupByDay(items, initial.timeZone).map((day) => (
          <Fragment key={day.date}>
            <li className="k-changes__day">
              <span>
                {day.date} · {day.label}
              </span>
              <span>
                {day.entries.length} update{day.entries.length === 1 ? "" : "s"}
              </span>
            </li>
            {day.entries.map((item) => {
              const at = (
                <time className="k-changes__time" dateTime={item.at}>
                  {time.format(new Date(item.at))}
                </time>
              );
              if (item.type === "import") {
                return (
                  <li
                    key={item.id}
                    className={`k-changes__entry${item.undone ? " is-undone" : ""}`}
                  >
                    {at}
                    <span className="flex w-(--poster-sm) justify-center text-ink-faint">
                      <Icon name="list" />
                    </span>
                    <div className="min-w-0">
                      <p className="k-write__title">
                        Imported {item.count} {item.count === 1 ? "show" : "shows"}
                      </p>
                      <p className="k-field__hint">From your notes, as one import</p>
                    </div>
                    {item.undone ? (
                      <span className="k-write__undone">undone</span>
                    ) : (
                      <button
                        type="button"
                        className="k-link"
                        disabled={busy !== null}
                        aria-busy={busy === item.id}
                        onClick={() => void undoImport(item.id, item.count)}
                      >
                        {busy === item.id ? "Undoing…" : "Undo"}
                      </button>
                    )}
                  </li>
                );
              }
              const undone = item.type === "change" && item.undone;
              const note = item.type === "change" ? item.note : null;
              return (
                <li key={item.id} className={`k-changes__entry${undone ? " is-undone" : ""}`}>
                  {at}
                  <Poster url={item.pictureUrl} title={item.title} />
                  <div className="min-w-0">
                    <p className="k-write__title">
                      <ShowLink animeId={item.animeId}>{item.title}</ShowLink>
                    </p>
                    <Diff
                      kind={item.kind}
                      before={item.before}
                      after={item.after}
                      numEpisodes={item.numEpisodes}
                      prefix={item.type === "mal" ? "On MyAnimeList" : sourceLabel(item.source)}
                    />
                    {note && (
                      <NoteLine
                        note={note}
                        onShare={() => void toggleShare(item.id, note)}
                        onDelete={() => void removeNote(item.id, item.title, note)}
                      />
                    )}
                  </div>
                  {item.type === "mal" ? (
                    <span />
                  ) : item.undone ? (
                    <span className="k-write__undone">undone</span>
                  ) : (
                    <button
                      type="button"
                      className="k-link"
                      disabled={busy !== null}
                      aria-busy={busy === item.id}
                      onClick={() => void undoChange(item.id)}
                    >
                      {busy === item.id ? "Undoing…" : "Undo"}
                    </button>
                  )}
                </li>
              );
            })}
          </Fragment>
        ))}
      </ol>
      {sheet}
    </>
  );
}

/** What the user said with an update: shared with friends or not, and deletable. */
function NoteLine({
  note,
  onShare,
  onDelete,
}: {
  note: Note;
  onShare: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <p className="k-drop__said">{note.text}</p>
      <p className="k-field__hint flex flex-wrap gap-x-4">
        <button type="button" className="k-link" onClick={onShare} aria-pressed={note.shared}>
          {note.shared ? "Shared with friends · Stop sharing" : "Share with friends"}
        </button>
        <button type="button" className="k-link" onClick={onDelete}>
          Delete note
        </button>
      </p>
    </>
  );
}
