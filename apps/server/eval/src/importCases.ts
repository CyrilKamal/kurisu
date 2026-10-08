import { readdirSync, readFileSync } from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

import { normalizeName } from "../../src/list/seasons.js";
import { MAL_LIST_STATUSES } from "../../src/mal/client.js";
import type { ListChange } from "../../src/writes/normalize.js";
import { CASES_DIR, IMPORT_FILE, type Problem } from "./cases.js";
import type { CatalogFreeze } from "./catalog.js";
import { loadSnapshot, TitleIndex, type Snapshot } from "./snapshot.js";

export const IMPORT_GROUPS = [
  "add",
  "update",
  "up_to_date",
  "disagree",
  "which_one",
  "not_found",
  "not_a_show",
] as const;
export type ImportGroup = (typeof IMPORT_GROUPS)[number];

/** Groups that point at one show, so the case says which. */
const NAMES_A_SHOW: ImportGroup[] = ["add", "update", "up_to_date", "disagree"];

const expectedRowSchema = z
  .object({
    /** The line of the notes it's on, counting from 1 as pasted (blank lines count). */
    line: z.number().int().positive(),
    group: z.enum(IMPORT_GROUPS),
    /** The show: a title from the snapshot or the frozen catalog, or a MAL id. */
    anime: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    /** The fields the change should have (others aren't checked). */
    change: z
      .object({
        status: z.enum(MAL_LIST_STATUSES).optional(),
        episodes_watched: z.number().int().nonnegative().optional(),
        score: z.number().int().min(0).max(10).optional(),
        is_rewatching: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const importCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    /** The notes, pasted as they are. */
    notes: z.string().min(1),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    /**
     * One row per show the notes mention, in order: by line, then by place on the line. A line
     * left out should come back as not a show.
     */
    expect: z.array(expectedRowSchema).min(1),
  })
  .strict();
export type ImportCase = z.infer<typeof importCaseSchema>;

const importFileSchema = z
  .object({
    /** The list the notes are imported onto; "empty" for onboarding from notes alone. */
    snapshot: z.string().regex(/^[a-z0-9-]+$/),
    cases: z.array(importCaseSchema).min(1),
  })
  .strict();

export interface ExpectedRow {
  line: number;
  group: ImportGroup;
  animeId: number | null;
  change: ListChange | null;
}

export interface ResolvedImportCase {
  file: string;
  snapshot: string;
  case: ImportCase;
  rows: ExpectedRow[];
}

/** Finds a show by name or id: on the snapshot's list, else in the frozen catalog. */
function resolveShow(
  anime: string | number,
  titles: TitleIndex,
  catalog: CatalogFreeze | null,
): { ok: true; id: number } | { ok: false; error: string } {
  const onList = titles.resolve(anime);
  if (onList.ok) return { ok: true, id: onList.entry.id };
  const shows = (catalog?.searches ?? []).flatMap((s) => s.shows);
  if (typeof anime === "number") {
    return shows.some((s) => s.malId === anime)
      ? { ok: true, id: anime }
      : { ok: false, error: `${String(anime)} is neither on the list nor in the frozen catalog.` };
  }
  if (onList.reason === "ambiguous") {
    return { ok: false, error: `"${anime}" matches several shows on the list; use a MAL id.` };
  }
  const ids = [
    ...new Set(
      shows
        .filter((s) =>
          [s.title, s.titleEn, ...s.synonyms].some(
            (n) => n !== null && normalizeName(n) === normalizeName(anime),
          ),
        )
        .flatMap((s) => (s.malId === null ? [] : [s.malId])),
    ),
  ];
  if (ids.length === 1 && ids[0] !== undefined) return { ok: true, id: ids[0] };
  return {
    ok: false,
    error:
      ids.length > 1
        ? `"${anime}" matches several shows in the catalog; use a MAL id.`
        : `"${anime}" isn't on the list or in the frozen catalog (pnpm eval:lookup, or pnpm eval:catalog "${anime}").`,
  };
}

/** Loads and checks every import case file. */
export function loadImportCases(
  catalog: CatalogFreeze | null,
  casesDir: string = CASES_DIR,
  snapshotLoader: (name: string) => Snapshot = loadSnapshot,
): { cases: ResolvedImportCase[]; errors: Problem[] } {
  const files = readdirSync(casesDir)
    .filter((f) => IMPORT_FILE.test(f))
    .sort();
  const result: { cases: ResolvedImportCase[]; errors: Problem[] } = { cases: [], errors: [] };
  const seenIds = new Map<string, string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(`${casesDir}${file}`, "utf8"));
    } catch (err) {
      result.errors.push({ file, message: `not valid YAML: ${(err as Error).message}` });
      continue;
    }
    const shape = importFileSchema.safeParse(parsed);
    if (!shape.success) {
      for (const issue of shape.error.issues) {
        result.errors.push({ file, message: `${issue.path.join(".")}: ${issue.message}` });
      }
      continue;
    }
    let snapshot: Snapshot;
    try {
      snapshot = snapshotLoader(shape.data.snapshot);
    } catch {
      result.errors.push({ file, message: `no snapshot named "${shape.data.snapshot}".` });
      continue;
    }
    const titles = new TitleIndex(snapshot);

    for (const c of shape.data.cases) {
      const problem = (message: string) => ({ file, caseId: c.id, message });
      const before = seenIds.get(c.id);
      if (before) {
        result.errors.push(problem(`id also used in ${before}.`));
        continue;
      }
      seenIds.set(c.id, file);
      const lineCount = c.notes.split(/\r?\n/).length;
      let ok = true;
      const rows: ExpectedRow[] = [];
      for (const [i, row] of c.expect.entries()) {
        const where = `expect[${String(i)}]`;
        if (row.line > lineCount) {
          result.errors.push(problem(`${where}: line ${String(row.line)} is past the notes' end.`));
          ok = false;
        }
        if (NAMES_A_SHOW.includes(row.group) && row.anime === undefined) {
          result.errors.push(problem(`${where}: a ${row.group} row needs anime.`));
          ok = false;
        }
        let animeId: number | null = null;
        if (row.anime !== undefined) {
          const show = resolveShow(row.anime, titles, catalog);
          if (show.ok) animeId = show.id;
          else {
            result.errors.push(problem(`${where}: ${show.error}`));
            ok = false;
          }
        }
        const change: ListChange | null = row.change
          ? {
              ...(row.change.status !== undefined && { status: row.change.status }),
              ...(row.change.episodes_watched !== undefined && {
                episodesWatched: row.change.episodes_watched,
              }),
              ...(row.change.score !== undefined && { score: row.change.score }),
              ...(row.change.is_rewatching !== undefined && {
                isRewatching: row.change.is_rewatching,
              }),
            }
          : null;
        rows.push({ line: row.line, group: row.group, animeId, change });
      }
      const sorted = rows.every((r, i) => i === 0 || (rows[i - 1]?.line ?? 0) <= r.line);
      if (!sorted) {
        result.errors.push(problem("list expect rows in line order."));
        ok = false;
      }
      if (ok) result.cases.push({ file, snapshot: shape.data.snapshot, case: c, rows });
    }
  }
  return result;
}
