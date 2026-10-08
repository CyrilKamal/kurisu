import { describe, expect, it } from "vitest";

import {
  costUsd,
  loadModelsFile,
  parseModelRef,
  resolveRoles,
  type ModelsFile,
} from "../../src/llm/modelConfig.js";

const file: ModelsFile = {
  roles: {
    agent: "gemini:a",
    escalation: "gemini:b",
    eval: "ollama:qwen3.6:27b",
    brief: "gemini:a",
    recommend: "gemini:b",
  },
  ollama: { numCtx: 8192, think: false },
  pricesPerMillionTokens: {
    "gemini:a": { input: 0.3, output: 2.5 },
    "ollama:*": { input: 0, output: 0 },
  },
};

describe("parseModelRef", () => {
  it("splits on the first colon, so Ollama tags survive", () => {
    expect(parseModelRef("ollama:qwen3.6:27b")).toEqual({
      provider: "ollama",
      model: "qwen3.6:27b",
      ref: "ollama:qwen3.6:27b",
    });
    expect(parseModelRef("gemini:gemini-3.5-flash-lite").model).toBe("gemini-3.5-flash-lite");
  });

  it("rejects unknown providers and malformed refs", () => {
    for (const bad of ["openai:gpt", "gemini:", ":model", "gemini-3.5-flash-lite"]) {
      expect(() => parseModelRef(bad)).toThrow(/Invalid model reference/);
    }
  });
});

describe("resolveRoles", () => {
  it("uses config/models.json unless an environment override is set", () => {
    const roles = resolveRoles(file, { eval: "ollama:ornith:9b" });
    expect(roles.agent.ref).toBe("gemini:a");
    expect(roles.eval.ref).toBe("ollama:ornith:9b");
  });
});

describe("thinking levels", () => {
  it("attach to the roles config/models.json gives one", () => {
    const roles = resolveRoles({ ...file, thinking: { recommend: "low" } }, {});
    expect(roles.recommend).toEqual({
      provider: "gemini",
      model: "b",
      ref: "gemini:b",
      thinking: "low",
    });
    expect(roles.agent.thinking).toBeUndefined();
    // The price is still the model's.
    expect(roles.recommend.ref).toBe("gemini:b");
  });
});

describe("costUsd", () => {
  it("prices exact refs and provider wildcards, and admits unknown ones", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 200_000 };
    expect(costUsd(file, parseModelRef("gemini:a"), usage)).toBeCloseTo(0.3 + 0.5);
    expect(costUsd(file, parseModelRef("ollama:anything"), usage)).toBe(0);
    expect(costUsd(file, parseModelRef("gemini:unpriced"), usage)).toBeNull();
  });
});

describe("the committed config/models.json", () => {
  it("parses, and every role points at a priced model", () => {
    const committed = loadModelsFile();
    const roles = resolveRoles(committed, {});
    for (const ref of Object.values(roles)) {
      expect(costUsd(committed, ref, { inputTokens: 1, outputTokens: 1 })).not.toBeNull();
    }
  });
});
