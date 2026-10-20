import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, showExtras } from "../db/schema.js";
import { rememberShows } from "./catalog.js";
import type { AniListClient, LinkedShow, ShowPageExtras } from "./client.js";
import { plainSynopsis, SYNOPSIS_WAIT_MS } from "./synopsis.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A show's extras (rankings, episode links) change slowly: refetched once a week old. */
export const EXTRAS_MAX_AGE_MS = 7 * DAY_MS;

/** A stored synopsis as the page shows it: "" (AniList has none) and no fetch yet are both null. */
function shown(synopsis: string | null | undefined): string | null {
  return synopsis === undefined || synopsis === "" ? null : synopsis;
}

export interface ShowPageDetails {
  /** AniList's description as plain text; null when there's none (yet). */
  synopsis: string | null;
  extras: ShowPageExtras | null;
}

export interface ShowPageLoader {
  /**
   * The show's synopsis and extras: the stored ones, or AniList's fetched now and stored. A
   * show not fetched yet waits up to `waitMs`, then opens without them while the fetch carries
   * on in the background. Extras over a week old are refetched in the background.
   */
  get(malId: number, waitMs?: number): Promise<ShowPageDetails>;
  /** Waits for fetches still running (shutdown). */
  settle(): Promise<void>;
}

/**
 * Only what the app can show: no adult titles, no shows MAL doesn't know, no music videos
 * among related shows, and https links only.
 */
export function keepShowable(extras: ShowPageExtras): ShowPageExtras {
  const showable = (linked: LinkedShow) =>
    !linked.isAdult && linked.show.malId !== null && linked.show.format !== "MUSIC";
  return {
    ...extras,
    relations: extras.relations.filter(showable),
    recommendations: extras.recommendations.filter(showable),
    episodes: extras.episodes.filter((e) => e.url.startsWith("https://")),
  };
}

/**
 * Fetches each show's page (synopsis and extras) the first time anyone opens it, in one
 * AniList request, and again in the background once its extras are a week old. Related and
 * recommended shows get `anime` rows, so their pages open too.
 */
export function createShowPageLoader(deps: {
  db: Db;
  anilist: AniListClient;
  onError: (err: unknown) => void;
}): ShowPageLoader {
  const { db, anilist } = deps;
  // One fetch per show at a time, however many people open it.
  const running = new Map<number, Promise<ShowPageDetails | null>>();

  const fetchAndStore = (malId: number): Promise<ShowPageDetails | null> => {
    const existing = running.get(malId);
    if (existing) return existing;
    const task = (async () => {
      const page = (await anilist.showPages([malId])).get(malId);
      // AniList doesn't know the show: try again another time.
      if (!page) return null;
      const extras = keepShowable(page.extras);
      await rememberShows(db, [
        ...extras.relations.map((r) => r.show),
        ...extras.recommendations.map((r) => r.show),
      ]);
      const now = new Date();
      // A synopsis is fetched once and kept ("" when AniList has none); syncs never touch it.
      await db
        .update(anime)
        .set({ synopsis: page.description === null ? "" : plainSynopsis(page.description) })
        .where(and(eq(anime.malId, malId), isNull(anime.synopsis)));
      await db
        .insert(showExtras)
        .values({ malId, data: extras, fetchedAt: now })
        .onConflictDoUpdate({ target: showExtras.malId, set: { data: extras, fetchedAt: now } });
      const [row] = await db
        .select({ synopsis: anime.synopsis })
        .from(anime)
        .where(eq(anime.malId, malId));
      return { synopsis: shown(row?.synopsis), extras };
    })()
      .catch((err: unknown) => {
        deps.onError(err);
        return null;
      })
      .finally(() => running.delete(malId));
    running.set(malId, task);
    return task;
  };

  return {
    async get(malId, waitMs = SYNOPSIS_WAIT_MS) {
      const [row] = await db
        .select({ synopsis: anime.synopsis })
        .from(anime)
        .where(eq(anime.malId, malId))
        .limit(1);
      if (!row) return { synopsis: null, extras: null };
      const [stored] = await db.select().from(showExtras).where(eq(showExtras.malId, malId));
      if (stored && row.synopsis !== null) {
        if (Date.now() - stored.fetchedAt.getTime() > EXTRAS_MAX_AGE_MS) void fetchAndStore(malId);
        return { synopsis: shown(row.synopsis), extras: stored.data };
      }

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, waitMs);
      });
      try {
        const fetched = await Promise.race([fetchAndStore(malId), timeout]);
        return fetched ?? { synopsis: shown(row.synopsis), extras: stored?.data ?? null };
      } finally {
        clearTimeout(timer);
      }
    },
    async settle() {
      await Promise.allSettled(running.values());
    },
  };
}
