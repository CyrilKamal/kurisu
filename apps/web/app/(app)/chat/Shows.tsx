import type { ShowCard } from "@kurisu/shared";

import { Icon } from "@/components/Icon";
import { Poster, progressOf } from "@/components/Poster";
import { showDetails } from "@/lib/format";

/**
 * When kurisu asks which show you meant (the design system's ChoiceList): numbered rows that
 * answer with the show's exact title. Only the latest question can still be answered.
 */
export function ChoiceList({
  shows,
  onChoose,
}: {
  shows: ShowCard[];
  onChoose?: ((show: ShowCard) => void) | undefined;
}) {
  return (
    <ul className="k-choices">
      {shows.map((show, i) => (
        <li key={show.animeId}>
          <button
            type="button"
            className="k-choice"
            aria-label={`Choose ${show.title}`}
            disabled={!onChoose}
            onClick={() => {
              onChoose?.(show);
            }}
          >
            <span className="k-kbd">{i + 1}</span>
            <Poster
              url={show.pictureUrl}
              title={show.title}
              progress={progressOf(show.episodesWatched, show.numEpisodes)}
            />
            <span className="min-w-0">
              <span className="k-row__title">{show.title}</span>
              <span className="k-row__meta">{showDetails(show)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Shows a reply names without asking, as rows: where each is on the list, and an Add button for
 * one that isn't there (which goes through Chat, so it comes back as a held write).
 */
export function ShowList({
  shows,
  onAdd,
}: {
  shows: ShowCard[];
  onAdd?: ((show: ShowCard) => void) | undefined;
}) {
  return (
    <ul className="k-rows k-panel">
      {shows.map((show) => (
        <li key={show.animeId} className="k-row">
          <Poster
            url={show.pictureUrl}
            title={show.title}
            progress={progressOf(show.episodesWatched, show.numEpisodes)}
          />
          <div className="k-row__main">
            <a
              className="k-row__title"
              href={`https://myanimelist.net/anime/${String(show.animeId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {show.title}
            </a>
            <p className="k-row__meta">{showDetails(show)}</p>
          </div>
          <div className="k-row__data">
            {show.status === null && onAdd && (
              <button
                type="button"
                className="k-btn k-btn--sm"
                onClick={() => {
                  onAdd(show);
                }}
              >
                <Icon name="plus" />
                Add to Plan to Watch
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
