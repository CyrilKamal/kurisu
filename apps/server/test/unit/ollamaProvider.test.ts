import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOllamaProvider } from "../../src/llm/providers/ollama.js";
import { ModelProviderError, type ModelProvider, type ToolSpec } from "../../src/llm/types.js";
import { FakeHttpServer } from "../support/fakeHttp.js";

const tools: ToolSpec[] = [
  {
    name: "search_my_list",
    description: "Find shows",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

let server: FakeHttpServer;
let provider: ModelProvider;

beforeAll(async () => {
  server = await FakeHttpServer.start();
  provider = createOllamaProvider({ baseUrl: server.baseUrl });
});
afterAll(() => server.stop());
beforeEach(() => {
  server.reset();
});

// Shape recorded from Ollama 0.35 /api/chat with a tool call.
const toolCallResponse = {
  model: "ornith:9b",
  message: {
    role: "assistant",
    content: "",
    tool_calls: [{ function: { name: "search_my_list", arguments: { query: "frieren" } } }],
  },
  done: true,
  prompt_eval_count: 120,
  eval_count: 18,
};

describe("ollama provider", () => {
  it("sends the system prompt, history and tools in Ollama's format", async () => {
    server.reply({ body: toolCallResponse });

    await provider.chat({
      model: "ornith:9b",
      system: "be brief",
      tools,
      messages: [
        { role: "user", content: "watched ep 3 of frieren" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "search_my_list", arguments: { query: "frieren" } }],
        },
        { role: "tool", toolCallId: "c1", name: "search_my_list", content: "[]" },
      ],
    });

    const request = server.requests[0];
    expect(request?.url).toBe("/api/chat");
    expect(request?.body).toEqual({
      model: "ornith:9b",
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "watched ep 3 of frieren" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "search_my_list", arguments: { query: "frieren" } } }],
        },
        { role: "tool", tool_name: "search_my_list", content: "[]" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_my_list",
            description: "Find shows",
            parameters: tools[0]?.parameters,
          },
        },
      ],
    });
  });

  it("parses tool calls and usage, assigning ids Ollama doesn't send", async () => {
    server.reply({ body: toolCallResponse });

    const res = await provider.chat({ model: "ornith:9b", system: "", tools, messages: [] });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.id).toMatch(/^call_/);
    expect(res.toolCalls[0]).toMatchObject({
      name: "search_my_list",
      arguments: { query: "frieren" },
    });
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 18 });
    expect(res.text).toBe("");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("accepts arguments sent as a JSON string", async () => {
    server.reply({
      body: {
        message: {
          content: "",
          tool_calls: [{ function: { name: "x", arguments: '{"query":"jjk"}' } }],
        },
      },
    });

    const res = await provider.chat({ model: "m", system: "", tools, messages: [] });
    expect(res.toolCalls[0]?.arguments).toEqual({ query: "jjk" });
  });

  it("classifies failures, including Ollama's error message", async () => {
    server.reply(
      { status: 404, body: { error: 'model "nope" not found, try pulling it first' } },
      { status: 500, body: { error: "model runner has unexpectedly stopped" } },
      { status: 200, body: { unexpected: true } },
    );

    const errors: ModelProviderError[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        await provider.chat({ model: "nope", system: "", tools, messages: [] });
      } catch (err) {
        errors.push(err as ModelProviderError);
      }
    }

    expect(errors.map((e) => [e.kind, e.message])).toEqual([
      ["bad_request", expect.stringMatching(/isn't pulled \(run: ollama pull nope\)/)],
      ["unavailable", "ollama: HTTP 500: model runner has unexpectedly stopped"],
      ["bad_response", "ollama: unexpected /api/chat response shape"],
    ]);
  });

  it("reports an unreachable server as unavailable", async () => {
    const down = createOllamaProvider({ baseUrl: "http://127.0.0.1:1" });
    await expect(down.chat({ model: "m", system: "", tools, messages: [] })).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
