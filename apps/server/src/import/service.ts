import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { CatalogSearch } from "../agent/tools.js";
import { loadShowCards, type ShowCardView } from "../chat/service.js";
import type { Db } from "../db/client.js";
import { anime, changes, importItems, imports, listEntries } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import { commitProposal, type WriteDeps } from "../writes/commit.js";
import type { EntryState, ListState } from "../writes/normalize.js";
import { findProposal, stageProposal } from "../writes/stage.js";
import { undoChange } from "../writes/undo.js";
import { groupMatched, matchItems, type ImportGroup } from "./classify.js";
import { noteLines, readNotes } from "./parse.js";

export interface ImportDeps {
  db: Db;
  models: ModelClient;
  /** Reads the notes: the agent role (Flash-Lite). */
  model: ModelRef;
  prompt: { version: string; system: string };
  /** AniList title search, for shows that aren't on the list; null leaves them unfound. */
  catalog: CatalogSearch | null;
  /** The single write path. */
  writes: WriteDeps;
  /** Pause between MAL writes, since MAL's rate limits are undocumented. Tests use 0. */
  writeIntervalMs: number;
  log?: (message: string, err?: unknown) => void;
}

export type ImportRow = typeof imports.$inferSelect;
type ItemRow = typeof importItems.$inferSelect;

export interface ImportItemView {
  id: string;
  lineNo: number;
  line: string;
  said: string;
  title: string | null;
  group: ImportGroup;
  show: ShowCardView | null;
  candidates: ShowCardView[];
  malState: ListState | null;
  change: ItemRow["change"];
  note: string | null;
  checked: boolean;
  resolution: "keep_mal" | "use_notes" | null;
  status: ItemRow["status"];
  error: string | null;
}

export interface ImportView {
  id: string;
  status: ImportRow["status"];
  error: string | null;
  createdAt: string;
  items: ImportItemView[];
}

/** Imports with a background job running in this process, so one never runs twice. */
const active = new Set<string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The groups whose checked rows get written. */
const WRITABLE: ImportGroup[] = ["add", "update", "disagree"];

async function entryOf(db: Db, userId: string, animeId: number): Promise<EntryState | null> {
  const [row] = await db
    .select({
      status: listEntries.status,
      episodesWatched: listEntries.numEpisodesWatched,
      score: listEntries.score,
      isRewatching: listEntries.isRewatching,
      numEpisodes: anime.numEpisodes,
    })
    .from(listEntries)
    .innerJoin(anime, eq(listEntries.animeId, anime.malId))
    .where(and(eq(listEntries.userId, userId), eq(listEntries.animeId, animeId)));
  return row ?? null;
}

async function episodesOf(db: Db, animeId: number): Promise<number | null> {
  const [row] = await db
    .select({ numEpisodes: anime.numEpisodes })
    .from(anime)
    .where(eq(anime.malId, animeId));
  return row?.numEpisodes ?? null;
}

function stateOf(entry: EntryState | null): ListState | null {
  return entry
    ? {
        status: entry.status,
        episodesWatched: entry.episodesWatched,
        score: entry.score,
        isRewatching: entry.isRewatching,
      }
    : null;
}

function sameState(a: ListState | null, b: ListState | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.status === b.status &&
    a.episodesWatched === b.episodesWatched &&
    a.score === b.score &&
    a.isRewatching === b.isRewatching
  );
}

async function setStatus(
  db: Db,
  importId: string,
  status: ImportRow["status"],
  error: string | null = null,
) {
  await db
    .update(imports)
    .set({ status, error, updatedAt: new Date() })
    .where(eq(imports.id, importId));
}

/** Whether the user has an import being read, written or undone right now. */
export async function importBusy(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(eq(imports.userId, userId), inArray(imports.status, ["parsing", "running", "undoing"])),
    )
    .limit(1);
  return row !== undefined;
}

/** Starts an import: the notes are read and matched in the background, then wait for review. */
export async function startImport(deps: ImportDeps, userId: string, text: string): Promise<string> {
  const [row] = await deps.db
    .insert(imports)
    .values({ userId, text })
    .returning({ id: imports.id });
  if (!row) throw new Error("imports insert returned no row");
  void parse(deps, userId, row.id, text);
  return row.id;
}

/** A review row, before it's saved under an import. */
export type ReviewRow = Omit<typeof importItems.$inferInsert, "importId">;

/**
 * Reads the notes and turns them into review rows: the model reads each line, code matches the
 * titles and groups each show. Null when the notes couldn't be read. The eval runs exactly this.
 */
export async function prepareImport(
  deps: Pick<ImportDeps, "db" | "models" | "model" | "prompt" | "catalog">,
  userId: string,
  text: string,
): Promise<ReviewRow[] | null> {
  const { db } = deps;
  const items = await readNotes(deps, userId, noteLines(text));
  if (!items) return null;
  const matches = await matchItems({ db, userId, catalog: deps.catalog }, items);
  const rows: ReviewRow[] = [];
  for (const [i, item] of items.entries()) {
    const match = matches[i] ?? { kind: "none" as const };
    const base = {
      lineNo: item.lineNo,
      position: item.position,
      line: item.line,
      said: item.said,
      title: item.title ?? "",
      notes: item.notes,
    };
    if (!item.title) {
      rows.push({
        ...base,
        group: item.unread ? "not_found" : "not_a_show",
        note: item.unread ? "Couldn't read this line." : null,
      });
    } else if (match.kind === "none") {
      rows.push({ ...base, group: "not_found" });
    } else if (match.kind === "several") {
      rows.push({ ...base, group: "which_one", candidates: match.candidates });
    } else {
      const entry = await entryOf(db, userId, match.animeId);
      const grouped = groupMatched(
        item.notes,
        entry?.numEpisodes ?? (await episodesOf(db, match.animeId)),
        entry,
      );
      rows.push({
        ...base,
        animeId: match.animeId,
        ...grouped,
        resolution: grouped.group === "disagree" && grouped.change ? "keep_mal" : null,
      });
    }
  }
  return rows;
}

async function parse(deps: ImportDeps, userId: string, importId: string, text: string) {
  const { db } = deps;
  try {
    const rows = await prepareImport(deps, userId, text);
    if (!rows) {
      await setStatus(db, importId, "failed", "parse_failed");
      return;
    }
    if (rows.length > 0) {
      await db.insert(importItems).values(rows.map((row) => ({ ...row, importId })));
    }
    await setStatus(db, importId, "review");
  } catch (err) {
    deps.log?.("import: reading the notes failed", err);
    await setStatus(db, importId, "failed", "internal_error");
  }
}

async function toView(db: Db, userId: string, row: ImportRow): Promise<ImportView> {
  const items = await db
    .select()
    .from(importItems)
    .where(eq(importItems.importId, row.id))
    .orderBy(asc(importItems.lineNo), asc(importItems.position));
  const cards = await loadShowCards(db, userId, [
    ...items.flatMap((item) => (item.animeId === null ? [] : [item.animeId])),
    ...items.flatMap((item) => item.candidates),
  ]);
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      lineNo: item.lineNo,
      line: item.line,
      said: item.said,
      title: item.title === "" ? null : item.title,
      group: item.group,
      show: item.animeId === null ? null : (cards.get(item.animeId) ?? null),
      candidates: item.candidates.flatMap((id) => {
        const card = cards.get(id);
        return card ? [card] : [];
      }),
      malState: item.malState,
      change: item.change,
      note: item.note,
      checked: item.checked,
      resolution:
        item.resolution === "keep_mal" || item.resolution === "use_notes" ? item.resolution : null,
      status: item.status,
      error: item.error,
    })),
  };
}

export async function loadImport(
  db: Db,
  userId: string,
  importId: string,
): Promise<ImportView | null> {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)));
  return row ? toView(db, userId, row) : null;
}

/** The user's newest import, so the screen picks up where they left it. */
export async function latestImport(db: Db, userId: string): Promise<ImportView | null> {
  const [row] = await db
    .select()
    .from(imports)
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt))
    .limit(1);
  return row ? toView(db, userId, row) : null;
}

export interface ItemPatch {
  checked?: boolean;
  animeId?: number | null;
  resolution?: "keep_mal" | "use_notes";
}

/**
 * Records the user's answer for one row during the review: check or uncheck it, pick which show
 * a "which one?" row means (it's then grouped like any match), or settle a disagreement.
 */
export async function updateItem(
  db: Db,
  userId: string,
  importId: string,
  itemId: string,
  patch: ItemPatch,
): Promise<"ok" | "not_found" | "not_ready" | "invalid"> {
  const [owner] = await db
    .select({ status: imports.status })
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)));
  if (!owner) return "not_found";
  if (owner.status !== "review") return "not_ready";
  const [item] = await db
    .select()
    .from(importItems)
    .where(and(eq(importItems.id, itemId), eq(importItems.importId, importId)));
  if (!item) return "not_found";

  let next: Partial<typeof importItems.$inferInsert> = {};
  if (patch.animeId !== undefined) {
    if (item.candidates.length === 0) return "invalid";
    if (patch.animeId === null) {
      next = {
        group: "which_one",
        animeId: null,
        malState: null,
        change: null,
        note: null,
        checked: false,
        resolution: null,
      };
    } else {
      if (!item.candidates.includes(patch.animeId)) return "invalid";
      const entry = await entryOf(db, userId, patch.animeId);
      const grouped = groupMatched(
        item.notes,
        entry?.numEpisodes ?? (await episodesOf(db, patch.animeId)),
        entry,
      );
      next = {
        animeId: patch.animeId,
        ...grouped,
        resolution: grouped.group === "disagree" && grouped.change ? "keep_mal" : null,
      };
    }
  }
  const group = next.group ?? item.group;
  const change = next.change === undefined ? item.change : next.change;
  if (patch.resolution !== undefined) {
    if (group !== "disagree" || change === null) return "invalid";
    next = { ...next, resolution: patch.resolution, checked: patch.resolution === "use_notes" };
  }
  if (patch.checked !== undefined) {
    if (!WRITABLE.includes(group) || change === null) return "invalid";
    next = {
      ...next,
      checked: patch.checked,
      ...(group === "disagree" && { resolution: patch.checked ? "use_notes" : "keep_mal" }),
    };
  }
  await db.update(importItems).set(next).where(eq(importItems.id, itemId));
  return "ok";
}

/**
 * The user tapped Import: their OK for every checked row, adds included. Rows that won't be
 * written are marked skipped, and the rest are written in the background.
 */
export async function runImport(
  deps: ImportDeps,
  userId: string,
  importId: string,
): Promise<"started" | "not_found" | "not_ready"> {
  const { db } = deps;
  const started = await db
    .update(imports)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(imports.id, importId), eq(imports.userId, userId), eq(imports.status, "review")))
    .returning({ id: imports.id });
  if (started.length === 0) {
    const [exists] = await db
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.id, importId), eq(imports.userId, userId)));
    return exists ? "not_ready" : "not_found";
  }
  const items = await db.select().from(importItems).where(eq(importItems.importId, importId));
  const skipped = items
    .filter((i) => !(i.checked && i.change !== null && WRITABLE.includes(i.group)))
    .map((i) => i.id);
  if (skipped.length > 0) {
    await db.update(importItems).set({ status: "skipped" }).where(inArray(importItems.id, skipped));
  }
  void write(deps, userId, importId);
  return "started";
}

async function write(deps: ImportDeps, userId: string, importId: string) {
  if (active.has(importId)) return;
  active.add(importId);
  const { db } = deps;
  try {
    const pending = await db
      .select()
      .from(importItems)
      .where(and(eq(importItems.importId, importId), eq(importItems.status, "pending")))
      .orderBy(asc(importItems.lineNo), asc(importItems.position));
    for (const [n, item] of pending.entries()) {
      if (n > 0) await sleep(deps.writeIntervalMs);
      await writeItem(deps, userId, item);
    }
    await setStatus(db, importId, "done");
  } catch (err) {
    deps.log?.("import: writing failed", err);
    await setStatus(db, importId, "failed", "internal_error");
  } finally {
    active.delete(importId);
  }
}

async function writeItem(deps: ImportDeps, userId: string, item: ItemRow) {
  const { db } = deps;
  const fail = (error: string) =>
    db.update(importItems).set({ status: "failed", error }).where(eq(importItems.id, item.id));
  if (item.animeId === null || item.change === null) return fail("nothing_to_write");
  const key = `import:${item.id}`;

  // After a restart, a row may already be written: its proposal says so.
  let proposal = await findProposal(db, userId, key);
  if (!proposal) {
    const entry = await entryOf(db, userId, item.animeId);
    // The list changed since the review (a sync, an edit): the user decided on what they saw.
    if (!sameState(stateOf(entry), item.malState)) return fail("changed_since_review");
    proposal = await stageProposal(db, {
      userId,
      animeId: item.animeId,
      source: "import",
      kind: item.malState ? "update" : "add",
      idempotencyKey: key,
      before: stateOf(entry),
      change: item.change,
    });
  }
  const result = await commitProposal(deps.writes, userId, proposal.id, { confirmed: true });
  if (result.status === "committed") {
    await db
      .update(importItems)
      .set({ status: "committed", proposalId: proposal.id, error: null })
      .where(eq(importItems.id, item.id));
    return;
  }
  return fail(result.status === "failed" ? result.error : result.status);
}

/** Undoes everything an import wrote, newest first, in the background. */
export async function undoImport(
  deps: ImportDeps,
  userId: string,
  importId: string,
): Promise<"started" | "not_found" | "not_ready"> {
  const started = await deps.db
    .update(imports)
    .set({ status: "undoing", updatedAt: new Date() })
    .where(and(eq(imports.id, importId), eq(imports.userId, userId), eq(imports.status, "done")))
    .returning({ id: imports.id });
  if (started.length === 0) {
    const [exists] = await deps.db
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.id, importId), eq(imports.userId, userId)));
    return exists ? "not_ready" : "not_found";
  }
  void undo(deps, userId, importId);
  return "started";
}

async function undo(deps: ImportDeps, userId: string, importId: string) {
  if (active.has(importId)) return;
  active.add(importId);
  const { db } = deps;
  try {
    const written = await db
      .select({ item: importItems, changeId: changes.id })
      .from(importItems)
      .innerJoin(changes, eq(changes.proposalId, importItems.proposalId))
      .where(and(eq(importItems.importId, importId), eq(importItems.status, "committed")))
      .orderBy(desc(importItems.lineNo), desc(importItems.position));
    for (const [n, { item, changeId }] of written.entries()) {
      if (n > 0) await sleep(deps.writeIntervalMs);
      const result = await undoChange(deps.writes, userId, changeId);
      const undone = result.status === "committed" || result.status === "already_undone";
      await db
        .update(importItems)
        .set(
          undone
            ? { status: "undone", error: null }
            : {
                status: "undo_failed",
                error: result.status === "failed" ? result.error : result.status,
              },
        )
        .where(eq(importItems.id, item.id));
    }
    await setStatus(db, importId, "undone");
  } catch (err) {
    deps.log?.("import: undo failed", err);
    await setStatus(db, importId, "failed", "internal_error");
  } finally {
    active.delete(importId);
  }
}

/** Throws away an import still in review (or one that failed). */
export async function discardImport(db: Db, userId: string, importId: string): Promise<boolean> {
  const deleted = await db
    .delete(imports)
    .where(
      and(
        eq(imports.id, importId),
        eq(imports.userId, userId),
        inArray(imports.status, ["review", "failed"]),
      ),
    )
    .returning({ id: imports.id });
  return deleted.length > 0;
}

/**
 * After a restart: finishes writes and undos that were under way. Reading the notes again would
 * cost another model call, so an interrupted read is marked failed for the user to retry.
 */
export async function resumeImports(deps: ImportDeps): Promise<void> {
  const unfinished = await deps.db
    .select({ id: imports.id, userId: imports.userId, status: imports.status })
    .from(imports)
    .where(inArray(imports.status, ["parsing", "running", "undoing"]));
  for (const row of unfinished) {
    if (row.status === "parsing") await setStatus(deps.db, row.id, "failed", "interrupted");
    else if (row.status === "running") void write(deps, row.userId, row.id);
    else void undo(deps, row.userId, row.id);
  }
}
