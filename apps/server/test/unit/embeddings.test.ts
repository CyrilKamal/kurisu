import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createEmbedder } from "../../src/llm/modelClient.js";
import { resolveEmbedding, type ModelsFile } from "../../src/llm/modelConfig.js";
import { createGeminiProvider } from "../../src/llm/providers/gemini.js";
import { createOllamaProvider } from "../../src/llm/providers/ollama.js";
import { ModelProviderError, type EmbedRequest, type ModelProvider } from "../../src/llm/types.js";
import { FakeHttpServer } from "../support/fakeHttp.js";

let server: FakeHttpServer;

beforeAll(async () => {
  server = await FakeHttpServer.start();
});
afterAll(() => server.stop());
beforeEach(() => {
  server.reset();
});

const request = (fields: Partial<EmbedRequest> = {}): EmbedRequest => ({
  model: "embeddinggemma",
  texts: ["frieren", "jjk"],
  purpose: "document",
  dimensions: 3,
  ...fields,
});

describe("ollama embed", () => {
  const provider = () => createOllamaProvider({ baseUrl: server.baseUrl });

  it("posts the texts to /api/embed and returns one vector each", async () => {
    // Shape recorded from Ollama's /api/embed.
    server.reply({
      body: {
        model: "embeddinggemma",
        embeddings: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        prompt_eval_count: 7,
      },
    });
    const result = await provider().embed(request());
    expect(server.requests[0]?.url).toBe("/api/embed");
    expect(server.requests[0]?.body).toEqual({
      model: "embeddinggemma",
      input: ["frieren", "jjk"],
      truncate: true,
    });
    expect(result).toMatchObject({
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      inputTokens: 7,
    });
  });

  it("refuses vectors of another size, and says when the model isn't pulled", async () => {
    server.reply({
      body: {
        embeddings: [
          [1, 0],
          [0, 1],
        ],
      },
    });
    await expect(provider().embed(request())).rejects.toThrow(/2-dimension vectors, not 3/);

    server.reply({ status: 404, body: { error: 'model "embeddinggemma" not found' } });
    const err = await provider()
      .embed(request())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelProviderError);
    expect((err as Error).message).toMatch(/ollama pull embeddinggemma/);
  });
});

describe("gemini embed", () => {
  it("asks for retrieval vectors of the stored size", async () => {
    server.reply({ body: { embeddings: [{ values: [0, 0, 1] }, { values: [0, 1, 0] }] } });
    const provider = createGeminiProvider({ apiKey: "test-key-not-real", baseUrl: server.baseUrl });
    const result = await provider.embed(
      request({ model: "gemini-embedding-001", purpose: "query" }),
    );
    expect(server.requests[0]?.url).toMatch(/gemini-embedding-001:batchEmbedContents/);
    const body = JSON.stringify(server.requests[0]?.body);
    expect(body).toContain("RETRIEVAL_QUERY");
    expect(body).toContain('"outputDimensionality":3');
    expect(result.vectors).toEqual([
      [0, 0, 1],
      [0, 1, 0],
    ]);
  });
});

describe("createEmbedder", () => {
  const file = {
    roles: {},
    pricesPerMillionTokens: {},
    embedding: {
      model: "ollama:embeddinggemma",
      dimensions: 2,
      prefixes: { query: "q: ", document: "d: " },
    },
  } as unknown as ModelsFile;

  it("adds the model's task prefix, batches, and returns unit-length vectors", async () => {
    const seen: EmbedRequest[] = [];
    const fake: ModelProvider = {
      name: "ollama",
      chat: () => Promise.reject(new Error("unused")),
      embed: (req) => {
        seen.push(req);
        return Promise.resolve({
          vectors: req.texts.map(() => [3, 4]),
          inputTokens: req.texts.length,
          latencyMs: 1,
        });
      },
    };
    const embedder = createEmbedder({
      ref: resolveEmbedding(file),
      geminiApiKey: null,
      ollamaBaseUrl: "http://unused",
      providers: { ollama: fake },
    });
    const texts = Array.from({ length: 70 }, (_, i) => `show ${String(i)}`);
    const result = await embedder.embed(texts, "document");

    expect(embedder.model).toBe("ollama:embeddinggemma");
    expect(seen.map((req) => req.texts.length)).toEqual([64, 6]);
    expect(seen[0]?.texts[0]).toBe("d: show 0");
    expect(result.vectors[0]).toEqual([0.6, 0.8]);
    expect(result.inputTokens).toBe(70);

    await embedder.embed(["frieren"], "query");
    expect(seen.at(-1)?.texts).toEqual(["q: frieren"]);
  });

  it("drops the configured prefixes for an overriding model", () => {
    const ref = resolveEmbedding(file, "gemini:gemini-embedding-001");
    expect(ref).toMatchObject({ ref: "gemini:gemini-embedding-001", dimensions: 2, prefixes: {} });
  });
});
