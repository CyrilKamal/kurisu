import type { ListChange, WriteKind } from "@kurisu/shared";

import { Diff } from "@/components/Diff";
import { Poster, progressOf } from "@/components/Poster";

interface DemoWrite {
  title: string;
  /** The show's cover on MyAnimeList's image server, as the app shows it. */
  pictureUrl: string | null;
  kind: WriteKind;
  before: ListChange;
  after: ListChange;
  numEpisodes: number;
}

/**
 * A static example of Chat, drawn with the log's own classes: one message, kurisu's reply, the
 * write it made to MAL (dashed teal, with Undo), and the run behind it. Nothing here is live.
 */
export function DemoLog({
  message,
  reply,
  writes,
  run,
}: {
  message: string;
  reply: string;
  writes: DemoWrite[];
  run: string[];
}) {
  return (
    <figure className="k-panel m-0">
      <figcaption className="k-visually-hidden">An example of Chat</figcaption>
      <ol className="k-log">
        <li className="k-log__entry k-log__entry--user max-sm:grid-cols-1 max-sm:pl-4">
          <span className="k-log__time max-sm:pl-0 max-sm:leading-4">08:12</span>
          <div className="k-log__body">
            <p className="k-log__text">{message}</p>
          </div>
        </li>
        <li className="k-log__entry max-sm:grid-cols-1 max-sm:pl-4">
          <span className="k-log__time max-sm:pl-0 max-sm:leading-4">08:12</span>
          <div className="k-log__body">
            <p className="k-log__text">{reply}</p>
            <div className="k-write">
              <div className="k-write__head">
                <span className="k-write__level">MAL write</span>
                <span className="k-write__id">p_7f3a · p_8c21 · committed</span>
              </div>
              <ul className="k-write__rows">
                {writes.map((write) => (
                  // The app's writes use the small poster; here the cover is the point, so it's
                  // the medium one (as in recommendations).
                  <li
                    key={write.title}
                    className="k-write__row grid-cols-[var(--poster-md)_minmax(0,1fr)_auto]"
                  >
                    <Poster
                      url={write.pictureUrl}
                      title={write.title}
                      size="md"
                      eager
                      progress={progressOf(write.after.episodesWatched ?? 0, write.numEpisodes)}
                    />
                    <div className="min-w-0">
                      <p className="k-write__title">{write.title}</p>
                      <Diff
                        kind={write.kind}
                        before={write.before}
                        after={write.after}
                        numEpisodes={write.numEpisodes}
                      />
                    </div>
                    <span className="k-link" aria-hidden="true">
                      Undo
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="k-run">
              {run.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </p>
          </div>
        </li>
      </ol>
    </figure>
  );
}
