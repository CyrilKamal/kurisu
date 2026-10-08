import type { ListEntry } from "@kurisu/shared";
import Image from "next/image";

import { mediaTypeLabel, progressLabel } from "@/lib/format";

/**
 * One show on the List screen. With handlers, it gets an Edit button and, for a show under way,
 * "+1 ep" for the most common edit.
 */
export function EntryRow({
  entry,
  onEdit,
  onNextEpisode,
  busy = false,
}: {
  entry: ListEntry;
  onEdit?: () => void;
  onNextEpisode?: () => void;
  busy?: boolean;
}) {
  const details = [
    mediaTypeLabel(entry.mediaType),
    progressLabel(entry),
    entry.airingStatus === "currently_airing" ? "Airing" : null,
  ].filter((part) => part !== null);

  return (
    <li className="flex items-start gap-3 py-3">
      {entry.pictureUrl ? (
        <Image
          src={entry.pictureUrl}
          alt=""
          width={48}
          height={68}
          className="h-[68px] w-12 shrink-0 rounded bg-zinc-200 object-cover dark:bg-zinc-800"
        />
      ) : (
        <div aria-hidden className="h-[68px] w-12 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
      )}

      <div className="min-w-0 flex-1">
        <a
          href={`https://myanimelist.net/anime/${String(entry.animeId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          {entry.title}
        </a>
        <p className="mt-1 text-sm text-zinc-500">{details.join(" · ")}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {entry.isRewatching && (
            <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              Rewatching
            </span>
          )}
          {onNextEpisode && (
            <button
              type="button"
              onClick={onNextEpisode}
              disabled={busy}
              aria-label={`Watched episode ${String(entry.episodesWatched + 1)} of ${entry.title}`}
              className="h-7 rounded-full border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {busy ? "Saving…" : "+1 ep"}
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {entry.score > 0 && (
          <span
            className="text-sm tabular-nums text-zinc-600 dark:text-zinc-300"
            aria-label={`Score ${String(entry.score)} out of 10`}
          >
            ★ {entry.score}
          </span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${entry.title}`}
            className="flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-4"
            >
              <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8 18.5l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}
