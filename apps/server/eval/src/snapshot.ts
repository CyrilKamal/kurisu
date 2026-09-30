import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { MAL_LIST_STATUSES } from "../../src/mal/client.js";

export const SNAPSHOTS_DIR = fileURLToPath(new URL("../snapshots/", import.meta.url));

/**
 * One list entry as the eval sees it. Deliberately sanitized: no scores, dates, tags, comments
 * or usernames, only what's needed to resolve titles and judge progress updates.
 */
export const snapshotEntrySchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1),
    titleEn: z.string().nullable(),
    titleJa: z.string().nullable(),
    synonyms: z.array(z.string()),
    mediaType: z.string().nullable(),
    numEpisodes: z.number().int().positive().nullable(),
    status: z.enum(MAL_LIST_STATUSES),
    episodesWatched: z.number().int().nonnegative(),
    isRewatching: z.boolean(),
  })
  .strict();
export type SnapshotEntry = z.infer<typeof snapshotEntrySchema>;

export const snapshotSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string(),
    source: z.enum(["mal-mirror", "synthetic"]),
    exportedAt: z.iso.datetime(),
    entries: z.array(snapshotEntrySchema),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;

export function loadSnapshot(name: string, dir: string = SNAPSHOTS_DIR): Snapshot {
  const raw: unknown = JSON.parse(readFileSync(`${dir}${name}.json`, "utf8"));
  return snapshotSchema.parse(raw);
}

/** Case- and width-insensitive form used to compare titles. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export type Resolution =
  | { ok: true; entry: SnapshotEntry }
  | { ok: false; reason: "not_found"; suggestions: string[] }
  | { ok: false; reason: "ambiguous"; matches: SnapshotEntry[] };

/** Finds which snapshot entry a case means, by MAL id or by any of its titles. */
export class TitleIndex {
  private readonly byId = new Map<number, SnapshotEntry>();
  private readonly byTitle = new Map<string, SnapshotEntry[]>();

  constructor(private readonly snapshot: Snapshot) {
    for (const entry of snapshot.entries) {
      this.byId.set(entry.id, entry);
      const titles = [entry.title, entry.titleEn, entry.titleJa, ...entry.synonyms];
      const keys = new Set(titles.filter((t): t is string => !!t).map(normalizeTitle));
      for (const key of keys) {
        const list = this.byTitle.get(key) ?? [];
        list.push(entry);
        this.byTitle.set(key, list);
      }
    }
  }

  resolve(anime: string | number): Resolution {
    if (typeof anime === "number") {
      const entry = this.byId.get(anime);
      return entry ? { ok: true, entry } : { ok: false, reason: "not_found", suggestions: [] };
    }
    const matches = this.byTitle.get(normalizeTitle(anime)) ?? [];
    if (matches.length === 1 && matches[0]) return { ok: true, entry: matches[0] };
    if (matches.length > 1) return { ok: false, reason: "ambiguous", matches };
    return { ok: false, reason: "not_found", suggestions: this.suggest(anime) };
  }

  /** Up to three titles that contain the words of the query, to help fix typos. */
  private suggest(query: string): string[] {
    const words = normalizeTitle(query)
      .split(" ")
      .filter((w) => w.length > 2);
    if (words.length === 0) return [];
    return this.snapshot.entries
      .map((entry) => {
        const haystack = normalizeTitle(
          [entry.title, entry.titleEn ?? "", ...entry.synonyms].join(" "),
        );
        return { entry, hits: words.filter((w) => haystack.includes(w)).length };
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3)
      .map((s) => `${s.entry.title} (id ${String(s.entry.id)})`);
  }
}
