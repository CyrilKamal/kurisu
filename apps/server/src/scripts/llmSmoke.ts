/**
 * Live check that a model can drive a tool-calling round trip through our provider interface.
 *
 *   pnpm llm:smoke                   the eval model from config/models.json
 *   pnpm llm:smoke --role agent      the agent (or escalation) model
 *   pnpm llm:smoke --model ollama:qwen3.6:27b
 *
 * Sends one user message, expects a search tool call, feeds back a canned result and prints the
 * reply with latency, tokens and paid-tier cost. Never touches MAL or the database.
 */
import { parseArgs } from "node:util";

import { loadConfig } from "../config.js";
import { loadLocalEnvFile } from "../env.js";
import { createModelClient } from "../llm/modelClient.js";
import {
  costUsd,
  loadModelsFile,
  MODEL_ROLES,
  parseModelRef,
  resolveRoles,
  type ModelRole,
} from "../llm/modelConfig.js";
import type { LlmMessage, ToolSpec } from "../llm/types.js";

const { values } = parseArgs({
  options: { role: { type: "string", default: "eval" }, model: { type: "string" } },
});

loadLocalEnvFile();
const config = loadConfig();
const models = loadModelsFile();
const role = values.role as ModelRole;
if (!(MODEL_ROLES as readonly string[]).includes(role)) {
  throw new Error(`--role must be one of ${MODEL_ROLES.join(", ")}`);
}
const ref = values.model
  ? parseModelRef(values.model)
  : resolveRoles(models, config.llm.overrides)[role];
const client = createModelClient({
  geminiApiKey: config.llm.geminiApiKey,
  ollamaBaseUrl: config.llm.ollamaBaseUrl,
  ollama: models.ollama,
});

const tools: ToolSpec[] = [
  {
    name: "search_my_list",
    description: "Find shows on the user's anime list by title or nickname.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Title or nickname to look up" } },
      required: ["query"],
    },
  },
];
const system =
  "You keep the user's anime list up to date. Always look shows up with search_my_list before " +
  "saying anything about them. Reply in one short sentence.";
const messages: LlmMessage[] = [{ role: "user", content: "watched ep 3 of frieren" }];

console.log(`model: ${ref.ref}`);
let inputTokens = 0;
let outputTokens = 0;
let totalMs = 0;

const first = await client.chat(ref, { system, messages, tools });
inputTokens += first.usage.inputTokens;
outputTokens += first.usage.outputTokens;
totalMs += first.latencyMs;
const call = first.toolCalls[0];
console.log(
  `turn 1: ${String(first.latencyMs)} ms, tool calls: ${JSON.stringify(first.toolCalls.map((c) => ({ name: c.name, args: c.arguments })))}`,
);
if (!call) {
  console.log(`FAIL: expected a search_my_list call; got text: ${JSON.stringify(first.text)}`);
  process.exit(1);
}

messages.push(
  {
    role: "assistant",
    content: first.text,
    toolCalls: first.toolCalls,
    providerState: first.providerState,
  },
  {
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    content: JSON.stringify([
      { animeId: 52991, title: "Sousou no Frieren", episodesWatched: 2, numEpisodes: 28 },
    ]),
  },
);
const second = await client.chat(ref, { system, messages, tools });
inputTokens += second.usage.inputTokens;
outputTokens += second.usage.outputTokens;
totalMs += second.latencyMs;
console.log(`turn 2: ${String(second.latencyMs)} ms, reply: ${JSON.stringify(second.text)}`);

const cost = costUsd(models, ref, { inputTokens, outputTokens });
console.log(
  `total: ${String(totalMs)} ms, ${String(inputTokens)} in / ${String(outputTokens)} out tokens, paid-tier cost $${cost === null ? "?" : cost.toFixed(6)}`,
);
console.log(call.name === "search_my_list" ? "OK" : `FAIL: unexpected tool ${call.name}`);
