/**
 * Runs the recommendation cases (eval/cases/recommend-*.yaml) through the real flow: the progress
 * agent reads the message and hands it to the recommender, which searches the list and the
 * frozen discovery pool and presents picks. Each pick is checked against the case's labels.
 *
 *   pnpm eval:recommend                         every case, on the models in config/models.json
 *   pnpm eval:recommend --case rec-movie-tonight --limit 5
 *   pnpm eval:recommend --model gemini:gemini-3.5-flash-lite   a different recommender model
 *   pnpm eval:recommend --prompt recommend@3                 compare another recommender prompt
 *
 * Needs Docker (a throwaway Postgres) and the frozen data from pnpm eval:recommend-data. Taste is
 * neutral here (the snapshot has no scores), so this measures following the request, not taste.
 * Writes a full JSON report to eval/results/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  CURRENT_PROMPT,
  RECOMMEND_PROMPT as DEFAULT_RECOMMEND_PROMPT,
  RECOMMEND_PROMPTS,
} from "../../../src/agent/prompts/index.js";
import { runAgent } from "../../../src/agent/runAgent.js";
import { agentRunSteps, anime, listEntries } from "../../../src/db/schema.js";
import { loadLocalEnvFile } from "../../../src/env.js";
import { createModelClient } from "../../../src/llm/modelClient.js";
import {
  costUsd,
  loadModelsFile,
  parseModelRef,
  resolveRoles,
} from "../../../src/llm/modelConfig.js";
import { runRecommender } from "../../../src/recommend/agent.js";
import { loadAiring } from "../airing.js";
import { frozenCatalogSearch, loadCatalog } from "../catalog.js";
import { createFakeWriter, loadSnapshotIntoDb, startEvalDatabase } from "../harness.js";
import { loadRecommendCases, type ResolvedRecommendCase } from "../recommendCases.js";
import { loadDetails, loadDiscovery, loadRecommendDataIntoDb } from "../recommendData.js";
import {
  aggregateRecommend,
  scoreRecommendCase,
  type PickedShow,
  type RecommendMetrics,
  type RecommendRun,
  type RecommendScore,
} from "../recommendScore.js";
import { loadSnapshot, type Snapshot } from "../snapshot.js";
import { throttle } from "../throttle.js";

const RESULTS_DIR = fileURLToPath(new URL("../../results/", import.meta.url));
const DEFAULT_GEMINI_RPM = 60;

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    "agent-model": { type: "string" },
    tag: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    file: { type: "string", multiple: true },
    limit: { type: "string" },
    rpm: { type: "string" },
    prompt: { type: "string" },
  },
});

const recommendVersion = values.prompt ?? DEFAULT_RECOMMEND_PROMPT.version;
if (!Object.hasOwn(RECOMMEND_PROMPTS, recommendVersion)) {
  console.error(
    `Unknown prompt "${recommendVersion}". Known: ${Object.keys(RECOMMEND_PROMPTS).join(", ")}`,
  );
  process.exit(1);
}
const RECOMMEND_PROMPT = RECOMMEND_PROMPTS[recommendVersion as keyof typeof RECOMMEND_PROMPTS];

loadLocalEnvFile();
const modelsFile = loadModelsFile();
const roles = resolveRoles(modelsFile, {
  ...(process.env.AGENT_MODEL ? { agent: process.env.AGENT_MODEL } : {}),
  ...(process.env.RECOMMEND_MODEL ? { recommend: process.env.RECOMMEND_MODEL } : {}),
});
const recommendRef = values.model ? parseModelRef(values.model) : roles.recommend;
const agentRef = values["agent-model"] ? parseModelRef(values["agent-model"]) : roles.agent;
const client = createModelClient({
  geminiApiKey: nonEmpty(process.env.GEMINI_API_KEY),
  ollamaBaseUrl: nonEmpty(process.env.OLLAMA_BASE_URL) ?? "http://127.0.0.1:11434",
  ollama: modelsFile.ollama,
});
const usesGemini = [agentRef, recommendRef].some((r) => r.provider === "gemini");
const rpm = values.rpm ? Number(values.rpm) : usesGemini ? DEFAULT_GEMINI_RPM : null;
if (rpm !== null && !(rpm > 0)) {
  console.error("--rpm must be a positive number.");
  process.exit(1);
}
const models = rpm === null ? { ...client, waitedMs: 0 } : throttle(client, rpm);

const details = loadDetails();
const pool = loadDiscovery();
const loaded = loadRecommendCases(details, pool);
if (loaded.errors.length > 0 || !details || !pool) {
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
  console.error("No recommendation cases match the filters.");
  process.exit(1);
}

const airing = loadAiring();
const catalog = frozenCatalogSearch(loadCatalog());
const poolIds = new Set(pool.shows.map((s) => s.malId));
const snapshots = new Map<string, Snapshot>();

console.log(
  `Recommendation eval: ${String(selected.length)} cases; ${agentRef.ref} (${CURRENT_PROMPT.version}) hands off to ${recommendRef.ref} (${RECOMMEND_PROMPT.version})`,
);
if (rpm !== null)
  console.log(`At most ${String(rpm)} model calls a minute (waiting is left out of latency).`);
console.log("Starting a throwaway Postgres...");
const database = await startEvalDatabase();

try {
  const scored: { run: RecommendRun; score: RecommendScore; resolved: ResolvedRecommendCase }[] =
    [];
  for (const [i, resolved] of selected.entries()) {
    const run = await runCase(resolved);
    const score = scoreRecommendCase(run, resolved.case.expect, resolved.mustNot);
    scored.push({ run, score, resolved });
    const picks = run.picks.map((p) => p.title).join("; ");
    console.log(
      `${score.correct ? "✓" : "✗"} ${String(i + 1).padStart(3)}/${String(selected.length)} ${resolved.case.id.padEnd(30)} ${String(run.latencyMs).padStart(6)} ms  ${picks || "(no picks)"}`,
    );
  }

  const metrics = aggregateRecommend(scored);
  printReport(metrics, scored);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${RESULTS_DIR}recommend-${stamp}-${recommendRef.ref.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        agentModel: agentRef.ref,
        agentPrompt: CURRENT_PROMPT.version,
        recommendModel: recommendRef.ref,
        recommendPrompt: RECOMMEND_PROMPT.version,
        ranAt: new Date().toISOString(),
        metrics,
        cases: scored.map(({ run, score }) => ({ ...run, score })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nFull report: ${path}`);
} finally {
  await database.close();
}

async function runCase(resolved: ResolvedRecommendCase): Promise<RecommendRun> {
  let snapshot = snapshots.get(resolved.snapshot);
  if (!snapshot) {
    snapshot = loadSnapshot(resolved.snapshot);
    snapshots.set(resolved.snapshot, snapshot);
  }
  const { db } = database;
  if (!details || !pool) throw new Error("frozen data missing");
  const userId = await loadSnapshotIntoDb(db, snapshot, airing);
  await loadRecommendDataIntoDb(db, userId, details, pool);
  const { writer } = createFakeWriter(db);
  const c = resolved.case;

  const waitedBefore = models.waitedMs;
  const agent = await runAgent(
    { db, models, writeListStatus: writer, prompt: CURRENT_PROMPT, catalog },
    { userId, conversationId: null, history: c.history, message: c.message, model: agentRef },
  );
  const recommendation = agent.handedOff
    ? await runRecommender(
        { db, models, prompt: RECOMMEND_PROMPT },
        {
          userId,
          conversationId: null,
          history: c.history,
          message: c.message,
          model: recommendRef,
          handedOffFromRunId: agent.runId,
        },
      )
    : null;
  const waited = models.waitedMs - waitedBefore;

  const pickIds = recommendation?.picks.map((p) => p.animeId) ?? [];
  const rows =
    pickIds.length === 0
      ? []
      : await db
          .select({
            animeId: anime.malId,
            title: anime.title,
            mediaType: anime.mediaType,
            numEpisodes: anime.numEpisodes,
            episodesWatched: listEntries.numEpisodesWatched,
            episodeMinutes: anime.episodeMinutes,
            genres: anime.genres,
            airingStatus: anime.airingStatus,
            status: listEntries.status,
            isRewatching: listEntries.isRewatching,
          })
          .from(anime)
          .leftJoin(
            listEntries,
            and(eq(listEntries.animeId, anime.malId), eq(listEntries.userId, userId)),
          )
          .where(inArray(anime.malId, pickIds));
  const byId = new Map(rows.map((r) => [r.animeId, r]));
  const picks: PickedShow[] = pickIds.map((id) => {
    const row = byId.get(id);
    return {
      animeId: id,
      title: row?.title ?? `#${String(id)}`,
      status: row?.status ?? null,
      isRewatching: row?.isRewatching ?? false,
      inPool: poolIds.has(id),
      mediaType: row?.mediaType ?? null,
      numEpisodes: row?.numEpisodes ?? null,
      episodesWatched: row?.episodesWatched ?? 0,
      episodeMinutes: row?.episodeMinutes ?? null,
      genres: row?.genres ?? [],
      airingStatus: row?.airingStatus ?? null,
    };
  });

  // The progress agent's steps, then the recommender's.
  const steps = [];
  for (const runId of [agent.runId, ...(recommendation ? [recommendation.runId] : [])]) {
    steps.push(
      ...(await db
        .select({
          tool: agentRunSteps.toolName,
          kind: agentRunSteps.kind,
          args: agentRunSteps.args,
          error: agentRunSteps.error,
        })
        .from(agentRunSteps)
        .where(eq(agentRunSteps.runId, runId))
        .orderBy(asc(agentRunSteps.seq))),
    );
  }

  const agentCost = costUsd(modelsFile, agentRef, agent);
  const recommendCost = recommendation ? costUsd(modelsFile, recommendRef, recommendation) : 0;
  return {
    file: resolved.file,
    caseId: c.id,
    tags: c.tags,
    message: c.message,
    handedOff: agent.handedOff,
    picks,
    reply: recommendation?.reply ?? agent.reply,
    error: agent.error ?? recommendation?.error ?? null,
    latencyMs: agent.latencyMs + (recommendation?.latencyMs ?? 0) - waited,
    costUsd: agentCost === null || recommendCost === null ? null : agentCost + recommendCost,
    inputTokens: agent.inputTokens + (recommendation?.inputTokens ?? 0),
    outputTokens: agent.outputTokens + (recommendation?.outputTokens ?? 0),
    toolCalls: steps
      .filter((s) => s.kind === "tool_call")
      .map((s) => `${s.tool ?? "?"}(${JSON.stringify(s.args)})${s.error ? ` -> ${s.error}` : ""}`),
  };
}

function printReport(
  metrics: RecommendMetrics,
  scored: { run: RecommendRun; score: RecommendScore }[],
): void {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  console.log("\n=== Metrics");
  console.log(
    `Cases right              ${pct(metrics.correct, metrics.cases)}   (${String(metrics.correct)}/${String(metrics.cases)})`,
  );
  console.log(
    `Reached the recommender  ${pct(metrics.handedOff, metrics.cases)}   (${String(metrics.handedOff)}/${String(metrics.cases)})`,
  );
  console.log(
    `Valid picks              ${pct(metrics.validPicks, metrics.picks)}   (${String(metrics.validPicks)}/${String(metrics.picks)})`,
  );
  console.log(
    `Picks within the labels  ${pct(metrics.withinLabels, metrics.picks)}   (${String(metrics.withinLabels)}/${String(metrics.picks)})`,
  );
  console.log(
    `Genre fit                ${pct(metrics.genreFit.fit, metrics.genreFit.total)}   (${String(metrics.genreFit.fit)}/${String(metrics.genreFit.total)} picks in cases with genres_any)`,
  );
  console.log(
    `Picks per case           ${(metrics.picks / Math.max(1, metrics.cases)).toFixed(1)}`,
  );
  console.log(
    `Median latency           ${String(metrics.medianLatencyMs)} ms   (p90 ${String(metrics.p90LatencyMs)} ms)`,
  );
  console.log(
    `Cost per case            ${metrics.costPerCaseUsd === null ? "n/a" : `$${metrics.costPerCaseUsd.toFixed(5)}`}`,
  );
  console.log(`Errors                   ${String(metrics.errors)}`);
  console.log(
    `Tokens                   ${String(metrics.inputTokens)} in / ${String(metrics.outputTokens)} out`,
  );

  const failures = scored.filter((s) => !s.score.correct);
  if (failures.length > 0) {
    console.log("\n=== Failures");
    for (const { run, score } of failures) {
      console.log(`\n✗ ${run.caseId}: "${run.message}"`);
      console.log(`  why:      ${score.reasons.join("; ")}`);
      for (const pick of run.picks) {
        const broken = score.violations.filter((v) => v.animeId === pick.animeId);
        console.log(
          `  pick:     ${pick.title} (${String(pick.animeId)}, ${pick.status ?? "new"}, ${pick.mediaType ?? "?"}, ${pick.episodeMinutes === null ? "?" : String(pick.episodeMinutes)} min)` +
            (broken.length ? ` -> ${broken.map((v) => v.message).join("; ")}` : ""),
        );
      }
      console.log(`  reply:    ${JSON.stringify(run.reply.slice(0, 200))}`);
      for (const call of run.toolCalls) console.log(`  tool:     ${call.slice(0, 240)}`);
    }
  }
}

/** .env files write unset variables as empty strings. */
function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}
