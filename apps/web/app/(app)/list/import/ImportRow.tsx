"use client";

import type { ImportItemView } from "@kurisu/shared";
import { useState } from "react";

import { Poster, progressOf } from "@/components/Poster";
import { STATUS_LABELS } from "@/lib/format";
import { disagreement, rowAction } from "@/lib/importView";

import { ChoiceList } from "../../chat/Shows";

const ROW = "flex items-start gap-4 border-b border-line px-2 py-2 last:border-b-0";

/** The line from the notes it came from, as the design system quotes the user ("said …"). */
function Said({ item }: { item: ImportItemView }) {
  return <p className="k-drop__said">{item.said}</p>;
}

/** The show a row is about: poster, title, and the line it came from. */
function Show({ item }: { item: ImportItemView }) {
  const show = item.show;
  const title = show?.title ?? item.title ?? item.said;
  return (
    <>
      <Poster
        url={show?.pictureUrl ?? null}
        title={title}
        progress={show ? progressOf(show.episodesWatched, show.numEpisodes) : null}
      />
      <div className="min-w-0 flex-1">
        <p className="k-write__title">{title}</p>
        <Said item={item} />
      </div>
    </>
  );
}

/** "Not this one" for a row that was a "which one?": takes the pick back. */
function Repick({ item, onPatch }: { item: ImportItemView; onPatch: Patch }) {
  if (item.candidates.length === 0) return null;
  return (
    <button type="button" className="k-link" onClick={() => void onPatch({ animeId: null })}>
      Not this one
    </button>
  );
}

type Patch = (body: Record<string, unknown>) => Promise<void>;

/** One row of the review, shaped by its group. */
export function ImportRow({ item, onPatch }: { item: ImportItemView; onPatch: Patch }) {
  const [busy, setBusy] = useState(false);
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    await onPatch(body);
    setBusy(false);
  };

  switch (item.group) {
    case "add":
    case "update":
      return (
        <li className={ROW}>
          <label className="k-check items-start pt-2">
            <input
              type="checkbox"
              checked={item.checked}
              disabled={busy}
              onChange={(event) => void patch({ checked: event.target.checked })}
            />
            <span className="k-visually-hidden">
              Import {item.show?.title ?? item.title ?? item.said}
            </span>
          </label>
          <Show item={item} />
          <div className="flex flex-col items-end gap-2">
            {/* Teal: a proposed write, as in Chat. */}
            <span className="k-caps text-right text-signal">{rowAction(item)}</span>
            <Repick item={item} onPatch={patch} />
          </div>
        </li>
      );

    case "disagree": {
      const diff = disagreement(item);
      return (
        <li className={`${ROW} flex-wrap`}>
          <span className="k-tag k-tag--word mt-2">?</span>
          <Show item={item} />
          <div className="flex w-full flex-col gap-2">
            {diff ? (
              <>
                <p className="k-diff">
                  <span>MAL</span>
                  <b>{diff.mal}</b>
                  <span className="k-sep">·</span>
                  <span>your notes</span>
                  <b>{diff.notes}</b>
                </p>
                <div className="k-chips">
                  {(["keep_mal", "use_notes"] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="k-chip"
                      disabled={busy}
                      aria-pressed={item.resolution === choice}
                      onClick={() => void patch({ resolution: choice })}
                    >
                      {choice === "keep_mal" ? "Keep MAL" : "Use my notes"}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="k-field__hint text-warn">{item.note} Nothing will change.</p>
            )}
            <div>
              <Repick item={item} onPatch={patch} />
            </div>
          </div>
        </li>
      );
    }

    case "which_one":
      return (
        <li className={`${ROW} flex-col`}>
          <div className="flex items-center gap-4">
            <span className="k-tag k-tag--word">?</span>
            <Said item={item} />
          </div>
          <div className="w-full">
            <ChoiceList
              shows={item.candidates}
              onChoose={busy ? undefined : (show) => void patch({ animeId: show.animeId })}
            />
          </div>
        </li>
      );

    case "up_to_date":
      return (
        <li className={ROW}>
          <Show item={item} />
          {item.malState && (
            <span className="k-meter__label text-right">
              {STATUS_LABELS[item.malState.status]} · ep <b>{item.malState.episodesWatched}</b>
              {item.malState.score ? ` · ${String(item.malState.score)}/10` : ""}
            </span>
          )}
        </li>
      );

    case "not_found":
      return (
        <li className={`${ROW} flex-col gap-0`}>
          <Said item={item} />
          <p className="k-field__hint">
            {item.note ?? "No show by that name on your list or on AniList."}
          </p>
        </li>
      );

    case "not_a_show":
      return <li className={`${ROW} text-ink-faint`}>{item.line}</li>;
  }
}
