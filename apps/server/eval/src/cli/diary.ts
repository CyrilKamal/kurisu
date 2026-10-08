/**
 * Runs the diary reader (diary/reader.ts) over the update cases' messages, as if each case's
 * expected writes had just committed. The progress agent doesn't run: the reader only ever sees
 * a message and the shows it updated, so this measures the reader alone, for a few cents.
 *
 *   pnpm eval:diary                       every update case with expected writes
 *   pnpm eval:diary --file examples.yaml
 *   pnpm eval:diary --prompt diary@1 --model gemini:gemini-3.5-flash-lite
 *
 * A case labeled `reaction: true` must save a note, `reaction: false` must save none. Notes saved
 * in unlabeled cases are listed, to read through. Needs Docker (a throwaway Postgres for the
 * run log). Writes a JSON report to eval/results/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { DIARY_PROMPT, DIARY_PROMPTS } from "../../../src/agent/prompts/index.js";
import { readReactions } from "../../../src/diary/reader.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { createModelClient } from "../../../src/llm/modelClient.js";
import {
  costUsd,
  loadModelsFile,
  parseModelRef,
  resolveRoles,
} from "../../../src/llm/modelConfig.js";
import { loadCases } from "../cases.js";
import { loadSnapshotIntoDb, startEvalDatabase } from "../harness.js";
import { loadSnapshot, type Snapshot } from "../snapshot.js";
import { throttle } from "../throttle.js";

const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    prompt: { type: "string" },
    file: { type: "string", multiple: true },
    rpm: { type: "string" },
  },
});

const version = values.prompt ?? DIARY_PROMPT.version;
if (!Object.hasOwn(DIARY_PROMPTS, version)) {
  console.error(`Unknown prompt "${version}". Known: ${Object.keys(DIARY_PROMPTS).join(", ")}`);
  process.exit(1);
}
const prompt = DIARY_PROMPTS[version as keyof typeof DIARY_PROMPTS];

loadLocalEnvFile();
const modelsFile = loadModelsFile();
const roles = resolveRoles(modelsFile, {
  ...(process.env.AGENT_MODEL ? { agent: process.env.AGENT_MODEL } : {}),
});
// The app reads the diary with the agent's model.
const ref = values.model ? parseModelRef(values.model) : roles.agent;
const client = createModelClient({
  geminiApiKey: nonEmpty(process.env.GEMINI_API_KEY),
  ollamaBaseUrl: nonEmpty(process.env.OLLAMA_BASE_URL) ?? "http://127.0.0.1:11434",
  ollama: modelsFile.ollama,
});
const rpm = values.rpm ? Number(values.rpm) : ref.provider === "gemini" ? 60 : null;
const models = rpm === null ? { ...client, waitedMs: 0 } : throttle(client, rpm);

const loaded = loadCases();
if (loaded.errors.length > 0) {
  console.error("Fix the cases first (pnpm eval:validate).");
  process.exit(1);
}
const selected = loaded.cases.filter(
  (c) => c.expectedChanges.size > 0 && (!values.file || values.file.includes(c.file)),
);

interface DiaryRun {
  caseId: string;
  message: string;
  expect: boolean | null;
  notes: { animeId: number; text: string }[];
  error: boolean;
  latencyMs: number;
  costUsd: number | null;
}

console.log(`Diary eval: ${String(selected.length)} messages on ${ref.ref} with ${prompt.version}`);
console.log("Starting a throwaway Postgres...");
const database = await startEvalDatabase();
try {
  const snapshots = new Map<string, { snapshot: Snapshot; userId: string }>();
  const runs: DiaryRun[] = [];
  for (const resolved of selected) {
    let loadedSnapshot = snapshots.get(resolved.snapshot);
    if (!loadedSnapshot) {
      const snapshot = loadSnapshot(resolved.snapshot);
      loadedSnapshot = { snapshot, userId: await loadSnapshotIntoDb(database.db, snapshot) };
      snapshots.clear();
      snapshots.set(resolved.snapshot, loadedSnapshot);
    }
    const { snapshot, userId } = loadedSnapshot;
    const titles = new Map(snapshot.entries.map((e) => [e.id, e.title]));
    const shows = [...resolved.expectedChanges.keys()].map((animeId) => ({
      animeId,
      title: titles.get(animeId) ?? `#${String(animeId)}`,
    }));

    const before = await usage(userId);
    const waitedBefore = models.waitedMs;
    const started = performance.now();
    const notes = await readReactions(
      { db: database.db, models, model: ref, prompt },
      userId,
      resolved.case.message,
      shows,
    );
    const latencyMs = Math.round(performance.now() - started - (models.waitedMs - waitedBefore));
    const after = await usage(userId);
    const run: DiaryRun = {
      caseId: resolved.case.id,
      message: resolved.case.message,
      expect: resolved.case.expect.reaction ?? null,
      notes: notes ?? [],
      error: notes === null,
      latencyMs,
      costUsd: costUsd(modelsFile, ref, {
        inputTokens: after.input - before.input,
        outputTokens: after.output - before.output,
      }),
    };
    runs.push(run);
    const right = run.expect === null ? null : run.notes.length > 0 === run.expect;
    const mark = run.error
      ? "!"
      : right === false
        ? "✗"
        : right
          ? "✓"
          : run.notes.length
            ? "•"
            : " ";
    console.log(
      `${mark} ${resolved.case.id.padEnd(48)} ${run.notes.map((n) => JSON.stringify(n.text)).join(" ")}`,
    );
  }

  const labeled = runs.filter((r) => r.expect !== null);
  const right = labeled.filter((r) => r.notes.length > 0 === r.expect);
  const unlabeledNotes = runs.filter((r) => r.expect === null && r.notes.length > 0);
  const costs = runs.map((r) => r.costUsd);
  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  console.log("\n=== Metrics");
  console.log(`Labeled cases right      ${String(right.length)}/${String(labeled.length)}`);
  console.log(
    `Unlabeled with a note    ${String(unlabeledNotes.length)}/${String(runs.length - labeled.length)} (read them above, marked •)`,
  );
  console.log(`Errors                   ${String(runs.filter((r) => r.error).length)}`);
  console.log(
    `Median latency           ${String(latencies[Math.floor(latencies.length / 2)] ?? 0)} ms`,
  );
  console.log(
    `Cost per message         ${costs.some((c) => c === null) ? "n/a" : `$${((costs as number[]).reduce((a, b) => a + b, 0) / Math.max(1, costs.length)).toFixed(5)}`}`,
  );

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${RESULTS_DIR}diary-${stamp}-${ref.ref.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
  writeFileSync(
    path,
    `${JSON.stringify({ model: ref.ref, prompt: prompt.version, ranAt: new Date().toISOString(), runs }, null, 2)}\n`,
  );
  console.log(`\nFull report: ${path}`);
} finally {
  await database.close();
}

/** The model's token use so far, from the runs it logged for this user. */
async function usage(userId: string): Promise<{ input: number; output: number }> {
  const result = await database.db.execute<{ input: number; output: number }>(sql`
    SELECT coalesce(sum(input_tokens), 0)::int AS input, coalesce(sum(output_tokens), 0)::int AS output
    FROM agent_runs WHERE user_id = ${userId}
  `);
  return result.rows[0] ?? { input: 0, output: 0 };
}

/** .env files write unset variables as empty strings. */
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}
