import type { listEvents } from "../db/schema.js";
import type { ListChange, ListState } from "../writes/normalize.js";

/** An entry as the mirror holds it, or as MAL sends it in a sync. */
export interface EntrySnapshot extends ListState {
  /** When MAL says the entry last changed. */
  malUpdatedAt: Date;
}

export type ListEventRow = typeof listEvents.$inferInsert;

const FIELDS = ["status", "episodesWatched", "score", "isRewatching"] as const;

function pick(state: ListState, keys: readonly (typeof FIELDS)[number][]): ListChange {
  return Object.fromEntries(keys.map((key) => [key, state[key]]));
}

/**
 * What changed on MAL since the mirror was written, as list events: shows added, the list fields
 * that changed on the others (status, episodes, score, rewatching; dates don't count), and shows
 * removed. kurisu's own writes leave nothing to find, since a commit writes MAL's answer into
 * the mirror.
 *
 * A write that lands while a sync is reading MAL can make the sync's copy older than the mirror;
 * so a change counts only when MAL's time for it is newer than the mirror's, and a removal only
 * for an entry the mirror had before the sync began.
 */
export function listEventsBetween(
  userId: string,
  mirror: ReadonlyMap<number, EntrySnapshot>,
  incoming: ReadonlyMap<number, EntrySnapshot>,
  sync: { startedAt: Date; at: Date },
): ListEventRow[] {
  const events: ListEventRow[] = [];
  for (const [animeId, next] of incoming) {
    const prev = mirror.get(animeId);
    if (!prev) {
      events.push({
        userId,
        animeId,
        kind: "added",
        before: {},
        after: pick(next, FIELDS),
        at: next.malUpdatedAt,
      });
      continue;
    }
    if (next.malUpdatedAt.getTime() <= prev.malUpdatedAt.getTime()) continue;
    const changed = FIELDS.filter((key) => prev[key] !== next[key]);
    if (changed.length === 0) continue;
    events.push({
      userId,
      animeId,
      kind: "updated",
      before: pick(prev, changed),
      after: pick(next, changed),
      at: next.malUpdatedAt,
    });
  }
  for (const [animeId, prev] of mirror) {
    if (incoming.has(animeId) || prev.malUpdatedAt.getTime() >= sync.startedAt.getTime()) continue;
    events.push({
      userId,
      animeId,
      kind: "removed",
      before: pick(prev, FIELDS),
      after: {},
      at: sync.at,
    });
  }
  return events;
}
