import type { FastifyBaseLogger } from "fastify";

import { seasonKey } from "../recommend/season.js";
import { ARCHIVE_MAX_AGE_MS, refreshSeasonChart, type BrowseRefreshDeps } from "./refresh.js";
import type { Season } from "./seasons.js";

/** Seasons waiting to be fetched, beyond the one being fetched; more are turned away. */
export const ARCHIVE_MAX_WAITING = 3;
/** A season AniList failed on isn't asked for again for a while. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

export interface SeasonArchive {
  /**
   * Asks for an earlier season's chart, fetched in the background when it's missing or a month
   * old. Returns at once; asking again while it's on its way changes nothing.
   */
  request(season: Season): void;
  /** Resolves once nothing is being fetched (for tests and shutdown). */
  settled(): Promise<void>;
}

/**
 * Charts of seasons before last, fetched from AniList when someone asks for one, never while
 * they wait: one at a time server-wide, at most a few waiting, and not again soon after AniList
 * failed on one. A fetched season stays in `season_charts`.
 */
export function createSeasonArchive(
  deps: BrowseRefreshDeps & { log: FastifyBaseLogger },
  options: {
    maxWaiting?: number;
    /** Fetches one season's chart; tests pass a stand-in. */
    fetchChart?: (season: Season) => Promise<unknown>;
  } = {},
): SeasonArchive {
  const maxWaiting = options.maxWaiting ?? ARCHIVE_MAX_WAITING;
  const fetchChart =
    options.fetchChart ??
    ((season: Season) => refreshSeasonChart(deps, season, { maxAgeMs: ARCHIVE_MAX_AGE_MS }));
  const waiting: Season[] = [];
  const failedAt = new Map<string, number>();
  let current: { key: string; done: Promise<void> } | null = null;

  function pump(): void {
    if (current) return;
    const season = waiting.shift();
    if (!season) return;
    const key = seasonKey(season);
    const done = fetchChart(season)
      .then(() => {
        failedAt.delete(key);
      })
      .catch((err: unknown) => {
        failedAt.set(key, Date.now());
        deps.log.warn(
          { err: { name: (err as Error).name }, season: key },
          "could not fetch a season's chart",
        );
      })
      .finally(() => {
        current = null;
        pump();
      });
    current = { key, done };
  }

  return {
    request(season) {
      const key = seasonKey(season);
      if (current?.key === key || waiting.some((s) => seasonKey(s) === key)) return;
      const failed = failedAt.get(key);
      if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return;
      if (waiting.length >= maxWaiting) return;
      waiting.push(season);
      pump();
    },

    async settled() {
      while (current) await current.done;
    },
  };
}
