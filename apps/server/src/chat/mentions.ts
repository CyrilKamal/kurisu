import { inArray } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime } from "../db/schema.js";

/** Cards per reply. */
export const MAX_SHOW_CARDS = 5;
/** Names shorter than this are too easily ordinary words or initials ("K", "86"). */
const MIN_NAME_CHARS = 4;

export interface NamedCandidate {
  animeId: number;
  /** Title, English and Japanese titles, synonyms. */
  names: string[];
}

interface Match {
  animeId: number;
  start: number;
  end: number;
}

/** Words, keeping their case: letters and digits, split on everything else. */
function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The shows a reply names, in the order it first names them. A name counts only as whole
 * words. When two names overlap ("Frieren" inside "Frieren Season 2"), the longer wins, so naming
 * one season doesn't also name another. A one-word name must keep its capital ("Another" the
 * show, not "another season").
 */
export function namedShows(
  reply: string,
  candidates: NamedCandidate[],
  limit = MAX_SHOW_CARDS,
): number[] {
  const said = words(reply);
  const lower = said.map((w) => w.toLowerCase());
  const matches: Match[] = [];
  for (const { animeId, names } of candidates) {
    for (const name of new Set(names)) {
      const parts = words(name);
      if (parts.join("").length < MIN_NAME_CHARS) continue;
      const wanted = parts.map((w) => w.toLowerCase());
      for (let start = 0; start + wanted.length <= said.length; start++) {
        const same = wanted.every((w, i) => lower[start + i] === w);
        if (!same) continue;
        if (parts.length === 1 && said[start] !== parts[0]) continue;
        matches.push({ animeId, start, end: start + wanted.length });
      }
    }
  }

  // Longest first; a match that overlaps a longer one of another show is dropped.
  matches.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Match[] = [];
  for (const m of matches) {
    const overlaps = kept.some(
      (k) => k.animeId !== m.animeId && m.start < k.end && k.start < m.end,
    );
    if (!overlaps) kept.push(m);
  }

  const firstAt = new Map<number, number>();
  for (const m of kept)
    firstAt.set(m.animeId, Math.min(firstAt.get(m.animeId) ?? m.start, m.start));
  return [...firstAt.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/** namedShows over these anime ids, with their names from the mirror. */
export async function mentionedShows(db: Db, reply: string, animeIds: number[]): Promise<number[]> {
  if (animeIds.length === 0 || reply.length === 0) return [];
  const rows = await db
    .select({
      animeId: anime.malId,
      title: anime.title,
      titleEn: anime.titleEn,
      titleJa: anime.titleJa,
      synonyms: anime.synonyms,
    })
    .from(anime)
    .where(inArray(anime.malId, [...new Set(animeIds)]));
  return namedShows(
    reply,
    rows.map((r) => ({
      animeId: r.animeId,
      names: [r.title, r.titleEn, r.titleJa, ...r.synonyms].filter(
        (n): n is string => typeof n === "string" && n.length > 0,
      ),
    })),
  );
}
