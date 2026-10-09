import type { Db } from "../db/client.js";
import { loadDiary, type DiaryEntryRow } from "../diary/load.js";

/** Updates read per friend; the feed keeps the newest of all of them. */
const PER_FRIEND = 40;

export type ActivityKind = "finished" | "dropped" | "started" | "watched" | "planned" | "rated";

export interface ActivityItem {
  friendId: string;
  friend: string;
  at: Date;
  kind: ActivityKind;
  animeId: number;
  title: string;
  pictureUrl: string | null;
  /** For "watched": the first and last episode, which can span several updates in a day. */
  fromEpisode: number | null;
  toEpisode: number | null;
  /** Their score, when this update set one. */
  score: number | null;
  /** A diary note they chose to share with this update. */
  note: string | null;
}

/**
 * What friends who share their activity watched lately, newest first: kurisu's updates and the
 * ones a sync found on MAL's site, as the diary has them. Never removals, imports or undone
 * changes, never a drop's reason, and a diary note only when its owner shared it.
 */
export async function friendActivity(
  db: Db,
  friends: { id: string; malUsername: string; shareActivity: boolean }[],
  limit: number,
): Promise<ActivityItem[]> {
  const sharing = friends.filter((friend) => friend.shareActivity);
  const perFriend = await Promise.all(
    sharing.map(async (friend) => {
      const { entries } = await loadDiary(db, friend.id, PER_FRIEND);
      return mergeEpisodes(
        entries.flatMap((entry) => {
          const item = activityOf(entry);
          return item ? [{ ...item, friendId: friend.id, friend: friend.malUsername }] : [];
        }),
      );
    }),
  );
  return perFriend
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

/** What one update means to a friend reading about it, or null if it's nothing to show. */
export function activityOf(entry: DiaryEntryRow): Omit<ActivityItem, "friendId" | "friend"> | null {
  if (entry.kind === "remove") return null;
  const { before, after } = entry;
  const base = {
    at: entry.at,
    animeId: entry.animeId,
    title: entry.title,
    pictureUrl: entry.pictureUrl,
    fromEpisode: null,
    toEpisode: null,
    score: after.score !== undefined && after.score > 0 ? after.score : null,
    note: entry.note?.shared ? entry.note.text : null,
  };
  const status = after.status;
  if (status === "completed" && before.status !== "completed") {
    return { ...base, kind: "finished" };
  }
  if (status === "dropped") return { ...base, kind: "dropped" };
  const from = before.episodesWatched ?? 0;
  const to = after.episodesWatched;
  if (to !== undefined && to > from) {
    return {
      ...base,
      kind: from === 0 ? "started" : "watched",
      fromEpisode: from + 1,
      toEpisode: to,
    };
  }
  if (status === "watching") return { ...base, kind: "started" };
  if (status === "plan_to_watch") return { ...base, kind: "planned" };
  if (base.score !== null) return { ...base, kind: "rated" };
  return null;
}

/**
 * Joins one friend's "watched" updates of a show on the same day (newest first) into one: "eps
 * 3–5" rather than three lines. A shared note on any of them stays.
 */
function mergeEpisodes<T extends Omit<ActivityItem, "friendId" | "friend">>(items: T[]): T[] {
  const merged: T[] = [];
  for (const item of items) {
    const last = merged.at(-1);
    if (
      last &&
      last.kind === "watched" &&
      item.kind === "watched" &&
      last.animeId === item.animeId &&
      last.at.toISOString().slice(0, 10) === item.at.toISOString().slice(0, 10) &&
      item.toEpisode !== null &&
      last.fromEpisode !== null &&
      item.toEpisode + 1 >= last.fromEpisode
    ) {
      last.fromEpisode = Math.min(last.fromEpisode, item.fromEpisode ?? last.fromEpisode);
      last.note ??= item.note;
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
}
