import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { z } from "zod";

import { MAL_LIST_STATUSES } from "../../src/mal/client.js";
import { normalizeChange, type ListChange } from "../../src/writes/normalize.js";
import { loadSnapshot, TitleIndex, type Snapshot } from "./snapshot.js";

export const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));

const expectedWriteSchema = z
  .object({
    /** A title, English title, Japanese title or synonym from the snapshot, or a MAL id. */
    anime: z.union([z.string().min(1), z.number().int().positive()]),
    status: z.enum(MAL_LIST_STATUSES).optional(),
    episodes_watched: z.number().int().nonnegative().optional(),
    score: z.number().int().min(0).max(10).optional(),
    is_rewatching: z.boolean().optional(),
  })
  .strict()
  .refine(
    (w) =>
      w.status !== undefined ||
      w.episodes_watched !== undefined ||
      w.score !== undefined ||
      w.is_rewatching !== undefined,
    { message: "a write needs at least one of status, episodes_watched, score, is_rewatching" },
  );

export const evalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    message: z.string().min(1),
    /** Earlier turns of the conversation, oldest first, for follow-ups like "the second one". */
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }).strict())
      .default([]),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    notes: z.string().optional(),
    expect: z
      .object({
        /** Writes that should be committed. Empty or absent means none. */
        writes: z.array(expectedWriteSchema).default([]),
        /** True if the agent should ask (a question or a held proposal) before writing. */
        clarify: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const caseFileSchema = z
  .object({
    snapshot: z.string().regex(/^[a-z0-9-]+$/),
    cases: z.array(evalCaseSchema).min(1),
  })
  .strict();

/** A validated case, with titles resolved to MAL ids and writes normalized. */
export interface ResolvedCase {
  file: string;
  snapshot: string;
  case: EvalCase;
  /** Expected change per anime id, after applying the same rules as propose_update. */
  expectedChanges: Map<number, ListChange>;
}

export interface Problem {
  file: string;
  caseId?: string;
  message: string;
}

export interface LoadResult {
  cases: ResolvedCase[];
  errors: Problem[];
  warnings: Problem[];
}

/** Loads and checks every *.yaml file in the cases directory. */
export function loadCases(
  casesDir: string = CASES_DIR,
  snapshotLoader: (name: string) => Snapshot = loadSnapshot,
): LoadResult {
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const result: LoadResult = { cases: [], errors: [], warnings: [] };
  const seenIds = new Map<string, string>();
  const indexes = new Map<string, TitleIndex | null>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(`${casesDir}${file}`, "utf8"));
    } catch (err) {
      result.errors.push({ file, message: `not valid YAML: ${(err as Error).message}` });
      continue;
    }
    const checked = caseFileSchema.safeParse(parsed);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        result.errors.push({ file, message: `${formatPath(parsed, issue.path)}${issue.message}` });
      }
      continue;
    }

    const { snapshot, cases } = checked.data;
    if (!indexes.has(snapshot)) {
      try {
        indexes.set(snapshot, new TitleIndex(snapshotLoader(snapshot)));
      } catch (err) {
        indexes.set(snapshot, null);
        result.errors.push({
          file,
          message: `can't load snapshot "${snapshot}": ${(err as Error).message}`,
        });
      }
    }
    const index = indexes.get(snapshot);
    if (!index) continue;

    for (const evalCase of cases) {
      const where = { file, caseId: evalCase.id };
      const firstFile = seenIds.get(evalCase.id);
      if (firstFile) {
        result.errors.push({ ...where, message: `duplicate case id (also in ${firstFile})` });
        continue;
      }
      seenIds.set(evalCase.id, file);

      const resolved = resolveCase(evalCase, index);
      result.errors.push(...resolved.errors.map((message) => ({ ...where, message })));
      result.warnings.push(...resolved.warnings.map((message) => ({ ...where, message })));
      if (resolved.errors.length === 0) {
        result.cases.push({ file, snapshot, case: evalCase, expectedChanges: resolved.changes });
      }
    }
  }
  return result;
}

function resolveCase(
  evalCase: EvalCase,
  index: TitleIndex,
): { changes: Map<number, ListChange>; errors: string[]; warnings: string[] } {
  const changes = new Map<number, ListChange>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const write of evalCase.expect.writes) {
    const label = JSON.stringify(write.anime);
    const found = index.resolve(write.anime);
    if (!found.ok) {
      if (found.reason === "ambiguous") {
        const ids = found.matches.map((m) => `${m.title} (id ${String(m.id)})`).join(", ");
        errors.push(`${label} matches several entries: ${ids}. Use the MAL id instead.`);
      } else {
        const hint = found.suggestions.length
          ? ` Did you mean: ${found.suggestions.join("; ")}?`
          : "";
        errors.push(`${label} isn't in the snapshot.${hint}`);
      }
      continue;
    }
    const entry = found.entry;
    if (changes.has(entry.id)) {
      errors.push(`${label} appears twice in this case's writes; combine them into one.`);
      continue;
    }

    const normalized = normalizeChange(
      { ...entry, score: 0 },
      {
        ...(write.status !== undefined && { status: write.status }),
        ...(write.episodes_watched !== undefined && { episodesWatched: write.episodes_watched }),
        ...(write.score !== undefined && { score: write.score }),
        ...(write.is_rewatching !== undefined && { isRewatching: write.is_rewatching }),
      },
    );
    if (!normalized.ok) {
      errors.push(`${label}: ${describeNormalizeError(normalized.error, entry.numEpisodes)}`);
      continue;
    }
    if (Object.keys(normalized.change).length === 0) {
      warnings.push(`${label}: this write changes nothing (the list already has these values).`);
      continue;
    }
    changes.set(entry.id, normalized.change);
  }

  if (evalCase.expect.writes.length === 0 && !evalCase.expect.clarify) {
    // Allowed: the agent should do nothing (e.g. an unrelated message). Just make it explicit.
    if (!evalCase.tags.includes("no-action")) {
      warnings.push(`expects no writes and no question; consider tagging it "no-action".`);
    }
  }
  return { changes, errors, warnings };
}

function describeNormalizeError(error: string, total: number | null): string {
  switch (error) {
    case "episodes_exceed_total":
      return `episodes_watched is more than the show's ${String(total)} episodes.`;
    case "negative_episodes":
      return "episodes_watched can't be negative.";
    default:
      return "score must be a whole number from 0 to 10.";
  }
}

function formatPath(data: unknown, path: PropertyKey[]): string {
  if (path.length === 0) return "";
  // Point at the case id when the problem is inside a case, which is easier to find than an index.
  if (path[0] === "cases" && typeof path[1] === "number") {
    const id = (data as { cases?: { id?: unknown }[] } | undefined)?.cases?.[path[1]]?.id;
    const rest = path.slice(2).join(".");
    return `case #${String(path[1] + 1)}${typeof id === "string" ? ` (${id})` : ""}${rest ? ` ${rest}` : ""}: `;
  }
  return `${path.join(".")}: `;
}
