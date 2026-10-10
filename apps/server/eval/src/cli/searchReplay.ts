/**
 * Replays the list searches a recorded eval run made, with and without the lab's vector channel,
 * and reports where the expected show lands. No model is called, so it's free and repeatable:
 *
 *   pnpm lab:search-replay --results eval/results/<run>.json
 *
 * For every search_my_list call in a case that expects a write, it searches the case's snapshot
 * with the same queries and the user's message, and counts how often the expected show is first,
 * in the five results the model sees, and clear: with trigram alone, and with vectors under each
 * rule for shows only the meaning found (MeaningSearch.extras), counting how often those were
 * right and how close.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { ensureTitleEmbeddings } from "../../../src/lab/titles.js";
import { searchMyList, type SearchCandidate } from "../../../src/list/search.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { createEmbedder } from "../../../src/llm/modelClient.js";
import { loadModelsFile, resolveEmbedding } from "../../../src/llm/modelConfig.js";
import { loadAiring } from "../airing.js";
import { loadCases } from "../cases.js";
import { cachedEmbedder } from "../embedCache.js";
import { loadSnapshotIntoDb, startEvalDatabase } from "../harness.js";
import { loadSnapshot } from "../snapshot.js";

const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));

const { values } = parseArgs({ options: { results: { type: "string" } } });

/** The newest plain update-eval result here, when --results isn't given. */
function newestResult(): string | null {
  if (!existsSync(RESULTS_DIR)) return null;
  const names = readdirSync(RESULTS_DIR)
    .filter((name) => /^\d{4}-.*\.json$/.test(name) && !name.includes("vectors"))
    .sort();
  const last = names.at(-1);
  return last ? `${RESULTS_DIR}${last}` : null;
}

const resultsFile = values.results ?? newestResult();
if (!resultsFile || !existsSync(resultsFile)) {
  console.error("Pass --results <an update eval's JSON report> (eval/results/ is per checkout).");
  process.exit(1);
}

interface RecordedCase {
  file: string;
  caseId: string;
  message: string;
  expected: Record<string, unknown>;
  toolCalls: string[];
}
const recorded = JSON.parse(readFileSync(resultsFile, "utf8")) as {
  model: string;
  ranAt: string;
  cases: RecordedCase[];
};

loadLocalEnvFile();
/** .env files write unset variables as empty strings. */
const nonEmpty = (value: string | undefined): string | null =>
  value !== undefined && value.length > 0 ? value : null;
const modelsFile = loadModelsFile();
const embedder = cachedEmbedder(
  createEmbedder({
    ref: resolveEmbedding(modelsFile, nonEmpty(process.env.EMBEDDING_MODEL) ?? undefined),
    geminiApiKey: null,
    ollamaBaseUrl: nonEmpty(process.env.OLLAMA_BASE_URL) ?? "http://127.0.0.1:11434",
    ollama: modelsFile.ollama,
  }),
);

const airing = loadAiring();
const snapshotOf = new Map(
  loadCases(undefined, undefined, airing).cases.map((c) => [c.case.id, c.snapshot] as const),
);

/** The queries of a recorded call like `search_my_list({"queries":["ping ping"]})`. */
function queriesOf(call: string): string[] | null {
  const match = /^search_my_list\((\{.*\})\)(?: -> .*)?$/s.exec(call);
  if (!match?.[1]) return null;
  try {
    const args = JSON.parse(match[1]) as { queries?: unknown };
    return Array.isArray(args.queries)
      ? args.queries.filter((q): q is string => typeof q === "string")
      : null;
  } catch {
    return null;
  }
}

/** Trigram alone, then vectors with each rule for meaning-only shows (MeaningSearch.extras). */
const EXTRAS = ["never", "always"] as const;
const MODES = ["trigram", ...EXTRAS] as const;
type Mode = (typeof MODES)[number];
const tally = Object.fromEntries(
  MODES.map((mode) => [mode, { searches: 0, first: 0, topFive: 0, clear: 0 }]),
) as Record<Mode, { searches: number; first: number; topFive: number; clear: number }>;
/** Similarities of shows only the meaning found, right or wrong, per rule. */
const meaningOnly = Object.fromEntries(
  EXTRAS.map((mode) => [mode, { right: [] as number[], wrong: [] as number[] }]),
) as Record<(typeof EXTRAS)[number], { right: number[]; wrong: number[] }>;
const changed: {
  caseId: string;
  queries: string[];
  expected: number;
  ranks: Record<Mode, number>;
}[] = [];

console.log(`Replaying the searches of ${resultsFile} (${recorded.model}, ${recorded.ranAt})…`);
const database = await startEvalDatabase();
try {
  const { db } = database;
  let loadedSnapshot: string | null = null;
  let userId = "";
  for (const run of recorded.cases) {
    const expected = Object.keys(run.expected).map(Number);
    const searches = run.toolCalls.map(queriesOf).filter((q): q is string[] => q !== null);
    if (searches.length === 0) continue;
    const snapshotName = snapshotOf.get(run.caseId);
    if (!snapshotName) continue;
    if (snapshotName !== loadedSnapshot) {
      const snapshot = loadSnapshot(snapshotName);
      userId = await loadSnapshotIntoDb(db, snapshot, airing);
      await ensureTitleEmbeddings(
        { db, embedder },
        snapshot.entries.map((e) => e.id),
      );
      loadedSnapshot = snapshotName;
    }

    for (const queries of searches) {
      const base = { userText: run.message, groundIn: [run.message] };
      const results = {
        trigram: await searchMyList(db, userId, queries, base),
      } as Record<Mode, SearchCandidate[]>;
      for (const extras of EXTRAS) {
        results[extras] = await searchMyList(db, userId, queries, {
          ...base,
          meaning: { embedder, extras },
        });
        for (const c of results[extras]) {
          if (c.byMeaning === undefined) continue;
          const bucket = meaningOnly[extras];
          (expected.includes(c.animeId) ? bucket.right : bucket.wrong).push(c.byMeaning);
        }
      }
      for (const id of expected) {
        const ranks = { trigram: -1, never: -1, always: -1 };
        for (const mode of MODES) {
          const list = results[mode];
          const at = list.findIndex((c) => c.animeId === id);
          ranks[mode] = at;
          tally[mode].searches += 1;
          if (at === 0) tally[mode].first += 1;
          if (at >= 0) tally[mode].topFive += 1;
          if (list[at]?.clear === true) tally[mode].clear += 1;
        }
        if (EXTRAS.some((mode) => ranks[mode] !== ranks.trigram)) {
          changed.push({ caseId: run.caseId, queries, expected: id, ranks });
        }
      }
    }
  }
} finally {
  embedder.save();
  await database.close();
}

const pct = (n: number, of: number) => (of === 0 ? "n/a" : `${((n / of) * 100).toFixed(1)}%`);
console.log("\n=== Expected show, per recorded search");
console.log("mode       searches   first    top 5    clear   (vectors: meaning-only shows added)");
for (const mode of MODES) {
  const t = tally[mode];
  console.log(
    `${(mode === "trigram" ? mode : `vec/${mode}`).padEnd(10)} ${String(t.searches).padStart(8)}   ${pct(t.first, t.searches).padStart(6)}   ${pct(t.topFive, t.searches).padStart(6)}   ${pct(t.clear, t.searches).padStart(6)}`,
  );
}
const median = (xs: number[]) =>
  xs.length === 0
    ? "n/a"
    : ([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0).toFixed(3);
for (const mode of EXTRAS) {
  const { right, wrong } = meaningOnly[mode];
  console.log(
    `vec/${mode}: found by meaning only, ${String(right.length)} right (median ${median(right)}), ${String(wrong.length)} wrong (median ${median(wrong)})`,
  );
}
if (changed.length > 0) {
  console.log(
    "\n=== Searches where vectors moved the expected show (rank trigram -> never/always; -1 = not shown)",
  );
  for (const c of changed) {
    const { trigram, never, always } = c.ranks;
    console.log(
      `${c.caseId}  ${JSON.stringify(c.queries)}  ${String(trigram)} -> ${String(never)}/${String(always)}`,
    );
  }
}
console.log(
  `\n(embeddings: ${String(embedder.stats.hits)} cached, ${String(embedder.stats.misses)} new)`,
);

mkdirSync(RESULTS_DIR, { recursive: true });
const out = `${RESULTS_DIR}search-replay-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(
  out,
  `${JSON.stringify({ from: resultsFile, embedding: embedder.model, tally, meaningOnly, changed }, null, 2)}\n`,
);
console.log(`Report: ${out}`);
