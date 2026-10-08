import { readdirSync, readFileSync } from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

import { MEDIA_TYPES } from "../../src/recommend/candidates.js";
import { CASES_DIR, RECOMMEND_FILE, type Problem } from "./cases.js";
import type { DetailsFreeze, DiscoveryFreeze } from "./recommendData.js";
import { loadSnapshot, normalizeTitle, TitleIndex, type Snapshot } from "./snapshot.js";

/**
 * Where the picks should come from: the user's list (Plan to Watch or in progress), one part of
 * it, shows new to them, or anywhere. "started" is in progress with at least one episode watched:
 * a Watching show at episode 0 is only queued.
 */
export const PICK_SOURCES = [
  "list",
  "plan_to_watch",
  "in_progress",
  "started",
  "new",
  "any",
] as const;
export type PickSource = (typeof PICK_SOURCES)[number];

const titleOrId = z.union([z.string().min(1), z.number().int().positive()]);

export const recommendCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    message: z.string().min(1),
    /** Earlier turns of the conversation, oldest first. */
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }).strict())
      .default([]),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
    notes: z.string().optional(),
    expect: z
      .object({
        /** False when nothing should be recommended, because nothing can fit. */
        picks: z.boolean().default(true),
        /** Every pick is one of these MAL media types. */
        media_types: z.array(z.enum(MEDIA_TYPES)).min(1).optional(),
        /** Every pick's episodes (or the movie) are at most this many minutes. */
        max_episode_minutes: z.number().int().positive().optional(),
        /**
         * Minutes over max_episode_minutes still allowed when few shows fit, as long as every pick
         * that fits comes before them.
         */
        grace_minutes: z.number().int().positive().optional(),
        /** Every pick started airing in these years; either end may be left open. */
        year_from: z.number().int().min(1900).max(2100).optional(),
        year_to: z.number().int().min(1900).max(2100).optional(),
        /** Years outside year_from/year_to still allowed when few fit, after every pick inside. */
        grace_years: z.number().int().positive().optional(),
        /** The recommender should ask instead of picking (say, when "new" is unclear). */
        clarify: z.boolean().default(false),
        /** Every pick has at most this many episodes left to watch: "something I can finish". */
        max_episodes_left: z.number().int().positive().optional(),
        /** Picks should have at least one of these genres (a mood). Scored as genre fit. */
        genres_any: z.array(z.string().min(1)).min(1).optional(),
        /** No pick has any of these genres. */
        genres_none: z.array(z.string().min(1)).min(1).optional(),
        source: z.enum(PICK_SOURCES).default("any"),
        /** Shows that must never be picked: titles from the snapshot or the pool, or MAL ids. */
        must_not: z.array(titleOrId).default([]),
      })
      .strict(),
  })
  .strict();
export type RecommendCase = z.infer<typeof recommendCaseSchema>;

const recommendFileSchema = z
  .object({
    snapshot: z.string().regex(/^[a-z0-9-]+$/),
    cases: z.array(recommendCaseSchema).min(1),
  })
  .strict();

export interface ResolvedRecommendCase {
  file: string;
  snapshot: string;
  case: RecommendCase;
  /** must_not as MAL ids. */
  mustNot: Set<number>;
}

export interface RecommendLoadResult {
  cases: ResolvedRecommendCase[];
  errors: Problem[];
  warnings: Problem[];
}

/** Finds pool shows by any of their titles. */
function poolIndex(pool: DiscoveryFreeze): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const show of pool.shows) {
    const names = new Set(
      [show.title, show.titleEn, show.titleJa, ...show.synonyms]
        .filter((t): t is string => !!t)
        .map(normalizeTitle),
    );
    for (const name of names) index.set(name, [...(index.get(name) ?? []), show.malId]);
  }
  return index;
}

/**
 * Loads and checks every recommendation case file: schema, unique ids, genre names that exist
 * (spelled as MAL spells them), and must_not titles that resolve to exactly one show.
 */
export function loadRecommendCases(
  details: DetailsFreeze | null,
  pool: DiscoveryFreeze | null,
  casesDir: string = CASES_DIR,
  snapshotLoader: (name: string) => Snapshot = loadSnapshot,
): RecommendLoadResult {
  const files = readdirSync(casesDir)
    .filter((f) => RECOMMEND_FILE.test(f))
    .sort();
  const result: RecommendLoadResult = { cases: [], errors: [], warnings: [] };
  if (files.length === 0) return result;
  if (!details || !pool) {
    result.errors.push({
      file: files[0] ?? "",
      message: "the frozen show details and pool are missing: run pnpm eval:recommend-data.",
    });
    return result;
  }

  const genres = new Map<string, string>();
  for (const show of [...details.shows, ...pool.shows]) {
    for (const genre of show.genres) genres.set(genre.toLowerCase(), genre);
  }
  const inPool = new Set(pool.shows.map((s) => s.malId));
  const byPoolTitle = poolIndex(pool);
  const seenIds = new Map<string, string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(`${casesDir}${file}`, "utf8"));
    } catch (err) {
      result.errors.push({ file, message: `not valid YAML: ${(err as Error).message}` });
      continue;
    }
    const shape = recommendFileSchema.safeParse(parsed);
    if (!shape.success) {
      for (const issue of shape.error.issues) {
        result.errors.push({ file, message: `${issue.path.join(".")}: ${issue.message}` });
      }
      continue;
    }
    if (shape.data.snapshot !== details.snapshot) {
      result.errors.push({
        file,
        message: `the frozen show details are for "${details.snapshot}", not "${shape.data.snapshot}".`,
      });
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

      let ok = true;
      for (const name of [...(c.expect.genres_any ?? []), ...(c.expect.genres_none ?? [])]) {
        const known = genres.get(name.toLowerCase());
        if (!known) {
          result.errors.push(problem(`"${name}" isn't a genre on the list or in the pool.`));
          ok = false;
        } else if (known !== name) {
          result.errors.push(problem(`write "${name}" as "${known}".`));
          ok = false;
        }
      }

      const mustNot = new Set<number>();
      for (const show of c.expect.must_not) {
        if (typeof show === "number") {
          if (titles.resolve(show).ok || inPool.has(show)) mustNot.add(show);
          else {
            result.errors.push(problem(`${String(show)} is neither on the list nor in the pool.`));
            ok = false;
          }
          continue;
        }
        const onList = titles.resolve(show);
        const fromPool = byPoolTitle.get(normalizeTitle(show)) ?? [];
        const ids = new Set([...(onList.ok ? [onList.entry.id] : []), ...fromPool]);
        if (ids.size === 1) mustNot.add([...ids][0] ?? 0);
        else {
          result.errors.push(
            problem(
              ids.size === 0
                ? `"${show}" matches no show on the list or in the pool (try pnpm eval:lookup).`
                : `"${show}" matches several shows (${[...ids].join(", ")}); use a MAL id.`,
            ),
          );
          ok = false;
        }
      }

      const { year_from: from, year_to: to } = c.expect;
      if (c.expect.grace_years !== undefined && from === undefined && to === undefined) {
        result.errors.push(problem("grace_years needs year_from or year_to."));
        ok = false;
      }
      if (from !== undefined && to !== undefined && from > to) {
        result.errors.push(problem("year_from is after year_to."));
        ok = false;
      }
      if (c.expect.grace_minutes !== undefined && c.expect.max_episode_minutes === undefined) {
        result.errors.push(problem("grace_minutes needs max_episode_minutes."));
        ok = false;
      }
      if (!c.expect.picks && (c.expect.must_not.length > 0 || c.expect.genres_any)) {
        result.warnings.push(problem("expects no picks, so must_not and genres_any never apply."));
      }
      if (ok) result.cases.push({ file, snapshot: shape.data.snapshot, case: c, mustNot });
    }
  }
  return result;
}
