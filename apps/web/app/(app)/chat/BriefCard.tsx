import type { BriefCardView, ShowCard } from "@kurisu/shared";

import { Icon } from "@/components/Icon";
import { Poster, progressOf } from "@/components/Poster";
import { ShowLink } from "@/components/ShowLink";
import { durationLabel } from "@/lib/format";
import { dateTime } from "@/lib/runMeta";
import { useIsBrowser } from "@/lib/useIsBrowser";

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? "" : "s"}`;
}

/** "on Crunchyroll", "on Crunchyroll or HIDIVE"; nothing when no service of theirs lists it. */
function Where({ services }: { services: string[] }) {
  if (services.length === 0) return null;
  return (
    <>
      on{" "}
      {services.map((service, i) => (
        <span key={service}>
          {i > 0 && " or "}
          <b>{service}</b>
        </span>
      ))}
    </>
  );
}

/** The Sunday recap in one line: "23 eps · 9h 12m · finished Bocchi · goal 18/40". */
function recapLine(recap: NonNullable<BriefCardView["recap"]>): string {
  return [
    plural(recap.episodes, "ep"),
    recap.minutes > 0 ? durationLabel(recap.minutes) : null,
    recap.finished.length > 0 ? `finished ${recap.finished.join(", ")}` : null,
    recap.goal === null
      ? `${String(recap.completed)} completed in ${String(recap.year)}`
      : `goal ${String(recap.completed)}/${String(recap.goal)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * The morning brief as a log artifact (the design system's BriefCard): a mono header, the
 * summary, one row per new episode, the shows that started airing, the Sunday recap, and the
 * "watched it" reply. Services are named only when AniList lists the show on one of theirs.
 */
export function BriefCard({
  brief,
  shows,
  sentAt,
  onReply,
  onAdd,
}: {
  brief: BriefCardView;
  /** The message's show cards: the premieres' current state on the list. */
  shows: ShowCard[];
  sentAt: string;
  /** Set while the brief can still be answered. */
  onReply?: ((text: string) => void) | undefined;
  onAdd?: ((show: ShowCard) => void) | undefined;
}) {
  const inBrowser = useIsBrowser();
  const episodes = brief.items.reduce((sum, item) => sum + item.episodes.length, 0);
  const counts = [
    episodes > 0 ? `${plural(episodes, "ep")} · ${plural(brief.items.length, "show")}` : null,
    brief.alerts.length > 0 ? `${String(brief.alerts.length)} started airing` : null,
  ].filter((part) => part !== null);
  const showOf = new Map(shows.map((show) => [show.animeId, show]));

  return (
    <div className="k-panel">
      <div className="k-brief__head">
        <span className="k-caps">Brief</span>
        <span className="k-mono">{inBrowser ? dateTime(sentAt) : (brief.localDate ?? "")}</span>
        {counts.length > 0 && <span className="k-mono">{counts.join(" · ")}</span>}
      </div>
      {brief.summary && <p className="k-brief__summary">{brief.summary}</p>}

      {brief.items.length > 0 && (
        <ul className="k-brief__items">
          {brief.items.map((item) => {
            const first = item.episodes[0] ?? 0;
            const last = item.episodes.at(-1) ?? first;
            const behind = item.episodesWatched < first - 1;
            return (
              <li key={item.animeId} className="k-brief__item">
                <Poster
                  url={item.pictureUrl}
                  title={item.title}
                  progress={progressOf(item.episodesWatched, item.numEpisodes)}
                />
                <div className="min-w-0">
                  <p className="k-brief__title">
                    <ShowLink animeId={item.animeId}>{item.title}</ShowLink>
                  </p>
                  <p className="k-brief__where">
                    <Where services={item.services} />
                    {item.services.length === 0 && " "}
                  </p>
                </div>
                <span className="k-brief__ep">
                  EP {item.episodes.length > 1 ? `${String(first)}–${String(last)}` : last}
                  {behind ? (
                    <small>you&apos;re on {item.episodesWatched}</small>
                  ) : item.premiere ? (
                    <small>premiere</small>
                  ) : item.finale ? (
                    <small>finale</small>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {brief.alerts.length > 0 && (
        <>
          <p className="k-caps border-t border-line px-4 pb-2 pt-4">Started airing</p>
          <ul className="k-brief__items">
            {brief.alerts.map((alert) => {
              const show = showOf.get(alert.animeId);
              const title = show?.title ?? "";
              return (
                <li key={alert.animeId} className="k-brief__item">
                  <Poster url={show?.pictureUrl ?? null} title={title} />
                  <div className="min-w-0">
                    <p className="k-brief__title">
                      <ShowLink animeId={alert.animeId}>{title}</ShowLink>
                    </p>
                    <p className="k-brief__where">
                      {alert.kind === "sequel_started" && alert.after
                        ? `You finished ${alert.after}`
                        : "On your Plan to Watch"}
                      {alert.services.length > 0 && (
                        <>
                          {" · "}
                          <Where services={alert.services} />
                        </>
                      )}
                    </p>
                  </div>
                  {show?.status === null && onAdd ? (
                    <button
                      type="button"
                      className="k-btn k-btn--sm"
                      onClick={() => {
                        onAdd(show);
                      }}
                    >
                      <Icon name="plus" />
                      Add
                    </button>
                  ) : (
                    <span className="k-brief__ep">EP 1</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {brief.recap && (
        <div className="border-t border-line px-4 py-2">
          <p className="k-caps">This week</p>
          <p className="k-brief__where">{recapLine(brief.recap)}</p>
        </div>
      )}

      {brief.items.length > 0 && (
        <div className="k-brief__foot">
          <p className="k-brief__hint">
            Reply &quot;watched it&quot; once you&apos;ve caught up on all of these.
          </p>
          {onReply && (
            <button
              type="button"
              className="k-chip k-chip--cmd"
              onClick={() => {
                onReply("watched it");
              }}
            >
              watched it
            </button>
          )}
        </div>
      )}
    </div>
  );
}
