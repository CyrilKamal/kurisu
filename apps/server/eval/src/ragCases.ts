import { readdirSync, readFileSync } from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

import { CASES_DIR, RAG_FILE, type Problem } from "./cases.js";
import { loadSnapshot, TitleIndex, type Snapshot } from "./snapshot.js";

const titleOrId = z.union([z.string().min(1), z.number().int().positive()]);

/**
 * A question about the user's list (Milestone 7's RAG), answered from the list's documents: the
 * snapshot's entries with the frozen details and synopses. `sources` are the shows a right answer
 * draws on (retrieval should find them, and the answer should cite them); `facts` are what it
 * must say, in any words. A question the list can't answer, or about a show that isn't on it,
 * expects the answer to say so instead.
 */
export const ragCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    question: z.string().min(1),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    notes: z.string().optional(),
    expect: z
      .object({
        /** Shows a right answer draws on: snapshot titles or MAL ids. */
        sources: z.array(titleOrId).default([]),
        /** What a right answer says, one fact each. */
        facts: z.array(z.string().min(1)).default([]),
        /** The list can't answer it (it holds no scores, say): the answer should say so. */
        unanswerable: z.literal(true).optional(),
        /** It asks about a show that isn't on the list: the answer should say so. */
        not_on_list: z.literal(true).optional(),
      })
      .strict(),
  })
  .strict();
export type RagCase = z.infer<typeof ragCaseSchema>;

const ragFileSchema = z
  .object({
    snapshot: z.string().regex(/^[a-z0-9-]+$/),
    cases: z.array(ragCaseSchema).min(1),
  })
  .strict();

export interface ResolvedRagCase {
  file: string;
  snapshot: string;
  case: RagCase;
  /** The sources as MAL ids. */
  sources: number[];
  /** True when a right answer declines (unanswerable or not on the list). */
  declines: boolean;
}

export interface RagLoadResult {
  cases: ResolvedRagCase[];
  errors: Problem[];
}

/**
 * Loads and checks every RAG case file: schema, unique ids, sources that resolve to exactly one
 * snapshot entry, and either facts to check or a reason to decline.
 */
export function loadRagCases(
  casesDir: string = CASES_DIR,
  snapshotLoader: (name: string) => Snapshot = loadSnapshot,
): RagLoadResult {
  const files = readdirSync(casesDir)
    .filter((f) => RAG_FILE.test(f))
    .sort();
  const result: RagLoadResult = { cases: [], errors: [] };
  const seenIds = new Map<string, string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(`${casesDir}${file}`, "utf8"));
    } catch (err) {
      result.errors.push({ file, message: `not valid YAML: ${(err as Error).message}` });
      continue;
    }
    const shape = ragFileSchema.safeParse(parsed);
    if (!shape.success) {
      for (const issue of shape.error.issues) {
        result.errors.push({ file, message: `${issue.path.join(".")}: ${issue.message}` });
      }
      continue;
    }
    const titles = new TitleIndex(snapshotLoader(shape.data.snapshot));

    for (const c of shape.data.cases) {
      const problem = (message: string) => ({ file, caseId: c.id, message });
      const before = seenIds.get(c.id);
      if (before) {
        result.errors.push(problem(`id also used in ${before}.`));
        continue;
      }
      seenIds.set(c.id, file);

      const declines = c.expect.unanswerable === true || c.expect.not_on_list === true;
      if (!declines && c.expect.facts.length === 0) {
        result.errors.push(
          problem("give the facts a right answer states, or unanswerable / not_on_list."),
        );
        continue;
      }
      if (declines && c.expect.facts.length > 0) {
        result.errors.push(problem("a question the list can't answer has no facts to check."));
        continue;
      }
      if (!declines && c.expect.sources.length === 0) {
        result.errors.push(problem("name the shows a right answer draws on (sources)."));
        continue;
      }

      const sources: number[] = [];
      let ok = true;
      for (const show of c.expect.sources) {
        const found = titles.resolve(show);
        if (found.ok) {
          sources.push(found.entry.id);
        } else if (found.reason === "ambiguous") {
          result.errors.push(
            problem(
              `"${String(show)}" matches ${found.matches.map((m) => `${m.title} (${String(m.id)})`).join(", ")}; use the MAL id.`,
            ),
          );
          ok = false;
        } else {
          const hint = found.suggestions.length
            ? ` Did you mean ${found.suggestions.join("; ")}?`
            : "";
          result.errors.push(problem(`"${String(show)}" isn't in the snapshot.${hint}`));
          ok = false;
        }
      }
      if (ok) {
        result.cases.push({
          file,
          snapshot: shape.data.snapshot,
          case: c,
          sources: [...new Set(sources)],
          declines,
        });
      }
    }
  }
  return result;
}
