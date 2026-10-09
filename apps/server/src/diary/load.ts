import { and, desc, eq, isNull, ne } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, changes, diaryNotes, listEvents, proposals } from "../db/schema.js";
import { userTimeZone } from "../stats/compute.js";
import type { ListChange } from "../writes/normalize.js";

/** Updates the diary shows at most. */
export const DIARY_LIMIT = 100;

export interface DiaryEntryRow {
  id: string;
  origin: "kurisu" | "mal";
  kind: "update" | "add" | "remove";
  animeId: number;
  title: string;
  pictureUrl: string | null;
  before: ListChange;
  after: ListChange;
  at: Date;
  /** shared: whether the user showed it to their friends. */
  note: { id: string; text: string; shared: boolean } | null;
}

/**
 * The user's latest updates, newest first: changes made through kurisu (not undos, changes that
 * were undone, or imports, which log what was watched before) with their diary notes, and changes
 * a sync found on MAL's site.
 */
export async function loadDiary(
  db: Db,
  userId: string,
  limit: number = DIARY_LIMIT,
): Promise<{ timeZone: string; entries: DiaryEntryRow[] }> {
  const ours = await db
    .select({
      id: changes.id,
      kind: changes.kind,
      animeId: changes.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      before: changes.before,
      after: changes.after,
      at: changes.committedAt,
      noteId: diaryNotes.id,
      noteText: diaryNotes.text,
      noteShared: diaryNotes.shared,
    })
    .from(changes)
    .innerJoin(proposals, eq(proposals.id, changes.proposalId))
    .innerJoin(anime, eq(anime.malId, changes.animeId))
    .leftJoin(diaryNotes, eq(diaryNotes.changeId, changes.id))
    .where(
      and(
        eq(changes.userId, userId),
        isNull(changes.undoneByChangeId),
        ne(proposals.source, "undo"),
        ne(proposals.source, "import"),
      ),
    )
    .orderBy(desc(changes.committedAt))
    .limit(limit);
  const theirs = await db
    .select({
      id: listEvents.id,
      kind: listEvents.kind,
      animeId: listEvents.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      before: listEvents.before,
      after: listEvents.after,
      at: listEvents.at,
    })
    .from(listEvents)
    .innerJoin(anime, eq(anime.malId, listEvents.animeId))
    .where(eq(listEvents.userId, userId))
    .orderBy(desc(listEvents.at))
    .limit(limit);

  const kinds = { added: "add", updated: "update", removed: "remove" } as const;
  const entries: DiaryEntryRow[] = [
    ...ours.map(({ noteId, noteText, noteShared, ...row }) => ({
      ...row,
      origin: "kurisu" as const,
      note:
        noteId !== null && noteText !== null
          ? { id: noteId, text: noteText, shared: noteShared ?? false }
          : null,
    })),
    ...theirs.map((row) => ({
      ...row,
      kind: kinds[row.kind],
      origin: "mal" as const,
      note: null,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
  return { timeZone: await userTimeZone(db, userId), entries };
}
