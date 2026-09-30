/**
 * Runs the eval set through the real agent against a fake MAL and reports the metrics.
 *
 *   pnpm eval                          every case, on the eval model from config/models.json
 *   pnpm eval --model ollama:qwen3.6:27b
 *   pnpm eval --tag nickname --tag multi
 *   pnpm eval --case plain-001 --file examples.yaml --limit 20
 *   pnpm eval --prompt progress-sync@1     compare an older prompt version
 *
 * Needs Docker (a throwaway Postgres) and, for local models, Ollama running.
 * Writes a full JSON report to eval/results/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { asc, eq } from "drizzle-orm";

import { CURRENT_PROMPT, PROMPTS } from "../../../src/agent/prompts/index.js";
import { runAgent } from "../../../src/agent/runAgent.js";
import { agentRunSteps } from "../../../src/db/schema.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { createModelClient } from "../../../src/llm/modelClient.js";
import {
  costUsd,
  loadModelsFile,
  parseModelRef,
  resolveRoles,
} from "../../../src/llm/modelConfig.js";
import type { ListChange } from "../../../src/writes/normalize.js";
import { loadCases, type ResolvedCase } from "../cases.js";
import { createFakeWriter, loadSnapshotIntoDb, startEvalDatabase } from "../harness.js";
import { aggregate, scoreCase, type CaseRun, type Metrics } from "../score.js";
import { loadSnapshot, type Snapshot } from "../snapshot.js";

const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    tag: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    file: { type: "string", multiple: true },
    limit: { type: "string" },
    prompt: { type: "string" },
  },
});

const promptVersion = values.prompt ?? CURRENT_PROMPT.version;
if (!Object.hasOwn(PROMPTS, promptVersion)) {
  console.error(`Unknown prompt "${promptVersion}". Known: ${Object.keys(PROMPTS).join(", ")}`);
  process.exit(1);
}
const PROMPT = PROMPTS[promptVersion as keyof typeof PROMPTS];

loadLocalEnvFile();
const modelsFile = loadModelsFile();
const roles = resolveRoles(modelsFile, {
  ...(process.env.EVAL_MODEL ? { eval: process.env.EVAL_MODEL } : {}),
});
const ref = values.model ? parseModelRef(values.model) : roles.eval;
const models = createModelClient({
  geminiApiKey: nonEmpty(process.env.GEMINI_API_KEY),
  ollamaBaseUrl: nonEmpty(process.env.OLLAMA_BASE_URL) ?? "http://127.0.0.1:11434",
  ollama: modelsFile.ollama,
});

const loaded = loadCases();
if (loaded.errors.length > 0) {
  for (const e of loaded.errors)
    console.error(`ERROR ${e.file}${e.caseId ? ` [${e.caseId}]` : ""}: ${e.message}`);
  console.error("Fix the cases first (pnpm eval:validate).");
  process.exit(1);
}
let selected = loaded.cases.filter(
  (c) =>
    (!values.tag || c.case.tags.some((t) => values.tag?.includes(t))) &&
    (!values.case || values.case.includes(c.case.id)) &&
    (!values.file || values.file.includes(c.file)),
);
if (values.limit) selected = selected.slice(0, Number(values.limit));
if (selected.length === 0) {
  console.error("No cases match the filters.");
  process.exit(1);
}

console.log(`Eval: ${String(selected.length)} cases on ${ref.ref} with ${PROMPT.version}`);
console.log("Starting a throwaway Postgres...");
const database = await startEvalDatabase();
const snapshots = new Map<string, Snapshot>();

try {
  // Warm up: loading a local model can take many seconds, which isn't latency the user sees.
  await models.chat(ref, {
    system: "Reply with OK.",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  });

  const runs: (CaseRun & { file: string; toolCalls: string[] })[] = [];
  for (const [i, resolved] of selected.entries()) {
    const run = await runCase(resolved);
    runs.push(run);
    const score = scoreCase(run);
    const mark = score.correct ? "✓" : "✗";
    console.log(
      `${mark} ${String(i + 1).padStart(3)}/${String(selected.length)} ${resolved.case.id.padEnd(30)} ${String(run.latencyMs).padStart(6)} ms`,
    );
  }

  const metrics = aggregate(runs);
  printReport(metrics, runs);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${RESULTS_DIR}${stamp}-${ref.ref.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        model: ref.ref,
        promptVersion: PROMPT.version,
        ranAt: new Date().toISOString(),
        metrics,
        cases: runs.map((r) => ({
          ...r,
          expected: Object.fromEntries(r.expected),
          actual: Object.fromEntries(r.actual),
          score: scoreCase(r),
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nFull report: ${path}`);
} finally {
  await database.close();
}

async function runCase(
  resolved: ResolvedCase,
): Promise<CaseRun & { file: string; toolCalls: string[] }> {
  let snapshot = snapshots.get(resolved.snapshot);
  if (!snapshot) {
    snapshot = loadSnapshot(resolved.snapshot);
    snapshots.set(resolved.snapshot, snapshot);
  }
  const { db } = database;
  const userId = await loadSnapshotIntoDb(db, snapshot);
  const { writer } = createFakeWriter(db);

  const result = await runAgent(
    { db, models, writeListStatus: writer, prompt: PROMPT },
    {
      userId,
      conversationId: null,
      history: resolved.case.history,
      message: resolved.case.message,
      model: ref,
    },
  );

  const actual = new Map<number, ListChange>();
  for (const change of result.committed) {
    actual.set(change.animeId, { ...actual.get(change.animeId), ...change.after });
  }
  const steps = await db
    .select({
      kind: agentRunSteps.kind,
      tool: agentRunSteps.toolName,
      args: agentRunSteps.args,
      error: agentRunSteps.error,
    })
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, result.runId))
    .orderBy(asc(agentRunSteps.seq));

  return {
    file: resolved.file,
    caseId: resolved.case.id,
    tags: resolved.case.tags,
    message: resolved.case.message,
    expectClarify: resolved.case.expect.clarify,
    expected: resolved.expectedChanges,
    actual,
    asked: result.asked || result.pending.length > 0,
    reply: result.reply,
    error: result.error,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: costUsd(modelsFile, ref, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }),
    toolCalls: steps
      .filter((s) => s.kind === "tool_call")
      .map((s) => `${s.tool ?? "?"}(${JSON.stringify(s.args)})${s.error ? ` -> ${s.error}` : ""}`),
  };
}

function printReport(metrics: Metrics, runs: (CaseRun & { toolCalls: string[] })[]): void {
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const agentPrice = costUsd(modelsFile, roles.agent, {
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
  });
  const writeCases = runs.filter((r) => r.expected.size > 0).length;

  console.log("\n=== Metrics");
  console.log(
    `Update accuracy          ${pct(metrics.updateAccuracy)}   (${String(runs.filter((r) => scoreCase(r).correct).length)}/${String(metrics.cases)} cases)`,
  );
  console.log(
    `Wrong-write rate         ${pct(metrics.wrongWriteRate)}   (${String(metrics.wrongWrites)}/${String(metrics.totalWrites)} writes)`,
  );
  console.log(
    `Clarification precision  ${pct(metrics.clarificationPrecision)}   (recall ${pct(metrics.clarificationRecall)})`,
  );
  console.log(
    `Median latency           ${String(metrics.medianLatencyMs)} ms   (p90 ${String(metrics.p90LatencyMs)} ms; write cases ${metrics.medianWriteLatencyMs === null ? "n/a" : `${String(metrics.medianWriteLatencyMs)} ms`})`,
  );
  console.log(
    `Cost per update          ${metrics.costPerUpdateUsd === null ? "n/a" : `$${metrics.costPerUpdateUsd.toFixed(6)}`} on ${ref.ref}` +
      (agentPrice !== null && writeCases > 0
        ? `; at ${roles.agent.ref} paid prices ≈ $${(agentPrice / runs.length).toFixed(6)} per case`
        : ""),
  );
  console.log(`Errors                   ${String(metrics.errors)}`);
  console.log(
    `Tokens                   ${String(metrics.inputTokens)} in / ${String(metrics.outputTokens)} out`,
  );

  const tags = [...new Set(runs.flatMap((r) => r.tags))].sort();
  if (tags.length > 0) {
    console.log("\n=== By tag");
    for (const tag of tags) {
      const tagged = runs.filter((r) => r.tags.includes(tag));
      const right = tagged.filter((r) => scoreCase(r).correct).length;
      console.log(
        `${tag.padEnd(16)} ${pct(right / tagged.length).padStart(6)}  (${String(right)}/${String(tagged.length)})`,
      );
    }
  }

  const failures = runs.filter((r) => !scoreCase(r).correct);
  if (failures.length > 0) {
    console.log("\n=== Failures");
    for (const f of failures) {
      const fmt = (m: Map<number, ListChange>) =>
        m.size === 0
          ? "nothing"
          : [...m].map(([id, c]) => `${String(id)} ${JSON.stringify(c)}`).join("; ");
      console.log(`\n✗ ${f.caseId}: "${f.message}"`);
      console.log(`  expected: ${fmt(f.expected)}${f.expectClarify ? " + ask" : ""}`);
      console.log(
        `  actual:   ${fmt(f.actual)}${f.asked ? " + asked" : ""}${f.error ? ` [error: ${f.error}]` : ""}`,
      );
      console.log(`  reply:    ${JSON.stringify(f.reply.slice(0, 200))}`);
      for (const call of f.toolCalls) console.log(`  tool:     ${call.slice(0, 200)}`);
    }
  }
}

/** .env files write unset variables as empty strings. */
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}
