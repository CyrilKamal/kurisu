import type { PickView } from "@kurisu/shared";
import { Fragment } from "react";
import Link from "next/link";

import { Icon } from "@/components/Icon";
import { Poster, progressOf } from "@/components/Poster";
import { StatusBadge } from "@/components/StatusBadge";
import { showHref } from "@/lib/airing";
import { durationLabel } from "@/lib/format";

/** "ep 3 of 12" for a show under way, "12 eps" otherwise. */
function episodesText(pick: PickView): string | null {
  if (pick.episodesWatched > 0) {
    return `ep ${String(pick.episodesWatched)}${
      pick.numEpisodes === null ? "" : ` of ${String(pick.numEpisodes)}`
    }`;
  }
  if (pick.numEpisodes === null) return null;
  return pick.numEpisodes === 1 ? "1 ep" : `${String(pick.numEpisodes)} eps`;
}

/**
 * The recommender's picks in one hairline panel (the design system's PickCard): mono rank,
 * poster, where it is on the list (or new to you), what it takes to watch, the recommender's
 * line as it wrote it, and where it streams on the user's services. A new show can be added,
 * which goes through Chat and comes back as a held write.
 */
export function Picks({
  picks,
  onAdd,
}: {
  picks: PickView[];
  /** Set while a new show can still be added. */
  onAdd?: ((pick: PickView) => void) | undefined;
}) {
  return (
    <ol className="k-picks k-panel">
      {picks.map((pick, i) => {
        const left =
          pick.numEpisodes === null ? null : Math.max(0, pick.numEpisodes - pick.episodesWatched);
        const episodes = episodesText(pick);
        return (
          <li key={pick.animeId} className="k-pick">
            <span className="k-pick__rank">{String(i + 1).padStart(2, "0")}</span>
            <Poster
              url={pick.pictureUrl}
              title={pick.title}
              size="md"
              progress={progressOf(pick.episodesWatched, pick.numEpisodes)}
            />
            <div className="k-pick__body">
              <p className="k-pick__title">
                <Link href={showHref(pick.animeId)}>{pick.title}</Link>
              </p>
              <p className="k-pick__meta">
                {pick.status === null ? (
                  <span className="k-tag k-tag--word k-tag--new">New to you</span>
                ) : (
                  <StatusBadge status={pick.status} plain />
                )}
                {episodes && <span className="k-num">{episodes}</span>}
              </p>
              {pick.episodeMinutes !== null && (
                <div className="k-chips">
                  <span className="k-tag">
                    <Icon name="clock" />
                    {pick.episodeMinutes}m/ep
                  </span>
                  {left !== null && left > 1 && (
                    <span className="k-tag">
                      {left} eps = {durationLabel(left * pick.episodeMinutes)}
                    </span>
                  )}
                </div>
              )}
              <p className="k-pick__why">{pick.why}</p>
              {pick.watchOn.length > 0 && (
                <p className="k-pick__meta">
                  <span>
                    on{" "}
                    {pick.watchOn.map((w, j) => (
                      <Fragment key={w.service}>
                        {j > 0 && (j === pick.watchOn.length - 1 ? " or " : ", ")}
                        <b className="font-semibold text-ink">
                          {w.url ? (
                            <a
                              href={w.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline-offset-2 hover:underline"
                            >
                              {w.service}
                            </a>
                          ) : (
                            w.service
                          )}
                        </b>
                      </Fragment>
                    ))}
                  </span>
                </p>
              )}
              {pick.status === null && onAdd && (
                <div>
                  <button
                    type="button"
                    className="k-btn k-btn--sm"
                    onClick={() => {
                      onAdd(pick);
                    }}
                  >
                    <Icon name="plus" />
                    Add to Plan to Watch
                  </button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
