import { describe, expect, it } from "vitest";

import { throttle } from "../../eval/src/throttle.js";
import type { ModelClient } from "../../src/llm/modelClient.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { ModelProviderError, type ChatResponse } from "../../src/llm/types.js";

const REF = parseModelRef("gemini:test");
const REQUEST = { system: "s", messages: [], tools: [] };
const RESPONSE: ChatResponse = {
  text: "ok",
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 1,
};

describe("throttle", () => {
  it("spaces calls to the per-minute limit and counts the waiting", async () => {
    const waits: number[] = [];
    const inner: ModelClient = { chat: () => Promise.resolve(RESPONSE) };
    const models = throttle(inner, 60, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });

    await models.chat(REF, REQUEST);
    await models.chat(REF, REQUEST);
    await models.chat(REF, REQUEST);

    // The first call goes straight out; the next two wait for their one-second slots.
    expect(waits).toHaveLength(2);
    for (const ms of waits) expect(ms).toBeGreaterThan(900);
    expect(models.waitedMs).toBe(waits.reduce((a, b) => a + b, 0));
  });

  it("waits and retries when the provider is rate limited, but not for other errors", async () => {
    let calls = 0;
    const limited: ModelClient = {
      chat: () => {
        calls++;
        return calls < 3
          ? Promise.reject(new ModelProviderError("gemini", "rate_limited", "quota", 429))
          : Promise.resolve(RESPONSE);
      },
    };
    const noWait = () => Promise.resolve();
    await expect(throttle(limited, 6000, noWait).chat(REF, REQUEST)).resolves.toEqual(RESPONSE);
    expect(calls).toBe(3);

    const broken: ModelClient = {
      chat: () => Promise.reject(new ModelProviderError("gemini", "auth", "bad key", 401)),
    };
    await expect(throttle(broken, 6000, noWait).chat(REF, REQUEST)).rejects.toThrow(/bad key/);
  });
});
