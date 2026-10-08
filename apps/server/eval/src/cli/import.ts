/**
 * Runs the import cases (eval/cases/import-*.yaml) through the app's own import code: the model
 * reads the notes, code matches each show (on the snapshot's list, then in the frozen AniList
 * catalog) and groups it. Each row is compared with what the case expects. Nothing is written.
 *
 *   pnpm eval:import                          every case, on the agent model in config/models.json
 *   pnpm eval:import --case import-example-merge
 *   pnpm eval:import --model gemini:gemini-3.8-flash
 *
 * Needs Docker (a throwaway Postgres). Writes a full JSON report to eval/results/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { IMPORT_V1 } from "../../../src/agent/prompts/import.v1.js";
import { prepareImport } from "../../../src/import/service.js";
import { noteLines } from "../../../src/import/parse.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { createModelClient } from "../../../src/llm/modelClient.js";
import {
  costUsd,
  loadModelsFile,
  parseModelRef,
  resolveRoles,
} from "../../../src/llm/modelConfig.js";
import { frozenCatalogSearch, loadCatalog } from "../catalog.js";
import { loadSnapshotIntoDb, startEvalDatabase } from "../harness.js";
import { loadImportCases, type ResolvedImportCase } from "../importCases.js";
import {
  aggregateImport,
  scoreImport,
  type ImportMetrics,
  type ImportRun,
  type ProducedRow,
} from "../importScore.js";
import { loadSnapshot, type Snapshot } from "../snapshot.js";
import { throttle } from "../throttle.js";

const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));
const DEFAULT_GEMINI_RPM = 60;

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    tag: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    file: { type: "string", multiple: true },
    limit: { type: "string" },
    rpm: { type: "string" },
  },
});

loadLocalEnvFile();
const modelsFile = loadModelsFile();
const roles = resolveRoles(modelsFile, {
  ...(process.env.AGENT_MODEL ? { agent: process.env.AGENT_MODEL } : {}),
});
const ref = values.model ? parseModelRef(values.model) : roles.agent;
const client = createModelClient({
  geminiApiKey: nonEmpty(process.env.GEMINI_API_KEY),
  ollamaBaseUrl: nonEmpty(process.env.OLLAMA_BASE_URL) ?? "http://127.0.0.1:11434",
  ollama: modelsFile.ollama,
});
const rpm = values.rpm ? Number(values.rpm) : ref.provider === "gemini" ? DEFAULT_GEMINI_RPM : null;
if (rpm !== null && !(rpm > 0)) {
  console.error("--rpm must be a positive number.");
  process.exit(1);
}
const models = rpm === null ? { ...client, waitedMs: 0 } : throttle(client, rpm);

const catalogFreeze = loadCatalog();
const loaded = loadImportCases(catalogFreeze);
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
  console.error("No import cases match the filters.");
  process.exit(1);
}

const catalog = frozenCatalogSearch(catalogFreeze);
const snapshots = new Map<string, Snapshot>();

console.log(
  `Import eval: ${String(selected.length)} cases on ${ref.ref} with ${IMPORT_V1.version}`,
);
console.log("Starting a throwaway Postgres...");
const database = await startEvalDatabase();

try {
  const runs: ImportRun[] = [];
  for (const [i, resolved] of selected.entries()) {
    const run = await runCase(resolved);
    runs.push(run);
    const right = run.error === null && run.verdicts.every((v) => v.right);
    const wrongChecked = run.verdicts.filter((v) => v.wrongPrechecked).length;
    console.log(
      `${right ? "✓" : "✗"} ${String(i + 1).padStart(3)}/${String(selected.length)} ${resolved.case.id.padEnd(32)} ${String(run.latencyMs).padStart(6)} ms  ${String(run.verdicts.filter((v) => v.right).length)}/${String(run.verdicts.length)} rows${wrongChecked > 0 ? `  ${String(wrongChecked)} WRONG PRE-CHECKED` : ""}`,
    );
  }

  const metrics = aggregateImport(runs);
  printReport(metrics, runs);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${RESULTS_DIR}import-${stamp}-${ref.ref.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        model: ref.ref,
        prompt: IMPORT_V1.version,
        ranAt: new Date().toISOString(),
        metrics,
        cases: runs,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nFull report: ${path}`);
} finally {
  await database.close();
}

async function runCase(resolved: ResolvedImportCase): Promise<ImportRun> {
  let snapshot = snapshots.get(resolved.snapshot);
  if (!snapshot) {
    snapshot = loadSnapshot(resolved.snapshot);
    snapshots.set(resolved.snapshot, snapshot);
  }
  const { db } = database;
  const userId = await loadSnapshotIntoDb(db, snapshot);
  const lines = noteLines(resolved.case.notes).map((l) => l.lineNo);

  const waitedBefore = models.waitedMs;
  const started = performance.now();
  let rows = null;
  let error: string | null = null;
  try {
    rows = await prepareImport(
      { db, models, model: ref, prompt: IMPORT_V1, catalog },
      userId,
      resolved.case.notes,
    );
    if (!rows) error = "parse_failed";
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : "error";
  }
  const latencyMs = Math.round(performance.now() - started - (models.waitedMs - waitedBefore));

  // The model's token use, from the runs it logged for this user.
  const usage = await db.execute<{ input: number; output: number }>(sql`
    SELECT coalesce(sum(input_tokens), 0)::int AS input, coalesce(sum(output_tokens), 0)::int AS output
    FROM agent_runs WHERE user_id = ${userId}
  `);
  const inputTokens = usage.rows[0]?.input ?? 0;
  const outputTokens = usage.rows[0]?.output ?? 0;

  const produced: ProducedRow[] = (rows ?? []).map((row) => ({
    line: row.lineNo,
    position: row.position,
    group: row.group,
    animeId: row.animeId ?? null,
    candidates: row.candidates ?? [],
    change: row.change ?? null,
    checked: row.checked ?? false,
    said: row.said,
  }));
  return {
    caseId: resolved.case.id,
    file: resolved.file,
    tags: resolved.case.tags,
    notes: resolved.case.notes,
    verdicts: scoreImport(resolved.rows, produced, lines),
    error,
    latencyMs,
    costUsd: costUsd(modelsFile, ref, { inputTokens, outputTokens }),
    inputTokens,
    outputTokens,
  };
}

function printReport(metrics: ImportMetrics, runs: ImportRun[]): void {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  console.log("\n=== Metrics");
  console.log(
    `Wrong pre-checked rows   ${String(metrics.wrongPrechecked)}   (of ${String(metrics.prechecked)} pre-checked; must be 0)`,
  );
  console.log(
    `Rows right               ${pct(metrics.rowsRight, metrics.rows)}   (${String(metrics.rowsRight)}/${String(metrics.rows)})`,
  );
  console.log(
    `Cases right              ${pct(metrics.casesRight, metrics.cases)}   (${String(metrics.casesRight)}/${String(metrics.cases)})`,
  );
  console.log(
    `"?" precision            ${pct(metrics.askPrecision.right, metrics.askPrecision.made)}   (recall ${pct(metrics.askRecall.found, metrics.askRecall.expected)})`,
  );
  console.log(`Median latency           ${String(metrics.medianLatencyMs)} ms`);
  console.log(
    `Cost per case            ${metrics.costPerCaseUsd === null ? "n/a" : `$${metrics.costPerCaseUsd.toFixed(5)}`}`,
  );
  console.log(`Errors                   ${String(metrics.errors)}`);

  const failures = runs.filter((r) => r.error !== null || r.verdicts.some((v) => !v.right));
  if (failures.length > 0) {
    console.log("\n=== Failures");
    for (const run of failures) {
      console.log(`\n✗ ${run.caseId}${run.error ? ` [error: ${run.error}]` : ""}`);
      for (const v of run.verdicts.filter((x) => !x.right)) {
        console.log(
          `  line ${String(v.line)}${v.wrongPrechecked ? " PRE-CHECKED" : ""}: ${v.why ?? ""}  (said: ${JSON.stringify(v.produced?.said ?? "")})`,
        );
      }
    }
  }
}

/** .env files write unset variables as empty strings. */
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}
