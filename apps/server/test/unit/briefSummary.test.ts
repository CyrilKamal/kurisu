import { describe, expect, it } from "vitest";

import type { BriefItem } from "../../src/brief/build.js";
import { isSafeSummary, writeSummary } from "../../src/brief/summary.js";
import { parseModelRef } from "../../src/llm/modelConfig.js";
import { ScriptedModels } from "../support/scriptedModels.js";

const items: BriefItem[] = [
  {
    malId: 1,
    title: "Kaiju No. 8",
    episodes: [11, 12],
    premiere: false,
    finale: true,
    episodesWatched: 10,
    services: ["Crunchyroll"],
  },
  {
    malId: 2,
    title: "Steel Ball Run",
    episodes: [1],
    premiere: true,
    finale: false,
    episodesWatched: 0,
    services: [],
  },
];

describe("isSafeSummary", () => {
  it("allows numbers from the brief: episodes, counts and titles", () => {
    expect(isSafeSummary("Kaiju No. 8 wraps up with episodes 11 and 12.", items)).toBe(true);
    expect(isSafeSummary("3 new episodes across 2 shows, including a premiere.", items)).toBe(true);
    expect(isSafeSummary("Steel Ball Run premieres today.", items)).toBe(true);
  });

  it("rejects invented numbers, long text and line breaks", () => {
    expect(isSafeSummary("Kaiju No. 8 episode 13 is out.", items)).toBe(false);
    expect(isSafeSummary("Season 4 of Steel Ball Run starts.", items)).toBe(false);
    expect(isSafeSummary("x".repeat(201), items)).toBe(false);
    expect(isSafeSummary("Two shows.\nOne premiere.", items)).toBe(false);
    expect(isSafeSummary("", items)).toBe(false);
  });
});

describe("writeSummary", () => {
  const ref = parseModelRef("gemini:brief-test");

  it("uses the model's line and records how it was written", async () => {
    const models = new ScriptedModels();
    models.script(ref.ref, [{ text: "  Kaiju No. 8 ends and Steel Ball Run premieres.  " }]);

    const summary = await writeSummary(models, ref, items);

    expect(summary).toEqual({
      text: "Kaiju No. 8 ends and Steel Ball Run premieres.",
      source: "model",
      model: "gemini:brief-test",
      promptVersion: "brief-summary@1",
      inputTokens: 100,
      outputTokens: 10,
      latencyMs: 5,
      rejected: null,
    });
    const [request] = models.requests;
    expect(request?.request.tools).toEqual([]);
    expect(request?.request.messages).toEqual([
      {
        role: "user",
        content: "New episodes:\nKaiju No. 8: eps 11–12, finale\nSteel Ball Run: ep 1, premiere",
      },
    ]);
  });

  it("falls back to the template when the line fails the check or the call fails", async () => {
    const models = new ScriptedModels();
    models.script(ref.ref, [
      { text: "Kaiju No. 8 episode 13 is here." },
      { throws: new Error("model down") },
    ]);

    expect(await writeSummary(models, ref, items)).toMatchObject({
      text: "3 new episodes from 2 shows you're watching.",
      source: "template",
      rejected: "failed_check",
    });
    expect(await writeSummary(models, ref, items)).toMatchObject({
      source: "template",
      rejected: "model_error",
      inputTokens: null,
    });
  });
});
