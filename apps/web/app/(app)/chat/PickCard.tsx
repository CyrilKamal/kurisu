import type { PickView } from "@kurisu/shared";

import { STATUS_LABELS } from "@/lib/format";

import { Cover } from "./ShowCard";

/**
 * A recommended show: cover, where you are in it (or that it's new to you), how long it takes,
 * why it fits, and where it streams on your services. A new show has an Add button, which asks
 * Chat to add it (and Chat then asks you to confirm, as every add does).
 */
export function PickCard({
  pick,
  rank,
  onAdd,
}: {
  pick: PickView;
  rank: number;
  /** Set for a show that isn't on the list. */
  onAdd?: () => void;
}) {
  const left =
    pick.numEpisodes === null ? null : Math.max(0, pick.numEpisodes - pick.episodesWatched);
  const where =
    pick.status === null
      ? "New to you"
      : pick.status === "plan_to_watch"
        ? STATUS_LABELS.plan_to_watch
        : `${STATUS_LABELS[pick.status]} · ep ${String(pick.episodesWatched)}${
            pick.numEpisodes === null ? "" : ` of ${String(pick.numEpisodes)}`
          }`;
  const length =
    left !== null && pick.episodeMinutes !== null
      ? left === 1 && pick.numEpisodes === 1
        ? `${String(pick.episodeMinutes)} min`
        : `${String(left)} ep${left === 1 ? "" : "s"} × ${String(pick.episodeMinutes)} min`
      : pick.episodeMinutes !== null
        ? `${String(pick.episodeMinutes)} min eps`
        : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <Cover url={pick.pictureUrl} />
      <div className="min-w-0 flex-1">
        <a
          href={`https://myanimelist.net/anime/${String(pick.animeId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          <span className="text-zinc-500">{rank}. </span>
          {pick.title}
        </a>
        <p className="text-xs text-zinc-500">
          {pick.status === null ? (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">{where}</span>
          ) : (
            where
          )}
          {length ? ` · ${length}` : ""}
        </p>
        <p className="mt-1">{pick.why}</p>
        {pick.watchOn.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            On{" "}
            {pick.watchOn.map((w, i) => (
              <span key={w.service}>
                {i > 0 ? (i === pick.watchOn.length - 1 ? " or " : ", ") : ""}
                {w.url ? (
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
                  >
                    {w.service}
                  </a>
                ) : (
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{w.service}</span>
                )}
              </span>
            ))}
          </p>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 h-8 rounded-md border border-zinc-300 px-2.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Add to Plan to Watch
          </button>
        )}
      </div>
    </div>
  );
}
