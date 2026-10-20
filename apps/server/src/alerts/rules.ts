import type { WatchOn } from "../brief/services.js";
import type { AiringRow } from "../anilist/cache.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How far back a run looks for episodes that aired: enough to catch up after the server was
 * down for a while, not so far that a push arrives long after the news.
 */
export const ALERT_LOOKBACK_MS = 6 * HOUR_MS;

/** The window a run looks at: the last few hours, and nothing from before alerts were on. */
export function alertWindow(now: Date, since: Date): { from: Date; to: Date } {
  return { from: new Date(Math.max(now.getTime() - ALERT_LOOKBACK_MS, since.getTime())), to: now };
}

/**
 * Whether AniList, refetched after the episode's time, says the episode is out: its next episode
 * has moved past it, or the show finished with at least that many episodes. A delayed episode is
 * still AniList's next one, so it isn't sent; nor is anything when AniList's row is from before
 * the episode was due, or AniList doesn't know the show.
 */
export function confirmedAired(
  row: Pick<AiringRow, "anilistId" | "status" | "episodes" | "nextEpisode" | "fetchedAt"> | null,
  episode: number,
  airingAt: Date,
): boolean {
  if (row?.anilistId == null) return false;
  if (row.fetchedAt.getTime() < airingAt.getTime()) return false;
  if (row.nextEpisode !== null) return row.nextEpisode > episode;
  return row.status === "FINISHED" && (row.episodes === null || row.episodes >= episode);
}

/** "Episode 8", or "Episodes 8–10" when several came out at once. */
export function episodesLabel(episodes: readonly number[]): string {
  const sorted = [...episodes].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? `Episode ${String(first)}` : `Episodes ${String(first)}–${String(last)}`;
}

/** "Out now on Crunchyroll", "Out now on Crunchyroll and Netflix", or "Out now". */
export function outNowLine(watch: readonly WatchOn[]): string {
  const names = watch.map((w) => w.service);
  if (names.length === 0) return "Out now";
  if (names.length === 1) return `Out now on ${names[0] ?? ""}`;
  return `Out now on ${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}
