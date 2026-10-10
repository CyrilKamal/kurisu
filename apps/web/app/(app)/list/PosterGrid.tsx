import type { ListEntry } from "@kurisu/shared";
import Link from "next/link";

import { Poster, progressOf } from "@/components/Poster";
import { showHref } from "@/lib/airing";

/**
 * The list as a wall of covers (the design system's PosterGrid), for finding a show by its
 * cover: each cell opens its page, with progress on the left and the score on the right.
 */
export function PosterGrid({ entries }: { entries: ListEntry[] }) {
  return (
    <ul className="k-grid pt-4">
      {entries.map((entry) => {
        const underway =
          entry.isRewatching || (entry.episodesWatched > 0 && entry.status !== "completed");
        return (
          <li key={entry.animeId} className="k-grid__item">
            <Link href={showHref(entry.animeId)} className="block text-ink no-underline">
              <Poster
                url={entry.pictureUrl}
                title={entry.title}
                size="fill"
                progress={underway ? progressOf(entry.episodesWatched, entry.numEpisodes) : null}
              />
              <p className="k-grid__cap">{entry.title}</p>
              <p className="k-grid__sub">
                <span>
                  {entry.episodesWatched}/{entry.numEpisodes ?? "?"}
                </span>
                <span>{entry.score > 0 ? entry.score : "–"}</span>
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
