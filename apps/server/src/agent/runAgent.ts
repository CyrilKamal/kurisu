import { eq } from "drizzle-orm";

import type { Db } from "../db/client.js";
import { agentRuns, agentRunSteps } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import { ModelProviderError, type LlmMessage } from "../llm/types.js";
import type { Change, ListWriter } from "../writes/commit.js";
import type { Proposal } from "../writes/propose.js";
import { executeTool, TOOL_SPECS, type RunContext } from "./tools.js";

export interface Prompt {
  version: string;
  system: string;
}

export type AgentOutcome =
  "committed" | "needs_confirmation" | "clarification" | "no_action" | "error";

export interface RunInput {
  userId: string;
  conversationId: string | null;
  /** Earlier turns of this conversation, oldest first (text only). */
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  model: ModelRef;
  escalatedFromRunId?: string;
}

export interface RunResult {
  runId: string;
  model: string;
  outcome: AgentOutcome;
  reply: string;
  /** True if the reply asks the user something. */
  asked: boolean;
  committed: Change[];
  /** Proposals waiting for the user's confirmation. */
  pending: Proposal[];
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentDeps {
  db: Db;
  models: ModelClient;
  writeListStatus: ListWriter;
  prompt: Prompt;
  /** Model turns before giving up. Each turn is one model call plus its tool calls. */
  maxTurns?: number;
}

const DEFAULT_MAX_TURNS = 6;
const MAX_LOGGED_RESULT_CHARS = 4000;

/**
 * One agent run: the model reads the message, calls tools, and replies. Every model call and
 * tool call is logged to agent_run_steps; the run's totals and outcome to agent_runs.
 */
export async function runAgent(deps: AgentDeps, input: RunInput): Promise<RunResult> {
  const { db } = deps;
  const started = performance.now();
  const [run] = await db
    .insert(agentRuns)
    .values({
      userId: input.userId,
      conversationId: input.conversationId,
      escalatedFromRunId: input.escalatedFromRunId ?? null,
      promptVersion: deps.prompt.version,
      model: input.model.ref,
    })
    .returning({ id: agentRuns.id });
  if (!run) throw new Error("agent_runs insert returned no row");

  const ctx: RunContext = {
    db,
    userId: input.userId,
    runId: run.id,
    writeListStatus: deps.writeListStatus,
    seen: new Set(),
    clear: new Map(),
    proposalIds: new Set(),
    committed: [],
    pending: [],
    toldWaiting: new Set(),
    userMessage: input.message,
    contested: new Set(),
    searches: new Map(),
    stop: null,
  };
  const messages: LlmMessage[] = [
    ...input.history.map((m): LlmMessage =>
      m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", content: m.content, toolCalls: [] },
    ),
    { role: "user", content: input.message },
  ];

  let seq = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reply: string | null = null;
  let error: string | null = null;

  const logStep = async (step: Omit<typeof agentRunSteps.$inferInsert, "runId" | "seq">) => {
    await db.insert(agentRunSteps).values({ ...step, runId: run.id, seq: seq++ });
  };

  for (let turn = 0; turn < (deps.maxTurns ?? DEFAULT_MAX_TURNS); turn++) {
    let response;
    const callStarted = performance.now();
    try {
      response = await deps.models.chat(input.model, {
        system: deps.prompt.system,
        messages,
        tools: TOOL_SPECS,
      });
    } catch (err) {
      error = err instanceof ModelProviderError ? `model_${err.kind}` : "model_failed";
      await logStep({
        kind: "model_call",
        latencyMs: Math.round(performance.now() - callStarted),
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      break;
    }

    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;
    await logStep({
      kind: "model_call",
      latencyMs: response.latencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      result: {
        text: response.text,
        toolCalls: response.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })),
      },
    });

    if (response.toolCalls.length === 0) {
      reply = response.text.trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
      providerState: response.providerState,
    });
    for (const call of response.toolCalls) {
      const toolStarted = performance.now();
      const outcome = await executeTool(ctx, call);
      const content = JSON.stringify(outcome.result);
      await logStep({
        kind: "tool_call",
        toolName: call.name,
        args: call.arguments,
        result: truncate(outcome.result, content),
        latencyMs: Math.round(performance.now() - toolStarted),
        error: outcome.error ?? null,
      });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }
    if (ctx.stop) break;
  }

  // Ran out of turns, or stopped for repeating itself. If changes were written or held, the
  // run still did its job: Chat shows them, so end with a plain reply instead of an error. A
  // model searching in circles gets an honest question back. agent_runs keeps the reason.
  let stopReason: string | null = null;
  if (reply === null && error === null) {
    if (ctx.committed.length > 0 || ctx.pending.length > 0) {
      stopReason = ctx.stop ?? "max_turns";
      reply = fallbackReply(ctx.committed.length, ctx.pending.length);
    } else if (ctx.stop === "repeated_search") {
      stopReason = ctx.stop;
      reply = "I couldn't work out which show you mean. Could you give me its full title?";
    } else {
      error = "max_turns";
    }
  }
  const text = reply ?? "";
  const asked = text.includes("?");
  const outcome: AgentOutcome = error
    ? "error"
    : ctx.committed.length > 0
      ? "committed"
      : ctx.pending.length > 0
        ? "needs_confirmation"
        : asked
          ? "clarification"
          : "no_action";
  const latencyMs = Math.round(performance.now() - started);

  await db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      latencyMs,
      inputTokens,
      outputTokens,
      outcome,
      error: error ?? stopReason,
    })
    .where(eq(agentRuns.id, run.id));

  return {
    runId: run.id,
    model: input.model.ref,
    outcome,
    reply: text,
    asked,
    committed: ctx.committed,
    pending: ctx.pending,
    error,
    latencyMs,
    inputTokens,
    outputTokens,
  };
}

function fallbackReply(committed: number, held: number): string {
  if (held === 0) return "Done.";
  const waiting =
    held === 1 ? "That change needs your confirmation." : "Those changes need your confirmation.";
  return committed > 0 ? `Done. ${waiting.replace("That change", "One change")}` : waiting;
}

function truncate(value: unknown, serialized: string): unknown {
  return serialized.length <= MAX_LOGGED_RESULT_CHARS
    ? value
    : { truncated: true, preview: serialized.slice(0, MAX_LOGGED_RESULT_CHARS) };
}
