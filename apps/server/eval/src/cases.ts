import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { z } from "zod";

import { mentionsNewestEpisode } from "../../src/agent/newestEpisode.js";
import { mentionsNumber } from "../../src/agent/scoreGiven.js";
import { MAL_LIST_STATUSES } from "../../src/mal/client.js";
import { normalizeChange, type ListChange } from "../../src/writes/normalize.js";
import { isProgress, isProgressBeforeAiring } from "../../src/writes/propose.js";
import { parseShorthand } from "./shorthand.js";
import { briefAllows, type BriefRule } from "../../src/agent/briefReply.js";
import { frozenLatestAired, loadAiring, type AiringFreeze } from "./airing.js";
import { normalizeName } from "../../src/list/seasons.js";
import { addChange } from "../../src/writes/propose.js";
import { briefReplyFor } from "./brief.js";
import { loadCatalog, type CatalogFreeze } from "./catalog.js";
import { loadSnapshot, TitleIndex, type Snapshot } from "./snapshot.js";

export const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));
/** Recommendation cases have their own format and runner (recommendCases.ts). */
export const RECOMMEND_FILE = /^recommend-.*\.ya?ml$/;
/** Import cases too (importCases.ts). */
export const IMPORT_FILE = /^import-.*\.ya?ml$/;

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

/** A show the agent should propose adding (held for the user's tap), with what the user said. */
const expectedAddSchema = z
  .object({
    /** The show's title, English title or a synonym in the frozen catalog, or its MAL id. */
    anime: z.union([z.string().min(1), z.number().int().positive()]),
    status: z.enum(MAL_LIST_STATUSES).optional(),
    episodes_watched: z.number().int().nonnegative().optional(),
    score: z.number().int().min(0).max(10).optional(),
  })
  .strict();

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
        /**
         * Shows not on the list the agent should propose adding. Every add waits for the user, so
         * these count as asking. Titles resolve against the frozen catalog (snapshots/catalog.json).
         */
        adds: z.array(expectedAddSchema).default([]),
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
  /** Expected held add per anime id, normalized the same way. */
  expectedAdds: Map<number, ListChange>;
}

export interface Problem {
  file: string;
  /** Set for shorthand (.txt) files. */
  line?: number;
  caseId?: string;
  message: string;
}

export interface LoadResult {
  cases: ResolvedCase[];
  errors: Problem[];
  warnings: Problem[];
}

/** Loads and checks every case file in the cases directory: YAML, or shorthand (.txt). */
export function loadCases(
  casesDir: string = CASES_DIR,
  snapshotLoader: (name: string) => Snapshot = loadSnapshot,
  airing: AiringFreeze | null = loadAiring(),
  catalog: CatalogFreeze | null = loadCatalog(),
): LoadResult {
  const files = readdirSync(casesDir)
    .filter((f) => /\.(ya?ml|txt)$/.test(f) && !RECOMMEND_FILE.test(f) && !IMPORT_FILE.test(f))
    .sort();
  const result: LoadResult = { cases: [], errors: [], warnings: [] };
  const seenIds = new Map<string, string>();
  const indexes = new Map<string, TitleIndex | null>();

  for (const file of files) {
    const text = readFileSync(`${casesDir}${file}`, "utf8");
    let parsed: unknown;
    let lineOf = new Map<string, number>();
    if (file.endsWith(".txt")) {
      const shorthand = parseShorthand(text, file.replace(/\.txt$/, ""));
      result.errors.push(...shorthand.errors.map((e) => ({ file, ...e })));
      if (shorthand.cases.length === 0) {
        if (shorthand.errors.length === 0) result.errors.push({ file, message: "no cases yet." });
        continue;
      }
      parsed = { snapshot: shorthand.snapshot, cases: shorthand.cases };
      lineOf = shorthand.lineOf;
    } else {
      try {
        parsed = parse(text);
      } catch (err) {
        result.errors.push({ file, message: `not valid YAML: ${(err as Error).message}` });
        continue;
      }
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
      const line = lineOf.get(evalCase.id);
      const where = { file, caseId: evalCase.id, ...(line !== undefined && { line }) };
      const firstFile = seenIds.get(evalCase.id);
      if (firstFile) {
        result.errors.push({ ...where, message: `duplicate case id (also in ${firstFile})` });
        continue;
      }
      seenIds.set(evalCase.id, file);

      const resolved = resolveCase(evalCase, index, airing);
      const adds = resolveAdds(evalCase, index, catalog);
      const errors = [...resolved.errors, ...adds.errors];
      result.errors.push(...errors.map((message) => ({ ...where, message })));
      result.warnings.push(...resolved.warnings.map((message) => ({ ...where, message })));
      if (errors.length === 0) {
        result.cases.push({
          file,
          snapshot,
          case: evalCase,
          expectedChanges: resolved.changes,
          expectedAdds: adds.changes,
        });
      }
    }
  }
  return result;
}

/**
 * The adds a case expects, by MAL id: each show found in the frozen catalog (or given by MAL id)
 * and not already on the snapshot's list, with the change the add would make.
 */
function resolveAdds(
  evalCase: EvalCase,
  index: TitleIndex,
  catalog: CatalogFreeze | null,
): { changes: Map<number, ListChange>; errors: string[] } {
  const changes = new Map<number, ListChange>();
  const errors: string[] = [];
  const shows = (catalog?.searches ?? []).flatMap((s) => s.shows);
  for (const add of evalCase.expect.adds) {
    const label = JSON.stringify(add.anime);
    const matches =
      typeof add.anime === "number"
        ? shows.filter((s) => s.malId === add.anime)
        : shows.filter((s) =>
            [s.title, s.titleEn, ...s.synonyms].some(
              (n) => n !== null && normalizeName(n) === normalizeName(add.anime as string),
            ),
          );
    const ids = [...new Set(matches.map((s) => s.malId))];
    const malId = typeof add.anime === "number" ? add.anime : ids[0];
    if (typeof add.anime === "string" && ids.length > 1) {
      errors.push(`${label} matches several shows in the catalog. Use the MAL id instead.`);
      continue;
    }
    if (malId === undefined || malId === null) {
      errors.push(
        `${label} isn't in the frozen catalog. Run pnpm eval:catalog "${String(add.anime)}" to add it.`,
      );
      continue;
    }
    if (index.resolve(malId).ok) {
      errors.push(`${label} is already on the snapshot's list: that's an update, not an add.`);
      continue;
    }
    const show = matches[0] ?? shows.find((s) => s.malId === malId);
    const change = addChange(show?.episodes ?? null, {
      ...(add.status !== undefined && { status: add.status }),
      ...(add.episodes_watched !== undefined && { episodesWatched: add.episodes_watched }),
      ...(add.score !== undefined && { score: add.score }),
    });
    if (!change.ok) {
      errors.push(`${label}: ${describeNormalizeError(change.error, show?.episodes ?? null)}`);
      continue;
    }
    changes.set(malId, change.change);
  }
  return { changes, errors };
}

function resolveCase(
  evalCase: EvalCase,
  index: TitleIndex,
  airing: AiringFreeze | null,
): { changes: Map<number, ListChange>; errors: string[]; warnings: string[] } {
  const changes = new Map<number, ListChange>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const briefReply = briefReplyFor(evalCase.message, evalCase.history, index);

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
    if (isProgressBeforeAiring(entry, normalized.change)) {
      warnings.push(
        `${label}: the snapshot says this show hasn't aired yet, so the agent holds progress on it for confirmation instead of writing it. Expect clarify: true and no write for it, unless you're testing that rule.`,
      );
    } else if (briefCovers(briefReply, entry.id)) {
      // The same rules the agent's tools apply to a reply to the brief (agent/briefReply.ts).
      const listed = briefReply?.listed.get(entry.id) ?? [];
      const rule: BriefRule =
        listed.length === 0 || !briefReply
          ? { kind: "last" }
          : briefReply.unnamed.has(entry.id)
            ? { kind: "unnamed" }
            : briefReply.rule;
      if (
        isProgress(entry, normalized.change) &&
        !briefAllows(rule, listed, entry.episodesWatched, normalized.change.episodesWatched)
      ) {
        warnings.push(
          `${label}: the message replies to the brief in its history, which ${listed.length === 0 ? "doesn't list this show" : `listed ${listed.length === 1 ? "ep" : "eps"} ${listed.join(", ")} for it`}. By the brief-reply rules (${rule.kind}), this write is held for confirmation.`,
        );
      }
    } else if (mentionsNewestEpisode(evalCase.message) && isProgress(entry, normalized.change)) {
      const latest = frozenLatestAired(airing, entry.id);
      if (latest === null) {
        warnings.push(
          `${label}: the message means "the newest episode" without a number, and the frozen airing data (snapshots/airing.json) has no latest episode for this show, so the agent holds progress for confirmation. Expect clarify: true and no write for it, unless you're testing that rule.`,
        );
      } else if (normalized.change.episodesWatched !== latest) {
        warnings.push(
          `${label}: the message means "the newest episode", which the frozen airing data says is ep ${String(latest)}. A write of any other episode is held for confirmation.`,
        );
      }
    } else if (normalized.change.score !== undefined && !mentionsNumber(evalCase.message)) {
      warnings.push(
        `${label}: the message has no number in it, so the agent holds a score for confirmation instead of writing it. Expect clarify: true and no write for it, unless you're testing that rule.`,
      );
    }
    changes.set(entry.id, normalized.change);
  }

  // An expected add is held for the user, which counts as asking.
  const asks = evalCase.expect.clarify || evalCase.expect.adds.length > 0;
  if (evalCase.expect.writes.length === 0 && !asks) {
    // Allowed: the agent should do nothing (e.g. an unrelated message). Just make it explicit.
    if (!evalCase.tags.includes("no-action")) {
      warnings.push(`expects no writes and no question; consider tagging it "no-action".`);
    }
  }
  return { changes, errors, warnings };
}

/**
 * Whether the brief-reply rules decide this show's progress: the brief listed it, or the message
 * claims the whole brief ("watched it" can't touch a show the brief didn't list).
 */
function briefCovers(reply: ReturnType<typeof briefReplyFor>, animeId: number): boolean {
  return reply !== null && (reply.listed.has(animeId) || reply.whole);
}

function describeNormalizeError(error: string, total: number | null): string {
  switch (error) {
    case "episodes_exceed_total":
      return `episodes_watched is more than the show's ${String(total)} episodes.`;
    case "negative_episodes":
      return "episodes_watched can't be negative.";
    case "rewatch_not_completed":
      return "is_rewatching only applies to a show that's completed.";
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
