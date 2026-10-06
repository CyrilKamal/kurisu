import type { PickView } from "@kurisu/shared";

import { STATUS_LABELS } from "@/lib/format";

import { Cover } from "./ShowCard";

/** A recommended show: cover, where you are in it, how long it takes, and why it fits. */
export function PickCard({ pick, rank }: { pick: PickView; rank: number }) {
  const left =
    pick.numEpisodes === null ? null : Math.max(0, pick.numEpisodes - pick.episodesWatched);
  const details = [
    pick.status === "plan_to_watch"
      ? STATUS_LABELS.plan_to_watch
      : `${STATUS_LABELS[pick.status]} · ep ${String(pick.episodesWatched)}${
          pick.numEpisodes === null ? "" : ` of ${String(pick.numEpisodes)}`
        }`,
    left !== null && pick.episodeMinutes !== null
      ? `${String(left)} ep${left === 1 ? "" : "s"} × ${String(pick.episodeMinutes)} min`
      : pick.episodeMinutes !== null
        ? `${String(pick.episodeMinutes)} min eps`
        : null,
  ].filter((part) => part !== null);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <Cover url={pick.pictureUrl} />
      <div className="min-w-0">
        <a
          href={`https://myanimelist.net/anime/${String(pick.animeId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          <span className="text-zinc-500">{rank}. </span>
          {pick.title}
        </a>
        <p className="text-xs text-zinc-500">{details.join(" · ")}</p>
        <p className="mt-1">{pick.why}</p>
      </div>
    </div>
  );
}
