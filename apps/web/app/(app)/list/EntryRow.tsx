import type { ListEntry } from "@kurisu/shared";
import Link from "next/link";

import { AiringLine } from "@/components/AiringLine";
import { Icon } from "@/components/Icon";
import { Poster, progressOf } from "@/components/Poster";
import { ProgressMeter } from "@/components/ProgressMeter";
import { Score } from "@/components/Score";
import { showHref } from "@/lib/airing";
import { mediaTypeLabel } from "@/lib/format";

/** "TV · 24 min", "Movie · 110 min", "ONA". */
function kindAndLength(entry: ListEntry): string | null {
  const parts = [
    mediaTypeLabel(entry.mediaType),
    entry.episodeMinutes === null ? null : `${String(entry.episodeMinutes)} min`,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * One show on the List screen, dense (the design system's EntryRow): poster with its progress
 * edge, title and meta, then progress, score and the edit actions on the right. List editing
 * (Milestone 5) adds "+1 ep" and Edit, which the system's row predates.
 */
export function EntryRow({
  entry,
  onEdit,
  onNextEpisode,
  busy = false,
}: {
  entry: ListEntry;
  onEdit?: () => void;
  onNextEpisode?: (() => void) | undefined;
  busy?: boolean;
}) {
  const underway =
    entry.isRewatching || (entry.episodesWatched > 0 && entry.status !== "completed");
  const meta = kindAndLength(entry);

  return (
    <li className="k-row">
      {/* The title is the link for keyboards and screen readers; the poster is a bigger target. */}
      <Link href={showHref(entry.animeId)} className="block" tabIndex={-1} aria-hidden="true">
        <Poster
          url={entry.pictureUrl}
          title={entry.title}
          progress={underway ? progressOf(entry.episodesWatched, entry.numEpisodes) : null}
        />
      </Link>
      <div className="k-row__main">
        <Link className="k-row__title" href={showHref(entry.animeId)}>
          {entry.title}
        </Link>
        <p className="k-row__meta">
          {meta && <span>{meta}</span>}
          {entry.airing ? (
            <AiringLine
              airing={entry.airing}
              status={entry.status}
              episodesWatched={entry.episodesWatched}
            />
          ) : (
            entry.airingStatus === "currently_airing" && <span className="k-airing">airing</span>
          )}
          {entry.isRewatching && <span className="k-tag k-tag--word">Rewatching</span>}
        </p>
      </div>
      <div className="k-row__data">
        {entry.status !== "plan_to_watch" && (
          <ProgressMeter
            watched={entry.episodesWatched}
            total={entry.numEpisodes}
            bar={entry.status !== "completed" || entry.isRewatching}
            className="w-24 sm:w-40"
          />
        )}
        <div className="flex items-center gap-2">
          <Score score={entry.score} />
          {onNextEpisode && (
            <button
              type="button"
              className="k-btn k-btn--sm"
              onClick={onNextEpisode}
              disabled={busy}
              aria-busy={busy}
              aria-label={`Watched episode ${String(entry.episodesWatched + 1)} of ${entry.title}`}
            >
              {busy ? "Saving…" : "+1 ep"}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--icon k-btn--sm"
              onClick={onEdit}
              aria-label={`Edit ${entry.title}`}
            >
              <Icon name="rename" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
