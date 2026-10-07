import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  kindForStatus,
  ModelProviderError,
  type ChatRequest,
  type ChatResponse,
  type LlmMessage,
  type ModelProvider,
  type ToolCall,
} from "../types.js";

/** Ollama's /api/chat, called over plain HTTP. No SDK needed. */
export interface OllamaOptions {
  baseUrl: string;
  /** Whether thinking models should think. Off by default: slower, and not needed for parsing. */
  think?: boolean;
  /** Context window in tokens. Always set it: some models default to 256K and crash on a 16 GB GPU. */
  numCtx?: number;
  timeoutMs?: number;
}

const responseSchema = z.object({
  message: z.object({
    content: z.string().default(""),
    tool_calls: z
      .array(
        z.object({
          // Newer Ollama versions send an id; older ones don't.
          id: z.string().optional(),
          function: z.object({
            name: z.string(),
            // Current Ollama sends an object; accept a JSON string too.
            arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).default({}),
          }),
        }),
      )
      .optional(),
  }),
  prompt_eval_count: z.number().int().nonnegative().default(0),
  eval_count: z.number().int().nonnegative().default(0),
});

export function createOllamaProvider(options: OllamaOptions): ModelProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    name: "ollama",

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const body = {
        model: request.model,
        stream: false,
        think: options.think ?? false,
        // Temperature 0 keeps local eval runs repeatable.
        options: { temperature: 0, num_ctx: options.numCtx ?? 8192 },
        messages: [{ role: "system", content: request.system }, ...request.messages.map(toOllama)],
        tools: request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      };

      const signals = [AbortSignal.timeout(timeoutMs)];
      if (request.signal) signals.push(request.signal);
      const started = performance.now();
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });
      } catch (err) {
        throw new ModelProviderError("ollama", "unavailable", `request failed: ${describe(err)}`);
      }
      if (!res.ok) {
        // Ollama errors are {"error": "..."} about the model or request; they never hold secrets.
        const detail = errorMessage(await res.text().catch(() => ""));
        const notPulled = res.status === 404 && /not found/i.test(detail);
        throw new ModelProviderError(
          "ollama",
          kindForStatus(res.status),
          notPulled
            ? `model "${request.model}" isn't pulled (run: ollama pull ${request.model})`
            : `HTTP ${String(res.status)}${detail ? `: ${detail}` : ""}`,
          res.status,
        );
      }

      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new ModelProviderError(
          "ollama",
          "bad_response",
          "unexpected /api/chat response shape",
        );
      }
      const { message } = parsed.data;
      return {
        text: message.content,
        toolCalls: (message.tool_calls ?? []).map((call): ToolCall => ({
          id: call.id ?? `call_${randomUUID()}`,
          name: call.function.name,
          arguments: parseArguments(call.function.arguments),
        })),
        usage: { inputTokens: parsed.data.prompt_eval_count, outputTokens: parsed.data.eval_count },
        latencyMs: Math.round(performance.now() - started),
      };
    },
  };
}

function toOllama(message: LlmMessage) {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    case "tool":
      return { role: "tool", tool_name: message.name, content: message.content };
  }
}

function parseArguments(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error.slice(0, 200);
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "timed out" : err.message;
  return String(err);
}
