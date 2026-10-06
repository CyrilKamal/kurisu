import type { Db } from "../db/client.js";
import { agentRunSteps } from "../db/schema.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { ModelRef } from "../llm/modelConfig.js";
import { ModelProviderError, type LlmMessage, type ToolCall, type ToolSpec } from "../llm/types.js";

export interface ToolOutcome {
  /** Sent back to the model as JSON. */
  result: unknown;
  /** Set when the call failed, for the run log. */
  error?: string;
}

const MAX_LOGGED_RESULT_CHARS = 4000;

export interface ToolLoopResult {
  /** The model's final text, or null if it never gave one (error or out of turns). */
  reply: string | null;
  /** `model_<kind>` when a model call failed. */
  error: string | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The agent loop shared by every agent: call the model, run the tools it asks for, feed the
 * results back, until it replies, a model call fails, `shouldStop` says so, or turns run out.
 * Every model call and tool call is logged to agent_run_steps under `runId` (CLAUDE.md:
 * prompt version, model, tool calls with arguments, latency, tokens and outcome).
 */
export async function runToolLoop(deps: {
  db: Db;
  runId: string;
  models: ModelClient;
  model: ModelRef;
  system: string;
  tools: ToolSpec[];
  messages: LlmMessage[];
  maxTurns: number;
  execute: (call: ToolCall) => Promise<ToolOutcome>;
  shouldStop: () => boolean;
}): Promise<ToolLoopResult> {
  const { db, messages } = deps;
  let seq = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const logStep = async (step: Omit<typeof agentRunSteps.$inferInsert, "runId" | "seq">) => {
    await db.insert(agentRunSteps).values({ ...step, runId: deps.runId, seq: seq++ });
  };

  for (let turn = 0; turn < deps.maxTurns; turn++) {
    let response;
    const callStarted = performance.now();
    try {
      response = await deps.models.chat(deps.model, {
        system: deps.system,
        messages,
        tools: deps.tools,
      });
    } catch (err) {
      await logStep({
        kind: "model_call",
        latencyMs: Math.round(performance.now() - callStarted),
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      const error = err instanceof ModelProviderError ? `model_${err.kind}` : "model_failed";
      return { reply: null, error, inputTokens, outputTokens };
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
      return { reply: response.text.trim(), error: null, inputTokens, outputTokens };
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
      providerState: response.providerState,
    });
    for (const call of response.toolCalls) {
      const toolStarted = performance.now();
      const outcome = await deps.execute(call);
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
    if (deps.shouldStop()) break;
  }
  return { reply: null, error: null, inputTokens, outputTokens };
}

function truncate(value: unknown, serialized: string): unknown {
  return serialized.length <= MAX_LOGGED_RESULT_CHARS
    ? value
    : { truncated: true, preview: serialized.slice(0, MAX_LOGGED_RESULT_CHARS) };
}
