import { randomUUID } from "node:crypto";

// The only module allowed to import the Gemini SDK (see eslint.config.js).
import {
  ApiError,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel as GeminiThinkingLevel,
  type Content,
  type Part,
} from "@google/genai";

import {
  kindForStatus,
  ModelProviderError,
  type ChatRequest,
  type ChatResponse,
  type EmbedRequest,
  type EmbedResponse,
  type LlmMessage,
  type ModelProvider,
  type ThinkingLevel,
  type ToolCall,
} from "../types.js";

const GEMINI_THINKING: Record<ThinkingLevel, GeminiThinkingLevel> = {
  minimal: GeminiThinkingLevel.MINIMAL,
  low: GeminiThinkingLevel.LOW,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH,
};

export interface GeminiOptions {
  apiKey: string;
  /** Tests point this at a local fake. */
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Gemini through the official SDK. The SDK matters here: Gemini 3 models return "thought
 * signatures" with function calls that must be sent back unchanged on the next turn. We keep
 * the model's raw turn as providerState and replay it verbatim.
 */
export function createGeminiProvider(options: GeminiOptions): ModelProvider {
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      timeout: options.timeoutMs ?? 60_000,
      // No hidden retries: a 429 must reach the router, which decides what to do.
      retryOptions: { attempts: 1 },
    },
  });

  return {
    name: "gemini",

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const started = performance.now();
      let response;
      try {
        response = await ai.models.generateContent({
          model: request.model,
          contents: toContents(request.messages),
          config: {
            // No temperature, top_p, top_k or thinking budget: newer Gemini models answer them with
            // a 400, so each model's own defaults apply. A thinking level is the supported way to
            // trade thinking for speed.
            systemInstruction: request.system,
            ...(request.thinking && {
              thinkingConfig: { thinkingLevel: GEMINI_THINKING[request.thinking] },
            }),
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.parameters,
                })),
              },
            ],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
            ...(request.signal ? { abortSignal: request.signal } : {}),
          },
        });
      } catch (err) {
        throw providerError(err);
      }

      const content = response.candidates?.[0]?.content;
      if (!content) {
        throw new ModelProviderError("gemini", "bad_response", "no candidate in the response");
      }
      const toolCalls = (response.functionCalls ?? []).map((call): ToolCall => ({
        id: call.id ?? `call_${randomUUID()}`,
        name: call.name ?? "",
        arguments: call.args ?? {},
      }));
      const usage = response.usageMetadata;
      return {
        text: textOf(content),
        toolCalls,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          // Thinking tokens are billed as output.
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        },
        latencyMs: Math.round(performance.now() - started),
        providerState: content,
      };
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const started = performance.now();
      let response;
      try {
        response = await ai.models.embedContent({
          model: request.model,
          contents: request.texts,
          config: {
            taskType: request.purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
            outputDimensionality: request.dimensions,
            ...(request.signal ? { abortSignal: request.signal } : {}),
          },
        });
      } catch (err) {
        throw providerError(err);
      }
      const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
      if (
        vectors.length !== request.texts.length ||
        vectors.some((v) => v.length !== request.dimensions)
      ) {
        throw new ModelProviderError("gemini", "bad_response", "unexpected embedContent response");
      }
      return {
        vectors,
        // The response doesn't count tokens; about four characters make one.
        inputTokens: Math.ceil(request.texts.reduce((n, t) => n + t.length, 0) / 4),
        latencyMs: Math.round(performance.now() - started),
      };
    },
  };
}

/** A failed SDK call as a ModelProviderError: retryable, or the request's fault. */
function providerError(err: unknown): ModelProviderError {
  if (err instanceof ApiError) {
    return new ModelProviderError(
      "gemini",
      kindForStatus(err.status),
      // Google's error text (e.g. "model is overloaded") never contains the API key.
      `HTTP ${String(err.status)}: ${err.message.slice(0, 200)}`,
      err.status,
    );
  }
  // The key travels in a header, so SDK error messages don't contain it.
  const detail = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : "";
  // Network failures and timeouts are transient; anything else is the SDK rejecting the request
  // before sending it.
  const transient =
    err instanceof TypeError ||
    (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
  return new ModelProviderError(
    "gemini",
    transient ? "unavailable" : "bad_request",
    `request failed (${detail})`,
  );
}

function toContents(messages: LlmMessage[]): Content[] {
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
    } else if (message.role === "assistant") {
      contents.push(
        isContent(message.providerState)
          ? message.providerState
          : {
              role: "model",
              parts: [
                ...(message.content ? [{ text: message.content }] : []),
                ...message.toolCalls.map((call): Part => ({
                  functionCall: { id: call.id, name: call.name, args: call.arguments },
                })),
              ],
            },
      );
    } else {
      // All results for one model turn go back together in a single user turn.
      const part: Part = {
        functionResponse: {
          id: message.toolCallId,
          name: message.name,
          response: { result: parseJson(message.content) },
        },
      };
      const last = contents.at(-1);
      if (last?.role === "user" && last.parts?.every((p) => p.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
    }
  }
  return contents;
}

/** Visible text only; thought summaries are left out. */
function textOf(content: Content): string {
  return (content.parts ?? [])
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text)
    .join("");
}

function isContent(value: unknown): value is Content {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as Content).parts) &&
    (value as Content).role === "model"
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
