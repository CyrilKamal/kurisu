/**
 * Milestone 7's RAG eval: asks each question in eval/cases/rag-*.yaml about the snapshot's list,
 * answered from its documents (the snapshot's entries with the frozen details and synopses), and
 * grades the answers.
 *
 *   pnpm eval:rag                                    every case, on config/models.json's lab models
 *   pnpm eval:rag --case rag-example-dropped --limit 5
 *   pnpm eval:rag --model gemini:gemini-3.5-flash-lite   another answering model
 *   pnpm eval:rag --judge gemini:gemini-3.8-flash        another judge
 *   pnpm eval:rag --prompt ask@1 --k 5
 *
 * Reports retrieval recall@k (fused, and each channel alone), citation precision, facts stated,
 * claims supported by their citations, and answers right, with every grade kept in the JSON
 * report in eval/results/. Needs Docker, Ollama, and the frozen synopses (pnpm eval:synopses).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { ASK_PROMPT, ASK_PROMPTS } from "../../../src/agent/prompts/index.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { askList } from "../../../src/lab/ask.js";
import { ensureListDocuments } from "../../../src/lab/documents.js";
import { RETRIEVE_K } from "../../../src/lab/retrieve.js";
import { createEmbedder, createModelClient } from "../../../src/llm/modelClient.js";
import {
  costUsd,
  loadModelsFile,
  parseModelRef,
  resolveEmbedding,
  resolveLab,
} from "../../../src/llm/modelConfig.js";
import { cachedEmbedder } from "../embedCache.js";
import { loadSnapshotIntoDb, startEvalDatabase } from "../harness.js";
import { loadRagCases, type ResolvedRagCase } from "../ragCases.js";
import { judgeAnswer, RAG_JUDGE } from "../ragJudge.js";
import { aggregateRag, scoreRagRun, type RagRun, type RagScore } from "../ragScore.js";
import { loadDetails, loadDiscovery, loadRecommendDataIntoDb } from "../recommendData.js";
import { loadSnapshot } from "../snapshot.js";
import { loadSynopses } from "../synopses.js";
import { throttle } from "../throttle.js";

const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));
const DEFAULT_GEMINI_RPM = 60;

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    judge: { type: "string" },
    prompt: { type: "string" },
    k: { type: "string" },
    tag: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    limit: { type: "string" },
    rpm: { type: "string" },
  },
});

const version = values.prompt ?? ASK_PROMPT.version;
if (!Object.hasOwn(ASK_PROMPTS, version)) {
  console.error(`Unknown prompt "${version}". Known: ${Object.keys(ASK_PROMPTS).join(", ")}`);
  process.exit(1);
}
const prompt = ASK_PROMPTS[version as keyof typeof ASK_PROMPTS];
const k = values.k ? Number(values.k) : RETRIEVE_K;
if (!Number.isInteger(k) || k < 1) {
  console.error("--k takes a whole number of documents.");
  process.exit(1);
}

loadLocalEnvFile();
const modelsFile = loadModelsFile();
const lab = resolveLab(modelsFile);
const askRef = values.model ? parseModelRef(values.model) : lab.ask;
const judgeRef = values.judge ? parseModelRef(values.judge) : lab.judge;
const clientOptions = {
  geminiApiKey: nonEmpty(process.env.GEMINI_API_KEY),
  ollamaBaseUrl: nonEmpty(process.env.OLLAMA_BASE_URL) ?? "http://127.0.0.1:11434",
  ollama: modelsFile.ollama,
};
const client = createModelClient(clientOptions);
const usesGemini = [askRef, judgeRef].some((r) => r.provider === "gemini");
const rpm = values.rpm ? Number(values.rpm) : usesGemini ? DEFAULT_GEMINI_RPM : null;
const models = rpm === null ? { ...client, waitedMs: 0 } : throttle(client, rpm);
const embedder = cachedEmbedder(
  createEmbedder({
    ...clientOptions,
    ref: resolveEmbedding(modelsFile, nonEmpty(process.env.EMBEDDING_MODEL) ?? undefined),
  }),
);

const synopses = loadSynopses();
const details = loadDetails();
const pool = loadDiscovery();
if (!synopses || !details || !pool) {
  console.error(
    !synopses
      ? "The frozen synopses are missing: run pnpm eval:synopses first (they stay in eval/local/)."
      : "The frozen show details are missing: run pnpm eval:recommend-data.",
  );
  process.exit(1);
}

const loaded = loadRagCases();
if (loaded.errors.length > 0) {
  for (const e of loaded.errors)
    console.error(`ERROR ${e.file}${e.caseId ? ` [${e.caseId}]` : ""}: ${e.message}`);
  console.error("Fix the cases first (pnpm eval:validate).");
  process.exit(1);
}
let selected = loaded.cases.filter(
  (c) =>
    (!values.tag || c.case.tags.some((t) => values.tag?.includes(t))) &&
    (!values.case || values.case.includes(c.case.id)),
);
if (values.limit) selected = selected.slice(0, Number(values.limit));
if (selected.length === 0) {
  console.error("No RAG cases match the filters.");
  process.exit(1);
}
// Cases on the same snapshot share one load.
selected.sort((a, b) => a.snapshot.localeCompare(b.snapshot));

console.log(
  `RAG eval: ${String(selected.length)} questions; ${askRef.ref} (${prompt.version}) answers from the top ${String(k)} documents (${embedder.model}); ${judgeRef.ref} (${RAG_JUDGE.version}) grades.`,
);
console.log("Starting a throwaway Postgres...");
const database = await startEvalDatabase();

try {
  const { db } = database;
  const scored: { run: RagRun; score: RagScore }[] = [];
  let loadedSnapshot: string | null = null;
  let userId = "";
  const texts = new Map<number, string>();
  for (const [i, resolved] of selected.entries()) {
    if (resolved.snapshot !== loadedSnapshot) {
      userId = await loadSnapshotIntoDb(db, loadSnapshot(resolved.snapshot));
      await loadRecommendDataIntoDb(db, userId, details, pool);
      await db.execute(sql`
        UPDATE anime a SET synopsis = s.value ->> 'synopsis'
        FROM jsonb_array_elements(${JSON.stringify(synopses.shows)}::jsonb) AS s
        WHERE a.mal_id = (s.value ->> 'malId')::int
      `);
      const { documents } = await ensureListDocuments({ db, embedder }, userId);
      texts.clear();
      for (const doc of documents) texts.set(doc.malId, doc.text);
      loadedSnapshot = resolved.snapshot;
    }
    const run = await runCase(resolved, userId, texts);
    const score = scoreRagRun(run, k);
    scored.push({ run, score });
    const mark = score.correct === null ? "?" : score.correct ? "✓" : "✗";
    const recall =
      score.recall === null ? "  -  " : `${(score.recall * 100).toFixed(0).padStart(3)}%`;
    console.log(
      `${mark} ${String(i + 1).padStart(3)}/${String(selected.length)} ${resolved.case.id.padEnd(34)} recall ${recall}  ${String(run.latencyMs).padStart(6)} ms`,
    );
  }

  const metrics = aggregateRag(scored, k);
  printReport(metrics, scored);
  const cost = costUsd(modelsFile, askRef, {
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
  });

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${RESULTS_DIR}rag-${stamp}-${askRef.ref.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        model: askRef.ref,
        prompt: prompt.version,
        judge: judgeRef.ref,
        judgePrompt: RAG_JUDGE.version,
        embedding: embedder.model,
        synopsesFrozenAt: synopses.frozenAt,
        ranAt: new Date().toISOString(),
        metrics: { ...metrics, answerCostUsd: cost },
        cases: scored.map(({ run, score }) => ({ ...run, score })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nFull report: ${path}`);
} finally {
  embedder.save();
  await database.close();
}

async function runCase(
  resolved: ResolvedRagCase,
  userId: string,
  texts: Map<number, string>,
): Promise<RagRun> {
  const c = resolved.case;
  const base = {
    file: resolved.file,
    caseId: c.id,
    tags: c.tags,
    question: c.question,
    sources: resolved.sources,
    declines: resolved.declines,
    facts: c.expect.facts,
  };
  const waitedBefore = models.waitedMs;
  try {
    const result = await askList(
      { db: database.db, embedder, models },
      { userId, question: c.question, model: askRef, prompt, k },
    );
    const judged = await judgeAnswer(models, judgeRef, {
      question: c.question,
      facts: c.expect.facts,
      answer: result.answer,
      cited: result.cited.map((id) => ({ id, text: texts.get(id) ?? "" })),
    });
    return {
      ...base,
      retrieved: result.retrieval.documents.map((d) => d.malId),
      byMeaning: result.retrieval.byMeaning,
      byName: result.retrieval.byName,
      answer: result.answer,
      cited: result.cited,
      strayCitations: result.strayCitations,
      grade: judged.grade,
      judgeError: judged.error,
      error: null,
      latencyMs: result.latencyMs - (models.waitedMs - waitedBefore),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    return {
      ...base,
      retrieved: [],
      byMeaning: [],
      byName: [],
      answer: "",
      cited: [],
      strayCitations: [],
      grade: null,
      judgeError: null,
      error: (err as Error).message,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

function printReport(
  metrics: ReturnType<typeof aggregateRag>,
  scored: { run: RagRun; score: RagScore }[],
): void {
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  console.log("\n=== Metrics");
  console.log(`Recall@${String(metrics.k)}               ${pct(metrics.recallAtK)}`);
  console.log(
    `  by meaning alone       ${pct(metrics.recallByMeaning)}   by name alone ${pct(metrics.recallByName)}`,
  );
  console.log(
    `Citation precision      ${pct(metrics.citationPrecision)}   (${String(metrics.strayCitations)} citations of documents it wasn't given)`,
  );
  console.log(`Facts stated            ${pct(metrics.factsStated)}`);
  console.log(`Claims supported        ${pct(metrics.claimsSupported)}`);
  console.log(`Answers grounded        ${pct(metrics.groundedRate)}   (every claim supported)`);
  console.log(`Answers right           ${pct(metrics.correctRate)}`);
  console.log(`Median latency          ${String(metrics.medianLatencyMs)} ms`);
  console.log(
    `Errors                  ${String(metrics.errors)}   judge errors ${String(metrics.judgeErrors)}`,
  );
  const wrong = scored.filter((x) => x.score.correct === false || x.score.grounded === false);
  if (wrong.length > 0) console.log("\n=== Answers to read");
  for (const { run, score } of wrong) {
    const unsupported = run.grade?.claims.filter((c) => !c.supported).map((c) => c.claim) ?? [];
    const missed = run.grade?.facts.filter((f) => !f.stated).map((f) => f.fact) ?? [];
    console.log(`\n${run.caseId}: ${run.question}`);
    console.log(`  answer: ${run.answer}`);
    if (score.correct === false && run.declines)
      console.log("  should have said the list can't tell");
    if (missed.length > 0) console.log(`  missed: ${missed.join("; ")}`);
    if (unsupported.length > 0) console.log(`  unsupported: ${unsupported.join("; ")}`);
    if (run.strayCitations.length > 0)
      console.log(`  cited documents it wasn't given: ${run.strayCitations.join(", ")}`);
  }
}

/** .env files write unset variables as empty strings. */
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}
