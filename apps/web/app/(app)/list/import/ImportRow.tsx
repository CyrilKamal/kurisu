"use client";

import type { ImportItemView } from "@kurisu/shared";
import { useState } from "react";

import { STATUS_LABELS } from "@/lib/format";
import { disagreement, rowAction } from "@/lib/importView";

import { Cover, ShowCard } from "../../chat/ShowCard";

const ROW =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900";

function Said({ item }: { item: ImportItemView }) {
  return (
    <p className="text-xs text-zinc-500">
      Your notes: <q className="italic">{item.said}</q>
    </p>
  );
}

/** The show a row is about: cover, title, and where it is on the list. */
function Show({ item }: { item: ImportItemView }) {
  const show = item.show;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Cover url={show?.pictureUrl ?? null} />
      <div className="min-w-0">
        <p className="line-clamp-2 font-medium leading-snug">{show?.title ?? item.title}</p>
        <Said item={item} />
      </div>
    </div>
  );
}

/** "Change" for a row that was a "which one?": takes the pick back. */
function Repick({ item, onPatch }: { item: ImportItemView; onPatch: Patch }) {
  if (item.candidates.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => void onPatch({ animeId: null })}
      className="text-xs text-zinc-600 underline dark:text-zinc-400"
    >
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
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={item.checked}
              disabled={busy}
              onChange={(event) => void patch({ checked: event.target.checked })}
              className="mt-1 size-4 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <Show item={item} />
              <p className="mt-1 font-medium text-blue-800 dark:text-blue-300">{rowAction(item)}</p>
            </div>
          </label>
          <Repick item={item} onPatch={patch} />
        </li>
      );

    case "disagree": {
      const diff = disagreement(item);
      return (
        <li className={ROW}>
          <Show item={item} />
          {diff ? (
            <>
              <p className="mt-1 text-xs">
                MAL: <span className="font-medium">{diff.mal}</span> · Your notes:{" "}
                <span className="font-medium">{diff.notes}</span>
              </p>
              <div className="mt-2 inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
                {(["keep_mal", "use_notes"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    disabled={busy}
                    aria-pressed={item.resolution === choice}
                    onClick={() => void patch({ resolution: choice })}
                    className={`h-8 rounded-md px-3 text-xs font-medium ${
                      item.resolution === choice
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {choice === "keep_mal" ? "Keep MAL" : "Use my notes"}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              {item.note} Nothing will change.
            </p>
          )}
          <div>
            <Repick item={item} onPatch={patch} />
          </div>
        </li>
      );
    }

    case "which_one":
      return (
        <li className={ROW}>
          <Said item={item} />
          <div className="mt-2 flex flex-col gap-2">
            {item.candidates.map((show) => (
              <ShowCard
                key={show.animeId}
                show={show}
                onChoose={() => void patch({ animeId: show.animeId })}
              />
            ))}
          </div>
        </li>
      );

    case "up_to_date":
      return (
        <li className={ROW}>
          <Show item={item} />
          {item.malState && (
            <p className="mt-1 text-xs text-zinc-500">
              Already {STATUS_LABELS[item.malState.status]}, ep{" "}
              {String(item.malState.episodesWatched)}
              {item.malState.score ? `, ${String(item.malState.score)}/10` : ""}
            </p>
          )}
        </li>
      );

    case "not_found":
      return (
        <li className={ROW}>
          <p>
            <q className="italic">{item.said}</q>
          </p>
          <p className="text-xs text-zinc-500">
            {item.note ?? "No show by that name on your list or on AniList."}
          </p>
        </li>
      );

    case "not_a_show":
      return <li className={`${ROW} text-zinc-500`}>{item.line}</li>;
  }
}
