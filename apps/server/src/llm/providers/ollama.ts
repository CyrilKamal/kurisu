import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  kindForStatus,
  ModelProviderError,
  type ChatRequest,
  type ChatResponse,
  type EmbedRequest,
  type EmbedResponse,
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

const embedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  prompt_eval_count: z.number().int().nonnegative().default(0),
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

      const started = performance.now();
      const res = await post("/api/chat", body, request.model, request.signal);

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

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const started = performance.now();
      // truncate: a text longer than the model's window is cut rather than refused.
      const body = { model: request.model, input: request.texts, truncate: true };
      const res = await post("/api/embed", body, request.model, request.signal);
      const parsed = embedResponseSchema.safeParse(await res.json());
      if (!parsed.success || parsed.data.embeddings.length !== request.texts.length) {
        throw new ModelProviderError("ollama", "bad_response", "unexpected /api/embed response");
      }
      const wrongSize = parsed.data.embeddings.find((v) => v.length !== request.dimensions);
      if (wrongSize) {
        throw new ModelProviderError(
          "ollama",
          "bad_response",
          `${request.model} returned ${String(wrongSize.length)}-dimension vectors, not ${String(request.dimensions)}`,
        );
      }
      return {
        vectors: parsed.data.embeddings,
        inputTokens: parsed.data.prompt_eval_count,
        latencyMs: Math.round(performance.now() - started),
      };
    },
  };

  /** POSTs to Ollama and turns its failures into ModelProviderErrors. */
  async function post(
    path: string,
    body: unknown,
    model: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
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
          ? `model "${model}" isn't pulled (run: ollama pull ${model})`
          : `HTTP ${String(res.status)}${detail ? `: ${detail}` : ""}`,
        res.status,
      );
    }
    return res;
  }
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
