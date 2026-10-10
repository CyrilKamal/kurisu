import { eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";
import type { AniListClient } from "./client.js";

/** How long a show's page waits for AniList before it opens without the synopsis. */
export const SYNOPSIS_WAIT_MS = 4_000;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/**
 * AniList's description as plain text: line breaks kept, tags and spoilers (AniList's `~!…!~`)
 * removed, entities decoded, and runs of blank lines folded into one.
 */
export function plainSynopsis(raw: string): string {
  const text = raw
    .replace(/~![\s\S]*?!~/g, "")
    // AniList follows a <br> with a newline of its own: one break, not two.
    .replace(/<br\s*\/?>\r?\n?/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? match;
    });
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SynopsisLoader {
  /**
   * The show's synopsis: the stored one, or AniList's fetched now and stored. Null when AniList
   * has none, or doesn't answer within `waitMs`; then the fetch carries on in the background,
   * so the next view has it.
   */
  get(malId: number, waitMs?: number): Promise<string | null>;
  /** Waits for fetches still running (shutdown). */
  settle(): Promise<void>;
}

/** Fetches each show's synopsis once, the first time someone opens its page. */
export function createSynopsisLoader(deps: {
  db: Db;
  anilist: AniListClient;
  onError: (err: unknown) => void;
}): SynopsisLoader {
  const { db, anilist } = deps;
  // One fetch per show at a time, however many people open it.
  const running = new Map<number, Promise<string | null>>();

  const fetchAndStore = (malId: number): Promise<string | null> => {
    const existing = running.get(malId);
    if (existing) return existing;
    const task = (async () => {
      const found = await anilist.descriptions([malId]);
      // AniList doesn't know the show: try again another time.
      if (!found.has(malId)) return null;
      const raw = found.get(malId) ?? null;
      const synopsis = raw === null ? "" : plainSynopsis(raw);
      await db.update(anime).set({ synopsis }).where(eq(anime.malId, malId));
      return synopsis || null;
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
      if (!row) return null;
      if (row.synopsis !== null) return row.synopsis || null;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, waitMs);
      });
      try {
        return await Promise.race([fetchAndStore(malId), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    async settle() {
      await Promise.allSettled(running.values());
    },
  };
}
