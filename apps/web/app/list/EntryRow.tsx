import type { ListEntry } from "@kurisu/shared";
import Image from "next/image";

import { mediaTypeLabel, progressLabel } from "@/lib/format";

export function EntryRow({ entry }: { entry: ListEntry }) {
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
        {entry.isRewatching && (
          <span className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            Rewatching
          </span>
        )}
      </div>

      {entry.score > 0 && (
        <span
          className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-300"
          aria-label={`Score ${String(entry.score)} out of 10`}
        >
          ★ {entry.score}
        </span>
      )}
    </li>
  );
}
