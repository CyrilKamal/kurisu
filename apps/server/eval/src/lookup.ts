import { normalizeTitle, TitleIndex, type Snapshot, type SnapshotEntry } from "./snapshot.js";

export interface LookupFilters {
  status?: string;
  airing?: string;
}

export interface LookupHit {
  entry: SnapshotEntry;
  /** What to write after "=>" in a case: the main title, or the MAL id if that title is shared. */
  caseName: string;
}

/**
 * Finds snapshot entries for writing cases: by any of their names (every word of the query must
 * appear in one name), and/or by list status and airing status. Best matches first.
 */
export function lookUp(
  snapshot: Snapshot,
  query: string,
  filters: LookupFilters = {},
): LookupHit[] {
  const index = new TitleIndex(snapshot);
  const q = normalizeTitle(query);
  const words = q.split(" ").filter(Boolean);

  const ranked: { entry: SnapshotEntry; rank: number }[] = [];
  for (const entry of snapshot.entries) {
    if (filters.status && entry.status !== filters.status) continue;
    if (filters.airing && entry.airingStatus !== filters.airing) continue;
    if (words.length === 0) {
      ranked.push({ entry, rank: 0 });
      continue;
    }
    const names = [entry.title, entry.titleEn, entry.titleJa, ...entry.synonyms]
      .filter((n): n is string => !!n)
      .map(normalizeTitle);
    const rank = Math.max(
      ...names.map((n) =>
        n === q ? 3 : n.startsWith(q) ? 2 : words.every((w) => n.includes(w)) ? 1 : 0,
      ),
    );
    if (rank > 0) ranked.push({ entry, rank });
  }

  return ranked
    .sort((a, b) => b.rank - a.rank || a.entry.title.localeCompare(b.entry.title))
    .map(({ entry }) => {
      const byTitle = index.resolve(entry.title);
      const unique = byTitle.ok && byTitle.entry.id === entry.id;
      return { entry, caseName: unique ? entry.title : String(entry.id) };
    });
}

/**
 * One entry as a few readable lines. `latestAired` is the frozen newest episode (airing shows
 * only), which "the newest episode" cases should expect.
 */
export function describeEntry(hit: LookupHit, latestAired: number | null = null): string {
  const e = hit.entry;
  const also = [e.titleEn, ...e.synonyms].filter((n): n is string => !!n && n !== e.title);
  const facts = [
    e.mediaType ?? "?",
    e.status.replace(/_/g, " "),
    `${String(e.episodesWatched)}/${e.numEpisodes === null ? "?" : String(e.numEpisodes)} eps`,
    ...(e.isRewatching ? ["rewatching"] : []),
    e.airingStatus ? e.airingStatus.replace(/_/g, " ") : "airing unknown",
    ...(latestAired !== null ? [`newest aired ep ${String(latestAired)}`] : []),
  ];
  return [
    `${String(e.id).padEnd(7)} ${e.title}`,
    ...(also.length ? [`        also: ${also.join(" · ")}`] : []),
    `        ${facts.join(" · ")}`,
    `        in a case: ${hit.caseName}: …`,
  ].join("\n");
}
