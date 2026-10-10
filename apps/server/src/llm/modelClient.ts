import type { EmbeddingRef, ModelRef } from "./modelConfig.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createOllamaProvider } from "./providers/ollama.js";
import {
  ModelProviderError,
  type ChatRequest,
  type ChatResponse,
  type EmbedPurpose,
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
  const provider = providerSource(options);
  return {
    chat(ref, request) {
      return provider(ref.provider).chat({
        ...request,
        model: ref.model,
        ...(ref.thinking && { thinking: ref.thinking }),
      });
    },
  };
}

/** Texts as vectors, from the configured embedding model (Milestone 7's lab). */
export interface Embedder {
  /** "ollama:embeddinggemma": stored with every vector, since models' vectors don't mix. */
  readonly model: string;
  readonly dimensions: number;
  /** Unit-length vectors, one per text, in order. */
  embed(
    texts: string[],
    purpose: EmbedPurpose,
  ): Promise<{ vectors: number[][]; inputTokens: number }>;
}

/** Texts per request: small enough for any provider, big enough to keep a backfill quick. */
const EMBED_BATCH = 64;

/**
 * The embedding model behind the same providers as chat: adds the model's task prefix, sends the
 * texts in batches, and scales each vector to unit length, so a dot product is the cosine.
 */
export function createEmbedder(options: ModelClientOptions & { ref: EmbeddingRef }): Embedder {
  const provider = providerSource(options);
  const { ref } = options;
  return {
    model: ref.ref,
    dimensions: ref.dimensions,
    async embed(texts, purpose) {
      const prefix = ref.prefixes[purpose] ?? "";
      const vectors: number[][] = [];
      let inputTokens = 0;
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const result = await provider(ref.provider).embed({
          model: ref.model,
          texts: texts.slice(i, i + EMBED_BATCH).map((text) => prefix + text),
          purpose,
          dimensions: ref.dimensions,
        });
        vectors.push(...result.vectors.map(unitLength));
        inputTokens += result.inputTokens;
      }
      return { vectors, inputTokens };
    },
  };
}

function unitLength(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

/** Creates each provider on first use, or takes the one a test injected. */
function providerSource(options: ModelClientOptions): (name: ProviderName) => ModelProvider {
  const providers: Partial<Record<ProviderName, ModelProvider>> = { ...options.providers };

  return function provider(name: ProviderName): ModelProvider {
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
  };
}
