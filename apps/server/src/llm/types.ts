/**
 * The one interface every model call goes through. Provider SDKs are imported only under
 * src/llm/providers/ (enforced by lint), so swapping a model is a config change.
 */

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  /** Stable within a run; providers that don't assign ids get generated ones. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls: ToolCall[];
      /**
       * Provider-specific data that must be sent back verbatim on the next turn (e.g. Gemini's
       * thought signatures). Opaque to everything outside the provider that produced it.
       */
      providerState?: unknown;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** How much a thinking model thinks before answering; less is faster. */
export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ChatRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  /** Unset leaves the model's default. Providers without the setting ignore it. */
  thinking?: ThinkingLevel;
  // No sampling settings (temperature, top_p, top_k): newer Gemini models reject them, so every
  // model runs on its own defaults.
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  latencyMs: number;
  providerState?: unknown;
}

export interface ModelProvider {
  readonly name: ProviderName;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export const PROVIDER_NAMES = ["gemini", "ollama"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type ModelErrorKind =
  "rate_limited" | "unavailable" | "auth" | "bad_request" | "bad_response";

/** A failed model call, classified so callers can decide to retry, escalate or give up. */
export class ModelProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly kind: ModelErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ModelProviderError";
  }
}

export function kindForStatus(status: number): ModelErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "unavailable";
  return "bad_request";
}
