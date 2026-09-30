import type { ModelClient } from "../../src/llm/modelClient.js";
import type { ModelRef } from "../../src/llm/modelConfig.js";
import type { ChatRequest, ChatResponse, LlmMessage } from "../../src/llm/types.js";

/** One scripted model turn: tool calls to make, or a final reply. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
}

export type ScriptStep =
  ScriptedTurn | ((request: Omit<ChatRequest, "model">) => ScriptedTurn) | { throws: Error };

/**
 * A ModelClient that plays back a script instead of calling a model, and records every request.
 * Scripts can be set per model ref, to test escalation.
 */
export class ScriptedModels implements ModelClient {
  readonly requests: { ref: string; request: Omit<ChatRequest, "model"> }[] = [];
  private readonly scripts = new Map<string, ScriptStep[]>();
  private callCounter = 0;

  script(ref: string, steps: ScriptStep[]): void {
    this.scripts.set(ref, [...steps]);
  }

  reset(): void {
    this.requests.length = 0;
    this.scripts.clear();
  }

  chat(ref: ModelRef, request: Omit<ChatRequest, "model">): Promise<ChatResponse> {
    this.requests.push({ ref: ref.ref, request: { ...request, messages: [...request.messages] } });
    const step = this.scripts.get(ref.ref)?.shift();
    if (!step) return Promise.reject(new Error(`no scripted turn left for ${ref.ref}`));
    if ("throws" in step) return Promise.reject(step.throws);
    const turn = typeof step === "function" ? step(request) : step;
    return Promise.resolve({
      text: turn.text ?? "",
      toolCalls: (turn.toolCalls ?? []).map((call) => ({
        id: `call_${String(++this.callCounter)}`,
        ...call,
      })),
      usage: { inputTokens: 100, outputTokens: 10 },
      latencyMs: 5,
    });
  }
}

/** The parsed JSON result of the most recent tool call in a request's history. */
export function lastToolResult(request: Omit<ChatRequest, "model">): Record<string, unknown> {
  const last = [...request.messages]
    .reverse()
    .find((m): m is Extract<LlmMessage, { role: "tool" }> => m.role === "tool");
  if (!last) throw new Error("no tool result in history");
  return JSON.parse(last.content) as Record<string, unknown>;
}
