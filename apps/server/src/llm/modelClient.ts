import type { ModelRef } from "./modelConfig.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createOllamaProvider } from "./providers/ollama.js";
import {
  ModelProviderError,
  type ChatRequest,
  type ChatResponse,
  type ModelProvider,
  type ProviderName,
} from "./types.js";

export interface ModelClient {
  chat(ref: ModelRef, request: Omit<ChatRequest, "model">): Promise<ChatResponse>;
}

export interface ModelClientOptions {
  geminiApiKey: string | null;
  ollamaBaseUrl: string;
  ollama?: { numCtx: number; think: boolean };
  /** Tests inject fakes per provider. */
  providers?: Partial<Record<ProviderName, ModelProvider>>;
}

/** Routes each call to the provider named in the model ref, creating providers on first use. */
export function createModelClient(options: ModelClientOptions): ModelClient {
  const providers: Partial<Record<ProviderName, ModelProvider>> = { ...options.providers };

  function provider(name: ProviderName): ModelProvider {
    const existing = providers[name];
    if (existing) return existing;
    let created: ModelProvider;
    if (name === "gemini") {
      if (!options.geminiApiKey) {
        throw new ModelProviderError("gemini", "auth", "GEMINI_API_KEY is not set in .env.local");
      }
      created = createGeminiProvider({ apiKey: options.geminiApiKey });
    } else {
      created = createOllamaProvider({ baseUrl: options.ollamaBaseUrl, ...options.ollama });
    }
    providers[name] = created;
    return created;
  }

  return {
    chat(ref, request) {
      return provider(ref.provider).chat({ ...request, model: ref.model });
    },
  };
}
