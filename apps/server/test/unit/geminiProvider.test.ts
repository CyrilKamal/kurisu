import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGeminiProvider } from "../../src/llm/providers/gemini.js";
import type { LlmMessage, ModelProvider, ToolSpec } from "../../src/llm/types.js";
import { FakeHttpServer } from "../support/fakeHttp.js";

const tools: ToolSpec[] = [
  {
    name: "search_my_list",
    description: "Find shows",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

const hello: LlmMessage[] = [{ role: "user", content: "hi" }];

let server: FakeHttpServer;
let provider: ModelProvider;

beforeAll(async () => {
  server = await FakeHttpServer.start();
  provider = createGeminiProvider({ apiKey: "test-key-not-real", baseUrl: server.baseUrl });
});
afterAll(() => server.stop());
beforeEach(() => {
  server.reset();
});

// Shape of a generateContent response with a function call from a Gemini 3 thinking model.
const modelTurn = {
  role: "model",
  parts: [
    { text: "Looking it up.", thought: true },
    {
      functionCall: { id: "fc-1", name: "search_my_list", args: { query: "frieren" } },
      thoughtSignature: "c2lnbmF0dXJlLWJ5dGVz",
    },
  ],
};
const functionCallResponse = {
  candidates: [{ content: modelTurn, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 12, thoughtsTokenCount: 30 },
};

describe("gemini provider", () => {
  it("declares tools with JSON Schema and sends the system prompt", async () => {
    server.reply({ body: functionCallResponse });

    await provider.chat({
      model: "gemini-3.5-flash-lite",
      system: "be brief",
      tools,
      messages: [{ role: "user", content: "watched ep 3 of frieren" }],
    });

    const request = server.requests[0];
    expect(request?.url).toMatch(/\/models\/gemini-3\.5-flash-lite:generateContent$/);
    expect(request?.headers["x-goog-api-key"]).toBe("test-key-not-real");
    expect(request?.body).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "watched ep 3 of frieren" }] }],
      systemInstruction: { parts: [{ text: "be brief" }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: "search_my_list",
              description: "Find shows",
              parametersJsonSchema: tools[0]?.parameters,
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
    // Newer Gemini models reject sampling settings and thinking budgets with a 400.
    for (const key of ["temperature", "topP", "topK", "thinkingConfig.thinkingBudget"]) {
      expect(request?.body).not.toHaveProperty(`generationConfig.${key}`);
    }
  });

  it("sends a thinking level when one is set, never a thinking budget", async () => {
    server.reply({ body: functionCallResponse });

    await provider.chat({ model: "m", system: "", tools, messages: hello, thinking: "low" });

    const body = server.requests[0]?.body;
    expect(body).toHaveProperty("generationConfig.thinkingConfig.thinkingLevel", "LOW");
    expect(body).not.toHaveProperty("generationConfig.thinkingConfig.thinkingBudget");
  });

  it("parses function calls, counts thinking tokens as output and hides thoughts", async () => {
    server.reply({ body: functionCallResponse });

    const res = await provider.chat({ model: "m", system: "", tools, messages: hello });

    expect(res.toolCalls).toEqual([
      { id: "fc-1", name: "search_my_list", arguments: { query: "frieren" } },
    ]);
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 42 });
    expect(res.text).toBe("");
    expect(res.providerState).toEqual(modelTurn);
  });

  it("replays the model's turn verbatim (thought signatures) and groups tool results", async () => {
    server.reply({ body: functionCallResponse });
    const first = await provider.chat({ model: "m", system: "", tools, messages: hello });

    server.reset();
    server.reply({
      body: {
        candidates: [{ content: { role: "model", parts: [{ text: "Done." }] } }],
        usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 3 },
      },
    });
    const history: LlmMessage[] = [
      { role: "user", content: "watched ep 3 of frieren and jjk" },
      {
        role: "assistant",
        content: first.text,
        toolCalls: first.toolCalls,
        providerState: first.providerState,
      },
      { role: "tool", toolCallId: "fc-1", name: "search_my_list", content: '[{"id":1}]' },
      { role: "tool", toolCallId: "fc-2", name: "search_my_list", content: "not json" },
    ];
    const second = await provider.chat({ model: "m", system: "", tools, messages: history });

    expect(second.text).toBe("Done.");
    const body = server.requests[0]?.body as { contents: unknown[] };
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "watched ep 3 of frieren and jjk" }] },
      modelTurn,
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "fc-1",
              name: "search_my_list",
              response: { result: [{ id: 1 }] },
            },
          },
          {
            functionResponse: {
              id: "fc-2",
              name: "search_my_list",
              response: { result: "not json" },
            },
          },
        ],
      },
    ]);
  });

  it("reports a request the SDK refuses as bad_request, not unavailable", async () => {
    await expect(
      provider.chat({ model: "m", system: "", tools, messages: [] }),
    ).rejects.toMatchObject({ kind: "bad_request" });
    expect(server.requests).toHaveLength(0);
  });

  it("classifies failures and never retries them behind the router's back", async () => {
    server.reply(
      {
        status: 429,
        body: { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } },
      },
      {
        status: 403,
        body: { error: { code: 403, message: "bad key", status: "PERMISSION_DENIED" } },
      },
      { status: 503, body: { error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } } },
    );

    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) {
      await provider
        .chat({ model: "m", system: "", tools, messages: hello })
        .catch((err: unknown) => {
          kinds.push((err as { kind: string }).kind);
        });
    }

    expect(kinds).toEqual(["rate_limited", "auth", "unavailable"]);
    expect(server.requests).toHaveLength(3); // one request per call: no hidden retries
  });
});
