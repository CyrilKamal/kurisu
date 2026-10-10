import type { JournalItem } from "@kurisu/shared";
import { and, desc, eq, ne, type SQL } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { anime, changes, diaryNotes, importItems, listEvents, proposals } from "../db/schema.js";
import { userTimeZone } from "../stats/compute.js";

/** Lines the Journal shows at most. */
export const JOURNAL_LIMIT = 100;
/** Changes read before imports fold into one line each, so a big import can't crowd out the rest. */
const CHANGES_READ = 400;

const EVENT_KINDS = { added: "add", updated: "update", removed: "remove" } as const;

/**
 * The user's updates, newest first, for the Journal (or one show's page, with `animeId`):
 * - changes made through kurisu, each with its diary note and whether it was undone (undos
 *   themselves aren't lines: the change they undid shows struck through);
 * - changes a sync found on MAL's site;
 * - on the Journal, each import as one line, since it undoes as one.
 */
export async function loadJournal(
  db: Db,
  userId: string,
  options: { animeId?: number; limit?: number } = {},
): Promise<{ timeZone: string; items: JournalItem[] }> {
  const limit = options.limit ?? JOURNAL_LIMIT;
  const forShow = options.animeId !== undefined;
  const changeWhere: SQL[] = [eq(changes.userId, userId), ne(proposals.source, "undo")];
  const eventWhere: SQL[] = [eq(listEvents.userId, userId)];
  if (options.animeId !== undefined) {
    changeWhere.push(eq(changes.animeId, options.animeId));
    eventWhere.push(eq(listEvents.animeId, options.animeId));
  }

  const ours = await db
    .select({
      id: changes.id,
      animeId: changes.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      numEpisodes: anime.numEpisodes,
      kind: changes.kind,
      before: changes.before,
      after: changes.after,
      at: changes.committedAt,
      source: proposals.source,
      undoneBy: changes.undoneByChangeId,
      noteId: diaryNotes.id,
      noteText: diaryNotes.text,
      noteShared: diaryNotes.shared,
      importId: importItems.importId,
    })
    .from(changes)
    .innerJoin(proposals, eq(proposals.id, changes.proposalId))
    .innerJoin(anime, eq(anime.malId, changes.animeId))
    .leftJoin(diaryNotes, eq(diaryNotes.changeId, changes.id))
    .leftJoin(importItems, eq(importItems.proposalId, changes.proposalId))
    .where(and(...changeWhere))
    .orderBy(desc(changes.committedAt))
    .limit(forShow ? limit : CHANGES_READ);

  const theirs = await db
    .select({
      id: listEvents.id,
      animeId: listEvents.animeId,
      title: anime.title,
      pictureUrl: anime.mainPictureUrl,
      numEpisodes: anime.numEpisodes,
      kind: listEvents.kind,
      before: listEvents.before,
      after: listEvents.after,
      at: listEvents.at,
    })
    .from(listEvents)
    .innerJoin(anime, eq(anime.malId, listEvents.animeId))
    .where(and(...eventWhere))
    .orderBy(desc(listEvents.at))
    .limit(limit);

  const lines: { at: Date; item: JournalItem }[] = [];
  const imports = new Map<string, { at: Date; count: number; undone: boolean }>();
  for (const row of ours) {
    if (!forShow && row.source === "import" && row.importId !== null) {
      const group = imports.get(row.importId);
      if (group) {
        group.count += 1;
        group.undone &&= row.undoneBy !== null;
        if (row.at > group.at) group.at = row.at;
      } else {
        imports.set(row.importId, { at: row.at, count: 1, undone: row.undoneBy !== null });
      }
      continue;
    }
    lines.push({
      at: row.at,
      item: {
        type: "change",
        id: row.id,
        animeId: row.animeId,
        title: row.title,
        pictureUrl: row.pictureUrl,
        numEpisodes: row.numEpisodes,
        kind: row.kind,
        before: row.before,
        after: row.after,
        at: row.at.toISOString(),
        source: row.source,
        undone: row.undoneBy !== null,
        note:
          row.noteId !== null && row.noteText !== null
            ? { id: row.noteId, text: row.noteText, shared: row.noteShared ?? false }
            : null,
      },
    });
  }
  for (const [id, group] of imports) {
    lines.push({
      at: group.at,
      item: {
        type: "import",
        id,
        at: group.at.toISOString(),
        count: group.count,
        undone: group.undone,
      },
    });
  }
  for (const row of theirs) {
    lines.push({
      at: row.at,
      item: {
        type: "mal",
        id: row.id,
        animeId: row.animeId,
        title: row.title,
        pictureUrl: row.pictureUrl,
        numEpisodes: row.numEpisodes,
        kind: EVENT_KINDS[row.kind],
        before: row.before,
        after: row.after,
        at: row.at.toISOString(),
      },
    });
  }

  return {
    timeZone: await userTimeZone(db, userId),
    items: lines
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit)
      .map((line) => line.item),
  };
}
